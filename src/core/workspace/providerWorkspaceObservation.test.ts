import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { RuntimeWorkspaceIdentity } from './activityTypes.js';
import { WorkspaceActivityStore } from './workspaceActivity.js';
import { ProviderWorkspaceObserver } from './providerWorkspaceObservation.js';

const identity: RuntimeWorkspaceIdentity = { checkoutId: 'checkout-a', executionLocationId: 'native:fixture',
  path: resolve('fixture/repo'), repository: { id: 'repo-a', label: 'repo' }, kind: 'original',
  branch: 'main', detachedCommit: null, management: 'unmanaged', verification: 'verified' };

function fixture(resolve = async () => ({ workspace: identity })) {
  const store = new WorkspaceActivityStore();
  const attachment = store.attach('session', { startupCwd: '/fixture', runtimeCwd: '/fixture' },
    { status: 'partial', reason: 'native_tools_partial' })!;
  const lease = store.beginExecution(attachment, 'run')!;
  return { store, lease, observer: new ProviderWorkspaceObserver(store, lease, resolve),
    snapshot: () => store.get('session')! };
}

const start = (id = 'tool') => ({ type: 'tool_use' as const, toolId: id,
  workspaceOperation: { path: resolve('fixture/repo/file'), kind: 'write' as const } });
const result = (id = 'tool') => ({ type: 'tool_result' as const, toolId: id,
  workspaceOutcome: 'succeeded' as const });

describe('native structured workspace observations', () => {
  it('orders concurrent admissions and results, deduplicates partial/full frames and retains no payload', async () => {
    const f = fixture();
    await Promise.all([
      f.observer.observe({ type: 'tool_use', toolId: 'tool', toolName: 'Write' }),
      f.observer.observe({ ...start(), toolArgs: { content: 'PRIVATE CONTENT' }, raw: { credential: 'SECRET' } }),
      f.observer.observe(start()), f.observer.observe(result()), f.observer.observe(result()),
    ]);
    const row = f.snapshot().workspaces[0];
    expect(row.runningOperations).toEqual([]);
    expect(row.recentOperations).toHaveLength(1);
    expect(row.recentOperations[0]).toMatchObject({ toolId: 'tool', executionId: 'run',
      evidence: 'provider_structured', state: 'succeeded' });
    expect(row.recentOperations[0].id).not.toBe('tool');
    expect(JSON.stringify(f.snapshot())).not.toMatch(/PRIVATE CONTENT|SECRET|credential|toolArgs/u);
  });

  it('rejects result-before-start and distinguishes missing outcome from success', async () => {
    const f = fixture();
    await f.observer.observe(result('late'));
    await f.observer.observe(start('late'));
    expect(f.snapshot().workspaces).toEqual([]);
    await f.observer.observe(start('unknown'));
    await f.observer.observe({ type: 'tool_result', toolId: 'unknown', text: 'success in prose', workspaceOutcome: 'unknown' });
    expect(f.snapshot().workspaces[0].recentOperations[0].state).toBe('unknown');
    await f.observer.observe(start('failed'));
    await f.observer.observe({ type: 'tool_result', toolId: 'failed', workspaceOutcome: 'failed' });
    expect(f.snapshot().workspaces[0].recentOperations[0].state).toBe('failed');
  });

  it('does not parse Bash commands, raw args or unknown provider targets', async () => {
    const probe = vi.fn(async () => ({ workspace: identity }));
    const f = fixture(probe);
    await f.observer.observe({ type: 'tool_use', toolId: 'shell', toolName: 'Bash',
      toolArgs: { command: 'cd /fixture/repo && git status', cwd: '/fixture/repo' } });
    expect(probe).not.toHaveBeenCalled();
    expect(f.snapshot().workspaces).toEqual([]);
  });

  it('does not map relative, drive-relative or foreign-OS paths onto the startup cwd', async () => {
    const probe = vi.fn(async () => ({ workspace: identity }));
    const f = fixture(probe);
    const foreign = process.platform === 'win32' ? '/tmp/repo/file' : 'C:\\repo\\file';
    for (const path of ['repo/file', 'C:file', foreign]) {
      await f.observer.observe({ ...start(path), workspaceOperation: { kind: 'read', path } });
    }
    expect(probe).not.toHaveBeenCalled();
    expect(f.snapshot().workspaces).toEqual([]);
    expect(f.snapshot().coverage).toEqual({ status: 'partial', reason: 'unsupported_tool' });
  });

  it('bounds stalled probes and ignores their late result after disposal', async () => {
    vi.useFakeTimers();
    try {
      let resolveProbe!: (value: { workspace: RuntimeWorkspaceIdentity }) => void;
      const f = fixture(() => new Promise(resolve => { resolveProbe = resolve; }));
      const observing = f.observer.observe(start());
      await vi.advanceTimersByTimeAsync(5001);
      await observing;
      expect(f.snapshot().coverage.reason).toBe('observer_error');
      expect(f.snapshot().workspaces).toEqual([]);
      f.observer.dispose();
      resolveProbe({ workspace: identity });
      await Promise.resolve();
      expect(f.snapshot().workspaces).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('rejects malformed IDs and ignores results without verified scope', async () => {
    const f = fixture();
    for (const toolId of [42, {}, ['secret'], { toString: null }]) {
      await expect(f.observer.observe({ ...start(), toolId } as never)).resolves.toBeUndefined();
    }
    expect(f.snapshot().workspaces).toEqual([]);
    expect(JSON.stringify(f.snapshot())).not.toContain('secret');
    await f.observer.observe(start());
    await f.observer.observe({ type: 'tool_result', toolId: 'tool', isError: true });
    expect(f.snapshot().workspaces[0].runningOperations).toHaveLength(1);
    await f.observer.observe(result());
    expect(f.snapshot().workspaces[0].recentOperations[0].state).toBe('succeeded');
  });

  it('caps queued work and correlation retention without falsely retaining running operations', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 40 }, (_, i) => f.observer.observe(start(`burst-${i}`))));
    expect(f.snapshot().truncated).toBe(true);
    expect(f.snapshot().workspaces[0].runningOperations.length).toBeLessThanOrEqual(8);
    f.store.endExecution(f.lease, 'cancelled');
    f.observer.dispose();
    const before = f.snapshot();
    await f.observer.observe(result());
    expect(f.snapshot()).toEqual(before);
    expect(f.snapshot().workspaces[0].runningOperations).toEqual([]);
  });
});
