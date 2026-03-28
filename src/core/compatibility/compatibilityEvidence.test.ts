import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    runtimeMode: 'native' | 'wsl' | 'docker';
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
      runtime: { mode: overrides.runtimeMode || 'native' },
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

  it('filters retained compatibility evidence by classification', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    const service = new CompatibilityEvidenceService({ rootDir: root });

    try {
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-degraded', {
        classification: 'degraded',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-failed', {
        classification: 'probe_failed',
      });

      const listed = await service.listArtifacts({
        provider: 'codex',
        classifications: ['probe_failed'],
      });
      expect(listed.map((artifact) => artifact.artifactId)).toEqual(['artifact-failed']);

      const read = await service.readArtifactById('artifact-failed', {
        provider: 'codex',
        classifications: ['probe_failed'],
      });
      expect(read?.artifact.classification).toBe('probe_failed');

      await expect(service.readArtifactById('artifact-degraded', {
        provider: 'codex',
        classifications: ['probe_failed'],
      })).resolves.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('filters retained compatibility evidence by parser and profile ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    const service = new CompatibilityEvidenceService({ rootDir: root });

    try {
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-cli', {
        parserId: 'codex-json-rpc',
        profileId: 'codex-cli-best-fit',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-fallback', {
        parserId: 'codex-stream-json',
        profileId: 'codex-cli-fallback',
      });

      const listed = await service.listArtifacts({
        provider: 'codex',
        parserId: 'codex-stream-json',
        profileId: 'codex-cli-fallback',
      });
      expect(listed.map((artifact) => artifact.artifactId)).toEqual(['artifact-fallback']);

      const read = await service.readArtifactById('artifact-fallback', {
        provider: 'codex',
        parserId: 'codex-stream-json',
        profileId: 'codex-cli-fallback',
      });
      expect(read?.artifact.profile).toMatchObject({
        parserId: 'codex-stream-json',
        id: 'codex-cli-fallback',
      });

      await expect(service.readArtifactById('artifact-cli', {
        provider: 'codex',
        parserId: 'codex-stream-json',
        profileId: 'codex-cli-fallback',
      })).resolves.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('filters retained compatibility evidence by runtime mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    const service = new CompatibilityEvidenceService({ rootDir: root });

    try {
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-native', {
        runtimeMode: 'native',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', 'artifact-docker', {
        runtimeMode: 'docker',
      });

      const listed = await service.listArtifacts({
        provider: 'codex',
        runtimeMode: 'docker',
      });
      expect(listed).toEqual([
        expect.objectContaining({
          artifactId: 'artifact-docker',
          runtimeMode: 'docker',
        }),
      ]);

      const read = await service.readArtifactById('artifact-docker', {
        provider: 'codex',
        runtimeMode: 'docker',
      });
      expect(read?.artifact.fingerprint.runtime).toEqual({
        mode: 'docker',
      });

      await expect(service.readArtifactById('artifact-native', {
        provider: 'codex',
        runtimeMode: 'docker',
      })).resolves.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves the latest matching provider artifact from timestamp-ordered filenames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    const service = new CompatibilityEvidenceService({ rootDir: root });

    try {
      writeCompatibilityEvidenceArtifact(root, 'codex', '2026-03-27T00-00-00-000Z-old-default', {
        capturedAt: '2026-03-27T00:00:00.000Z',
        instanceId: 'default',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', '2026-03-27T00-00-01-000Z-newer-mirror', {
        capturedAt: '2026-03-27T00:00:01.000Z',
        instanceId: 'mirror',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', '2026-03-27T00-00-02-000Z-newest-default', {
        capturedAt: '2026-03-27T00:00:02.000Z',
        instanceId: 'default',
      });

      await expect(service.readLatestArtifact({
        provider: 'codex',
        instance: 'default',
      })).resolves.toEqual(expect.objectContaining({
        artifactId: '2026-03-27T00-00-02-000Z-newest-default',
        instance: 'default',
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prunes older retained compatibility evidence per provider', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-compat-evidence-'));
    const service = new CompatibilityEvidenceService({
      rootDir: root,
      retentionLimit: 2,
    });

    try {
      writeCompatibilityEvidenceArtifact(root, 'codex', '2026-03-27T00-00-00-000Z-old', {
        capturedAt: '2026-03-27T00:00:00.000Z',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', '2026-03-27T00-00-01-000Z-current', {
        capturedAt: '2026-03-27T00:00:01.000Z',
      });
      writeCompatibilityEvidenceArtifact(root, 'codex', '2026-03-27T00-00-02-000Z-newest', {
        capturedAt: '2026-03-27T00:00:02.000Z',
      });

      await expect(service.pruneRetainedArtifacts('codex')).resolves.toBe(1);
      expect(readdirSync(join(root, 'codex'))
        .filter((name) => name.endsWith('.json'))
        .sort())
        .toEqual([
          '2026-03-27T00-00-01-000Z-current.json',
          '2026-03-27T00-00-02-000Z-newest.json',
        ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
