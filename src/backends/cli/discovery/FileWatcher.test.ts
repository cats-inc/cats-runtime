import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from '../pool/SessionRegistry.js';
import { FileWatcher, type SessionScannerLike } from './FileWatcher.js';

describe('FileWatcher', () => {
  let watchDir: string;
  let registry: SessionRegistry;

  beforeEach(() => {
    watchDir = mkdtempSync(join(tmpdir(), 'file-watcher-test-'));
    registry = new SessionRegistry(undefined, undefined, { pi: 'native' });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(watchDir, { recursive: true, force: true });
  });

  it('discovers sessions when their directory is created after startup', async () => {
    vi.useFakeTimers();
    const sessionsDir = join(watchDir, 'new-cli', 'sessions');
    const scanner: SessionScannerLike = {
      scan: async () => existsSync(sessionsDir) ? [{
        providerSessionId: 'first-session',
        projectPath: sessionsDir,
        sourcePath: join(sessionsDir, 'session.jsonl'),
        cwd: watchDir,
      }] : [],
    };
    const watcher = new FileWatcher(sessionsDir, scanner, 'pi', registry, 'native');
    try {
      await watcher.start();
      expect(registry.list()).toHaveLength(0);
      mkdirSync(sessionsDir, { recursive: true });
      await vi.advanceTimersByTimeAsync(5000);
      expect(registry.list()).toHaveLength(1);
      expect(registry.list()[0].providerSessionId).toBe('first-session');
    } finally {
      watcher.stop();
    }
  });

  it('does not import an initial scan that completes after the watcher stops', async () => {
    let finish!: (sessions: Awaited<ReturnType<SessionScannerLike['scan']>>) => void;
    const scanner: SessionScannerLike = { scan: () => new Promise((resolve) => { finish = resolve; }) };
    const watcher = new FileWatcher(watchDir, scanner, 'pi', registry, 'native');
    const starting = watcher.start();
    watcher.stop();
    finish([{
      providerSessionId: 'late-session', projectPath: watchDir,
      sourcePath: join(watchDir, 'session.jsonl'), cwd: watchDir,
    }]);
    await starting;
    expect(registry.list()).toEqual([]);
  });

  it('reruns a pending scan request after a slow scan finishes', async () => {
    vi.useFakeTimers();
    let finish!: (sessions: Awaited<ReturnType<SessionScannerLike['scan']>>) => void;
    const scanner = { scan: vi.fn<SessionScannerLike['scan']>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue([{
        providerSessionId: 'changed-during-scan', projectPath: watchDir,
        sourcePath: join(watchDir, 'session.jsonl'), cwd: watchDir,
      }]),
    };
    const watcher = new FileWatcher(watchDir, scanner, 'pi', registry, 'native');
    try {
      const starting = watcher.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(scanner.scan).toHaveBeenCalledTimes(1);
      finish([]);
      await starting;
      await vi.waitFor(() => expect(registry.list()).toHaveLength(1));
      expect(scanner.scan).toHaveBeenCalledTimes(2);
    } finally {
      watcher.stop();
    }
  });

  it('prunes stale closed discovered sessions missing from the latest file-backed scan', async () => {
    const stale = registry.upsertDiscovered('pi-stale', {
      providerName: 'pi',
      providerInstanceId: 'native',
      cwd: '/tmp/stale',
      sourcePath: '/tmp/stale.jsonl',
    });
    const retained = registry.upsertDiscovered('pi-keep', {
      providerName: 'pi',
      providerInstanceId: 'native',
      cwd: '/tmp/keep',
      sourcePath: '/tmp/keep.jsonl',
    });
    const resumed = registry.upsertDiscovered('pi-live', {
      providerName: 'pi',
      providerInstanceId: 'native',
      cwd: '/tmp/live',
      sourcePath: '/tmp/live.jsonl',
    });
    registry.updateStatus(resumed!.id, 'ready');

    const scanner: SessionScannerLike = {
      scan: async () => [{
        providerSessionId: 'pi-keep',
        projectPath: watchDir,
        sourcePath: '/tmp/keep.jsonl',
        cwd: '/tmp/keep',
      }],
    };

    const watcher = new FileWatcher(watchDir, scanner, 'pi', registry, 'native');
    await watcher.start();
    watcher.stop();

    expect(registry.get(stale!.id)).toBeUndefined();
    expect(registry.get(retained!.id)).toBeDefined();
    expect(registry.get(resumed!.id)?.status).toBe('ready');
  });

  it('silently skips watching when the target directory does not exist', async () => {
    const missingDir = join(watchDir, 'missing');
    const scanner: SessionScannerLike = {
      scan: async () => [],
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const watcher = new FileWatcher(missingDir, scanner, 'pi', registry, 'native');
      await watcher.start();
      watcher.stop();

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('emits discovered only for provider sessions that are new to the registry', async () => {
    const scanner: SessionScannerLike = {
      scan: async () => [{
        providerSessionId: 'pi-existing-after-first-scan',
        projectPath: watchDir,
        sourcePath: join(watchDir, 'session.jsonl'),
        cwd: '/tmp/project',
      }],
    };
    const counts: number[] = [];

    const firstWatcher = new FileWatcher(watchDir, scanner, 'pi', registry, 'native');
    firstWatcher.on('discovered', ({ count }) => counts.push(count));
    await firstWatcher.start();
    firstWatcher.stop();

    const secondWatcher = new FileWatcher(watchDir, scanner, 'pi', registry, 'native');
    secondWatcher.on('discovered', ({ count }) => counts.push(count));
    await secondWatcher.start();
    secondWatcher.stop();

    expect(counts).toEqual([1]);
  });
});
