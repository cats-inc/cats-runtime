import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import { KNOWN_PROVIDERS } from '../../backends/cli/providers/types.js';
import { defaultKiroDbPath } from '../../backends/cli/config.js';
import { loadConfig } from '../config.js';
import type { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import { BootstrapService } from './BootstrapService.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from '../../../tests/support/runtimeTestPaths.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-bootstrap-service-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createTestEnv(root: string): NodeJS.ProcessEnv {
  return createRuntimeTestEnv(root);
}

function ensureDirs(env: NodeJS.ProcessEnv): void {
  const paths = createRuntimeTestPaths(env.HOME || env.USERPROFILE || '');
  ensureRuntimeTestDirs(paths);
}

function createAssessment(provider: ProviderName, commandPath: string) {
  return {
    setup: {
      command: {
        status: 'ready',
        resolvedCommand: commandPath,
      },
      version: {
        detected: `${provider}-1.0.0`,
      },
      auth: {
        status: 'ready',
      },
      remediation: [],
    },
  };
}

describe('BootstrapService', () => {
  it('preserves provider ordering even when probes resolve out of order', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const completionOrder: ProviderName[] = [];
      const compatibility = {
        assessCliTarget: async (target: { providerName: ProviderName; cliInstance?: { commandConfig: { path: string } } }) => {
          const providerIndex = KNOWN_PROVIDERS.indexOf(target.providerName);
          const delayMs = (KNOWN_PROVIDERS.length - providerIndex) * 2;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          completionOrder.push(target.providerName);
          return createAssessment(target.providerName, target.cliInstance?.commandConfig.path || target.providerName);
        },
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
        scanConcurrency: 4,
      });

      const result = await bootstrap.scan();
      expect(result.providers.map((entry) => entry.provider)).toEqual(KNOWN_PROVIDERS);
      expect(completionOrder).not.toEqual(KNOWN_PROVIDERS);
    } finally {
      cleanup();
    }
  });

  it('bounds scan concurrency to the configured worker count', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      let active = 0;
      let maxActive = 0;
      const compatibility = {
        assessCliTarget: async (target: { providerName: ProviderName; cliInstance?: { commandConfig: { path: string } } }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return createAssessment(target.providerName, target.cliInstance?.commandConfig.path || target.providerName);
        },
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
        scanConcurrency: 2,
      });

      const result = await bootstrap.scan();
      expect(result.providers).toHaveLength(KNOWN_PROVIDERS.length);
      expect(maxActive).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('keeps automatic scans separate from explicit manual scan snapshots', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const compatibility = {
        assessCliTarget: async (target: { providerName: ProviderName; cliInstance?: { commandConfig: { path: string } } }) => (
          createAssessment(target.providerName, target.cliInstance?.commandConfig.path || target.providerName)
        ),
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
      });

      const autoResult = await bootstrap.scan();
      expect(autoResult.scanType).toBe('auto');
      expect(existsSync(join(createRuntimeTestPaths(root).dataDir, 'setup', 'provider-manual-scan.json'))).toBe(false);
      expect((await bootstrap.getSetupState()).lastManualScanAt).toBeNull();

      const manualResult = await bootstrap.scan({ manual: true });
      expect(manualResult.scanType).toBe('manual');
      expect(existsSync(join(createRuntimeTestPaths(root).dataDir, 'setup', 'provider-manual-scan.json'))).toBe(true);
      expect((await bootstrap.getSetupState()).lastManualScanAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it('writes Devin only as the executable ACP agent target', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const devinPath = join(root, 'bin', 'devin.exe');
      const env = {
        ...createTestEnv(root),
        DEVIN_PATH: devinPath,
      };
      ensureDirs(env);
      const compatibility = {
        assessCliTarget: async (target: { providerName: ProviderName; cliInstance?: { commandConfig: { path: string } } }) => (
          createAssessment(target.providerName, target.cliInstance?.commandConfig.path || target.providerName)
        ),
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
      });

      await bootstrap.scan();
      await bootstrap.applyConfig(['devin']);

      const generated = loadConfig(env);
      expect(generated.providerInstances?.devin).toEqual({});
      expect(generated.remoteProviderCatalog?.agent.devin?.acp).toEqual(expect.objectContaining({
        providerName: 'devin',
        backend: 'agent',
        id: 'acp',
        transport: 'acp_stdio',
        command: devinPath,
        args: ['acp'],
        startupTimeoutMs: 15_000,
      }));
      expect(generated.providerDefaultTargets?.devin).toEqual({
        backend: 'agent',
        instance: 'acp',
      });

      const yaml = readFileSync(createRuntimeTestPaths(root).configPath, 'utf8');
      expect(yaml).not.toContain('cli:\n    providers:\n      devin:');
      expect(yaml).toContain('backend: agent');
      expect(yaml).toContain('transport: acp_stdio');
      expect(yaml).toContain('startup_timeout_ms: 15000');
    } finally {
      cleanup();
    }
  });

  it('writes Meta Muse as an executable CLI target', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const musePath = join(root, 'bin', 'muse.cmd');
      const env = {
        ...createTestEnv(root),
        MUSE_PATH: musePath,
      };
      ensureDirs(env);
      const compatibility = {
        assessCliTarget: async (target: { providerName: ProviderName; cliInstance?: { commandConfig: { path: string } } }) => (
          createAssessment(target.providerName, target.cliInstance?.commandConfig.path || target.providerName)
        ),
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
      });

      await bootstrap.scan();
      await bootstrap.applyConfig(['muse']);

      const generated = loadConfig(env);
      expect(generated.providerInstances?.muse?.native).toEqual(expect.objectContaining({
        id: 'native',
        providerName: 'muse',
      }));
      expect(generated.providerDefaultTargets?.muse).toEqual({
        backend: 'cli',
        instance: 'native',
      });

      const yaml = readFileSync(createRuntimeTestPaths(root).configPath, 'utf8');
      expect(yaml).toContain('muse:');
    } finally {
      cleanup();
    }
  });

  it('writes the runtime-aware Kiro database path into generated providers.yaml', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = {
        ...createTestEnv(root),
        KIRO_RUNTIME: 'docker',
      };
      ensureDirs(env);
      const compatibility = {
        assessCliTarget: async (target: { providerName: ProviderName; cliInstance?: { commandConfig: { path: string } } }) => (
          createAssessment(target.providerName, target.cliInstance?.commandConfig.path || target.providerName)
        ),
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
      });

      await bootstrap.applyConfig(['kiro']);

      const yaml = readFileSync(createRuntimeTestPaths(root).configPath, 'utf8');
      expect(yaml).toContain(`db_path: ${defaultKiroDbPath(process.platform, 'docker')}`);
    } finally {
      cleanup();
    }
  });
});

/**
 * `scanning` is written before probing and cleared after, and the desktop host
 * reads it as "a scan is already in flight" and declines to start another one.
 * A runtime that exits mid-scan therefore strands it on disk and disables
 * detection for good — which is exactly what the packaged update handoff does
 * when it drains the sidecars while the startup scan is still running.
 */
describe('BootstrapService stranded scan recovery', () => {
  function seedSetupState(root: string, state: Record<string, unknown>): string {
    const dataDir = createRuntimeTestPaths(root).dataDir;
    const setupDir = join(dataDir, 'setup');
    mkdirSync(setupDir, { recursive: true });
    const statePath = join(setupDir, 'setup-state.json');
    writeFileSync(statePath, JSON.stringify(state), 'utf8');
    return statePath;
  }

  function construct(root: string, env: NodeJS.ProcessEnv): void {
    // eslint-disable-next-line no-new
    new BootstrapService({
      dataDir: createRuntimeTestPaths(root).dataDir,
      configPath: createRuntimeTestPaths(root).configPath,
      config: loadConfig(env),
      compatibility: {} as unknown as ProviderCompatibilityService,
    });
  }

  it('clears a scanning status left by a process that is gone', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const statePath = seedSetupState(root, {
        status: 'scanning',
        lastScanAt: null,
        lastManualScanAt: null,
        appliedAt: null,
        appliedConfigPath: null,
        error: null,
      });

      construct(root, env);

      // Nothing ever scanned, so there is no result to fall back to.
      expect(JSON.parse(readFileSync(statePath, 'utf8')).status).toBe('pending');
    } finally {
      cleanup();
    }
  });

  it('restores a scanning status to ready when a scan had already completed', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const statePath = seedSetupState(root, {
        status: 'scanning',
        lastScanAt: '2026-08-28T18:00:00.000Z',
        lastManualScanAt: null,
        appliedAt: null,
        appliedConfigPath: null,
        error: null,
      });

      construct(root, env);

      const restored = JSON.parse(readFileSync(statePath, 'utf8'));
      expect(restored.status).toBe('ready');
      // The earlier result is still on disk and still true.
      expect(restored.lastScanAt).toBe('2026-08-28T18:00:00.000Z');
    } finally {
      cleanup();
    }
  });

  it('leaves every other persisted status alone', () => {
    for (const status of ['pending', 'ready', 'applied', 'error']) {
      const { root, cleanup } = createTestRoot();
      try {
        const env = createTestEnv(root);
        ensureDirs(env);
        const statePath = seedSetupState(root, {
          status,
          lastScanAt: null,
          lastManualScanAt: null,
          appliedAt: null,
          appliedConfigPath: null,
          error: null,
        });

        construct(root, env);

        expect(JSON.parse(readFileSync(statePath, 'utf8')).status).toBe(status);
      } finally {
        cleanup();
      }
    }
  });

  it('records a failed scan as an error rather than leaving it scanning', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const compatibility = {
        assessCliTarget: async () => {
          throw new Error('probe exploded');
        },
      } as unknown as ProviderCompatibilityService;

      const bootstrap = new BootstrapService({
        dataDir: createRuntimeTestPaths(root).dataDir,
        configPath: createRuntimeTestPaths(root).configPath,
        config: loadConfig(env),
        compatibility,
      });

      // probeProvider swallows per-provider failures, so force the throw past
      // it to prove the status is restored on the way out.
      (bootstrap as unknown as { probeProviders: () => Promise<never> }).probeProviders =
        async () => {
          throw new Error('scan exploded');
        };

      await expect(bootstrap.scan()).rejects.toThrow('scan exploded');

      const statePath = join(createRuntimeTestPaths(root).dataDir, 'setup', 'setup-state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      expect(state.status).toBe('error');
      expect(state.error).toBe('scan exploded');
    } finally {
      cleanup();
    }
  });
});

interface GatedProbe {
  release: () => void;
  runs: () => number;
}

function gateProbes(bootstrap: BootstrapService): GatedProbe {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let runs = 0;
  (bootstrap as unknown as { probeProviders: () => Promise<unknown[]> }).probeProviders =
    async () => {
      runs += 1;
      await gate;
      return [];
    };
  return { release, runs: () => runs };
}

async function waitForStatus(statePath: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(statePath)
      && JSON.parse(readFileSync(statePath, 'utf8')).status === status) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`setup state never reached ${status}`);
}

describe('BootstrapService.startScan', () => {
  function createGatedService(root: string) {
    const env = createTestEnv(root);
    ensureDirs(env);
    const paths = createRuntimeTestPaths(root);
    const bootstrap = new BootstrapService({
      dataDir: paths.dataDir,
      configPath: paths.configPath,
      config: loadConfig(env),
      compatibility: {
        assessCliTarget: async () => {
          throw new Error('probes are gated in this test');
        },
      } as unknown as ProviderCompatibilityService,
    });
    return {
      bootstrap,
      statePath: join(paths.dataDir, 'setup', 'setup-state.json'),
    };
  }

  it('persists the scanning status before returning to its caller', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const { bootstrap, statePath } = createGatedService(root);
      const probes = gateProbes(bootstrap);

      // The route answers from the state file the moment this returns. If the
      // status were written after the first await, that answer would still say
      // `ready` from the previous scan and the caller would stop polling before
      // this run had produced anything.
      expect(bootstrap.startScan({ manual: true })).toEqual({ started: true });
      expect(JSON.parse(readFileSync(statePath, 'utf8')).status).toBe('scanning');

      probes.release();
    } finally {
      cleanup();
    }
  });

  it('single-flights a running scan and accepts a new one once it settles', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const { bootstrap, statePath } = createGatedService(root);
      const probes = gateProbes(bootstrap);

      expect(bootstrap.startScan()).toEqual({ started: true });
      expect(bootstrap.startScan()).toEqual({ started: false });

      probes.release();
      await waitForStatus(statePath, 'ready');
      // The refused start left no second set of probes racing the first over
      // the same CLIs.
      expect(probes.runs()).toBe(1);

      expect(bootstrap.startScan()).toEqual({ started: true });
      await waitForStatus(statePath, 'ready');
      expect(probes.runs()).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('records a background failure as an error instead of rejecting into nowhere', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const { bootstrap, statePath } = createGatedService(root);
      (bootstrap as unknown as { probeProviders: () => Promise<never> }).probeProviders =
        async () => {
          throw new Error('scan exploded');
        };

      // Nothing awaits the promise startScan kicks off, so the failure has to
      // land in the state file rather than surfacing as an unhandled rejection.
      expect(bootstrap.startScan()).toEqual({ started: true });
      await waitForStatus(statePath, 'error');
      expect(JSON.parse(readFileSync(statePath, 'utf8')).error).toBe('scan exploded');
    } finally {
      cleanup();
    }
  });
});
