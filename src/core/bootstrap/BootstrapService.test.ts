import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
      }));
      expect(generated.providerDefaultTargets?.devin).toEqual({
        backend: 'agent',
        instance: 'acp',
      });

      const yaml = readFileSync(createRuntimeTestPaths(root).configPath, 'utf8');
      expect(yaml).not.toContain('cli:\n    providers:\n      devin:');
      expect(yaml).toContain('backend: agent');
      expect(yaml).toContain('transport: acp_stdio');
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
