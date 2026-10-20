import type { RuntimeWorkspaceActivitySnapshot, RuntimeWorkspaceIdentity } from './activityTypes.js';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\x00-\x1f\x7f]/u.test(value);
}

function choice(value: unknown, values: string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function timestamp(value: unknown): boolean {
  return text(value, 32) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

const IDENTITY_KEYS = ['checkoutId', 'executionLocationId', 'path', 'repository', 'kind',
  'branch', 'detachedCommit', 'management', 'verification'];
const ROW_KEYS = [...IDENTITY_KEYS, 'association', 'identityObservedAt', 'firstObservedAt', 'lastObservedAt',
  'runningOperations', 'recentOperations'];

export function isWorkspaceIdentity(value: unknown): value is RuntimeWorkspaceIdentity {
  if (!record(value) || !text(value.checkoutId) || !text(value.executionLocationId)
    || !text(value.path, 4096) || !choice(value.kind, ['original', 'worktree', 'non_git', 'unknown'])
    || !choice(value.management, ['runtime_managed', 'unmanaged', 'unknown'])
    || !choice(value.verification, ['verified', 'unverified', 'unavailable'])
    || !(value.branch === null || text(value.branch, 4096))
    || !(value.detachedCommit === null || (typeof value.detachedCommit === 'string'
      && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value.detachedCommit)))) return false;
  if (value.branch !== null && value.detachedCommit !== null) return false;
  if (value.repository !== null) {
    const repo = value.repository;
    if (!record(repo) || !keys(repo, ['id', 'label', 'sourceRoot'])
      || !text(repo.id) || !text(repo.label, 256)
      || (repo.sourceRoot !== undefined && !text(repo.sourceRoot, 4096))) return false;
  }
  if ((value.kind === 'original' || value.kind === 'worktree') && value.repository === null) return false;
  if ((value.kind === 'unknown' || value.kind === 'non_git')
    && (value.repository !== null || value.branch !== null || value.detachedCommit !== null)) return false;
  return value.management !== 'runtime_managed'
    || (value.kind === 'worktree' && value.verification === 'verified');
}

function operation(value: unknown, running: boolean): boolean {
  return record(value) && keys(value, ['id', 'toolId', 'executionId', 'kind', 'state',
    'evidence', 'startedAt', 'endedAt'])
    && text(value.id) && text(value.executionId)
    && (value.toolId === undefined || text(value.toolId))
    && choice(value.kind, ['read', 'write', 'test', 'git', 'shell', 'other'])
    && choice(value.evidence, ['runtime_tool', 'provider_structured'])
    && timestamp(value.startedAt)
    && (running ? value.state === 'running' && value.endedAt === undefined
      : choice(value.state, ['succeeded', 'failed', 'cancelled', 'unknown']) && timestamp(value.endedAt));
}

/** Fail closed before consuming untrusted transport/checkpoint input; never repair invented facts. */
export function isWorkspaceActivitySnapshot(value: unknown): value is RuntimeWorkspaceActivitySnapshot {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 64 * 1024) return false;
  } catch { return false; }
  if (!record(value) || !keys(value, ['schemaVersion', 'sessionId', 'observationEpoch', 'revision',
    'observedAt', 'startupCwd', 'runtimeCwd', 'coverage', 'workspaces', 'truncated'])
    || value.schemaVersion !== 1 || !text(value.sessionId) || !text(value.observationEpoch)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !timestamp(value.observedAt) || !text(value.startupCwd, 4096) || !text(value.runtimeCwd, 4096)
    || typeof value.truncated !== 'boolean' || !Array.isArray(value.workspaces) || value.workspaces.length > 32
    || !record(value.coverage) || !keys(value.coverage, ['status', 'reason'])
    || !choice(value.coverage.status, ['available', 'partial', 'unsupported', 'unavailable'])
    || (value.coverage.reason !== undefined && !text(value.coverage.reason, 128))) return false;
  const checkoutIds = new Set<string>();
  for (const row of value.workspaces) {
    if (!record(row) || !keys(row, ROW_KEYS) || !isWorkspaceIdentity(row)
      || !choice(row.association, ['session_binding', 'observed_operation'])
      || !timestamp(row.identityObservedAt) || !timestamp(row.firstObservedAt) || !timestamp(row.lastObservedAt)
      || !Array.isArray(row.runningOperations) || row.runningOperations.length > 8
      || !Array.isArray(row.recentOperations) || row.recentOperations.length > 8
      || !row.runningOperations.every(item => operation(item, true))
      || !row.recentOperations.every(item => operation(item, false))
      || checkoutIds.has(row.checkoutId)) return false;
    if (row.association === 'session_binding' && (row.runningOperations.length || row.recentOperations.length)) return false;
    checkoutIds.add(row.checkoutId);
    const ids = [...row.runningOperations, ...row.recentOperations].map(item => item.id);
    if (new Set(ids).size !== ids.length) return false;
  }
  return true;
}
