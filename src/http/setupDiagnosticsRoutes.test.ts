import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config.js';
import type { SetupDiagnosticBootstrapService } from '../core/diagnostics/SetupDiagnosticService.js';
import type { AppContext } from './app.js';
import { setupDiagnosticsRoutes } from './routes/setupDiagnostics.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-setup-diagnostics-route-'));
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

describe('setup diagnostics routes', () => {
  it('generates and reads the latest setup diagnostic artifact', async () => {
    const { root, cleanup } = createTestRoot();
    try {
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
        report: { setup: { scan: { source: string } } };
      };
      expect(postBody.status).toBe('generated');
      expect(postBody.report.setup.scan.source).toBe('refreshed');
      expect(existsSync(postBody.artifactPath)).toBe(true);

      const latestResponse = await app.request('/diagnostics/setup-report/latest');
      expect(latestResponse.status).toBe(200);
      const latestBody = await latestResponse.json() as {
        artifactPath: string;
        report: { artifactId: string };
      };
      expect(latestBody.artifactPath).toBe(postBody.artifactPath);
      expect(latestBody.report.artifactId).toContain('setup-report-');
    } finally {
      cleanup();
    }
  });
});
