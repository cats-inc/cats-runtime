import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { ProviderCompatibilityService } from '../src/core/compatibility/ProviderCompatibilityService.js';
import { createRuntimeServer } from '../src/server.js';
import { createRuntimeStartupState } from '../src/startup.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

const codex = { provider: 'codex', backend: 'cli', instance: 'native' };
const devin = { provider: 'devin', backend: 'agent', instance: 'acp' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('diagnostics during provider selection changes', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
  });

  function fixture(checkPackage: () => Promise<void>) {
    const root = mkdtempSync(join(tmpdir(), 'cats-diagnostics-selection-'));
    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    });
    ensureRuntimeTestDirs(createRuntimeTestPaths(root));
    const config = loadConfig(env);
    const compatibility = new ProviderCompatibilityService(config, {
      runner: { run: vi.fn(async () => {
        throw new Error('These diagnostics must not execute a provider');
      }) },
      installCheckRunner: {
        checkNpmPackage: async () => {
          await checkPackage();
          return { exists: true, version: '1.0.0', timedOut: false };
        },
        lookupCommand: async () => ({ available: true, resolvedPath: '/fake/cli', timedOut: false }),
        checkPath: async () => ({ exists: false, timedOut: false }),
        checkShellRcEntry: async () => ({ exists: false, timedOut: false }),
        getNpmPrefix: async () => ({ value: undefined, timedOut: false }),
      },
    });
    const runtime = createRuntimeServer(config, {
      compatibility,
      agentBackend: {
        env,
        cliCommandRunner: async () => { throw new Error('Unexpected agent CLI probe'); },
        acpProcessSpawner: () => { throw new Error('Unexpected ACP process'); },
      },
      startup: createRuntimeStartupState({ bootstrapRequired: true }),
    });
    cleanups.push(async () => {
      await runtime.close();
      await cleanupTempDirWithRetries(root);
    });
    const save = async (targets: Array<typeof codex>) => {
      const response = await runtime.app.request('/setup-selection', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets,
          expectedRevision: runtime.context.bootstrapService!.getSelection().revision }),
      });
      expect(response.status).toBe(200);
    };
    return { runtime, save, compatibility };
  }

  it.each([
    { endpoint: '/diagnostics/health', live: false, retainCodex: true },
    { endpoint: '/diagnostics/health', live: false, retainCodex: false },
    { endpoint: '/diagnostics/providers?scope=availability', live: false, retainCodex: false },
    { endpoint: '/diagnostics/providers', live: false, retainCodex: false },
    { endpoint: '/diagnostics/providers?probe=live', live: true, retainCodex: false },
  ])('discards the old selection for $endpoint (retain Codex: $retainCodex)', async ({ endpoint, live, retainCodex }) => {
    const release = deferred();
    const entered = deferred();
    const { runtime, save } = fixture(async () => {
      entered.resolve();
      await release.promise;
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await save([codex]);
    await entered.promise;
    const pending = runtime.app.request(endpoint);
    // Let the HTTP reader join/start its old-revision assessment before saving.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await save(retainCodex ? [codex, devin] : [devin]);
    const expectedProviders = retainCodex ? ['codex', 'devin'] : ['devin'];
    release.resolve();
    const response = await pending;
    expect(response.status).toBe(live ? 409 : 200);
    const body = await response.json();
    if (live) {
      expect(body).toMatchObject({ code: 'provider_selection_changed' });
    } else {
      const providers = endpoint === '/diagnostics/health' ? body.providers.defaults : body.providers;
      expect(providers.map((entry: { provider: string }) => entry.provider)).toEqual(expectedProviders);
    }
    expect(errors).not.toHaveBeenCalled();
    const current = await (await runtime.app.request('/diagnostics/providers?scope=availability')).json();
    expect(current.providers.map((entry: { provider: string }) => entry.provider)).toEqual(expectedProviders);
    expect((await runtime.app.request('/health')).status).toBe(200);
  });

  it('bounds retries when selection changes again during recovery', async () => {
    const releases = [deferred(), deferred()];
    const entered = [deferred(), deferred()];
    let phase = 0;
    const { runtime, save } = fixture(async () => {
      const current = phase;
      entered[current]?.resolve();
      await releases[current]?.promise;
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await save([codex]);
    await entered[0]!.promise;
    const pending = runtime.app.request('/diagnostics/health');
    await new Promise<void>((resolve) => setImmediate(resolve));
    phase = 1;
    await save([codex, devin]);
    await entered[1]!.promise;
    releases[0]!.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    phase = 2;
    await save([codex]);
    releases[1]!.resolve();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'provider_selection_changed' });
    expect(errors).not.toHaveBeenCalled();
    const current = await runtime.app.request('/diagnostics/health');
    expect(current.status).toBe(200);
    expect((await current.json()).providers.defaults.map((entry: { provider: string }) => entry.provider))
      .toEqual(['codex']);
  });

  it('preserves unrelated failures when the selection has not changed', async () => {
    const { runtime, save, compatibility } = fixture(async () => undefined);
    await save([codex]);
    await runtime.app.request('/diagnostics/health');
    const failure = new Error('Unexpected diagnostic failure');
    const assessment = vi.spyOn(compatibility, 'assessCliTarget').mockRejectedValue(failure);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await runtime.app.request('/diagnostics/providers')).status).toBe(500);
    expect(assessment).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(failure);
  });
});
