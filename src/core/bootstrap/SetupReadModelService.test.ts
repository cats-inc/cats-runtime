import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SetupReadModelService } from './SetupReadModelService.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-setup-read-model-'));
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

describe('SetupReadModelService', () => {
  it('recommends a manual scan when no persisted scan exists', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const service = new SetupReadModelService({
        bootstrapRequired: true,
        bootstrapService: {
          getSetupState: async () => ({
            status: 'pending',
            lastScanAt: null,
            lastManualScanAt: null,
            appliedAt: null,
            appliedConfigPath: null,
            error: null,
          }),
          getLatestScan: async () => null,
          getLatestManualScan: async () => null,
          getProviderUniverse: () => [],
        },
      });

      const readModel = await service.read();

      expect(readModel.repair.status).toBe('scan_required');
      expect(readModel.repair.actions).toEqual([
        expect.objectContaining({
          kind: 'run_manual_scan',
          path: '/setup-scan',
          method: 'POST',
          body: {
            manual: true,
          },
        }),
        expect.objectContaining({
          kind: 'generate_setup_report',
          path: '/diagnostics/setup-report',
          method: 'POST',
          body: {
            refreshScan: true,
          },
        }),
      ]);
      expect(readModel.repair.nextAction).toEqual(expect.objectContaining({
        kind: 'run_manual_scan',
        path: '/setup-scan',
        method: 'POST',
      }));
    } finally {
      cleanup();
    }
  });

  it('prefers the latest manual scan and surfaces apply-config guidance during bootstrap', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const service = new SetupReadModelService({
        bootstrapRequired: true,
        bootstrapService: {
          getSetupState: async () => ({
            status: 'ready',
            lastScanAt: '2026-03-26T03:00:00.000Z',
            lastManualScanAt: '2026-03-26T04:00:00.000Z',
            appliedAt: null,
            appliedConfigPath: null,
            error: null,
          }),
          getLatestScan: async () => ({
            scannedAt: '2026-03-26T03:00:00.000Z',
            scanType: 'auto',
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
          }),
          getLatestManualScan: async () => ({
            scannedAt: '2026-03-26T04:00:00.000Z',
            scanType: 'manual',
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
              {
                provider: 'codex',
                family: 'Codex',
                commandStatus: 'missing_install',
                commandPath: null,
                version: null,
                authStatus: 'unknown',
                available: false,
                install: null,
                remediation: [
                  {
                    code: 'install_missing',
                    summary: 'Install Codex CLI.',
                  },
                ],
              },
            ],
          }),
          getProviderUniverse: () => [{
            provider: 'claude',
            familyLabel: 'Claude',
            binaryName: 'claude',
            install: {} as never,
          }],
        },
        diagnostics: {
          readLatestReport: () => ({
            artifactPath: join(root, 'runtime-data', 'diagnostics', 'setup-report.json'),
            report: {
              artifactId: 'setup-report-test',
              generatedAt: '2026-03-26T04:05:00.000Z',
              summary: {
                status: 'degraded',
                issueCounts: {
                  info: 0,
                  warnings: 1,
                  errors: 0,
                },
                headline: 'Setup report found 1 warning(s).',
              },
            } as never,
          }),
        },
      });

      const readModel = await service.read();

      expect(readModel.repair.preferredScan.source).toBe('manualScan');
      expect(readModel.repair.status).toBe('attention_required');
      expect(readModel.repair.providersReadyToApply).toEqual([
        {
          provider: 'claude',
          family: 'Claude',
        },
      ]);
      expect(readModel.repair.providersNeedingAttention).toEqual([
        expect.objectContaining({
          provider: 'codex',
          family: 'Codex',
          remediationCount: 1,
          remediationPreview: [
            {
              code: 'install_missing',
              summary: 'Install Codex CLI.',
            },
          ],
        }),
      ]);
      expect(readModel.repair.nextAction).toEqual(expect.objectContaining({
        kind: 'apply_config',
        path: '/setup-apply',
        method: 'POST',
        providers: ['claude'],
        body: {
          providers: ['claude'],
        },
      }));
      expect(readModel.repair.actions).toEqual([
        expect.objectContaining({
          kind: 'apply_config',
          providers: ['claude'],
        }),
        expect.objectContaining({
          kind: 'review_remediation',
          providers: ['codex'],
        }),
        expect.objectContaining({
          kind: 'generate_setup_report',
          path: '/diagnostics/setup-report',
          body: {
            refreshScan: false,
          },
        }),
      ]);
      expect(readModel.diagnostics.latestReport).toEqual(expect.objectContaining({
        artifactId: 'setup-report-test',
        status: 'degraded',
        headline: 'Setup report found 1 warning(s).',
      }));
    } finally {
      cleanup();
    }
  });
});
