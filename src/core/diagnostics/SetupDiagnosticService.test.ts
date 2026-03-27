import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRuntimeResolvedPaths, loadConfig } from '../config.js';
import {
  ProviderEvolutionProbeService,
  PROVIDER_EVOLUTION_PROBE_PROFILES,
} from '../compatibility/providerEvolutionProbe.js';
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

async function createProviderEvolutionArtifact(root: string): Promise<void> {
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

  it('references recent provider-evolution artifacts without embedding full evidence', async () => {
    const { root, cleanup } = createTestRoot();

    try {
      await createProviderEvolutionArtifact(root);

      const service = new SetupDiagnosticService({
        config: loadConfig(createTestEnv(root)),
        bootstrapService: createBootstrapStub(),
        now: () => new Date('2026-03-26T00:00:00.000Z'),
      });

      const artifact = await service.generateReport();
      expect(artifact.report.references.providerEvolutionArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude',
            instance: 'default',
            parserId: 'claude-cli',
            probeProfile: 'manual_text',
            transport: 'stdio',
            relativePath: expect.stringMatching(/claude[\\/]/),
            review: expect.objectContaining({
              classifications: ['baseline'],
            }),
          }),
        ]),
      );
      expect(artifact.report.references.providerEvolutionArtifacts[0]).not.toHaveProperty('evidence');
    } finally {
      cleanup();
    }
  });

  it('references recent compatibility evidence artifacts without embedding full bundles', async () => {
    const { root, cleanup } = createTestRoot();

    try {
      createCompatibilityEvidenceArtifact(root);

      const service = new SetupDiagnosticService({
        config: loadConfig(createTestEnv(root)),
        bootstrapService: createBootstrapStub(),
        now: () => new Date('2026-03-26T00:00:00.000Z'),
      });

      const artifact = await service.generateReport();
      expect(artifact.report.references.compatibilityEvidenceArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactId: 'compat-artifact-1',
            provider: 'claude',
            instance: 'default',
            classification: 'probe_failed',
            parserId: 'claude-cli',
            profileId: 'claude-cli-best-fit',
            relativePath: expect.stringMatching(/claude[\\/]/),
          }),
        ]),
      );
      expect(artifact.report.references.compatibilityEvidenceArtifacts[0]).not.toHaveProperty('checks');
    } finally {
      cleanup();
    }
  });
});
