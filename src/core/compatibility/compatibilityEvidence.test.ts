import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompatibilityEvidenceService } from './compatibilityEvidence.js';

function writeCompatibilityEvidenceArtifact(
  root: string,
  provider: string,
  artifactId: string,
  overrides: Partial<{
    instanceId: string;
    classification: 'degraded' | 'unsupported_version' | 'unrecognized_protocol' | 'probe_failed';
    summary: string;
    capturedAt: string;
    parserId: string;
    profileId: string;
  }> = {},
): string {
  const providerDir = join(root, provider);
  mkdirSync(providerDir, { recursive: true });
  const artifactPath = join(providerDir, `${artifactId}.json`);
  writeFileSync(artifactPath, `${JSON.stringify({
    schemaVersion: 3,
    id: artifactId,
    capturedAt: overrides.capturedAt || '2026-03-27T00:00:00.000Z',
    classification: overrides.classification || 'unsupported_version',
    summary: overrides.summary || 'Provider version is newer than the best-fit profile.',
    target: {
      provider,
      instanceId: overrides.instanceId || 'default',
    },
    profile: {
      id: overrides.profileId || `${provider}-cli-best-fit`,
      label: `${provider} best fit`,
      protocolFamily: provider,
      parserId: overrides.parserId || `${provider}-json`,
      confidence: 'fallback',
    },
    fingerprint: {
      provider,
      instanceId: overrides.instanceId || 'default',
      command: provider,
      runner: 'auto',
      runtime: { mode: 'native' },
      version: {
        detected: true,
        source: 'command',
      },
      features: [],
      checkedAt: overrides.capturedAt || '2026-03-27T00:00:00.000Z',
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
  return artifactPath;
}

describe('CompatibilityEvidenceService', () => {
  it('lists and reads retained compatibility evidence artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    const service = new CompatibilityEvidenceService({ rootDir: root });

    try {
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-old', {
        capturedAt: '2026-03-26T00:00:00.000Z',
        instanceId: 'default',
      });
      const currentPath = writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-new', {
        capturedAt: '2026-03-27T00:00:00.000Z',
        instanceId: 'ubuntu',
        classification: 'probe_failed',
        summary: 'Compatibility probe failed while checking the provider.',
        parserId: 'codex-json-rpc',
      });

      const listed = await service.listArtifacts({
        provider: 'codex',
        limit: 5,
      });
      expect(listed.map((artifact) => artifact.artifactId)).toEqual([
        'artifact-new',
        'artifact-old',
      ]);
      expect(listed[0]).toEqual(expect.objectContaining({
        provider: 'codex',
        instance: 'ubuntu',
        classification: 'probe_failed',
        parserId: 'codex-json-rpc',
      }));

      const latest = await service.readLatestArtifact({
        provider: 'codex',
        instance: 'ubuntu',
      });
      expect(latest).toEqual(expect.objectContaining({
        artifactId: 'artifact-new',
        artifactPath: currentPath,
      }));

      const read = await service.readArtifactById('artifact-new', {
        provider: 'codex',
      });
      expect(read?.artifact.target).toEqual({
        provider: 'codex',
        instanceId: 'ubuntu',
      });
      expect(read?.artifact.summary).toBe('Compatibility probe failed while checking the provider.');
      await expect(service.readArtifactById('artifact-new', {
        provider: 'claude',
      })).resolves.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
