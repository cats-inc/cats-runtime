import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import {
  SetupDiagnosticService,
  type SetupDiagnosticBootstrapService,
} from './SetupDiagnosticService.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-setup-diagnostic-service-'));
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

function createBootstrapStub(): SetupDiagnosticBootstrapService {
  const latest = {
    scannedAt: '2026-03-26T00:00:00.000Z',
    scanType: 'manual' as const,
    providers: [
      {
        provider: 'claude',
        family: 'Claude',
        commandStatus: 'ready',
        commandPath: 'claude',
        version: '1.0.0',
        authStatus: 'ready',
        available: true,
        install: null,
        remediation: [],
      },
    ],
  };

  return {
    getProviderUniverse: () => [({
      provider: 'claude',
      familyLabel: 'Claude',
      binaryName: 'claude',
      install: {
        provider: 'claude',
      },
    })],
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
    scan: async () => latest,
  };
}

describe('SetupDiagnosticService', () => {
  it('lists retained reports newest-first and reads specific artifacts by id', async () => {
    const { root, cleanup } = createTestRoot();
    const timestamps = [
      '2026-03-26T00:00:00.000Z',
      '2026-03-26T00:00:01.000Z',
    ];

    try {
      const service = new SetupDiagnosticService({
        config: loadConfig(createTestEnv(root)),
        bootstrapService: createBootstrapStub(),
        now: () => new Date(timestamps.shift() ?? '2026-03-26T00:00:02.000Z'),
      });

      const first = await service.generateReport();
      const second = await service.generateReport();

      const summaries = service.listReports();
      expect(summaries.map((entry) => entry.artifactId)).toEqual([
        second.report.artifactId,
        first.report.artifactId,
      ]);
      expect(summaries[0]).toEqual(expect.objectContaining({
        artifactPath: second.artifactPath,
        generatedAt: second.report.generatedAt,
        summary: second.report.summary,
      }));

      const reread = service.readReport(first.report.artifactId);
      expect(reread).toEqual({
        artifactPath: first.artifactPath,
        report: first.report,
      });
      expect(service.readReport('../not-allowed')).toBeNull();
    } finally {
      cleanup();
    }
  });
});
