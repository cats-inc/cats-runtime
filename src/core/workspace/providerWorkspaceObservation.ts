import { randomUUID } from 'node:crypto';
import { isAbsolute, parse } from 'node:path';
import type { StreamEvent } from '../types.js';
import type { WorkspaceIdentityResult } from './activityTypes.js';
import { WORKSPACE_ACTIVITY_LIMITS, WorkspaceActivityStore,
  type WorkspaceActivityExecution } from './workspaceActivity.js';

type Action = { toolId: string; path: string; kind: 'read' | 'write' }
  | { toolId: string; outcome: 'succeeded' | 'failed' | 'unknown' };

/** One verified native attachment. Only selected adapter facts enter this queue. */
export class ProviderWorkspaceObserver {
  private readonly correlations = new Map<string, { id?: string; completed: boolean }>();
  private tail = Promise.resolve();
  private pending = 0;
  private disposed = false;
  private probe?: AbortController;

  constructor(private readonly store: WorkspaceActivityStore,
    private readonly lease: WorkspaceActivityExecution,
    private readonly resolveIdentity: (path: string, signal: AbortSignal) => Promise<WorkspaceIdentityResult>) {}

  observe(event: StreamEvent): Promise<void> {
    if (this.disposed || (event.type !== 'tool_use' && event.type !== 'tool_result')) return Promise.resolve();
    if (typeof event.toolId !== 'string' || !event.toolId || event.toolId.length > 256
      || /[\x00-\x1f\x7f]/u.test(event.toolId)) {
      this.store.degrade(this.lease, 'unsupported_tool');
      return Promise.resolve();
    }
    let action: Action;
    if (event.type === 'tool_use') {
      const target = event.workspaceOperation;
      if (!target) return Promise.resolve(); // Partial frames may precede complete input.
      if (!['read', 'write'].includes(target.kind) || typeof target.path !== 'string'
        || !target.path || target.path.length > 4096 || /[\x00-\x1f\x7f]/u.test(target.path)
        || !isAbsolute(target.path) || (process.platform === 'win32' && parse(target.path).root.length <= 1)) {
        this.store.degrade(this.lease, 'unsupported_tool');
        return Promise.resolve();
      }
      action = { toolId: event.toolId, path: target.path, kind: target.kind };
    } else {
      // Unverified/nested results must not close a direct call with the same ID.
      if (!['succeeded', 'failed', 'unknown'].includes(event.workspaceOutcome ?? '')) return Promise.resolve();
      action = { toolId: event.toolId, outcome: event.workspaceOutcome === 'succeeded' ? 'succeeded'
        : event.workspaceOutcome === 'failed' ? 'failed' : 'unknown' };
    }
    if (this.pending >= 32) {
      this.store.degrade(this.lease, 'observation_limit');
      return Promise.resolve();
    }
    this.pending++;
    // Retain the small picked action, never the provider event, arguments or output.
    const task = this.tail.then(() => this.apply(action)).catch(() => {
      this.store.degrade(this.lease, 'observer_error');
    }).finally(() => { this.pending--; });
    this.tail = task;
    return task;
  }

  dispose(): void {
    this.disposed = true;
    this.probe?.abort();
    this.correlations.clear();
  }

  private async apply(action: Action): Promise<void> {
    if (this.disposed) return;
    const prior = this.correlations.get(action.toolId);
    if ('outcome' in action) {
      if (prior?.completed) return;
      if (prior?.id) this.store.complete(this.lease, prior.id, action.outcome);
      if (prior) prior.completed = true;
      else if (this.reserve(action.toolId)) this.store.degrade(this.lease, 'unsupported_tool');
      return;
    }
    if (prior || !this.reserve(action.toolId)) return;
    const correlation = this.correlations.get(action.toolId)!;
    correlation.completed = false;
    const abort = new AbortController();
    this.probe = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.resolveIdentity(action.path, abort.signal),
        new Promise<undefined>(resolve => {
          // Cold Windows worktree metadata admission measured about three seconds.
          // Keep the original alias/containment checks and bound native stream admission.
          timer = setTimeout(() => { abort.abort(); resolve(undefined); }, 5000);
        }),
      ]);
      if (this.disposed) return;
      if (!result || abort.signal.aborted) {
        this.store.degrade(this.lease, 'observer_error');
        return;
      }
      if (result.reason) this.store.degrade(this.lease, 'identity_unavailable');
      if (!result.workspace) return;
      correlation.id = randomUUID();
      this.store.start(this.lease, { id: correlation.id, toolId: action.toolId,
        kind: action.kind, evidence: 'provider_structured', workspaces: [result.workspace] });
    } finally {
      if (timer) clearTimeout(timer);
      this.probe = undefined;
    }
  }

  private reserve(toolId: string): boolean {
    if (this.correlations.size >= WORKSPACE_ACTIVITY_LIMITS.operationsPerExecution) {
      this.store.degrade(this.lease, 'observation_limit');
      return false;
    }
    // A result without a start is a tombstone: late starts cannot invent running work.
    this.correlations.set(toolId, { completed: true });
    return true;
  }
}
