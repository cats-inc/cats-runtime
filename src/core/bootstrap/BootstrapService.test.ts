import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import type { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import { BootstrapService } from './BootstrapService.js';
import { createRuntimeTestEnv, createRuntimeTestPaths } from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetriesAsync } from '../../../tests/tempCleanup.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await cleanupTempDirWithRetriesAsync(root); });
const targets = ['claude', 'codex', 'copilot', 'pi'].map((provider) => ({ provider, backend: 'cli', instance: 'native' }));

function fixture(assessCliTarget = vi.fn(async (_target: unknown, _options?: unknown) => ({
  setup: { command: { status: 'ready' }, version: {}, auth: { status: 'unknown' }, remediation: [] },
})), concurrency = 2) {
  const root = mkdtempSync(join(tmpdir(), 'cats-bootstrap-'));
  roots.push(root);
  const paths = createRuntimeTestPaths(root);
  const options = { config: loadConfig(createRuntimeTestEnv(root)), configPath: paths.configPath,
    dataDir: paths.dataDir, scanConcurrency: concurrency,
    compatibility: { assessCliTarget } as unknown as ProviderCompatibilityService };
  return { service: new BootstrapService(options), assessCliTarget, options, paths };
}

describe('selected provider bootstrap scans', () => {
  it('does not probe the supported catalog or a missing selection', () => {
    const f = fixture();
    expect(f.service.getProviderUniverse().some((entry) => entry.provider === 'ollama')).toBe(true);
    expect(() => f.service.startScan()).toThrow('Save a valid');
    expect(f.assessCliTarget).not.toHaveBeenCalled();
  });

  it('bounds concurrency and preserves declared order despite different completion order', async () => {
    let active = 0;
    let maximum = 0;
    const finished: string[] = [];
    const probe = vi.fn(async (value: unknown) => {
      const provider = (value as { providerName: string }).providerName;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, provider === 'claude' ? 50 : 5));
      active--;
      finished.push(provider);
      return { setup: { command: { status: 'ready' }, version: {}, auth: { status: 'unknown' }, remediation: [] } };
    });
    const f = fixture(probe);
    f.service.saveSelection(targets, 'missing');
    const result = await f.service.scan();
    expect(result.providers.map((entry) => entry.provider)).toEqual(targets.map((entry) => entry.provider));
    expect(finished[0]).not.toBe('claude');
    expect(maximum).toBe(2);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it('spends zero, one, or N probe calls according to selection on cold and warm scans', async () => {
    const f = fixture();
    const all = f.service.getProviderUniverse().filter((target) => target.backend === 'cli');
    for (const selected of [[], all.slice(0, 1), all]) {
      f.service.saveSelection(selected, f.service.getSelection().revision);
      for (const manual of [false, true]) {
        f.assessCliTarget.mockClear();
        await f.service.scan({ manual });
        expect(f.assessCliTarget).toHaveBeenCalledTimes(selected.length);
        expect(f.assessCliTarget.mock.calls.map(([value]) => (value as { providerName: string }).providerName))
          .toEqual(selected.map((target) => target.provider));
      }
    }
  });

  it('keeps manual observations distinct and refreshes only the requested subset', async () => {
    const f = fixture();
    f.service.saveSelection(targets, 'missing');
    const auto = await f.service.scan();
    expect(await f.service.getLatestManualScan()).toBeNull();
    const manual = await f.service.scan({ manual: true, targets: [targets[0]] });
    expect(manual.providers).toHaveLength(1);
    expect(f.assessCliTarget).toHaveBeenLastCalledWith(expect.objectContaining({ providerName: 'claude' }),
      expect.objectContaining({ force: true, probeMode: 'light' }));
    expect((await f.service.getLatestManualScan())?.revision).toBe(auto.revision);
  });

  it('answers scan start before completion and coalesces the same requested scope', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = fixture(vi.fn(async () => {
      await gate;
      return { setup: { command: { status: 'ready' }, version: {}, auth: { status: 'unknown' }, remediation: [] } };
    }));
    f.service.saveSelection([targets[0]], 'missing');
    expect(f.service.startScan()).toEqual({ started: true });
    expect((await f.service.getSetupState()).status).toBe('scanning');
    expect(f.service.startScan()).toEqual({ started: false });
    release();
    await f.service.scan();
    expect((await f.service.getSetupState()).status).toBe('ready');
  });

  it('recovers persisted scanning progress after a restart', async () => {
    const f = fixture();
    mkdirSync(join(f.paths.dataDir, 'setup'), { recursive: true });
    writeFileSync(join(f.paths.dataDir, 'setup', 'setup-state.json'), JSON.stringify({
      status: 'scanning', lastScanAt: null, lastManualScanAt: null, appliedAt: null,
      appliedConfigPath: null, error: null,
    }));
    const restarted = new BootstrapService(f.options);
    expect((await restarted.getSetupState()).status).toBe('pending');
  });

  it('does not turn endpoint targets into native CLI installation advice', async () => {
    const f = fixture();
    f.service.saveSelection([{ provider: 'claude', backend: 'api', instance: 'personal',
      configuration: { transport: 'anthropic', api_key_env: 'TEST_KEY' } },
      { provider: 'ollama', backend: 'local', instance: 'local' }], 'missing');
    const result = await f.service.scan();
    expect(result.providers.every((entry) => entry.install === null)).toBe(true);
    expect(f.assessCliTarget).not.toHaveBeenCalled();
  });
});
