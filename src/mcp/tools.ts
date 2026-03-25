import type { SessionStatus } from '../backends/cli/pool/types.js';
import { RUNTIME_VERSION } from '../startup.js';
import {
  getRuntimeBrowserService,
  getRuntimeDeliveryService,
  getRuntimeManagementService,
  getRuntimeSessionManager,
  getWorkspaceSubstrateService,
  type AppContext,
} from '../http/app.js';
import { buildMcpObserveSessionPayload, buildMcpSessionSummary } from './readModels.js';
import { requestRuntimeJson, requestRuntimeNdjson } from './runtimeRequests.js';
import type {
  McpToolCallResult,
  McpToolDefinition,
  McpToolHandler,
} from './types.js';

class McpToolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

const SESSION_STATUSES: SessionStatus[] = [
  'initializing',
  'ready',
  'busy',
  'closed',
  'closing',
];
const WORKSPACE_MODES = ['isolated', 'shared', 'read_only'] as const;
const WORKSPACE_ISOLATION_MODES = ['shared', 'isolated', 'worktree'] as const;
const WORKTREE_CLEANUP_POLICIES = ['discard', 'merge', 'preserve'] as const;
const MAINTENANCE_FOLLOW_THROUGH_ACTIONS = [
  'reset',
  'delete',
  'cleanup_workspace',
  'compact',
] as const;
const MAINTENANCE_FOLLOW_THROUGH_PHASES = [
  'pre_reset',
  'pre_compaction',
  'pre_flush',
] as const;
const COMPACTION_FOLLOW_THROUGH_OUTCOMES = [
  'acknowledged',
  'retry_requested',
  'completed',
] as const;
const PERMISSION_MODES = ['skip', 'whitelist', 'default'] as const;
const REUSE_POLICIES = ['create_new', 'prefer_existing', 'require_existing'] as const;
const FORK_MODES = ['auto', 'native_fork', 'context_transplant'] as const;
const SUBSTRATE_PROFILES = ['minimal', 'standard', 'a2a-enabled'] as const;
const ENABLED_AGENTS = ['claude', 'gemini', 'codex'] as const;
const DIAGNOSTICS_PROBE_MODES = ['light', 'live'] as const;
const PROVIDER_BACKENDS = ['cli', 'api', 'local', 'agent'] as const;
const RUNTIME_SKILL_FAMILIES = ['base', 'orchestration', 'work', 'chat', 'code'] as const;
const RUNTIME_SKILL_PACKAGE_KINDS = ['base', 'role', 'bundle'] as const;
const RUNTIME_SKILL_DELIVERY_HINTS = ['filesystem', 'instructions', 'none'] as const;
const RUNTIME_SKILL_SORT_FIELDS = ['id', 'title', 'family', 'slug', 'role'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;
const RUNTIME_BROWSER_SESSION_STATUSES = ['ready', 'closed'] as const;
const BROWSER_BINDING_KINDS = ['manual_url', 'session_service', 'session_artifact'] as const;
const ACTOR_ROLES = [
  'boss_cat',
  'specialist_cat',
  'system',
  'owner',
  'product_host',
  'operator',
] as const;
const MANAGEMENT_ACTOR_CLASSES = ['system', 'owner', 'operator', 'service'] as const;

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpToolError(-32602, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalSessionStatus(
  record: Record<string, unknown>,
  key: string,
): SessionStatus | undefined {
  return readOptionalEnumString(record, key, SESSION_STATUSES, `${key} must be a valid session status`);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);
  if (!value) {
    throw new McpToolError(-32602, `${key} is required`);
  }
  return value;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? record[key] as boolean : undefined;
}

function readOptionalInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new McpToolError(-32602, `${key} must be an integer >= ${minimum}`);
  }
  return value;
}

function readOptionalObject(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return asRecord(record[key]);
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? items : undefined;
}

function readOptionalEnumString<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errorMessage?: string,
): T | undefined {
  const value = readOptionalString(record, key);
  if (!value) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new McpToolError(-32602, errorMessage ?? `${key} must be one of: ${allowed.join(', ')}`);
}

function readOptionalEnumStringArray<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errorMessage?: string,
): T[] | undefined {
  const values = readOptionalStringArray(record, key);
  if (!values) {
    return undefined;
  }
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new McpToolError(
        -32602,
        errorMessage ?? `${key} values must be one of: ${allowed.join(', ')}`,
      );
    }
  }
  return values as T[];
}

function readRouteErrorMessage(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const message = typeof record?.error === 'string'
    ? record.error
    : typeof record?.message === 'string'
      ? record.message
      : undefined;
  return message || fallback;
}

function throwRouteError(
  operation: string,
  status: number,
  body: unknown,
): never {
  throw new McpToolError(
    -32000,
    readRouteErrorMessage(body, `${operation} failed with status ${status}`),
    {
      operation,
      httpStatus: status,
      body,
    },
  );
}

function ensureRouteSuccess(
  operation: string,
  status: number,
  body: unknown,
): void {
  if (status >= 200 && status < 300) {
    return;
  }
  throwRouteError(operation, status, body);
}

function buildSessionPaths(sessionId: string) {
  return {
    sessionPath: `/sessions/${sessionId}`,
    observePath: `/sessions/${sessionId}/observe`,
    historyPath: `/sessions/${sessionId}/history`,
    messagePath: `/sessions/${sessionId}/messages`,
  };
}

function buildBrowserSessionPaths(browserSessionId: string) {
  return {
    browserSessionPath: `/browser/sessions/${browserSessionId}`,
    createBrowserPagePath: `/browser/sessions/${browserSessionId}/pages`,
    closeBrowserSessionPath: `/browser/sessions/${browserSessionId}/close`,
  };
}

function appendQueryValues(
  searchParams: URLSearchParams,
  key: string,
  values: string[] | undefined,
): void {
  if (!values?.length) {
    return;
  }
  for (const value of values) {
    searchParams.append(key, value);
  }
}

function appendSingleQueryValue(
  searchParams: URLSearchParams,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) {
    return;
  }
  searchParams.set(key, String(value));
}

function runtimeSummary(ctx: AppContext): McpToolCallResult {
  const sessions = ctx.registry.list();
  const byStatus: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  for (const session of sessions) {
    byStatus[session.status] = (byStatus[session.status] ?? 0) + 1;
    byProvider[session.providerName] = (byProvider[session.providerName] ?? 0) + 1;
  }

  const poolStatus = ctx.pool.status();
  const runtime = getRuntimeSessionManager(ctx);
  const attached = sessions.filter((session) => runtime.isAttached(session.id)).length;

  const structuredContent = {
    service: 'cats-runtime',
    version: RUNTIME_VERSION,
    startup: {
      mode: ctx.startup.mode,
      phase: ctx.startup.phase,
      ready: ctx.startup.ready,
      readySignal: ctx.startup.readySignal,
      readinessPath: ctx.startup.readinessPath,
      address: ctx.startup.address,
    },
    sessions: {
      total: sessions.length,
      attached,
      byStatus,
      byProvider,
    },
    pool: poolStatus,
    diagnostics: {
      healthPath: '/health',
      runtimePath: '/diagnostics/runtime',
      providersPath: '/diagnostics/providers',
      mcpPath: '/mcp',
    },
  };

  return {
    summary: `Runtime ${ctx.startup.phase}; ${sessions.length} session(s) tracked.`,
    structuredContent,
  };
}

async function listSessions(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessions = ctx.registry.list({
    provider: readOptionalString(args, 'provider'),
    status: readOptionalSessionStatus(args, 'status'),
  });
  const includeInspection = readOptionalBoolean(args, 'includeInspection') === true;

  return {
    summary: `Returned ${sessions.length} session(s).`,
    structuredContent: {
      sessions: sessions.map((session) =>
        buildMcpSessionSummary(ctx, session, { includeInspection }),
      ),
    },
  };
}

async function providerDiagnostics(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const searchParams = new URLSearchParams();
  appendSingleQueryValue(
    searchParams,
    'probe',
    readOptionalEnumString(
      args,
      'probe',
      DIAGNOSTICS_PROBE_MODES,
      'probe must be a valid diagnostics probe mode',
    ),
  );
  appendSingleQueryValue(searchParams, 'provider', readOptionalString(args, 'provider'));
  appendSingleQueryValue(
    searchParams,
    'backend',
    readOptionalEnumString(
      args,
      'backend',
      PROVIDER_BACKENDS,
      'backend must be a valid provider backend',
    ),
  );
  appendSingleQueryValue(searchParams, 'instance', readOptionalString(args, 'instance'));
  if (readOptionalBoolean(args, 'defaultOnly') === true) {
    searchParams.set('defaultOnly', 'true');
  }
  if (readOptionalBoolean(args, 'forceRefresh') === true) {
    searchParams.set('force', '1');
  }

  const path = searchParams.size > 0
    ? `/diagnostics/providers?${searchParams.toString()}`
    : '/diagnostics/providers';
  const result = await requestRuntimeJson(ctx, path, { method: 'GET' });
  ensureRouteSuccess('provider_diagnostics', result.status, result.body);

  const payload = ensureObject(result.body, 'provider_diagnostics result');
  const summary = asRecord(payload.summary);
  const targets = typeof summary?.targets === 'number' ? summary.targets : 0;

  return {
    summary: `Provider diagnostics cover ${targets} target(s).`,
    structuredContent: {
      ...payload,
      providersPath: path,
    },
  };
}

async function observeSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const session = ctx.registry.get(sessionId);
  if (!session) {
    throw new McpToolError(-32602, `Unknown session '${sessionId}'`);
  }

  return {
    summary: `Observation snapshot for session ${sessionId}.`,
    structuredContent: buildMcpObserveSessionPayload(ctx, session),
  };
}

async function listRuntimeSkills(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const searchParams = new URLSearchParams();
  appendQueryValues(searchParams, 'id', readOptionalStringArray(args, 'id'));
  appendQueryValues(
    searchParams,
    'family',
    readOptionalEnumStringArray(
      args,
      'family',
      RUNTIME_SKILL_FAMILIES,
      'family must be a valid runtime skill family',
    ),
  );
  appendQueryValues(searchParams, 'slug', readOptionalStringArray(args, 'slug'));
  appendQueryValues(searchParams, 'role', readOptionalStringArray(args, 'role'));
  appendQueryValues(
    searchParams,
    'packageKind',
    readOptionalEnumStringArray(
      args,
      'packageKind',
      RUNTIME_SKILL_PACKAGE_KINDS,
      'packageKind must be a valid runtime skill package kind',
    ),
  );
  appendQueryValues(
    searchParams,
    'capabilityTag',
    readOptionalStringArray(args, 'capabilityTag'),
  );
  appendQueryValues(searchParams, 'productTag', readOptionalStringArray(args, 'productTag'));
  appendQueryValues(
    searchParams,
    'deliveryHint',
    readOptionalEnumStringArray(
      args,
      'deliveryHint',
      RUNTIME_SKILL_DELIVERY_HINTS,
      'deliveryHint must be a valid runtime skill delivery hint',
    ),
  );
  const sortBy = readOptionalEnumString(
    args,
    'sortBy',
    RUNTIME_SKILL_SORT_FIELDS,
    'sortBy must be a valid runtime skill sort field',
  );
  const sortDirection = readOptionalEnumString(
    args,
    'sortDirection',
    SORT_DIRECTIONS,
    'sortDirection must be a valid sort direction',
  );
  if (sortDirection && !sortBy) {
    throw new McpToolError(-32602, 'sortDirection requires sortBy');
  }
  appendSingleQueryValue(searchParams, 'sortBy', sortBy);
  appendSingleQueryValue(searchParams, 'sortDirection', sortBy ? sortDirection : undefined);
  const offset = readOptionalInteger(args, 'offset', 0);
  const limit = readOptionalInteger(args, 'limit', 1);
  if (offset !== undefined) {
    searchParams.set('offset', String(offset));
  }
  if (limit !== undefined) {
    searchParams.set('limit', String(limit));
  }

  const path = searchParams.size > 0
    ? `/skills/catalog?${searchParams.toString()}`
    : '/skills/catalog';
  const result = await requestRuntimeJson(ctx, path, { method: 'GET' });
  ensureRouteSuccess('list_runtime_skills', result.status, result.body);

  const payload = ensureObject(result.body, 'list_runtime_skills result');
  const count = typeof payload.count === 'number'
    ? payload.count
    : Array.isArray(payload.skills)
      ? payload.skills.length
      : 0;

  return {
    summary: `Returned ${count} runtime skill(s).`,
    structuredContent: {
      ...payload,
      catalogPath: path,
    },
  };
}

async function auditWorkspace(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const service = getWorkspaceSubstrateService(ctx);
  const workspacePath = readRequiredString(args, 'workspacePath');
  const profile = readOptionalEnumString(
    args,
    'profile',
    SUBSTRATE_PROFILES,
    'profile must be a valid workspace substrate profile',
  );
  const enabledAgents = readOptionalEnumStringArray(
    args,
    'enabledAgents',
    ENABLED_AGENTS,
    'enabledAgents must be one of: claude, gemini, codex',
  );
  const includeA2A = readOptionalBoolean(args, 'includeA2A');
  const result = await service.execute({
    operation: 'audit-workspace',
    workspacePath,
    ...(profile ? { profile } : {}),
    ...(enabledAgents ? { enabledAgents } : {}),
    ...(includeA2A !== undefined ? { includeA2A } : {}),
  });

  return {
    summary: `Workspace audit ${result.status} for ${workspacePath}.`,
    structuredContent: result,
  };
}

async function auditDeliveryTarget(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const workspacePath = readOptionalString(args, 'workspacePath');
  const sessionId = readOptionalString(args, 'sessionId');
  if (!workspacePath && !sessionId) {
    throw new McpToolError(-32602, 'workspacePath or sessionId is required');
  }

  const result = await getRuntimeDeliveryService(ctx).execute({
    action: 'audit-delivery-target',
    workspacePath,
    sessionId,
    artifactIds: readOptionalStringArray(args, 'artifactIds'),
    preview: (
      readOptionalBoolean(args, 'includeSessionArtifacts') !== undefined
      || readOptionalBoolean(args, 'includeSessionServices') !== undefined
    )
      ? {
          includeSessionArtifacts: readOptionalBoolean(args, 'includeSessionArtifacts'),
          includeSessionServices: readOptionalBoolean(args, 'includeSessionServices'),
        }
      : undefined,
  });

  return {
    summary: `Delivery audit ${result.state} for ${sessionId || workspacePath}.`,
    structuredContent: result,
  };
}

async function createSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = await requestRuntimeJson(ctx, '/sessions', {
    body: args,
  });
  ensureRouteSuccess('create_session', result.status, result.body);

  const session = ensureObject(result.body, 'create_session result');
  const sessionId = readRequiredString(session, 'id');
  const reused = result.status === 200;
  return {
    summary: reused
      ? `Reused session ${sessionId}.`
      : `Created session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      reused,
      session,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function sendMessage(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  readRequiredString(args, 'message');
  const { sessionId: _sessionId, ...body } = args;
  const result = await requestRuntimeNdjson(
    ctx,
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    { body },
  );
  ensureRouteSuccess('send_message', result.status, result.body);

  const session = ctx.registry.get(sessionId);
  return {
    summary: `Completed message turn for session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      sessionId,
      events: result.events,
      ...(session
        ? { session: buildMcpSessionSummary(ctx, session, { includeInspection: true }) }
        : {}),
      ...buildSessionPaths(sessionId),
    },
  };
}

async function closeSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const body: Record<string, unknown> = {};
  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const closePath = `/sessions/${encodeURIComponent(sessionId)}/close`;
  const result = await requestRuntimeJson(ctx, closePath, {
    body,
  });
  ensureRouteSuccess('close_session', result.status, result.body);

  const payload = ensureObject(result.body, 'close_session result');
  return {
    summary: `Closed session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      closePath,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function resetSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const body: Record<string, unknown> = {};
  const requireAcknowledgedHooks = readOptionalBoolean(args, 'requireAcknowledgedHooks');
  if (requireAcknowledgedHooks !== undefined) {
    body.requireAcknowledgedHooks = requireAcknowledgedHooks;
  }
  const worktreeCleanupPolicy = readOptionalEnumString(
    args,
    'worktreeCleanupPolicy',
    WORKTREE_CLEANUP_POLICIES,
    'worktreeCleanupPolicy must be a valid worktree cleanup policy',
  );
  if (worktreeCleanupPolicy) {
    body.worktreeCleanupPolicy = worktreeCleanupPolicy;
  }

  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const resetPath = `/sessions/${encodeURIComponent(sessionId)}/reset`;
  const result = await requestRuntimeJson(ctx, resetPath, {
    body,
  });
  ensureRouteSuccess('reset_session', result.status, result.body);

  const payload = ensureObject(result.body, 'reset_session result');
  const status = readOptionalString(payload, 'status');
  return {
    summary: status === 'retained'
      ? `Reset session ${sessionId}, but workspace cleanup still needs attention.`
      : `Reset session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      resetPath,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function deleteSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const body: Record<string, unknown> = {};
  const requireAcknowledgedHooks = readOptionalBoolean(args, 'requireAcknowledgedHooks');
  if (requireAcknowledgedHooks !== undefined) {
    body.requireAcknowledgedHooks = requireAcknowledgedHooks;
  }
  const worktreeCleanupPolicy = readOptionalEnumString(
    args,
    'worktreeCleanupPolicy',
    WORKTREE_CLEANUP_POLICIES,
    'worktreeCleanupPolicy must be a valid worktree cleanup policy',
  );
  if (worktreeCleanupPolicy) {
    body.worktreeCleanupPolicy = worktreeCleanupPolicy;
  }

  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const deletePath = `/sessions/${encodeURIComponent(sessionId)}`;
  const result = await requestRuntimeJson(ctx, deletePath, {
    method: 'DELETE',
    body,
  });
  ensureRouteSuccess('delete_session', result.status, result.body);

  const payload = ensureObject(result.body, 'delete_session result');
  const status = readOptionalString(payload, 'status');
  return {
    summary: status === 'retained'
      ? `Delete for session ${sessionId} is retained until cleanup finishes safely.`
      : `Deleted session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      deletePath,
    },
  };
}

async function forkSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const { sessionId: _sessionId, ...body } = args;
  const result = await requestRuntimeJson(
    ctx,
    `/sessions/${encodeURIComponent(sessionId)}/fork`,
    { body },
  );
  ensureRouteSuccess('fork_session', result.status, result.body);

  const forked = ensureObject(result.body, 'fork_session result');
  const forkedId = readRequiredString(forked, 'id');
  return {
    summary: `Forked session ${sessionId} into ${forkedId}.`,
    structuredContent: {
      responseStatus: result.status,
      session: forked,
      ...buildSessionPaths(forkedId),
    },
  };
}

async function cleanupSessionWorkspace(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const body: Record<string, unknown> = {};
  const requireAcknowledgedHooks = readOptionalBoolean(args, 'requireAcknowledgedHooks');
  if (requireAcknowledgedHooks !== undefined) {
    body.requireAcknowledgedHooks = requireAcknowledgedHooks;
  }
  const worktreeCleanupPolicy = readOptionalEnumString(
    args,
    'worktreeCleanupPolicy',
    WORKTREE_CLEANUP_POLICIES,
    'worktreeCleanupPolicy must be a valid worktree cleanup policy',
  );
  if (worktreeCleanupPolicy) {
    body.worktreeCleanupPolicy = worktreeCleanupPolicy;
  }

  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const cleanupPath = `/sessions/${encodeURIComponent(sessionId)}/workspace/cleanup`;
  const result = await requestRuntimeJson(ctx, cleanupPath, {
    body,
  });
  ensureRouteSuccess('cleanup_session_workspace', result.status, result.body);

  const payload = ensureObject(result.body, 'cleanup_session_workspace result');
  const status = readOptionalString(payload, 'status');
  return {
    summary: status === 'retained'
      ? `Retained worktree cleanup still needs attention for session ${sessionId}.`
      : `Retried worktree cleanup for session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      cleanupPath,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function compactSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const body: Record<string, unknown> = {};
  const acknowledgeHooks = readOptionalBoolean(args, 'acknowledgeHooks');
  if (acknowledgeHooks !== undefined) {
    body.acknowledgeHooks = acknowledgeHooks;
  }

  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const compactPath = `/sessions/${encodeURIComponent(sessionId)}/compact`;
  const result = await requestRuntimeJson(ctx, compactPath, {
    body,
  });
  ensureRouteSuccess('compact_session', result.status, result.body);

  const payload = ensureObject(result.body, 'compact_session result');
  const status = readOptionalString(payload, 'status');
  return {
    summary: status === 'compacted'
      ? `Compacted runtime-managed transcript for session ${sessionId}.`
      : status === 'pending_hooks'
        ? `Compaction for session ${sessionId} is waiting on maintenance hooks.`
        : status === 'ready_for_external_compaction'
          ? `Compaction for session ${sessionId} is ready for external compaction.`
        : status === 'deferred'
          ? `Compaction for session ${sessionId} is deferred until the session is inactive.`
          : status === 'not_ready'
            ? `Compaction for session ${sessionId} is not ready yet.`
            : `Prepared compaction coordination for session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      compactPath,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function reportSessionMaintenanceFollowThrough(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const action = readOptionalEnumString(
    args,
    'action',
    MAINTENANCE_FOLLOW_THROUGH_ACTIONS,
    'action must be one of: reset, delete, cleanup_workspace, compact',
  );
  if (!action) {
    throw new McpToolError(-32602, 'action is required');
  }

  const phase = readOptionalEnumString(
    args,
    'phase',
    MAINTENANCE_FOLLOW_THROUGH_PHASES,
    'phase must be one of: pre_reset, pre_compaction, pre_flush',
  );
  if (!phase) {
    throw new McpToolError(-32602, 'phase is required');
  }

  const outcome = readOptionalEnumString(
    args,
    'outcome',
    COMPACTION_FOLLOW_THROUGH_OUTCOMES,
    'outcome must be one of: acknowledged, retry_requested, completed',
  );
  if (!outcome) {
    throw new McpToolError(-32602, 'outcome is required');
  }

  const body: Record<string, unknown> = {
    action,
    phase,
    outcome,
  };
  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const followThroughPath = `/sessions/${encodeURIComponent(sessionId)}/maintenance/follow-through`;
  const result = await requestRuntimeJson(ctx, followThroughPath, {
    body,
  });
  ensureRouteSuccess('report_session_maintenance_follow_through', result.status, result.body);

  const payload = ensureObject(result.body, 'report_session_maintenance_follow_through result');
  return {
    summary: outcome === 'retry_requested'
      ? `Requested ${phase} retry for ${action} on session ${sessionId}.`
      : outcome === 'completed'
        ? `Reported ${phase} completion for ${action} on session ${sessionId}.`
        : `Acknowledged ${phase} hooks for ${action} on session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      followThroughPath,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function reportCompactionFollowThrough(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const outcome = readOptionalEnumString(
    args,
    'outcome',
    COMPACTION_FOLLOW_THROUGH_OUTCOMES,
    'outcome must be one of: acknowledged, retry_requested, completed',
  );
  if (!outcome) {
    throw new McpToolError(-32602, 'outcome is required');
  }

  const body: Record<string, unknown> = { outcome };
  const maintenance = readOptionalObject(args, 'maintenance');
  if (maintenance) {
    body.maintenance = maintenance;
  }

  const followThroughPath = `/sessions/${encodeURIComponent(sessionId)}/compact/follow-through`;
  const result = await requestRuntimeJson(ctx, followThroughPath, {
    body,
  });
  ensureRouteSuccess('report_compaction_follow_through', result.status, result.body);

  const payload = ensureObject(result.body, 'report_compaction_follow_through result');
  return {
    summary: outcome === 'retry_requested'
      ? `Requested compaction hook retry for session ${sessionId}.`
      : outcome === 'completed'
        ? `Reported external compaction completion for session ${sessionId}.`
        : `Acknowledged compaction hooks for session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      followThroughPath,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function listBrowserDrivers(
  ctx: AppContext,
  _args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const drivers = getRuntimeBrowserService(ctx).listDrivers();
  return {
    summary: `Returned ${drivers.length} browser driver(s).`,
    structuredContent: {
      drivers,
      driversPath: '/browser/drivers',
    },
  };
}

async function listBrowserSessions(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const driverId = readOptionalString(args, 'driverId');
  const runtimeSessionId = readOptionalString(args, 'runtimeSessionId');
  const status = readOptionalEnumString(
    args,
    'status',
    RUNTIME_BROWSER_SESSION_STATUSES,
    'status must be a valid browser session status',
  );
  const sessions = getRuntimeBrowserService(ctx).listSessions({
    ...(driverId ? { driverId } : {}),
    ...(runtimeSessionId ? { runtimeSessionId } : {}),
    ...(status ? { status } : {}),
  });
  return {
    summary: `Returned ${sessions.length} browser session(s).`,
    structuredContent: {
      sessions,
      sessionsPath: '/browser/sessions',
    },
  };
}

async function browserSummary(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const searchParams = new URLSearchParams();
  appendSingleQueryValue(searchParams, 'driverId', readOptionalString(args, 'driverId'));
  appendSingleQueryValue(searchParams, 'runtimeSessionId', readOptionalString(args, 'runtimeSessionId'));
  appendSingleQueryValue(
    searchParams,
    'status',
    readOptionalEnumString(
      args,
      'status',
      RUNTIME_BROWSER_SESSION_STATUSES,
      'status must be a valid browser session status',
    ),
  );
  appendSingleQueryValue(searchParams, 'olderThanMs', readOptionalInteger(args, 'olderThanMs', 0));

  const path = searchParams.size > 0
    ? `/browser/summary?${searchParams.toString()}`
    : '/browser/summary';
  const result = await requestRuntimeJson(ctx, path, { method: 'GET' });
  ensureRouteSuccess('browser_summary', result.status, result.body);

  const payload = ensureObject(result.body, 'browser_summary result');
  const sessionSummary = asRecord(payload.sessions);
  const total = typeof sessionSummary?.total === 'number' ? sessionSummary.total : 0;

  return {
    summary: `Browser summary covers ${total} session(s).`,
    structuredContent: {
      ...payload,
      summaryPath: path,
    },
  };
}

async function createBrowserSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = await requestRuntimeJson(ctx, '/browser/sessions', {
    body: args,
  });
  ensureRouteSuccess('create_browser_session', result.status, result.body);

  const payload = ensureObject(result.body, 'create_browser_session result');
  const session = ensureObject(payload.session, 'create_browser_session result.session');
  const browserSessionId = readRequiredString(session, 'id');
  return {
    summary: `Created browser session ${browserSessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      session,
      ...buildBrowserSessionPaths(browserSessionId),
    },
  };
}

async function createBrowserPage(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const browserSessionId = readRequiredString(args, 'browserSessionId');
  const { browserSessionId: _browserSessionId, ...body } = args;
  const result = await requestRuntimeJson(
    ctx,
    `/browser/sessions/${encodeURIComponent(browserSessionId)}/pages`,
    { body },
  );
  ensureRouteSuccess('create_browser_page', result.status, result.body);

  const payload = ensureObject(result.body, 'create_browser_page result');
  return {
    summary: `Created browser page for session ${browserSessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      ...buildBrowserSessionPaths(browserSessionId),
    },
  };
}

async function closeBrowserSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const browserSessionId = readRequiredString(args, 'browserSessionId');
  const result = await requestRuntimeJson(
    ctx,
    `/browser/sessions/${encodeURIComponent(browserSessionId)}/close`,
  );
  ensureRouteSuccess('close_browser_session', result.status, result.body);

  const payload = ensureObject(result.body, 'close_browser_session result');
  return {
    summary: `Closed browser session ${browserSessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      ...buildBrowserSessionPaths(browserSessionId),
    },
  };
}

async function cleanupBrowserSessions(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const status = readOptionalEnumString(
    args,
    'status',
    RUNTIME_BROWSER_SESSION_STATUSES,
    'status must be a valid browser session status',
  );
  if (status && status !== 'closed') {
    throw new McpToolError(-32602, 'cleanup_browser_sessions only supports status "closed"');
  }

  const body: Record<string, unknown> = {};
  const driverId = readOptionalString(args, 'driverId');
  const runtimeSessionId = readOptionalString(args, 'runtimeSessionId');
  const olderThanMs = readOptionalInteger(args, 'olderThanMs', 0);
  if (driverId) {
    body.driverId = driverId;
  }
  if (runtimeSessionId) {
    body.runtimeSessionId = runtimeSessionId;
  }
  if (status) {
    body.status = status;
  }
  if (olderThanMs !== undefined) {
    body.olderThanMs = olderThanMs;
  }

  const result = await requestRuntimeJson(ctx, '/browser/sessions/cleanup', {
    body,
  });
  ensureRouteSuccess('cleanup_browser_sessions', result.status, result.body);

  const payload = ensureObject(result.body, 'cleanup_browser_sessions result');
  const removedSessionCount = typeof payload.removedSessionCount === 'number'
    ? payload.removedSessionCount
    : 0;
  return {
    summary: `Removed ${removedSessionCount} browser session(s) during cleanup.`,
    structuredContent: {
      ...payload,
      cleanupPath: '/browser/sessions/cleanup',
    },
  };
}

async function initWorkspace(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const service = getWorkspaceSubstrateService(ctx);
  const result = await service.execute({
    operation: 'init-workspace',
    workspacePath: readRequiredString(args, 'workspacePath'),
    profile: readOptionalEnumString(
      args,
      'profile',
      SUBSTRATE_PROFILES,
      'profile must be a valid workspace substrate profile',
    ),
    enabledAgents: readOptionalEnumStringArray(
      args,
      'enabledAgents',
      ENABLED_AGENTS,
      'enabledAgents must be one of: claude, gemini, codex',
    ),
    ...(readOptionalBoolean(args, 'includeA2A') !== undefined
      ? { includeA2A: readOptionalBoolean(args, 'includeA2A') }
      : {}),
    ...(readOptionalBoolean(args, 'apply') !== undefined
      ? { apply: readOptionalBoolean(args, 'apply') }
      : {}),
    ...(readOptionalObject(args, 'hints') ? { hints: readOptionalObject(args, 'hints') } : {}),
    ...(readOptionalEnumString(
      args,
      'actorRole',
      ACTOR_ROLES,
      'actorRole must be a valid workspace actor role',
    ) || readOptionalBoolean(args, 'approved') !== undefined
      ? {
          authorization: {
            actorRole: readOptionalEnumString(
              args,
              'actorRole',
              ACTOR_ROLES,
              'actorRole must be a valid workspace actor role',
            ),
            approved: readOptionalBoolean(args, 'approved'),
          },
        }
      : {}),
  });

  return {
    summary: `Workspace init ${result.status} for ${result.workspacePath}.`,
    structuredContent: result,
  };
}

async function commitChanges(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = await requestRuntimeJson(ctx, '/delivery/repo/commit', {
    body: args,
  });
  ensureRouteSuccess('commit_changes', result.status, result.body);

  const deliveryResult = ensureObject(result.body, 'commit_changes result');
  return {
    summary: `Commit action ${readOptionalString(deliveryResult, 'state') || 'completed'}.`,
    structuredContent: {
      responseStatus: result.status,
      ...deliveryResult,
    },
  };
}

// ---------------------------------------------------------------------------
// Management adapter MCP handler factory
// ---------------------------------------------------------------------------

function mcpManagementAction(
  domain: 'review' | 'deployment',
  action: string,
): (ctx: AppContext, args: Record<string, unknown>) => Promise<McpToolCallResult> {
  return async (ctx, args) => {
    const service = getRuntimeManagementService(ctx);
    const actorClass = readOptionalString(args, 'actorClass');
    const approvalRef = readOptionalString(args, 'approvalRef');
    const target = asRecord(args.target);

    const result = await service.execute({
      domain,
      action: action as never,
      adapter: readOptionalString(args, 'adapter'),
      workspacePath: readOptionalString(args, 'workspacePath'),
      sessionId: readOptionalString(args, 'sessionId'),
      apply: args.apply === true,
      authorization: actorClass || approvalRef
        ? {
            actorClass: actorClass as never,
            approvalRef,
          }
        : undefined,
      target,
      context: asRecord(args.context),
    });

    const label = result.outputs && typeof (result.outputs as Record<string, unknown>).repository === 'object'
      ? 'repository'
      : result.outputs && typeof (result.outputs as Record<string, unknown>).url === 'string'
        ? (result.outputs as Record<string, unknown>).url as string
        : domain;

    return {
      summary: `Management ${domain}/${action} ${result.state} for ${label}.`,
      structuredContent: result,
    };
  };
}

const TOOL_HANDLERS: McpToolHandler[] = [
  {
    definition: {
      name: 'runtime_summary',
      title: 'Runtime Summary',
      description: 'Return startup, pool, and tracked-session summary for cats-runtime.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    execute: async (ctx) => runtimeSummary(ctx),
  },
  {
    definition: {
      name: 'list_sessions',
      title: 'List Sessions',
      description: 'Return tracked runtime sessions, optionally filtered by provider or status.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          status: { type: 'string', enum: SESSION_STATUSES },
          includeInspection: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    execute: listSessions,
  },
  {
    definition: {
      name: 'provider_diagnostics',
      title: 'Provider Diagnostics',
      description: 'Return runtime-owned provider readiness, remediation, and compatibility diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          probe: { type: 'string', enum: DIAGNOSTICS_PROBE_MODES },
          provider: { type: 'string' },
          backend: { type: 'string', enum: PROVIDER_BACKENDS },
          instance: { type: 'string' },
          defaultOnly: { type: 'boolean' },
          forceRefresh: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    execute: providerDiagnostics,
  },
  {
    definition: {
      name: 'observe_session',
      title: 'Observe Session',
      description: 'Return the same machine-readable session/run inspection snapshot exposed by the observe route.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: observeSession,
  },
  {
    definition: {
      name: 'list_runtime_skills',
      title: 'List Runtime Skills',
      description: 'Return the runtime-owned skill catalog using the same filterable read contract exposed by GET /skills/catalog.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'array', items: { type: 'string' } },
          family: {
            type: 'array',
            items: { type: 'string', enum: RUNTIME_SKILL_FAMILIES },
          },
          slug: { type: 'array', items: { type: 'string' } },
          role: { type: 'array', items: { type: 'string' } },
          packageKind: {
            type: 'array',
            items: { type: 'string', enum: RUNTIME_SKILL_PACKAGE_KINDS },
          },
          capabilityTag: { type: 'array', items: { type: 'string' } },
          productTag: { type: 'array', items: { type: 'string' } },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1 },
          sortBy: {
            type: 'string',
            enum: RUNTIME_SKILL_SORT_FIELDS,
          },
          sortDirection: {
            type: 'string',
            enum: SORT_DIRECTIONS,
          },
          deliveryHint: {
            type: 'array',
            items: { type: 'string', enum: RUNTIME_SKILL_DELIVERY_HINTS },
          },
        },
        additionalProperties: false,
      },
    },
    execute: listRuntimeSkills,
  },
  {
    definition: {
      name: 'create_session',
      title: 'Create Session',
      description: 'Create or reuse a runtime session using the same contract as POST /sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          instance: { type: 'string' },
          cwd: { type: 'string' },
          model: { type: 'string' },
          group: { type: 'string' },
          workspaceMode: { type: 'string', enum: WORKSPACE_MODES },
          workspaceIsolation: { type: 'string', enum: WORKSPACE_ISOLATION_MODES },
          permissionMode: { type: 'string', enum: PERMISSION_MODES },
          allowedTools: { type: 'array', items: { type: 'string' } },
          sessionKey: { type: 'string' },
          reusePolicy: { type: 'string', enum: REUSE_POLICIES },
          instructions: { type: 'string' },
          skills: { type: 'object' },
          context: { type: 'object' },
          outputDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    execute: createSession,
  },
  {
    definition: {
      name: 'send_message',
      title: 'Send Message',
      description: 'Run one message turn against a runtime session and return normalized events.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          message: { type: 'string' },
          instructions: { type: 'string' },
          skills: { type: 'object' },
          context: { type: 'object' },
          outputDir: { type: 'string' },
        },
        required: ['sessionId', 'message'],
        additionalProperties: false,
      },
    },
    execute: sendMessage,
  },
  {
    definition: {
      name: 'close_session',
      title: 'Close Session',
      description: 'Close a runtime session using the same contract as POST /sessions/{id}/close.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: closeSession,
  },
  {
    definition: {
      name: 'reset_session',
      title: 'Reset Session',
      description: 'Reset a runtime session using the same contract as POST /sessions/{id}/reset.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          requireAcknowledgedHooks: { type: 'boolean' },
          worktreeCleanupPolicy: { type: 'string', enum: WORKTREE_CLEANUP_POLICIES },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: resetSession,
  },
  {
    definition: {
      name: 'fork_session',
      title: 'Fork Session',
      description: 'Fork an existing runtime session using the same contract as POST /sessions/{id}/fork.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          mode: { type: 'string', enum: FORK_MODES },
          provider: { type: 'string' },
          instance: { type: 'string' },
          model: { type: 'string' },
          cwd: { type: 'string' },
          workspaceMode: { type: 'string', enum: WORKSPACE_MODES },
          workspaceIsolation: { type: 'string', enum: WORKSPACE_ISOLATION_MODES },
          permissionMode: { type: 'string', enum: PERMISSION_MODES },
          allowedTools: { type: 'array', items: { type: 'string' } },
          group: { type: 'string' },
          instructions: { type: 'string' },
          skills: { type: 'object' },
          context: { type: 'object' },
          outputDir: { type: 'string' },
          transplant: { type: 'object' },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: forkSession,
  },
  {
    definition: {
      name: 'delete_session',
      title: 'Delete Session',
      description: 'Delete a runtime session using the same contract as DELETE /sessions/{id}.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          requireAcknowledgedHooks: { type: 'boolean' },
          worktreeCleanupPolicy: { type: 'string', enum: WORKTREE_CLEANUP_POLICIES },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: deleteSession,
  },
  {
    definition: {
      name: 'cleanup_session_workspace',
      title: 'Cleanup Session Workspace',
      description: 'Retry retained worktree cleanup for a closed worktree-backed runtime session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          requireAcknowledgedHooks: { type: 'boolean' },
          worktreeCleanupPolicy: { type: 'string', enum: WORKTREE_CLEANUP_POLICIES },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: cleanupSessionWorkspace,
  },
  {
    definition: {
      name: 'compact_session',
      title: 'Compact Session',
      description: 'Prepare or execute session compaction using the same contract as POST /sessions/{id}/compact.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          acknowledgeHooks: { type: 'boolean' },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: compactSession,
  },
  {
    definition: {
      name: 'report_session_maintenance_follow_through',
      title: 'Report Session Maintenance Follow-through',
      description: 'Persist hook acknowledgement, retry, or completion for reset/delete/cleanup/compact maintenance phases.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          action: { type: 'string', enum: MAINTENANCE_FOLLOW_THROUGH_ACTIONS },
          phase: { type: 'string', enum: MAINTENANCE_FOLLOW_THROUGH_PHASES },
          outcome: { type: 'string', enum: COMPACTION_FOLLOW_THROUGH_OUTCOMES },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId', 'action', 'phase', 'outcome'],
        additionalProperties: false,
      },
    },
    execute: reportSessionMaintenanceFollowThrough,
  },
  {
    definition: {
      name: 'report_compaction_follow_through',
      title: 'Report Compaction Follow-through',
      description: 'Persist compaction hook acknowledgement, retry, or completion outcomes through the runtime maintenance seam.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          outcome: { type: 'string', enum: COMPACTION_FOLLOW_THROUGH_OUTCOMES },
          maintenance: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              hookPayloads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    payload: {},
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ['sessionId', 'outcome'],
        additionalProperties: false,
      },
    },
    execute: reportCompactionFollowThrough,
  },
  {
    definition: {
      name: 'list_browser_drivers',
      title: 'List Browser Drivers',
      description: 'Return runtime-owned browser drivers and capability descriptors.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    execute: listBrowserDrivers,
  },
  {
    definition: {
      name: 'list_browser_sessions',
      title: 'List Browser Sessions',
      description: 'Return runtime-owned browser sessions, optionally filtered by driver or runtime session.',
      inputSchema: {
        type: 'object',
        properties: {
          driverId: { type: 'string' },
          runtimeSessionId: { type: 'string' },
          status: { type: 'string', enum: RUNTIME_BROWSER_SESSION_STATUSES },
        },
        additionalProperties: false,
      },
    },
    execute: listBrowserSessions,
  },
  {
    definition: {
      name: 'browser_summary',
      title: 'Browser Summary',
      description: 'Return aggregate runtime-owned browser counts plus cleanup candidates.',
      inputSchema: {
        type: 'object',
        properties: {
          driverId: { type: 'string' },
          runtimeSessionId: { type: 'string' },
          status: { type: 'string', enum: RUNTIME_BROWSER_SESSION_STATUSES },
          olderThanMs: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    execute: browserSummary,
  },
  {
    definition: {
      name: 'create_browser_session',
      title: 'Create Browser Session',
      description: 'Create a runtime-owned browser session bound optionally to a runtime session.',
      inputSchema: {
        type: 'object',
        properties: {
          driverId: { type: 'string' },
          runtimeSessionId: { type: 'string' },
          label: { type: 'string' },
          metadata: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
    execute: createBrowserSession,
  },
  {
    definition: {
      name: 'create_browser_page',
      title: 'Create Browser Page',
      description: 'Create a browser page using a manual URL/path or runtime preview binding.',
      inputSchema: {
        type: 'object',
        properties: {
          browserSessionId: { type: 'string' },
          label: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          path: { type: 'string' },
          mediaType: { type: 'string' },
          binding: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: BROWSER_BINDING_KINDS },
              runtimeSessionId: { type: 'string' },
              serviceId: { type: 'string' },
              artifactId: { type: 'string' },
            },
            additionalProperties: false,
          },
          metadata: { type: 'object' },
        },
        required: ['browserSessionId'],
        additionalProperties: false,
      },
    },
    execute: createBrowserPage,
  },
  {
    definition: {
      name: 'close_browser_session',
      title: 'Close Browser Session',
      description: 'Close a runtime-owned browser session and mark all pages closed.',
      inputSchema: {
        type: 'object',
        properties: {
          browserSessionId: { type: 'string' },
        },
        required: ['browserSessionId'],
        additionalProperties: false,
      },
    },
    execute: closeBrowserSession,
  },
  {
    definition: {
      name: 'cleanup_browser_sessions',
      title: 'Cleanup Browser Sessions',
      description: 'Delete closed runtime-owned browser sessions, optionally filtered by driver, runtime session, or age.',
      inputSchema: {
        type: 'object',
        properties: {
          driverId: { type: 'string' },
          runtimeSessionId: { type: 'string' },
          status: { type: 'string', enum: RUNTIME_BROWSER_SESSION_STATUSES },
          olderThanMs: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    execute: cleanupBrowserSessions,
  },
  {
    definition: {
      name: 'audit_workspace',
      title: 'Audit Workspace',
      description: 'Preview workspace substrate readiness without applying changes.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          profile: { type: 'string', enum: SUBSTRATE_PROFILES },
          enabledAgents: {
            type: 'array',
            items: { type: 'string', enum: ENABLED_AGENTS },
          },
          includeA2A: { type: 'boolean' },
        },
        required: ['workspacePath'],
        additionalProperties: false,
      },
    },
    execute: auditWorkspace,
  },
  {
    definition: {
      name: 'init_workspace',
      title: 'Init Workspace',
      description: 'Preview or apply runtime-owned workspace substrate initialization.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          profile: { type: 'string', enum: SUBSTRATE_PROFILES },
          enabledAgents: {
            type: 'array',
            items: { type: 'string', enum: ENABLED_AGENTS },
          },
          includeA2A: { type: 'boolean' },
          apply: { type: 'boolean' },
          actorRole: { type: 'string', enum: ACTOR_ROLES },
          approved: { type: 'boolean' },
          hints: { type: 'object' },
        },
        required: ['workspacePath'],
        additionalProperties: false,
      },
    },
    execute: initWorkspace,
  },
  {
    definition: {
      name: 'audit_delivery_target',
      title: 'Audit Delivery Target',
      description: 'Inspect runtime delivery readiness for a workspace or session.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          sessionId: { type: 'string' },
          artifactIds: {
            type: 'array',
            items: { type: 'string' },
          },
          includeSessionArtifacts: { type: 'boolean' },
          includeSessionServices: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    execute: auditDeliveryTarget,
  },
  {
    definition: {
      name: 'commit_changes',
      title: 'Commit Changes',
      description: 'Preview or apply Git commit creation using the runtime delivery contract.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          sessionId: { type: 'string' },
          apply: { type: 'boolean' },
          actorRole: { type: 'string', enum: ACTOR_ROLES },
          approved: { type: 'boolean' },
          repo: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              stageAll: { type: 'boolean' },
              allowEmpty: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    execute: commitChanges,
  },

  // -------------------------------------------------------------------------
  // Management adapter tools
  // -------------------------------------------------------------------------
  {
    definition: {
      name: 'audit_review_target',
      title: 'Audit Review Target',
      description: 'Check GitHub CLI auth and repo readiness for pull request operations.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          adapter: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('review', 'audit_review_target'),
  },
  {
    definition: {
      name: 'open_pull_request',
      title: 'Open Pull Request',
      description: 'Preview or create a pull request via the runtime management adapter.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          apply: { type: 'boolean' },
          actorClass: { type: 'string', enum: MANAGEMENT_ACTOR_CLASSES },
          approvalRef: { type: 'string' },
          adapter: { type: 'string' },
          target: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              base: { type: 'string' },
            },
          },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('review', 'open_pull_request'),
  },
  {
    definition: {
      name: 'inspect_pull_request',
      title: 'Inspect Pull Request',
      description: 'Inspect a pull request via the runtime management adapter.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          adapter: { type: 'string' },
          target: {
            type: 'object',
            properties: {
              number: { type: ['number', 'string'] },
            },
          },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('review', 'inspect_pull_request'),
  },
  {
    definition: {
      name: 'wait_review_checks',
      title: 'Wait Review Checks',
      description: 'Poll PR checks with bounded long-poll. Returns operation ID for resumption if checks do not complete within timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          adapter: { type: 'string' },
          target: {
            type: 'object',
            properties: {
              number: { type: ['number', 'string'] },
              timeoutMs: { type: 'number' },
            },
          },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('review', 'wait_review_checks'),
  },
  {
    definition: {
      name: 'audit_deployment_target',
      title: 'Audit Deployment Target',
      description: 'Check deployment CLI auth and project readiness.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          adapter: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('deployment', 'audit_deployment_target'),
  },
  {
    definition: {
      name: 'create_deployment',
      title: 'Create Deployment',
      description: 'Preview or trigger a deployment via the runtime management adapter.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          apply: { type: 'boolean' },
          actorClass: { type: 'string', enum: MANAGEMENT_ACTOR_CLASSES },
          approvalRef: { type: 'string' },
          adapter: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('deployment', 'create_deployment'),
  },
  {
    definition: {
      name: 'inspect_deployment',
      title: 'Inspect Deployment',
      description: 'Inspect deployment or service status.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          adapter: { type: 'string' },
          target: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('deployment', 'inspect_deployment'),
  },
  {
    definition: {
      name: 'read_deployment_logs',
      title: 'Read Deployment Logs',
      description: 'Read deployment logs from the runtime management adapter.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          adapter: { type: 'string' },
          target: {
            type: 'object',
            properties: {
              serviceId: { type: 'string' },
            },
          },
        },
        additionalProperties: false,
      },
    },
    execute: mcpManagementAction('deployment', 'read_deployment_logs'),
  },
];

export function listMcpTools(): McpToolDefinition[] {
  return TOOL_HANDLERS.map((tool) => tool.definition);
}

export async function callMcpTool(
  ctx: AppContext,
  name: string,
  args: unknown,
): Promise<McpToolCallResult> {
  const handler = TOOL_HANDLERS.find((tool) => tool.definition.name === name);
  if (!handler) {
    throw new McpToolError(-32602, `Unknown tool '${name}'`);
  }

  return handler.execute(ctx, ensureObject(args ?? {}, 'tool arguments'));
}

export { McpToolError };
