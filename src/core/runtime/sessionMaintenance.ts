import type {
  RuntimeSessionCleanupContract,
  RuntimeSessionCompactionContract,
  RuntimeSessionCompactionRecord,
  RuntimeSessionHookContract,
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

export function cloneMaintenanceRequest(
  request: NonNullable<RuntimeSessionMaintenanceState['lastRequest']>,
): NonNullable<RuntimeSessionMaintenanceState['lastRequest']> {
  return {
    ...request,
    hookPayloads: request.hookPayloads.map((payload) => ({
      ...payload,
      ...(Object.prototype.hasOwnProperty.call(payload, 'payload')
        ? { payload: structuredClone(payload.payload) }
        : {}),
    })),
  };
}
