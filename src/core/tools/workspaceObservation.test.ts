import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { LocalToolRuntime, type ToolExecutionContext } from './LocalToolRuntime.js';
import type { LocalToolWorkspaceTarget } from './workspaceObservation.js';

describe('Runtime-owned tool workspace observation', () => {
  let root: string;
  let context: ToolExecutionContext;
  let tools: LocalToolRuntime;
  let facts: Array<{ target: LocalToolWorkspaceTarget; existed: boolean; outcome?: string }>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cats-tool-observation-'));
    await mkdir(join(root, 'deep', 'client', 'service', 'repo-a'), { recursive: true });
    await mkdir(join(root, 'repo-b'));
    await writeFile(join(root, 'deep', 'client', 'service', 'repo-a', 'a.txt'), 'alpha\n');
    await writeFile(join(root, 'repo-b', 'b.txt'), 'beta\n');
    context = { sessionId: 'session-1', cwd: root, permissionMode: 'skip', workspaceMode: 'shared', toolProfile: 'extended' };
    facts = [];
    tools = new LocalToolRuntime();
    tools.setWorkspaceObserver(() => ({ start: async target => {
      const fact = { target, existed: existsSync(target.path), outcome: undefined as string | undefined };
      facts.push(fact);
      return outcome => { fact.outcome = outcome; };
    }, gap: () => {} }));
  });
  afterEach(() => cleanupTempDirWithRetries(root));

  it('observes every admitted batch target without inferring individual read success', async () => {
    const result = await tools.execute(context, { id: 'batch', name: 'read_files',
      arguments: { paths: ['deep/client/service/repo-a/a.txt', 'repo-b/missing.txt'] } });
    expect(result.isError).toBeUndefined();
    expect(facts.map(fact => fact.target.path)).toEqual([
      join(root, 'deep', 'client', 'service', 'repo-a', 'a.txt'), join(root, 'repo-b', 'missing.txt'),
    ]);
    expect(facts.every(fact => fact.outcome === 'unknown')).toBe(true);
    expect(facts.every(fact => fact.target.cwd === root && fact.target.toolId === 'batch')).toBe(true);
  });

  it('captures delete identity before deletion and both rename targets before their outcome', async () => {
    const deleted = await tools.execute(context, { id: 'delete', name: 'delete_file', arguments: { path: 'repo-b/b.txt' } });
    expect(deleted.isError).toBeUndefined();
    expect(facts[0]).toMatchObject({ existed: true, outcome: 'succeeded', target: { kind: 'write', toolId: 'delete' } });
    expect(existsSync(facts[0].target.path)).toBe(false);
    const moved = await tools.execute(context, { id: 'move', name: 'rename_file',
      arguments: { source: 'deep/client/service/repo-a/a.txt', destination: 'repo-b/moved.txt' } });
    expect(moved.isError).toBeUndefined();
    expect(facts.slice(1).map(fact => fact.outcome)).toEqual(['succeeded', 'succeeded']);
    expect(facts.slice(1).map(fact => fact.existed)).toEqual([true, false]);
  });

  it('observes structured patch targets across directories and preserves failed write outcomes', async () => {
    const patched = await tools.execute(context, { id: 'patch', name: 'apply_patch', arguments: {
      input: '*** Begin Patch\n*** Add File: deep/client/service/repo-a/new.txt\n+new\n*** Add File: repo-b/new.txt\n+new\n*** End Patch',
    } });
    expect(patched.isError).toBeUndefined();
    expect(new Set(facts.map(fact => fact.target.path)).size).toBe(2);
    expect(facts.every(fact => fact.outcome === 'succeeded')).toBe(true);
    facts.length = 0;
    const failed = await tools.execute(context, { id: 'failed-move', name: 'rename_file',
      arguments: { source: 'deep/client/service/repo-a/a.txt', destination: 'repo-b/b.txt' } });
    expect(failed.isError).toBe(true);
    expect(facts.map(fact => fact.outcome)).toEqual(['failed', 'failed']);
  });

  it('does not observe denied paths/tools or discover child repositories from a parent listing', async () => {
    await tools.execute(context, { id: 'denied', name: 'read_file', arguments: { path: '../outside-secret' } });
    await tools.execute({ ...context, workspaceMode: 'read_only' }, { id: 'write-denied', name: 'write_file',
      arguments: { path: 'repo-b/denied.txt', content: 'private source text' } });
    expect(facts).toEqual([]);
    await tools.execute(context, { id: 'parent-list', name: 'list_files', arguments: { path: '.' } });
    expect(facts.map(fact => fact.target.path)).toEqual([root]);
    expect(JSON.stringify(facts)).not.toContain('private source text');
  });

  it('classifies a cross-directory copy as source read and destination write', async () => {
    const result = await tools.execute(context, { id: 'copy', name: 'copy_file',
      arguments: { source: 'deep/client/service/repo-a/a.txt', destination: 'repo-b/copied.txt' } });
    expect(result.isError).toBeUndefined();
    expect(facts.map(fact => fact.target.kind)).toEqual(['read', 'write']);
    expect(facts.every(fact => fact.outcome === 'succeeded')).toBe(true);
  });

  it('keeps concurrent tool contexts separate and captures the observer before asynchronous admission', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const finished: string[] = [];
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    tools.setWorkspaceObserver(({ sessionId }) => ({ start: async target => {
      if (target.toolId === 'first') { entered(); await blocked; }
      return outcome => { finished.push(`${sessionId}:${target.toolId}:${outcome}`); };
    }, gap: () => {} }));
    const first = tools.execute(context, { id: 'first', name: 'read_file', arguments: { path: 'repo-b/b.txt' } });
    await started;
    await tools.execute({ ...context, sessionId: 'session-2' }, { id: 'second', name: 'read_file',
      arguments: { path: 'deep/client/service/repo-a/a.txt' } });
    release();
    await first;
    expect(finished).toEqual(['session-2:second:succeeded', 'session-1:first:succeeded']);
  });

  it('preserves actual tool results when factory, start or completion observers fail', async () => {
    const failure = () => { throw new Error('observer failure'); };
    for (const factory of [failure, () => ({ start: failure, gap: failure }),
      () => ({ start: async () => failure, gap: failure })]) {
      tools.setWorkspaceObserver(factory);
      const result = await tools.execute(context, { id: 'write', name: 'write_file',
        arguments: { path: 'repo-b/written.txt', content: 'verified write\n' } });
      expect(result.isError).toBeUndefined();
      expect(await readFile(join(root, 'repo-b', 'written.txt'), 'utf8')).toBe('verified write\n');
    }
  });

  it('observes shell initial cwd without interpreting command text as a target or test class', async () => {
    const result = await tools.execute(context, { id: 'opaque-shell', name: 'run_shell',
      arguments: { command: 'node -e "process.exit(0)"' } });
    expect(result.isError).toBe(false);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ target: { path: root, kind: 'shell' }, outcome: 'succeeded' });
    expect(JSON.stringify(facts)).not.toContain('process.exit');
  });

  it('bounds a stalled identity probe and prevents its late result from admitting activity', async () => {
    let release!: () => void;
    const stalled = new Promise<void>(resolve => { release = resolve; });
    let admitted = false;
    const gaps: string[] = [];
    tools.setWorkspaceObserver(() => ({ start: async (_target, signal) => {
      await stalled;
      if (signal.aborted) return undefined;
      admitted = true;
      return () => {};
    }, gap: (_id, reason) => { gaps.push(reason); } }));
    const result = await tools.execute(context, { id: 'bounded-write', name: 'write_file',
      arguments: { path: 'repo-b/bounded.txt', content: 'still executes\n' } });
    expect(result.isError).toBeUndefined();
    expect(await readFile(join(root, 'repo-b', 'bounded.txt'), 'utf8')).toBe('still executes\n');
    release();
    await stalled;
    expect(admitted).toBe(false);
    expect(gaps).toContain('observer_error');
  });

  it('reports target overflow without retaining an unbounded observer list', async () => {
    const gaps: string[] = [];
    tools.setWorkspaceObserver(() => ({ start: async () => () => {},
      gap: (_id, reason) => { gaps.push(reason); } }));
    const input = ['*** Begin Patch', ...Array.from({ length: 70 }, (_, index) =>
      `*** Add File: repo-b/target-${index}.txt\n+fixture`), '*** End Patch'].join('\n');
    const result = await tools.execute(context, { id: 'many-targets', name: 'apply_patch', arguments: { input } });
    expect(result.isError).toBeUndefined();
    expect(gaps).toContain('observation_limit');
  }, 30_000);
});
