import type {
  RuntimeSessionCleanupContract,
  RuntimeSessionCompactionContract,
  RuntimeSessionCompactionRecord,
  RuntimeSessionHookContract,
  RuntimeSessionMaintenanceHookPayload,
  RuntimeSessionHookGroup,
  RuntimeSessionLifecycleContract,
  RuntimeSessionMaintenance,
  RuntimeSessionMaintenanceMarker,
  RuntimeSessionMaintenanceState,
  SessionInfo,
  SessionView,
} from '../types.js';

const COMPACTION_MESSAGE_THRESHOLD = 25;
const COMPACTION_TOKEN_THRESHOLD = 12_000;
const MAX_MAINTENANCE_REASON_LENGTH = 512;
const MAX_MAINTENANCE_PAYLOAD_STRING_LENGTH = 512;
const MAX_MAINTENANCE_PAYLOAD_ARRAY_ITEMS = 20;
const MAX_MAINTENANCE_PAYLOAD_OBJECT_KEYS = 20;
const MAX_MAINTENANCE_PAYLOAD_DEPTH = 4;
const MAX_MAINTENANCE_PAYLOAD_BYTES = 4 * 1024;
const REDACTED_VALUE = '[redacted]';
const TRUNCATED_VALUE = '[truncated]';
const SENSITIVE_MAINTENANCE_KEY_PATTERN =
  /(api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|cookie|session)/i;

export type RuntimeTrackedSessionMaintenanceState = RuntimeSessionMaintenanceState;

export interface BuildSessionMaintenanceInput {
  session: SessionInfo;
  view: Pick<SessionView, 'attached' | 'activity'>;
  wakeupPending?: boolean;
  trackedMaintenance?: RuntimeTrackedSessionMaintenanceState;
}

export function buildSessionMaintenance(
  input: BuildSessionMaintenanceInput,
): RuntimeSessionMaintenance {
  const totalTokens = input.session.totalInputTokens + input.session.totalOutputTokens;
  const hasEvidence = input.session.messageCount > 0
    || totalTokens > 0
    || Boolean(input.session.artifacts?.length);
  const compaction = buildCompactionContract(
    input.session,
    input.view.attached,
    totalTokens,
    hasEvidence,
    input.trackedMaintenance?.lastCompaction,
  );
  const preResetHooks = hasEvidence
    ? [
        createMemoryFlushHook(
          'pre_reset',
          'Export or flush durable memory before a hard reset clears the live session boundary.',
        ),
      ]
    : [];
  const preCompactionHooks = compaction.status !== 'not_ready'
    ? [
        createMemoryFlushHook(
          'pre_compaction',
          'Export or flush durable memory before compaction trims working context.',
        ),
      ]
    : [];
  const preFlushHooks = hasEvidence || sessionHasRetainedWorkspace(input.session)
    ? [
        createMemoryFlushHook(
          'pre_flush',
          'Export or flush durable memory before workspace cleanup or lifecycle flush runs.',
        ),
      ]
    : [];
  const cleanup = buildCleanupContract(input.session, input.view, Boolean(input.wakeupPending));
  const lastLifecycle = input.trackedMaintenance?.lastLifecycle
    ? cloneLifecycle(input.trackedMaintenance.lastLifecycle)
    : undefined;

  return {
    status: resolveMaintenanceStatus(compaction, cleanup, lastLifecycle),
    compaction,
    hooks: {
      preReset: buildHookGroup(preResetHooks),
      preCompaction: buildHookGroup(preCompactionHooks),
      preFlush: buildHookGroup(preFlushHooks),
    },
    resetBoundary: {
      status: input.trackedMaintenance?.lastResetAt ? 'cleared' : 'none',
      ...(input.trackedMaintenance?.lastResetAt
        ? { lastResetAt: input.trackedMaintenance.lastResetAt }
        : {}),
      reasonCodes: lastLifecycle?.action === 'reset'
        ? [...lastLifecycle.reasonCodes]
        : [],
    },
    cleanup,
    markers: (input.trackedMaintenance?.markers || []).map(cloneMarker),
    ...(input.trackedMaintenance?.lastRequest
      ? { lastRequest: cloneMaintenanceRequest(input.trackedMaintenance.lastRequest) }
      : {}),
    ...(lastLifecycle ? { lastLifecycle } : {}),
  };
}

function buildCompactionContract(
  session: SessionInfo,
  attached: boolean,
  totalTokens: number,
  hasEvidence: boolean,
  lastCompaction?: RuntimeSessionCompactionRecord,
): RuntimeSessionCompactionContract {
  const liveMessageCount = Math.max(
    0,
    session.messageCount - Math.min(lastCompaction?.baselineMessageCount ?? 0, session.messageCount),
  );
  const liveTotalTokens = Math.max(
    0,
    totalTokens - Math.min(lastCompaction?.baselineTotalTokens ?? 0, totalTokens),
  );
  const thresholdReasons: string[] = [];
  if (liveMessageCount >= COMPACTION_MESSAGE_THRESHOLD) {
    thresholdReasons.push('message_count_threshold');
  }
  if (liveTotalTokens >= COMPACTION_TOKEN_THRESHOLD) {
    thresholdReasons.push('token_threshold');
  }

  if (!hasEvidence) {
    return {
      status: 'not_ready',
      reasonCodes: ['no_runtime_evidence'],
      messageCount: liveMessageCount,
      totalTokens: liveTotalTokens,
      ...(lastCompaction ? { lastCompaction: cloneCompactionRecord(lastCompaction) } : {}),
    };
  }

  if (thresholdReasons.length === 0) {
    return {
      status: 'not_ready',
      reasonCodes: ['below_compaction_threshold'],
      messageCount: liveMessageCount,
      totalTokens: liveTotalTokens,
      ...(lastCompaction ? { lastCompaction: cloneCompactionRecord(lastCompaction) } : {}),
    };
  }

  return {
    status: session.status === 'closed' || !attached ? 'ready' : 'recommended',
    reasonCodes: [
      ...thresholdReasons,
      session.status === 'closed' || !attached ? 'session_inactive' : 'session_active',
    ],
    messageCount: liveMessageCount,
    totalTokens: liveTotalTokens,
    ...(lastCompaction ? { lastCompaction: cloneCompactionRecord(lastCompaction) } : {}),
  };
}

function buildCleanupContract(
  session: SessionInfo,
  view: Pick<SessionView, 'attached' | 'activity'>,
  wakeupPending: boolean,
): RuntimeSessionCleanupContract {
  const reasonCodes: string[] = [];
  if (session.workspaceMode === 'isolated') {
    reasonCodes.push('isolated_workspace_retained');
  }
  if (session.workspaceIsolation?.mode === 'worktree' && session.workspaceIsolation.worktree) {
    if (session.workspaceIsolation.worktree.lastCleanup?.policy === 'preserve') {
      reasonCodes.push('worktree_preserved');
    } else {
      reasonCodes.push('worktree_retained');
    }
  }
  if (session.providerSessionId) {
    reasonCodes.push('provider_resume_state_retained');
  }
  if (session.providerState) {
    reasonCodes.push('provider_state_retained');
  }
  if (wakeupPending) {
    reasonCodes.push('scheduled_wakeup_retained');
  }
  // This captures externally resumed or discovered sessions that are still interactive
  // even though cats-runtime is no longer attached to the worker handle.
  if (!view.attached && view.activity === 'interactive') {
    reasonCodes.push('externally_active_session');
  }

  if (reasonCodes.length === 0) {
    return {
      status: 'clean',
      reasonCodes: [],
    };
  }

  if (
    session.status === 'closed'
    && !view.attached
    && reasonCodes.every((reason) =>
      reason === 'isolated_workspace_retained'
        || reason === 'worktree_retained'
        || reason === 'worktree_preserved',
    )
  ) {
    return {
      status: 'ready',
      reasonCodes,
    };
  }

  return {
    status: 'recommended',
    reasonCodes,
  };
}

function sessionHasRetainedWorkspace(session: SessionInfo): boolean {
  return session.workspaceMode === 'isolated'
    || session.workspaceIsolation?.mode === 'worktree';
}

function resolveMaintenanceStatus(
  compaction: RuntimeSessionCompactionContract,
  cleanup: RuntimeSessionCleanupContract,
  lastLifecycle?: RuntimeSessionLifecycleContract,
): RuntimeSessionMaintenance['status'] {
  if (cleanup.status === 'ready') {
    return 'cleanup_ready';
  }

  if (
    cleanup.status === 'recommended'
    || compaction.status === 'ready'
    || lastLifecycle?.status === 'retained'
  ) {
    return 'attention';
  }

  return 'clean';
}

function createMemoryFlushHook(
  phase: RuntimeSessionHookContract['phase'],
  reason: string,
): RuntimeSessionHookContract {
  return {
    id: 'memory_flush',
    phase,
    status: 'pending',
    owner: 'product_memory',
    reason,
  };
}

function buildHookGroup(pending: RuntimeSessionHookContract[]): RuntimeSessionHookGroup {
  return {
    available: true,
    pending: pending.map(cloneHook),
  };
}

function cloneLifecycle(
  lifecycle: RuntimeSessionLifecycleContract,
): RuntimeSessionLifecycleContract {
  return {
    ...lifecycle,
    reasonCodes: [...lifecycle.reasonCodes],
    cleanup: { ...lifecycle.cleanup },
  };
}

function cloneCompactionRecord(
  record: RuntimeSessionCompactionRecord,
): RuntimeSessionCompactionRecord {
  return {
    ...record,
    ...(record.archivePath ? { archivePath: record.archivePath } : {}),
  };
}

function cloneMarker(
  marker: RuntimeSessionMaintenanceMarker,
): RuntimeSessionMaintenanceMarker {
  return {
    ...marker,
    ...(marker.details ? { details: { ...marker.details } } : {}),
  };
}

function cloneHook(
  hook: RuntimeSessionHookContract,
): RuntimeSessionHookContract {
  return {
    ...hook,
  };
}

interface MaintenancePayloadSanitizationFlags {
  redacted: boolean;
  truncated: boolean;
  warnings: Set<string>;
}

function sanitizeMaintenanceString(
  value: string,
  limit: number,
  flags: MaintenancePayloadSanitizationFlags,
): string {
  if (value.length <= limit) {
    return value;
  }

  flags.truncated = true;
  flags.warnings.add('string_truncated');
  return `${value.slice(0, Math.max(0, limit - 1))}\u2026`;
}

function sanitizeMaintenancePayloadValue(
  value: unknown,
  depth: number,
  flags: MaintenancePayloadSanitizationFlags,
): unknown {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return sanitizeMaintenanceString(value, MAX_MAINTENANCE_PAYLOAD_STRING_LENGTH, flags);
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value;
    }
    flags.truncated = true;
    flags.warnings.add('non_finite_number_stringified');
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    flags.truncated = true;
    flags.warnings.add('bigint_stringified');
    return value.toString();
  }

  if (typeof value === 'undefined') {
    flags.truncated = true;
    flags.warnings.add('undefined_value_dropped');
    return undefined;
  }

  if (typeof value !== 'object') {
    flags.truncated = true;
    flags.warnings.add('unsupported_value_dropped');
    return undefined;
  }

  if (depth >= MAX_MAINTENANCE_PAYLOAD_DEPTH) {
    flags.truncated = true;
    flags.warnings.add('max_depth_reached');
    return TRUNCATED_VALUE;
  }

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_MAINTENANCE_PAYLOAD_ARRAY_ITEMS);
    if (limited.length !== value.length) {
      flags.truncated = true;
      flags.warnings.add('array_items_truncated');
    }

    const sanitizedItems: unknown[] = [];
    for (const item of limited) {
      const sanitized = sanitizeMaintenancePayloadValue(item, depth + 1, flags);
      if (sanitized !== undefined) {
        sanitizedItems.push(sanitized);
      }
    }
    return sanitizedItems;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const limitedEntries = entries.slice(0, MAX_MAINTENANCE_PAYLOAD_OBJECT_KEYS);
  if (limitedEntries.length !== entries.length) {
    flags.truncated = true;
    flags.warnings.add('object_keys_truncated');
  }

  const sanitizedRecord: Record<string, unknown> = {};
  for (const [key, item] of limitedEntries) {
    if (SENSITIVE_MAINTENANCE_KEY_PATTERN.test(key)) {
      flags.redacted = true;
      flags.warnings.add('sensitive_keys_redacted');
      sanitizedRecord[key] = REDACTED_VALUE;
      continue;
    }

    const sanitized = sanitizeMaintenancePayloadValue(item, depth + 1, flags);
    if (sanitized !== undefined) {
      sanitizedRecord[key] = sanitized;
    }
  }

  return sanitizedRecord;
}

function buildMaintenancePayloadStatus(
  flags: MaintenancePayloadSanitizationFlags,
  omitted: boolean,
): NonNullable<RuntimeSessionMaintenanceHookPayload['payloadStatus']> {
  if (omitted) {
    return 'omitted';
  }
  if (flags.redacted && flags.truncated) {
    return 'redacted_and_truncated';
  }
  if (flags.redacted) {
    return 'redacted';
  }
  if (flags.truncated) {
    return 'truncated';
  }
  return 'stored';
}

function cloneMaintenanceHookPayload(
  payload: RuntimeSessionMaintenanceHookPayload,
): RuntimeSessionMaintenanceHookPayload {
  if (!Object.prototype.hasOwnProperty.call(payload, 'payload')) {
    return {
      kind: payload.kind,
      ...(payload.payloadStatus ? { payloadStatus: payload.payloadStatus } : {}),
      ...(payload.payloadWarnings ? { payloadWarnings: [...payload.payloadWarnings] } : {}),
      ...(typeof payload.payloadBytes === 'number' ? { payloadBytes: payload.payloadBytes } : {}),
    };
  }

  const flags: MaintenancePayloadSanitizationFlags = {
    redacted: payload.payloadStatus === 'redacted' || payload.payloadStatus === 'redacted_and_truncated',
    truncated: payload.payloadStatus === 'truncated' || payload.payloadStatus === 'redacted_and_truncated',
    warnings: new Set<string>(payload.payloadWarnings ?? []),
  };
  const sanitizedPayload = sanitizeMaintenancePayloadValue(payload.payload, 0, flags);
  const payloadJson = sanitizedPayload === undefined ? '' : JSON.stringify(sanitizedPayload);
  const payloadBytes = payloadJson.length > 0 ? Buffer.byteLength(payloadJson, 'utf8') : 0;
  const omitted = sanitizedPayload === undefined || payloadBytes > MAX_MAINTENANCE_PAYLOAD_BYTES;

  if (payloadBytes > MAX_MAINTENANCE_PAYLOAD_BYTES) {
    flags.truncated = true;
    flags.warnings.add('payload_bytes_exceeded');
  }

  const payloadWarnings = Array.from(flags.warnings.values());
  return {
    kind: payload.kind,
    ...(!omitted ? { payload: structuredClone(sanitizedPayload) } : {}),
    payloadStatus: buildMaintenancePayloadStatus(flags, omitted),
    ...(payloadWarnings.length > 0 ? { payloadWarnings } : {}),
    ...(payloadBytes > 0 ? { payloadBytes } : {}),
  };
}

export function cloneMaintenanceRequest(
  request: NonNullable<RuntimeSessionMaintenanceState['lastRequest']>,
): NonNullable<RuntimeSessionMaintenanceState['lastRequest']> {
  const reason = request.reason
    ? request.reason.length > MAX_MAINTENANCE_REASON_LENGTH
      ? `${request.reason.slice(0, MAX_MAINTENANCE_REASON_LENGTH - 1)}\u2026`
      : request.reason
    : undefined;
  const reasonTruncated = Boolean(request.reasonTruncated || (request.reason && reason !== request.reason));
  return {
    ...request,
    ...(reason ? { reason } : {}),
    ...(reasonTruncated ? { reasonTruncated: true } : {}),
    hookPayloads: request.hookPayloads.map((payload) => cloneMaintenanceHookPayload(payload)),
  };
}
