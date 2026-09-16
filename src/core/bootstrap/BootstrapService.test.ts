import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('retains per-target results across edits, restarts and re-selection without probing', async () => {
    const f = fixture();
    f.service.saveSelection(targets.slice(0, 2), 'missing');
    const scan = await f.service.scan({ manual: true });
    f.assessCliTarget.mockClear();
    f.service.saveSelection([targets[0], targets[3]], f.service.getSelection().revision);
    expect(await f.service.getLatestScan()).toBeNull();
    expect(await f.service.getSetupState()).toMatchObject({ lastScanAt: scan.scannedAt, lastManualScanAt: scan.scannedAt });
    const restarted = new BootstrapService(f.options);
    expect(restarted.getProviderObservations()).toEqual([
      expect.objectContaining({ provider: 'claude', configurationStatus: 'unchanged', observedAt: scan.scannedAt, available: true }),
      expect.objectContaining({ provider: 'codex', configurationStatus: 'not_selected', observedAt: scan.scannedAt }),
    ]);
    expect(restarted.getProviderObservations().some((entry) => entry.provider === 'pi')).toBe(false);
    restarted.saveSelection(targets.slice(0, 2), restarted.getSelection().revision);
    expect(restarted.getProviderObservations().every((entry) => entry.configurationStatus === 'unchanged')).toBe(true);
    expect(f.assessCliTarget).not.toHaveBeenCalled();
  });

  it('invalidates only changed commands and replaces only the targets detected again', async () => {
    const f = fixture();
    f.service.saveSelection(targets.slice(0, 2), 'missing');
    const first = await f.service.scan({ manual: true });
    f.service.saveSelection([{ ...targets[0], configuration: {
      command: 'different-claude', runner: 'auto', runtime: 'native',
    } }, targets[1]], f.service.getSelection().revision);
    expect(f.service.getProviderObservations()).toEqual([
      expect.objectContaining({ provider: 'claude', configurationStatus: 'changed', observedAt: first.scannedAt }),
      expect.objectContaining({ provider: 'codex', configurationStatus: 'unchanged', observedAt: first.scannedAt }),
    ]);
    f.assessCliTarget.mockImplementationOnce(async () => { throw new Error('fake probe failed'); });
    const refreshed = await f.service.scan({ manual: true, targets: [targets[0]] });
    expect(f.service.getProviderObservations()).toEqual([
      expect.objectContaining({ provider: 'claude', configurationStatus: 'unchanged', observedAt: refreshed.scannedAt,
        commandStatus: 'probe_failed', available: false }),
      expect.objectContaining({ provider: 'codex', configurationStatus: 'unchanged', observedAt: first.scannedAt,
        commandStatus: 'ready', available: true }),
    ]);
  });

  it('retains a completed current snapshot before activation changes its revision', () => {
    const f = fixture();
    const selection = f.service.saveSelection([targets[0]], 'missing');
    writeFileSync(join(f.paths.dataDir, 'setup', 'provider-scan.json'), JSON.stringify({
      revision: selection.revision, scannedAt: '2026-09-16T01:00:00.000Z', scanType: 'manual',
      providers: [{ ...targets[0], family: 'Claude', commandStatus: 'ready', commandPath: 'claude',
        version: null, authStatus: 'unknown', available: true, install: null, remediation: [] }],
    }));
    f.service.saveSelection([targets[0], targets[1]], selection.revision);
    const restarted = new BootstrapService(f.options);
    expect(restarted.getProviderObservations()).toEqual([
      expect.objectContaining({ provider: 'claude', configurationStatus: 'unchanged', observedAt: '2026-09-16T01:00:00.000Z' }),
    ]);
    expect(f.assessCliTarget).not.toHaveBeenCalled();
  });

  it('marks changed endpoint settings without persisting configuration secrets', async () => {
    const f = fixture();
    const target = { provider: 'openclaw', backend: 'agent', instance: 'gateway' };
    f.service.saveSelection([{ ...target, configuration: {
      transport: 'openclaw_gateway', url: 'http://example.invalid/first',
      headers: { Authorization: 'private-test-value' },
    } }], 'missing');
    await f.service.scan({ manual: true });
    const yaml = readFileSync(f.paths.configPath, 'utf8');
    writeFileSync(f.paths.configPath, yaml.replace('http://example.invalid/first', 'http://example.invalid/second'));
    f.service.selection.reload(f.service.getSelection().revision);
    expect(f.service.getProviderObservations()[0]).toMatchObject({ ...target, configurationStatus: 'changed' });
    const archive = readFileSync(join(f.paths.dataDir, 'setup', 'provider-observations.json'), 'utf8');
    expect(archive).not.toContain('private-test-value');
    expect(archive).not.toContain('example.invalid');
    expect(f.assessCliTarget).not.toHaveBeenCalled();
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
