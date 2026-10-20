import { describe, expect, it } from 'vitest';
import { forwardWorkspaceActivity } from './workspaceStream.js';
import type { RuntimeObservedStreamEventEntry } from './RuntimeSessionManager.js';
import type { RuntimeWorkspaceActivitySnapshot } from '../workspace/activityTypes.js';
import { WorkspaceActivityStore } from '../workspace/workspaceActivity.js';

function fixture() {
  const listeners = new Set<(entry: RuntimeObservedStreamEventEntry) => void>();
  let sequence = 0;
  const store = new WorkspaceActivityStore({ onChange: workspaceActivity => {
    const entry: RuntimeObservedStreamEventEntry = { seq: ++sequence, event: { type: 'workspace_activity', workspaceActivity } };
    for (const listener of listeners) listener(entry);
  } });
  const attachment = store.attach('s', { startupCwd: '/fixture', runtimeCwd: '/fixture' }, { status: 'partial' })!;
  const runtime = {
    getWorkspaceActivity: (id: string) => store.get(id),
    subscribeObservedStream: (_id: string, listener: (entry: RuntimeObservedStreamEventEntry) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return { runtime, store, attachment, listeners };
}

describe('workspace activity transport forwarding', () => {
  it('subscribes before snapshot reconciliation and forwards independent updates before provider output', async () => {
    const { runtime, store, attachment, listeners } = fixture();
    const events: RuntimeWorkspaceActivitySnapshot[] = [];
    const forwarder = forwardWorkspaceActivity(runtime, 's', event => { events.push(event.workspaceActivity); });
    store.beginExecution(attachment, 'run');
    await forwarder.flush();
    expect(events.map(event => event.revision)).toEqual([1, 2]);
    expect(events.every(event => event.sessionId === 's')).toBe(true);
    await forwarder.close();
    expect(listeners.size).toBe(0);
  });

  it('coalesces slow readers to one pending latest snapshot and drains it before close', async () => {
    const { runtime, store, attachment } = fixture();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const revisions: number[] = [];
    const forwarder = forwardWorkspaceActivity(runtime, 's', async event => {
      revisions.push(event.workspaceActivity.revision);
      if (revisions.length === 1) await blocked;
    });
    for (let index = 0; index < 200; index++) store.beginExecution(attachment, `run-${index}`);
    expect(revisions).toEqual([1]);
    const closed = forwarder.close();
    release();
    await closed;
    expect(revisions).toEqual([1, 201]);
  });

  it('isolates disconnect/write failures and removes its observer', async () => {
    const { runtime, store, attachment, listeners } = fixture();
    const forwarder = forwardWorkspaceActivity(runtime, 's', () => { throw new Error('disconnected'); });
    store.beginExecution(attachment, 'run');
    await forwarder.close();
    expect(listeners.size).toBe(0);
    expect(store.get('s')!.revision).toBe(2);
  });
});
