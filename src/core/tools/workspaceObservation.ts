import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveSafeWorkspacePath as resolvePath } from './pathSafety.js';
import type { RuntimeWorkspaceOperation } from '../workspace/activityTypes.js';

type Outcome = 'succeeded' | 'failed' | 'unknown';

export interface LocalToolWorkspaceTarget {
  sessionId: string;
  cwd: string;
  toolId: string;
  kind: RuntimeWorkspaceOperation['kind'];
  path: string;
}

export interface LocalToolWorkspaceObserver {
  start(target: LocalToolWorkspaceTarget, signal: AbortSignal): Promise<((outcome: Outcome) => void) | undefined>;
  gap(sessionId: string, reason: 'unsupported_tool' | 'observation_limit' | 'observer_error'): void;
}

export type LocalToolWorkspaceObserverFactory = (
  context: { sessionId: string; cwd: string },
) => LocalToolWorkspaceObserver | undefined;

interface ToolObservation {
  observer: LocalToolWorkspaceObserver;
  target: Omit<LocalToolWorkspaceTarget, 'path'>;
  paths: Set<string>;
  finishes: Array<(outcome: Outcome) => void>;
  deadlineAt: number;
}

const currentTool = new AsyncLocalStorage<ToolObservation>();
const WRITE_TOOLS = new Set(['write_file', 'create_directory', 'edit_file', 'apply_patch',
  'delete_file', 'rename_file', 'copy_file']);
const READ_TOOLS = new Set(['list_files', 'inspect_path', 'inspect_paths', 'read_file',
  'read_files', 'diff_file', 'grep', 'glob']);
const MAX_OBSERVED_TARGETS = 64;

/** Same path policy, with observation only after admission and before the operation. */
export async function resolveObservedWorkspacePath(root: string, path: string,
  kind?: RuntimeWorkspaceOperation['kind']) {
  const safe = await resolvePath(root, path);
  const observation = currentTool.getStore();
  if (observation && !observation.paths.has(safe.fullPath)) {
    try {
      if (observation.paths.size >= MAX_OBSERVED_TARGETS) {
        observation.observer.gap(observation.target.sessionId, 'observation_limit');
      } else {
        observation.paths.add(safe.fullPath);
        const budget = Math.min(500, observation.deadlineAt - Date.now());
        if (budget <= 0) {
          observation.observer.gap(observation.target.sessionId, 'observer_error');
          return safe;
        }
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finish: ((outcome: Outcome) => void) | undefined;
        try {
          finish = await Promise.race([
            observation.observer.start({ ...observation.target,
              ...(kind ? { kind } : {}), path: safe.fullPath }, abort.signal),
            new Promise<undefined>(resolve => {
              timer = setTimeout(() => {
                abort.abort();
                try { observation.observer.gap(observation.target.sessionId, 'observer_error'); } catch { /* Optional observer. */ }
                resolve(undefined);
              }, budget);
            }),
          ]);
        } finally { if (timer) clearTimeout(timer); }
        if (finish) observation.finishes.push(finish);
      }
    } catch { /* Telemetry failure cannot change path admission or tool execution. */ }
  }
  return safe;
}

export async function observeLocalTool<T extends { isError?: boolean }>(
  factory: LocalToolWorkspaceObserverFactory | undefined,
  context: { sessionId: string; cwd: string },
  call: { id: string; name: string },
  execute: () => Promise<T>,
): Promise<T> {
  let observer: LocalToolWorkspaceObserver | undefined;
  try { observer = factory?.(context); } catch { /* Optional observer. */ }
  if (!observer) return execute();
  const kind = WRITE_TOOLS.has(call.name) ? 'write' : READ_TOOLS.has(call.name) ? 'read'
    : call.name === 'run_shell' ? 'shell' : undefined;
  if (!kind) {
    try { observer.gap(context.sessionId, 'unsupported_tool'); } catch { /* Optional observer. */ }
    return execute();
  }
  const observation: ToolObservation = { observer,
    target: { sessionId: context.sessionId, cwd: context.cwd, toolId: call.id, kind },
    paths: new Set(), finishes: [], deadlineAt: Date.now() + 1500 };
  return currentTool.run(observation, async () => {
    let outcome: Outcome = 'failed';
    try {
      const result = await execute();
      // Batch tools report per-entry failures inside their payload; no aggregate success inference.
      outcome = result.isError ? 'failed' : ['read_files', 'inspect_paths'].includes(call.name) ? 'unknown' : 'succeeded';
      return result;
    } finally {
      for (const finish of observation.finishes) {
        try { finish(outcome); } catch { /* Optional observer. */ }
      }
    }
  });
}
