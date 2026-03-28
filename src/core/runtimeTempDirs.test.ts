import { mkdtempSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupStaleRuntimeTempDirs,
  DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_MS,
  formatRuntimeTempCleanupSummary,
} from './runtimeTempDirs.js';

const createdRoots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-temp-cleanup-'));
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('cleanupStaleRuntimeTempDirs', () => {
  it('removes stale candidate directories and keeps recent ones', async () => {
    const root = createRoot();
    const staleDir = join(root, 'cats-runtime-peer-config-old');
    const recentDir = join(root, 'cats-runtime-provider-opencode-live-new');
    const unrelatedDir = join(root, 'cats-runtime-data');
    mkdirSync(staleDir);
    mkdirSync(recentDir);
    mkdirSync(unrelatedDir);

    const staleTime = new Date(Date.now() - (DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_MS + 60_000));
    utimesSync(staleDir, staleTime, staleTime);

    const summary = await cleanupStaleRuntimeTempDirs({ rootDir: root });

    expect(summary.removedCount).toBe(1);
    expect(summary.keptCount).toBe(1);
    expect(summary.candidateCount).toBe(2);
    expect(summary.removedByPrefix['cats-runtime-peer-']).toBe(1);
    expect(summary.keptByReason.recent).toBe(1);
    expect(summary.keptByReason.livePid).toBe(0);
    expect(summary.keptByReason.failed).toBe(0);
    expect(() => rmSync(staleDir, { recursive: true, force: false })).toThrow();
    expect(() => rmSync(recentDir, { recursive: true, force: false })).not.toThrow();
    expect(() => rmSync(unrelatedDir, { recursive: true, force: false })).not.toThrow();
  });

  it('keeps live python temp directories and removes dead or legacy ones', async () => {
    const root = createRoot();
    const livePythonDir = join(root, `cats-runtime-python-${process.pid}-keep`);
    const deadPythonDir = join(root, 'cats-runtime-python-999999-dead');
    const legacyPythonDir = join(root, 'cats-runtime-python-legacy');
    mkdirSync(livePythonDir);
    mkdirSync(deadPythonDir);
    mkdirSync(legacyPythonDir);

    const summary = await cleanupStaleRuntimeTempDirs({
      rootDir: root,
      currentPid: process.pid,
    });

    expect(summary.removedCount).toBe(2);
    expect(summary.keptCount).toBe(1);
    expect(summary.removedByPrefix['cats-runtime-python-']).toBe(2);
    expect(summary.keptByReason.livePid).toBe(1);
    expect(() => rmSync(livePythonDir, { recursive: true, force: false })).not.toThrow();
    expect(() => rmSync(deadPythonDir, { recursive: true, force: false })).toThrow();
    expect(() => rmSync(legacyPythonDir, { recursive: true, force: false })).toThrow();
  });

  it('formats a concise operator summary', () => {
    const summary = formatRuntimeTempCleanupSummary({
      rootDir: '/tmp/cats-runtime-tests',
      scannedCount: 12,
      candidateCount: 4,
      removedCount: 3,
      keptCount: 1,
      removedByPrefix: {
        'cats-runtime-peer-': 2,
        'cats-runtime-python-': 1,
      },
      keptByReason: {
        recent: 1,
        livePid: 0,
        failed: 0,
      },
    });

    expect(summary).toContain('Cleaned 3 stale cats-runtime temp directories');
    expect(summary).toContain('/tmp/cats-runtime-tests');
    expect(summary).toContain('cats-runtime-peer-2');
    expect(summary).toContain('cats-runtime-python-1');
  });
});
