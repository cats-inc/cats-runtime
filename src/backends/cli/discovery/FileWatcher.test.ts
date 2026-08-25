import { mkdtempSync, rmSync } from 'node:fs';
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
    rmSync(watchDir, { recursive: true, force: true });
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
