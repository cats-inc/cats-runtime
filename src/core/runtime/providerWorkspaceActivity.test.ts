import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../backends/cli/providers/claude.js';
import { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import { withSelectedCliProviders } from '../../../tests/support/selectedCliFixture.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import type { RuntimeConfig } from '../config.js';
import type { StreamEvent } from '../types.js';
import { RuntimeSessionManager } from './RuntimeSessionManager.js';
import * as identity from '../workspace/workspaceIdentity.js';
import { isWorkspaceActivitySnapshot } from '../workspace/workspaceActivityValidation.js';

function events(provider: ClaudeProvider, frame: unknown): StreamEvent[] {
  const parsed = provider.parseStreamLine(JSON.stringify(frame));
  return parsed ? Array.isArray(parsed) ? parsed : [parsed] : [];
}

describe('selected native provider workspace activity', () => {
  let fixture: string;
  let root: string;
  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'cats-native-activity-'));
    root = join(fixture, 'cats-inc');
    const repo = join(root, 'source', 'teams', 'deep', 'repo');
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, 'input.txt'), 'Workspace observation fixture.\n');
    function git(...args: string[]) {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 15000, windowsHide: true });
      if (r.status !== 0) throw new Error(r.stderr);
    }
    git('init', '-b', 'main'); git('add', 'input.txt');
    git('-c', 'user.name=Cats fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
    git('worktree', 'add', '-b', 'fixture-review', join(root, 'checkouts', 'review'));
  }, 30000);
  afterAll(() => { if (fixture) cleanupTempDirWithRetries(fixture); });

  function setup(mode = 'native', providerName = 'claude') {
    const registry = new SessionRegistry(undefined, join(fixture, 'sessions'));
    const session = registry.create({ providerName, cwd: root });
    const runtime = new RuntimeSessionManager(withSelectedCliProviders({
      sessionBaseDir: join(fixture, 'sessions'),
      providerCommands: { [providerName]: { path: providerName, runner: 'direct', runtime: { mode } } },
    }) as RuntimeConfig, { get: vi.fn(), cancel: vi.fn() } as never);
    return { runtime, session, registry };
  }

  it('replays actual Windows Claude 2.1.304 tool frames through manager identity, lifecycle and inspection', async () => {
    const { runtime, session, registry } = setup();
    runtime.beginRun(session, { message: 'fixture' });
    const lease = runtime.getWorkspaceExecution(session.id)!;
    const provider = new ClaudeProvider();
    const frames = readFileSync(new URL('../../../tests/fixtures/provider-captures/claude-2.1.304/workspace-read-write.redacted.ndjson', import.meta.url), 'utf8')
      .trim().split(/\r?\n/).map(line => JSON.parse(line));
    const rewrite = (value: unknown): unknown => typeof value === 'string'
      ? value.replace(/<fixture-root>/gu, root).replace(/\\/gu, '/') : Array.isArray(value) ? value.map(rewrite)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)])) : value;
    const observed: StreamEvent[] = [];
    runtime.subscribeObservedStream(session.id, entry => observed.push(entry.event));
    for (const frame of frames) for (const event of events(provider, rewrite(frame))) {
      await runtime.observeProviderWorkspaceEvent(session.id, event, lease);
      runtime.observeEvent(session.id, event, lease);
    }
    const snapshot = runtime.getWorkspaceActivity(session.id)!;
    expect(isWorkspaceActivitySnapshot(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ runtimeCwd: root, startupCwd: root,
      coverage: { status: 'partial', reason: 'native_tools_partial' } });
    expect(snapshot.workspaces).toHaveLength(2);
    const source = snapshot.workspaces.find(row => row.kind === 'original')!;
    const worktree = snapshot.workspaces.find(row => row.kind === 'worktree')!;
    expect(source.kind).toBe('original');
    expect(worktree).toMatchObject({ kind: 'worktree', branch: 'fixture-review', management: 'unmanaged' });
    expect(source.repository!.id).toBe(worktree.repository!.id);
    expect(new Set(snapshot.workspaces.map(row => row.checkoutId)).size).toBe(2);
    expect(snapshot.workspaces.every(row => !row.runningOperations.length
      && row.recentOperations[0].state === 'succeeded')).toBe(true);
    expect([source, worktree].map(row => row.recentOperations[0].kind)).toEqual(['read', 'write']);
    expect(session.cwd).toBe(root);
    expect(JSON.stringify(snapshot)).not.toMatch(/NATIVE_WORKSPACE_OK|Workspace observation fixture|toolArgs/u);
    expect(observed.filter(event => event.type === 'workspace_activity').at(-1))
      .toMatchObject({ workspaceActivity: snapshot });

    // A separate native conversation reviewed the existing worktree with the same cwd.
    // Its IDs are deliberately redacted to the same fixture values: correlation is per execution.
    const reviewer = registry.create({ providerName: 'claude', cwd: root });
    runtime.beginRun(reviewer, { message: 'review fixture' });
    const reviewLease = runtime.getWorkspaceExecution(reviewer.id)!;
    const reviewProvider = new ClaudeProvider();
    const reviewFrames = readFileSync(new URL('../../../tests/fixtures/provider-captures/claude-2.1.304/workspace-review-failure.redacted.ndjson', import.meta.url), 'utf8')
      .trim().split(/\r?\n/).map(line => JSON.parse(line));
    for (const frame of reviewFrames) for (const event of events(reviewProvider, rewrite(frame))) {
      await runtime.observeProviderWorkspaceEvent(reviewer.id, event, reviewLease);
      runtime.observeEvent(reviewer.id, event, reviewLease);
    }
    const review = runtime.getWorkspaceActivity(reviewer.id)!;
    expect(isWorkspaceActivitySnapshot(review)).toBe(true);
    expect(review.runtimeCwd).toBe(root);
    expect(review.workspaces.find(row => row.kind === 'original')?.recentOperations[0])
      .toMatchObject({ kind: 'read', state: 'failed' });
    const reviewedWorktree = review.workspaces.find(row => row.kind === 'worktree')!;
    expect(reviewedWorktree.checkoutId).toBe(worktree.checkoutId);
    expect(reviewedWorktree.recentOperations.map(operation => [operation.kind, operation.state]))
      .toEqual([['write', 'succeeded'], ['read', 'succeeded']]);
    expect(runtime.getWorkspaceActivity(session.id)).toEqual(snapshot);
  }, 30000);

  it('accepts only complete direct structured paths and verified results from the adapter', () => {
    const provider = new ClaudeProvider();
    const frame = { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Read', id: 'read', input: { file_path: '/fixture/repo/input' }, caller: { type: 'direct' } },
      { type: 'tool_use', name: 'Bash', id: 'shell', input: { command: 'cd /fixture/repo && git status' } },
    ] } };
    const direct = events(provider, frame).filter(event => event.type === 'tool_use');
    expect(direct[0]).toMatchObject({ workspaceOperation: { kind: 'read', path: '/fixture/repo/input' } });
    expect(direct[1]).not.toHaveProperty('workspaceOperation');
    expect(events(provider, { ...frame, parent_tool_use_id: 'parent' }).filter(event => event.type === 'tool_use')
      .every(event => !event.workspaceOperation)).toBe(true);
    for (const caller of [undefined, { type: 'code_execution' }]) {
      expect(events(provider, { ...frame, message: { content: [
        { ...frame.message.content[0], caller },
      ] } }).filter(event => event.type === 'tool_use').every(event => !event.workspaceOperation)).toBe(true);
    }
    const failed = events(provider, { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'read', is_error: true, content: 'not success' },
    ] } }).find(event => event.type === 'tool_result');
    expect(failed).toMatchObject({ isError: true, workspaceOutcome: 'failed' });
    expect(() => events(provider, { type: 'user', message: { content: [null, 42, {}, 'prose'] } }))
      .not.toThrow();
  });

  it('keeps guest, unsupported-native and peer observations from probing the host', async () => {
    const probe = vi.spyOn(identity, 'resolveWorkspaceIdentity');
    try {
      for (const [mode, providerName, peer] of [['wsl', 'claude', false], ['docker', 'claude', false],
        ['native', 'codex', false], ['native', 'claude', true]] as const) {
        const { runtime, session } = setup(mode, providerName);
        runtime.beginRun(session, { message: 'fixture' }, peer ? { workspaceObservation: 'unmapped' } : {});
        await runtime.observeProviderWorkspaceEvent(session.id,
          { type: 'tool_use', toolId: 'foreign', workspaceOperation: { kind: 'read', path: root } },
          runtime.getWorkspaceExecution(session.id));
        expect(runtime.getWorkspaceActivity(session.id)).toMatchObject({
          coverage: { status: 'unsupported' }, workspaces: [],
        });
      }
      expect(probe).not.toHaveBeenCalled();
    } finally { probe.mockRestore(); }
  });

  it('discards pending native probes, old results and old sources across cancel and replacement', async () => {
    const { runtime, session } = setup();
    runtime.beginRun(session, { message: 'first' });
    const oldLease = runtime.getWorkspaceExecution(session.id)!;
    let finish!: (value: Awaited<ReturnType<typeof identity.resolveWorkspaceIdentity>>) => void;
    const probe = vi.spyOn(identity, 'resolveWorkspaceIdentity').mockImplementationOnce(() =>
      new Promise(resolve => { finish = resolve; }));
    try {
      const pending = runtime.observeProviderWorkspaceEvent(session.id,
        { type: 'tool_use', toolId: 'old', workspaceOperation: { kind: 'read', path: root } }, oldLease);
      await Promise.resolve();
      await runtime.cancel(session);
      runtime.beginRun(session, { message: 'replacement' });
      const current = runtime.getWorkspaceActivity(session.id);
      finish({ workspace: { checkoutId: 'late', path: root, executionLocationId: 'native:test',
        kind: 'unknown', repository: null, branch: null, detachedCommit: null,
        management: 'unknown', verification: 'unavailable' } });
      await pending;
      await runtime.observeProviderWorkspaceEvent(session.id,
        { type: 'tool_result', toolId: 'old', workspaceOutcome: 'succeeded' }, oldLease);
      runtime.observeEvent(session.id, { type: 'result' }, oldLease);
      expect(runtime.getWorkspaceActivity(session.id)).toEqual(current);
    } finally { probe.mockRestore(); }
  });

  it('invalidates the previous lease even when the replacement observation envelope is rejected', async () => {
    const { runtime, session } = setup();
    runtime.beginRun(session, { message: 'first' });
    const oldLease = runtime.getWorkspaceExecution(session.id)!;
    runtime.beginRun({ ...session, cwd: '' }, { message: 'invalid observation context' });
    expect(runtime.getWorkspaceExecution(session.id)).toBeUndefined();
    expect(runtime.getWorkspaceActivity(session.id)).toBeUndefined();
    await runtime.observeProviderWorkspaceEvent(session.id,
      { type: 'tool_use', toolId: 'old', workspaceOperation: { kind: 'read', path: root } }, oldLease);
    runtime.observeEvent(session.id, { type: 'result' }, oldLease);
    expect(runtime.getWorkspaceActivity(session.id)).toBeUndefined();
  });

  it('retains a schema-valid redacted live Runtime snapshot for cross-repository consumers', () => {
    const snapshot = JSON.parse(readFileSync(new URL('../../../tests/fixtures/provider-captures/claude-2.1.304/workspace-runtime-snapshot.redacted.json', import.meta.url), 'utf8'));
    expect(isWorkspaceActivitySnapshot(snapshot)).toBe(true);
    expect(snapshot.workspaces).toHaveLength(2);
    expect(snapshot.workspaces.every((row: { runningOperations: unknown[] }) => !row.runningOperations.length)).toBe(true);
  });
});
