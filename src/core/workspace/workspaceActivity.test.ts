import { describe, expect, it } from 'vitest';
import type { RuntimeWorkspaceIdentity } from './activityTypes.js';
import { WORKSPACE_ACTIVITY_LIMITS, WorkspaceActivityStore } from './workspaceActivity.js';
import { isWorkspaceActivitySnapshot } from './workspaceActivityValidation.js';

function identity(id = 'checkout-1'): RuntimeWorkspaceIdentity {
  return { checkoutId: id, executionLocationId: 'native:fixture', path: `/fixture/${id}`,
    repository: { id: 'repo-1', label: 'cats-runtime', sourceRoot: '/fixture/source' },
    kind: 'worktree', branch: 'main', detachedCommit: null, management: 'unmanaged', verification: 'verified' };
}

function fixture() {
  let sequence = 0;
  let instant = 0;
  const changes: unknown[] = [];
  const store = new WorkspaceActivityStore({ epoch: () => `epoch-${++sequence}`,
    now: () => new Date(1_000 + instant++).toISOString(), onChange: value => changes.push(value) });
  const cwd = { startupCwd: '/selected', runtimeCwd: '/fixture' };
  const attachment = store.attach('session-1', cwd, { status: 'partial', reason: 'opaque_shell' })!;
  const run = store.beginExecution(attachment, 'run-1')!;
  const start = (id = 'operation-1', workspaces = [identity()]) => store.start(run, {
    id, kind: 'write', evidence: 'runtime_tool', workspaces,
  });
  return { store, start, changes, attachment, run, cwd };
}

describe('bounded session workspace activity', () => {
  it('separates binding context, observed attempts and correlated failed/successful outcomes', () => {
    const { store, start, attachment, run, cwd } = fixture();
    store.bind(attachment, identity());
    expect(store.get('session-1')!.workspaces[0]).toMatchObject({ association: 'session_binding',
      runningOperations: [], recentOperations: [] });
    start();
    expect(store.get('session-1')!.workspaces[0]).toMatchObject({ association: 'observed_operation',
      runningOperations: [{ id: 'operation-1', state: 'running' }] });
    store.complete(run, 'operation-1', 'failed');
    start('operation-2');
    const identityObservedAt = store.get('session-1')!.workspaces[0].identityObservedAt;
    store.complete(run, 'operation-2', 'succeeded');
    const row = store.get('session-1')!.workspaces[0];
    expect(row.runningOperations).toEqual([]);
    expect(row.recentOperations.map(item => item.state)).toEqual(['succeeded', 'failed']);
    expect(row.identityObservedAt).toBe(identityObservedAt);
    expect(row.lastObservedAt).not.toBe(identityObservedAt);
  });

  it('correlates one operation across all its checkouts and coalesces duplicate targets', () => {
    const { store, start, run } = fixture();
    start('rename-1', [identity('a'), identity('a'), identity('b')]);
    store.complete(run, 'rename-1', 'succeeded');
    expect(store.get('session-1')!.workspaces).toHaveLength(2);
    for (const row of store.get('session-1')!.workspaces) {
      expect(row.recentOperations).toHaveLength(1);
      expect(row.recentOperations[0].state).toBe('succeeded');
    }
  });

  it('ignores duplicates and results from earlier executions without reviving activity', () => {
    const { store, start, attachment, run, cwd } = fixture();
    start();
    start();
    store.complete(run, 'operation-1', 'succeeded');
    const revision = store.get('session-1')!.revision;
    start();
    store.complete(run, 'operation-1', 'failed');
    expect(store.get('session-1')!.revision).toBe(revision);
    store.beginExecution(attachment, 'run-2');
    start('late-start');
    store.complete(run, 'operation-1', 'failed');
    expect(store.get('session-1')!.workspaces[0].runningOperations).toEqual([]);
    expect(store.get('session-1')!.workspaces[0].recentOperations).toHaveLength(1);
  });

  it('marks unfinished work cancelled/unknown at execution and attachment boundaries', () => {
    const { store, start, attachment, run, cwd } = fixture();
    start();
    store.endExecution(run, 'cancelled');
    expect(store.get('session-1')!.workspaces[0].recentOperations[0].state).toBe('cancelled');
    const nextRun = store.beginExecution(attachment, 'run-1')!;
    start('stale-operation');
    store.start(nextRun, { id: 'operation-2', kind: 'read', evidence: 'runtime_tool', workspaces: [identity()] });
    const previousEpoch = store.get('session-1')!.observationEpoch;
    const nextAttachment = store.attach('session-1', cwd, { status: 'unsupported' })!;
    store.beginExecution(nextAttachment, 'run-1');
    start('late-prior-attachment');
    store.bind(attachment, identity('late-binding'));
    store.complete(run, 'operation-2', 'succeeded');
    const snapshot = store.get('session-1')!;
    expect(snapshot.observationEpoch).not.toBe(previousEpoch);
    expect(snapshot.revision).toBe(2);
    expect(snapshot.workspaces[0].runningOperations).toEqual([]);
    expect(snapshot.workspaces[0].recentOperations[0].state).toBe('unknown');
    expect(snapshot.coverage.status).toBe('unsupported');
    expect(snapshot).toMatchObject(cwd);
    expect(isWorkspaceActivitySnapshot(snapshot)).toBe(true);
  });

  it('drops prior binding facts on rebind and all facts on deletion or process restart', () => {
    const { store, start } = fixture();
    start();
    store.attach('session-1', { startupCwd: '/another', runtimeCwd: '/another-binding' }, { status: 'unavailable' });
    expect(store.get('session-1')!.workspaces).toEqual([]);
    store.delete('session-1');
    expect(store.get('session-1')).toBeUndefined();
    expect(new WorkspaceActivityStore().get('session-1')).toBeUndefined();
  });

  it('bounds retained rows, favors active rows and never invents a completion for dropped work', () => {
    const { store, start, run } = fixture();
    start('active', [identity('active')]);
    for (let index = 0; index < 40; index++) {
      start(`done-${index}`, [identity(`checkout-${index}`)]);
      store.complete(run, `done-${index}`, 'failed');
    }
    const snapshot = store.get('session-1')!;
    expect(snapshot.workspaces).toHaveLength(WORKSPACE_ACTIVITY_LIMITS.rows);
    expect(snapshot.workspaces[0].checkoutId).toBe('active');
    expect(snapshot.workspaces[0].runningOperations[0].state).toBe('running');
    expect(snapshot).toMatchObject({ truncated: true, coverage: { status: 'partial', reason: 'observation_limit' } });
    expect(isWorkspaceActivitySnapshot(snapshot)).toBe(true);
  });

  it('bounds operations, deduplication memory and serialized bytes with explicit truncation', () => {
    const { store, start, attachment, run } = fixture();
    for (let index = 0; index < 12; index++) start(`parallel-${index}`);
    expect(store.get('session-1')!.workspaces[0].runningOperations).toHaveLength(8);
    store.endExecution(run, 'unknown');
    const restarted = store.beginExecution(attachment, 'run-1')!;
    for (let index = 0; index < 1050; index++) {
      store.start(restarted, { id: `completed-${index}`, kind: 'write', evidence: 'runtime_tool', workspaces: [identity()] });
      store.complete(restarted, `completed-${index}`, 'succeeded');
    }
    expect(store.get('session-1')!.workspaces[0].recentOperations).toHaveLength(8);
    const nextRun = store.beginExecution(attachment, 'run-2')!;
    for (let index = 0; index < 32; index++) {
      store.start(nextRun, { id: `large-${index}`, kind: 'read', evidence: 'runtime_tool',
        workspaces: [{ ...identity(`large-${index}`), path: '/' + 'x'.repeat(4000) + index }] });
    }
    const snapshot = store.get('session-1')!;
    expect(snapshot.workspaces.length).toBeLessThan(32);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(64 * 1024);
    expect(isWorkspaceActivitySnapshot(snapshot)).toBe(true);
    expect(snapshot.truncated).toBe(true);
  });

  it('rejects terminal-before-start evidence without creating false running work', () => {
    const { store, run, start } = fixture();
    store.complete(run, 'operation-1', 'succeeded');
    start();
    expect(store.get('session-1')!.workspaces).toEqual([]);
    expect(store.get('session-1')!.coverage.status).toBe('partial');
  });

  it('isolates a throwing consumer and rejects unbounded producer envelope/correlation values', () => {
    const store = new WorkspaceActivityStore({ onChange: () => { throw new Error('consumer unavailable'); } });
    const cwd = { startupCwd: '/fixture', runtimeCwd: '/fixture' };
    expect(store.attach('bad', { ...cwd, runtimeCwd: 'x'.repeat(70_000) }, { status: 'partial' })).toBeUndefined();
    expect(store.get('bad')).toBeUndefined();
    const attachment = store.attach('good', cwd, { status: 'partial' })!;
    const run = store.beginExecution(attachment, 'run')!;
    store.start(run, { id: 'x'.repeat(70_000), kind: 'read', evidence: 'runtime_tool', workspaces: [identity()] });
    expect(isWorkspaceActivitySnapshot(store.get('good'))).toBe(true);
    expect(store.get('good')!.workspaces).toEqual([]);
  });

  it('revalidates branch facts, strips extra payloads and isolates returned/listener snapshots', () => {
    const { store, start, changes, attachment } = fixture();
    const extra = { ...identity(), command: 'secret command' };
    start('operation-1', [extra]);
    store.bind(attachment, { ...identity(), branch: 'renamed' });
    const snapshot = store.get('session-1')!;
    expect(snapshot.workspaces[0].branch).toBe('renamed');
    expect(snapshot.workspaces[0].association).toBe('observed_operation');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    snapshot.workspaces[0].path = 'mutated';
    expect(store.get('session-1')!.workspaces[0].path).not.toBe('mutated');
    expect(changes.every(isWorkspaceActivitySnapshot)).toBe(true);
    const revisions = changes.map(value => (value as { revision: number }).revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
  });
});

describe('workspace activity boundary validation', () => {
  it('rejects malformed, oversized, contradictory, duplicated and credential-bearing payloads', () => {
    const { store, start } = fixture();
    start();
    const valid = store.get('session-1')!;
    expect(isWorkspaceActivitySnapshot(valid)).toBe(true);
    for (const invalid of [null, {}, { ...valid, schemaVersion: 2 }, { ...valid, revision: -1 },
      { ...valid, revision: Infinity }, { ...valid, token: 'private' },
      { ...valid, observedAt: 'yesterday' }, { ...valid, workspaces: [...valid.workspaces, ...valid.workspaces] },
      { ...valid, runtimeCwd: 'a'.repeat(70_000) },
      { ...valid, workspaces: [{ ...valid.workspaces[0], association: 'session_binding' }] },
      { ...valid, workspaces: [{ ...valid.workspaces[0], branch: 'main', detachedCommit: 'a'.repeat(40) }] },
      { ...valid, workspaces: [{ ...valid.workspaces[0], runningOperations: [
        { ...valid.workspaces[0].runningOperations[0], state: 'succeeded' },
      ] }] },
    ]) expect(isWorkspaceActivitySnapshot(invalid)).toBe(false);
  });
});
