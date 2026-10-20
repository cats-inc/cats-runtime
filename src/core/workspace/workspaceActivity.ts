import { randomUUID } from 'node:crypto';
import type {
  RuntimeObservedWorkspace, RuntimeWorkspaceActivitySnapshot, RuntimeWorkspaceIdentity,
  RuntimeWorkspaceOperation, WorkspaceActivityCoverage,
} from './activityTypes.js';
import { isWorkspaceIdentity } from './workspaceActivityValidation.js';

export const WORKSPACE_ACTIVITY_LIMITS = Object.freeze({
  rows: 32, running: 8, recent: 8, bytes: 64 * 1024, operationsPerExecution: 1024,
});

interface ActivityState {
  snapshot: RuntimeWorkspaceActivitySnapshot;
  executionId?: string;
  executionToken?: string;
  seen: Set<string>;
}

interface ActivityOptions {
  now?: () => string;
  epoch?: () => string;
  onChange?: (snapshot: RuntimeWorkspaceActivitySnapshot) => void;
}

export interface WorkspaceActivityAttachment {
  sessionId: string;
  observationEpoch: string;
}

export interface WorkspaceActivityExecution extends WorkspaceActivityAttachment {
  executionId: string;
  executionToken: string;
}

export interface WorkspaceOperationStart {
  /** Runtime-owned correlation key, never a provider-assigned execution identity. */
  id: string;
  toolId?: string;
  kind: RuntimeWorkspaceOperation['kind'];
  evidence: RuntimeWorkspaceOperation['evidence'];
  workspaces: RuntimeWorkspaceIdentity[];
}

function boundedText(value: string, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\x00-\x1f\x7f]/u.test(value);
}

/** Bounded, in-memory facts. No commands, contents or provider payloads are retained. */
export class WorkspaceActivityStore {
  private readonly states = new Map<string, ActivityState>();
  private readonly now: () => string;
  private readonly epoch: () => string;

  constructor(private readonly options: ActivityOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.epoch = options.epoch ?? randomUUID;
  }

  attach(sessionId: string, cwd: { startupCwd: string; runtimeCwd: string },
    coverage: WorkspaceActivityCoverage): WorkspaceActivityAttachment | undefined {
    if (!boundedText(sessionId, 256) || !boundedText(cwd.startupCwd, 4096) || !boundedText(cwd.runtimeCwd, 4096)
      || !['available', 'partial', 'unsupported', 'unavailable'].includes(coverage.status)
      || (coverage.reason !== undefined && (!boundedText(coverage.reason, 128)
        || !/^[a-z0-9_]+$/u.test(coverage.reason)))) return undefined;
    const epoch = this.epoch();
    if (!boundedText(epoch, 256)) return undefined;
    const prior = this.states.get(sessionId);
    if (prior) this.finishPending(prior, 'unknown');
    const at = this.now();
    const snapshot: RuntimeWorkspaceActivitySnapshot = {
      schemaVersion: 1, sessionId, observationEpoch: epoch, revision: 0,
      observedAt: at, startupCwd: cwd.startupCwd, runtimeCwd: cwd.runtimeCwd,
      coverage: { status: coverage.status, ...(coverage.reason ? { reason: coverage.reason } : {}) },
      workspaces: prior?.snapshot.runtimeCwd === cwd.runtimeCwd ? prior.snapshot.workspaces : [],
      truncated: prior?.snapshot.runtimeCwd === cwd.runtimeCwd ? prior.snapshot.truncated : false,
    };
    const state = { snapshot, seen: new Set<string>() };
    this.states.set(sessionId, state);
    this.publish(state);
    return Object.freeze({ sessionId, observationEpoch: epoch });
  }

  get(sessionId: string): RuntimeWorkspaceActivitySnapshot | undefined {
    const snapshot = this.states.get(sessionId)?.snapshot;
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  beginExecution(attachment: WorkspaceActivityAttachment, executionId: string): WorkspaceActivityExecution | undefined {
    const state = this.current(attachment);
    if (!state || !boundedText(executionId, 256)) return undefined;
    if (state.executionId === executionId && state.executionToken) {
      return Object.freeze({ ...attachment, executionId, executionToken: state.executionToken });
    }
    this.finishPending(state, 'unknown');
    state.executionId = executionId;
    state.executionToken = randomUUID();
    state.seen.clear();
    this.publish(state);
    return Object.freeze({ ...attachment, executionId, executionToken: state.executionToken });
  }

  bind(attachment: WorkspaceActivityAttachment, workspace: RuntimeWorkspaceIdentity): void {
    const state = this.current(attachment);
    if (!state || !isWorkspaceIdentity(workspace)) return;
    this.row(state, workspace, 'session_binding');
    this.publish(state);
  }

  start(lease: WorkspaceActivityExecution, operation: WorkspaceOperationStart): void {
    const state = this.current(lease);
    if (!state || !state.executionId || state.executionId !== lease.executionId
      || state.seen.has(operation.id)
      || state.snapshot.workspaces.some(row => [...row.runningOperations, ...row.recentOperations]
        .some(item => item.id === operation.id))) return;
    if (!boundedText(operation.id, 256) || (operation.toolId !== undefined && !boundedText(operation.toolId, 256))
      || !['read', 'write', 'test', 'git', 'shell', 'other'].includes(operation.kind)
      || !['runtime_tool', 'provider_structured'].includes(operation.evidence)) {
      this.degrade(lease, 'observer_error');
      return;
    }
    if (state.seen.size >= WORKSPACE_ACTIVITY_LIMITS.operationsPerExecution) {
      this.truncate(state);
      this.publish(state);
      return;
    }
    state.seen.add(operation.id);
    const startedAt = this.now();
    if (operation.workspaces.length > WORKSPACE_ACTIVITY_LIMITS.rows) this.truncate(state);
    for (const identity of operation.workspaces.slice(0, WORKSPACE_ACTIVITY_LIMITS.rows)) {
      if (!isWorkspaceIdentity(identity)) {
        state.snapshot.coverage = { status: 'partial', reason: 'identity_unavailable' };
        continue;
      }
      const row = this.row(state, identity, 'observed_operation');
      if (row.runningOperations.some(item => item.id === operation.id)) continue;
      if (row.runningOperations.length >= WORKSPACE_ACTIVITY_LIMITS.running) {
        this.truncate(state);
        continue;
      }
      row.runningOperations.push({
        id: operation.id, ...(operation.toolId ? { toolId: operation.toolId } : {}),
        executionId: lease.executionId, kind: operation.kind, evidence: operation.evidence,
        state: 'running', startedAt,
      });
    }
    this.publish(state);
  }

  complete(lease: WorkspaceActivityExecution, id: string,
    outcome: Exclude<RuntimeWorkspaceOperation['state'], 'running'>): void {
    const state = this.current(lease);
    if (!state || state.executionId !== lease.executionId || !boundedText(id, 256)
      || !['succeeded', 'failed', 'cancelled', 'unknown'].includes(outcome)) return;
    let changed = false;
    const at = this.now();
    for (const row of state.snapshot.workspaces) {
      const index = row.runningOperations.findIndex(item => item.id === id && item.executionId === lease.executionId);
      if (index < 0) continue;
      const [operation] = row.runningOperations.splice(index, 1);
      this.recent(state, row, { ...operation, state: outcome, endedAt: at });
      row.lastObservedAt = at;
      changed = true;
    }
    if (!changed && !state.seen.has(id)) {
      // An out-of-order result must not be followed by a false running start.
      if (state.seen.size < WORKSPACE_ACTIVITY_LIMITS.operationsPerExecution) state.seen.add(id);
      this.truncate(state);
      changed = true;
    }
    if (changed) this.publish(state);
  }

  endExecution(lease: WorkspaceActivityExecution, outcome: 'cancelled' | 'unknown'): void {
    const state = this.current(lease);
    if (!state || state.executionId !== lease.executionId || !['cancelled', 'unknown'].includes(outcome)) return;
    this.finishPending(state, outcome);
    state.executionId = undefined;
    state.executionToken = undefined;
    this.publish(state);
  }

  degrade(attachment: WorkspaceActivityAttachment, reason: 'identity_unavailable' | 'unsupported_tool'
    | 'observation_limit' | 'observer_error'): void {
    const state = this.current(attachment);
    if (!state) return;
    state.snapshot.coverage = { status: 'partial', reason };
    this.publish(state);
  }

  delete(sessionId: string): void { this.states.delete(sessionId); }

  private current(attachment: WorkspaceActivityAttachment): ActivityState | undefined {
    const state = this.states.get(attachment.sessionId);
    if (state?.snapshot.observationEpoch !== attachment.observationEpoch) return undefined;
    if ('executionToken' in attachment) {
      const execution = attachment as WorkspaceActivityExecution;
      if (state.executionId !== execution.executionId || state.executionToken !== execution.executionToken) return undefined;
    }
    return state;
  }

  private row(state: ActivityState, identity: RuntimeWorkspaceIdentity,
    association: RuntimeObservedWorkspace['association']): RuntimeObservedWorkspace {
    const at = this.now();
    // Pick fields explicitly: structural typing must not retain an adapter's raw payload.
    const clean: RuntimeWorkspaceIdentity = {
      checkoutId: identity.checkoutId, executionLocationId: identity.executionLocationId,
      path: identity.path, repository: identity.repository ? {
        id: identity.repository.id, label: identity.repository.label,
        ...(identity.repository.sourceRoot ? { sourceRoot: identity.repository.sourceRoot } : {}),
      } : null, kind: identity.kind, branch: identity.branch, detachedCommit: identity.detachedCommit,
      management: identity.management, verification: identity.verification,
    };
    const existing = state.snapshot.workspaces.find(row => row.checkoutId === clean.checkoutId);
    if (existing) {
      Object.assign(existing, clean, { lastObservedAt: at, identityObservedAt: at });
      if (association === 'observed_operation') existing.association = association;
      return existing;
    }
    const row: RuntimeObservedWorkspace = { ...clean, association, identityObservedAt: at,
      firstObservedAt: at, lastObservedAt: at, runningOperations: [], recentOperations: [] };
    state.snapshot.workspaces.push(row);
    return row;
  }

  private recent(state: ActivityState, row: RuntimeObservedWorkspace, operation: RuntimeWorkspaceOperation): void {
    row.recentOperations.unshift(operation);
    if (row.recentOperations.length > WORKSPACE_ACTIVITY_LIMITS.recent) {
      row.recentOperations.length = WORKSPACE_ACTIVITY_LIMITS.recent;
      this.truncate(state);
    }
  }

  private finishPending(state: ActivityState, outcome: 'cancelled' | 'unknown'): void {
    const at = this.now();
    for (const row of state.snapshot.workspaces) {
      if (row.runningOperations.length) row.lastObservedAt = at;
      for (const operation of row.runningOperations) {
        this.recent(state, row, { ...operation, state: outcome, endedAt: at });
      }
      row.runningOperations = [];
    }
  }

  private truncate(state: ActivityState): void {
    state.snapshot.truncated = true;
    state.snapshot.coverage = { status: 'partial', reason: 'observation_limit' };
  }

  private publish(state: ActivityState): void {
    const snapshot = state.snapshot;
    snapshot.revision++;
    snapshot.observedAt = this.now();
    // Retain active rows ahead of completed rows, preserving insertion order for ties.
    snapshot.workspaces.sort((a, b) => Number(Boolean(b.runningOperations.length))
      - Number(Boolean(a.runningOperations.length)) || b.lastObservedAt.localeCompare(a.lastObservedAt));
    if (snapshot.workspaces.length > WORKSPACE_ACTIVITY_LIMITS.rows) {
      snapshot.workspaces.length = WORKSPACE_ACTIVITY_LIMITS.rows;
      this.truncate(state);
    }
    while (snapshot.workspaces.length
      && Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > WORKSPACE_ACTIVITY_LIMITS.bytes) {
      snapshot.workspaces.pop();
      this.truncate(state);
    }
    try { this.options.onChange?.(structuredClone(snapshot)); }
    catch { /* A failed observation consumer must not change an operation's outcome. */ }
  }
}
