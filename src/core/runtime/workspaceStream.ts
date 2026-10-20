import type { WorkspaceActivityStreamEvent } from '../types.js';
import type { RuntimeSessionManager } from './RuntimeSessionManager.js';

/** Forward bounded current facts independently of a provider's token/tool yield cadence. */
export function forwardWorkspaceActivity(
  runtime: Pick<RuntimeSessionManager, 'subscribeObservedStream' | 'getWorkspaceActivity'>,
  sessionId: string,
  write: (event: WorkspaceActivityStreamEvent) => void | Promise<void>,
): { flush(): Promise<void>; close(): Promise<void> } {
  let pending: WorkspaceActivityStreamEvent | undefined;
  let drain = Promise.resolve();
  let draining = false;
  let closed = false;
  let epoch: string | undefined;
  let revision = 0;

  const enqueue = (event: WorkspaceActivityStreamEvent): void => {
    const snapshot = event.workspaceActivity;
    if (closed || snapshot.sessionId !== sessionId
      || (snapshot.observationEpoch === epoch && snapshot.revision <= revision)) return;
    epoch = snapshot.observationEpoch;
    revision = snapshot.revision;
    pending = event;
    if (draining) return;
    draining = true;
    drain = (async () => {
      try {
        while (pending && !closed) {
          const next = pending;
          pending = undefined;
          await write(next);
        }
      } catch {
        closed = true;
        pending = undefined;
      } finally { draining = false; }
    })();
  };

  const unsubscribe = runtime.subscribeObservedStream(sessionId, entry => {
    if (entry.event.type === 'workspace_activity') enqueue(entry.event);
  });
  const snapshot = runtime.getWorkspaceActivity(sessionId);
  if (snapshot) enqueue({ type: 'workspace_activity', workspaceActivity: snapshot });
  return {
    flush: () => drain,
    close: async () => { unsubscribe(); await drain; closed = true; pending = undefined; },
  };
}
