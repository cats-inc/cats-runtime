import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import {
  SetupDiagnosticService,
  type SetupDiagnosticBootstrapService,
} from './SetupDiagnosticService.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-setup-diagnostics-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createTestEnv(root: string): NodeJS.ProcessEnv {
  return {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: join(root, 'config', 'providers.yaml'),
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
  };
}

function createBootstrapStub(
  root: string,
): SetupDiagnosticBootstrapService {
  let latest = {
    scannedAt: '2026-03-26T00:00:00.000Z',
    scanType: 'manual' as const,
    providers: [
      {
        provider: 'claude',
        family: 'Claude',
        commandStatus: 'ready',
        commandPath: join(root, 'bin', 'claude'),
        version: '1.0.0',
        authStatus: 'ready',
        available: true,
        install: null,
        remediation: [],
      },
      {
        provider: 'codex',
        family: 'Codex',
        commandStatus: 'missing_install',
        commandPath: null,
        version: null,
        authStatus: 'unknown',
        available: false,
        install: null,
        remediation: [],
      },
    ],
  };

  return {
    getProviderUniverse: () => [
      {
        provider: 'claude',
        familyLabel: 'Claude',
        binaryName: 'claude',
        install: {
          provider: 'claude',
        } as unknown,
      },
      {
        provider: 'codex',
        familyLabel: 'Codex',
        binaryName: 'codex',
        install: {
          provider: 'codex',
        } as unknown,
      },
    ],
    getSetupState: async () => ({
      status: 'ready',
      lastScanAt: latest.scannedAt,
      lastManualScanAt: latest.scannedAt,
      appliedAt: null,
      appliedConfigPath: null,
      error: null,
    }),
    getLatestScan: async () => latest,
    getLatestManualScan: async () => latest,
    scan: async () => {
      latest = {
        ...latest,
        scannedAt: '2026-03-26T00:10:00.000Z',
      };
      return latest;
    },
  };
}

describe('SetupDiagnosticService', () => {
  it('generates a redacted setup report from existing setup snapshots', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const config = loadConfig(env);
      const service = new SetupDiagnosticService({
        config,
        startup: {
          contractVersion: 1,
          mode: 'standalone',
          readyOutput: 'plain',
          readySignal: 'http',
          readinessPath: '/health',
          phase: 'ready',
          pid: process.pid,
          startedAt: '2026-03-26T00:00:00.000Z',
          ready: true,
          bootstrapRequired: true,
          address: {
            host: '127.0.0.1',
            port: 3110,
            healthUrl: 'http://127.0.0.1:3110/health',
          },
          version: '0.1.0-test',
        },
        bootstrapService: createBootstrapStub(root),
        now: () => new Date('2026-03-26T01:00:00.000Z'),
      });

      const result = await service.generateReport();

      expect(existsSync(result.artifactPath)).toBe(true);
      expect(result.report.setup.scan.source).toBe('existing');
      expect(result.report.summary.status).toBe('degraded');
      expect(result.report.runtime.paths.dataDir).toContain('<home>');
      expect(result.report.references.compatibilityEvidenceDir).toContain('<home>');
      expect(result.report.setup.scan.latest?.providers[0]?.commandPath).toContain('<home>');
    } finally {
      cleanup();
    }
  });

  it('retains only the newest bounded number of report artifacts and can read the latest', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const config = loadConfig(env);
      const bootstrapService = createBootstrapStub(root);
      const timestamps = [
        '2026-03-26T01:00:00.000Z',
        '2026-03-26T01:05:00.000Z',
      ];
      let nextTimestamp = 0;
      const service = new SetupDiagnosticService({
        config,
        bootstrapService,
        retentionLimit: 1,
        now: () => new Date(timestamps[nextTimestamp++] || timestamps[timestamps.length - 1]!),
      });

      const first = await service.generateReport();
      const second = await service.generateReport({ refreshScan: true });

      expect(existsSync(first.artifactPath)).toBe(false);
      expect(existsSync(second.artifactPath)).toBe(true);
      expect(second.report.setup.scan.source).toBe('refreshed');

      const latest = service.readLatestReport();
      expect(latest?.artifactPath).toBe(second.artifactPath);
      expect(latest?.report.generatedAt).toBe('2026-03-26T01:05:00.000Z');
    } finally {
      cleanup();
    }
  });

  it('records config load failures as additive report metadata', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const config = loadConfig(env, { skipProviderFile: true });
      const service = new SetupDiagnosticService({
        config,
        configLoadError: 'Provider claude is configured in multiple backends without an explicit selector.',
        now: () => new Date('2026-03-26T02:00:00.000Z'),
      });

      const result = await service.generateReport();

      expect(result.report.config.loadError).toContain('multiple backends');
      expect(result.report.summary.status).toBe('unavailable');
      expect(result.report.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'config_load_error',
          severity: 'error',
        }),
      ]));
    } finally {
      cleanup();
    }
  });
});
