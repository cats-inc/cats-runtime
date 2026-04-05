import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  ProviderEvolutionProbeService,
  PROVIDER_EVOLUTION_PROBE_PROFILES,
} from '../core/compatibility/providerEvolutionProbe.js';
import { getRuntimeResolvedPaths, loadConfig } from '../core/config.js';
import type { SetupDiagnosticBootstrapService } from '../core/diagnostics/SetupDiagnosticService.js';
import type { AppContext } from './app.js';
import { setupDiagnosticsRoutes } from './routes/setupDiagnostics.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from '../../tests/support/runtimeTestPaths.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-setup-diagnostics-route-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createTestEnv(root: string): NodeJS.ProcessEnv {
  return createRuntimeTestEnv(root, {
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
  });
}

function createBootstrapStub(): SetupDiagnosticBootstrapService {
  let latest = {
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
    getProviderUniverse: () => [{
      provider: 'claude',
      familyLabel: 'Claude',
      binaryName: 'claude',
      install: {
        provider: 'claude',
      } as unknown,
    }],
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

async function createProviderEvolutionArtifact(root: string): Promise<void> {
  ensureRuntimeTestDirs(createRuntimeTestPaths(root));
  const config = loadConfig(createTestEnv(root));
  const service = new ProviderEvolutionProbeService({
    rootDir: join(getRuntimeResolvedPaths(config).compatibilityEvidenceDir, 'provider-evolution'),
  });

  await service.run({
    target: {
      provider: 'claude',
      instance: 'default',
      parserId: 'claude-cli',
      probeProfile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text.id,
      transport: 'stdio',
      version: '1.0.0',
    },
    profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
    run: async () => ({
      status: 'completed',
      turnsCompleted: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text.turns.length,
      emittedEventCount: 0,
    }),
  });
}

function createCompatibilityEvidenceArtifact(root: string): void {
  const config = loadConfig(createTestEnv(root));
  const providerDir = join(getRuntimeResolvedPaths(config).compatibilityEvidenceDir, 'claude');
  mkdirSync(providerDir, { recursive: true });
  writeFileSync(join(providerDir, 'compat-artifact-1.json'), `${JSON.stringify({
    schemaVersion: 3,
    id: 'compat-artifact-1',
    capturedAt: '2026-03-26T00:00:00.000Z',
    classification: 'probe_failed',
    summary: 'Compatibility probe failed while checking the provider.',
    target: {
      provider: 'claude',
      instanceId: 'default',
    },
    profile: {
      id: 'claude-cli-best-fit',
      label: 'claude best fit',
      protocolFamily: 'claude',
      parserId: 'claude-cli',
      confidence: 'fallback',
    },
    fingerprint: {
      provider: 'claude',
      instanceId: 'default',
      command: 'claude',
      runner: 'auto',
      runtime: { mode: 'native' },
      version: {
        detected: true,
        source: 'command',
      },
      features: [],
      checkedAt: '2026-03-26T00:00:00.000Z',
    },
    warnings: [],
    setup: {
      status: 'ready',
      summary: 'ready',
      install: null,
      auth: null,
      remediation: [],
    },
    probes: {},
    checks: [],
  }, null, 2)}\n`, 'utf8');
}

describe('setup diagnostics routes', () => {
  it('generates, lists, and reads setup diagnostic artifacts', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      await createProviderEvolutionArtifact(root);
      createCompatibilityEvidenceArtifact(root);
      const app = new Hono<{ Variables: { ctx: AppContext } }>();
      const ctx = {
        config: loadConfig(createTestEnv(root)),
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
          bootstrapRequired: false,
          version: '0.1.0-test',
        },
        bootstrapService: createBootstrapStub(),
      } as unknown as AppContext;

      app.use('*', async (c, next) => {
        c.set('ctx', ctx);
        await next();
      });
      app.route('/', setupDiagnosticsRoutes);

      const postResponse = await app.request('/diagnostics/setup-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshScan: true }),
      });
      expect(postResponse.status).toBe(200);
      const postBody = await postResponse.json() as {
        status: string;
        artifactPath: string;
        report: {
          artifactId: string;
          setup: {
            scan: { source: string };
            repair: {
              status: string;
              nextAction: {
                kind: string;
              };
            };
          };
          references: {
            compatibilityEvidenceArtifacts: Array<{
              provider: string;
              classification: string;
              relativePath: string;
            }>;
            providerEvolutionArtifacts: Array<{
              provider: string;
              relativePath: string;
            }>;
          };
        };
      };
      expect(postBody.status).toBe('generated');
      expect(postBody.report.setup.scan.source).toBe('refreshed');
      expect(postBody.report.setup.repair).toEqual(expect.objectContaining({
        status: 'ready',
        nextAction: expect.objectContaining({
          kind: 'none',
        }),
      }));
      expect(postBody.report.references.compatibilityEvidenceArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude',
            classification: 'probe_failed',
            relativePath: expect.stringMatching(/claude[\\/]/),
          }),
        ]),
      );
      expect(postBody.report.references.providerEvolutionArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude',
            relativePath: expect.stringMatching(/claude[\\/]/),
          }),
        ]),
      );
      expect(existsSync(postBody.artifactPath)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const secondPostResponse = await app.request('/diagnostics/setup-report', {
        method: 'POST',
      });
      expect(secondPostResponse.status).toBe(200);
      const secondPostBody = await secondPostResponse.json() as {
        artifactPath: string;
        report: { artifactId: string };
      };
      expect(secondPostBody.report.artifactId).not.toBe(postBody.report.artifactId);

      const listResponse = await app.request('/diagnostics/setup-report?limit=1');
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {
        artifacts: Array<{
          artifactId: string;
          artifactPath: string;
          generatedAt: string;
          summary: { headline: string };
        }>;
      };
      expect(listBody.artifacts).toHaveLength(1);
      expect(listBody.artifacts[0]).toEqual(expect.objectContaining({
        artifactId: secondPostBody.report.artifactId,
        artifactPath: secondPostBody.artifactPath,
        generatedAt: expect.any(String),
        summary: expect.objectContaining({
          headline: expect.any(String),
        }),
      }));

      const latestResponse = await app.request('/diagnostics/setup-report/latest');
      expect(latestResponse.status).toBe(200);
      const latestBody = await latestResponse.json() as {
        artifactPath: string;
        report: { artifactId: string };
      };
      expect(latestBody.artifactPath).toBe(secondPostBody.artifactPath);
      expect(latestBody.report.artifactId).toBe(secondPostBody.report.artifactId);

      const artifactResponse = await app.request(
        `/diagnostics/setup-report/${encodeURIComponent(postBody.report.artifactId)}`,
      );
      expect(artifactResponse.status).toBe(200);
      const artifactBody = await artifactResponse.json() as {
        artifactPath: string;
        report: { artifactId: string };
      };
      expect(artifactBody.artifactPath).toBe(postBody.artifactPath);
      expect(artifactBody.report.artifactId).toBe(postBody.report.artifactId);

      const missingResponse = await app.request('/diagnostics/setup-report/setup-report-missing');
      expect(missingResponse.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});
