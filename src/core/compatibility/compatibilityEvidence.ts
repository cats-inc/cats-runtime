import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeMode } from '../../backends/cli/config.js';
import type {
  CompatibilityAssessment,
  CompatibilityClassification,
  CompatibilityProfileSelection,
} from './types.js';

interface CompatibilityEvidenceArtifactRecord extends Pick<
  CompatibilityAssessment,
  'summary' | 'fingerprint' | 'warnings' | 'checks' | 'setup' | 'probes'
> {
  schemaVersion?: number;
  id: string;
  capturedAt: string;
  classification: CompatibilityClassification;
  target: {
    provider: string;
    instanceId: string;
  };
  profile: CompatibilityProfileSelection;
  command?: Record<string, unknown>;
}

export interface CompatibilityEvidenceArtifactSummary {
  artifactId: string;
  provider: string;
  instance: string;
  classification: CompatibilityClassification;
  summary: string;
  capturedAt: string;
  parserId: string;
  profileId: string;
  runtimeMode?: RuntimeMode;
  relativePath: string;
  artifactPath: string;
}

export interface CompatibilityEvidenceStoredArtifact {
  artifact: CompatibilityEvidenceArtifactRecord;
  relativePath: string;
  artifactPath: string;
}

export interface CompatibilityEvidenceArtifactQuery {
  provider?: string;
  instance?: string;
  classifications?: CompatibilityClassification[];
  parserId?: string;
  profileId?: string;
  runtimeMode?: RuntimeMode;
  limit?: number;
}

export interface CompatibilityEvidenceServiceOptions {
  rootDir: string;
}

export class CompatibilityEvidenceService {
  constructor(private readonly options: CompatibilityEvidenceServiceOptions) {}

  async readArtifactById(
    artifactId: string,
    query: CompatibilityEvidenceArtifactQuery = {},
  ): Promise<CompatibilityEvidenceStoredArtifact | null> {
    const relativePaths = await this.listArtifactRelativePaths(query.provider);
    for (const relativePath of relativePaths) {
      if (!relativePath.endsWith(`${artifactId}.json`)) {
        continue;
      }
      const stored = await this.readStoredArtifact(relativePath);
      if (stored && matchesCompatibilityEvidenceQuery(stored.artifact, query)) {
        return stored;
      }
    }

    return null;
  }

  async readLatestArtifact(
    query: CompatibilityEvidenceArtifactQuery = {},
  ): Promise<CompatibilityEvidenceArtifactSummary | null> {
    const summaries = await this.listArtifacts({
      ...query,
      limit: 1,
    });
    return summaries[0] ?? null;
  }

  async listArtifacts(
    query: CompatibilityEvidenceArtifactQuery = {},
  ): Promise<CompatibilityEvidenceArtifactSummary[]> {
    const relativePaths = await this.listArtifactRelativePaths(query.provider);
    const artifacts: CompatibilityEvidenceArtifactSummary[] = [];

    for (const relativePath of relativePaths) {
      const stored = await this.readStoredArtifact(relativePath);
      if (!stored || !matchesCompatibilityEvidenceQuery(stored.artifact, query)) {
        continue;
      }
      artifacts.push(summarizeCompatibilityEvidenceArtifact(stored));
    }

    artifacts.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
    const limit = Math.max(1, Math.trunc(query.limit ?? artifacts.length));
    return artifacts.slice(0, limit);
  }

  private async listArtifactRelativePaths(provider?: string): Promise<string[]> {
    const providerSegments = provider
      ? [sanitizePathSegment(provider)]
      : await this.listProviderDirectories();
    const relativePaths: string[] = [];

    for (const providerSegment of providerSegments) {
      const providerDir = join(this.options.rootDir, providerSegment);
      let names: string[];
      try {
        names = await readdir(providerDir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.endsWith('.json')) {
          relativePaths.push(join(providerSegment, name));
        }
      }
    }

    return relativePaths;
  }

  private async listProviderDirectories(): Promise<string[]> {
    try {
      const entries = await readdir(this.options.rootDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async readStoredArtifact(
    relativePath: string,
  ): Promise<CompatibilityEvidenceStoredArtifact | null> {
    const artifactPath = join(this.options.rootDir, relativePath);
    try {
      const parsed = JSON.parse(await readFile(artifactPath, 'utf8')) as CompatibilityEvidenceArtifactRecord;
      if (
        !parsed
        || typeof parsed !== 'object'
        || typeof parsed.id !== 'string'
        || typeof parsed.capturedAt !== 'string'
        || typeof parsed.summary !== 'string'
        || typeof parsed.classification !== 'string'
        || !parsed.target
        || typeof parsed.target.provider !== 'string'
        || typeof parsed.target.instanceId !== 'string'
        || !parsed.profile
        || typeof parsed.profile.id !== 'string'
        || typeof parsed.profile.parserId !== 'string'
      ) {
        return null;
      }

      return {
        artifact: parsed,
        relativePath,
        artifactPath,
      };
    } catch {
      return null;
    }
  }
}

export function summarizeCompatibilityEvidenceArtifact(
  stored: CompatibilityEvidenceStoredArtifact,
): CompatibilityEvidenceArtifactSummary {
  return {
    artifactId: stored.artifact.id,
    provider: stored.artifact.target.provider,
    instance: stored.artifact.target.instanceId,
    classification: stored.artifact.classification,
    summary: stored.artifact.summary,
    capturedAt: stored.artifact.capturedAt,
    parserId: stored.artifact.profile.parserId,
    profileId: stored.artifact.profile.id,
    runtimeMode: resolveRuntimeMode(stored.artifact),
    relativePath: stored.relativePath.replace(/\\/g, '/'),
    artifactPath: stored.artifactPath,
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'default';
}

function matchesCompatibilityEvidenceQuery(
  artifact: CompatibilityEvidenceArtifactRecord,
  query: CompatibilityEvidenceArtifactQuery,
): boolean {
  if (query.provider && artifact.target.provider !== query.provider) {
    return false;
  }
  if (query.instance && artifact.target.instanceId !== query.instance) {
    return false;
  }
  if (
    query.classifications
    && query.classifications.length > 0
    && !query.classifications.includes(artifact.classification)
  ) {
    return false;
  }
  if (query.parserId && artifact.profile.parserId !== query.parserId) {
    return false;
  }
  if (query.profileId && artifact.profile.id !== query.profileId) {
    return false;
  }
  if (query.runtimeMode && resolveRuntimeMode(artifact) !== query.runtimeMode) {
    return false;
  }
  return true;
}

function resolveRuntimeMode(
  artifact: CompatibilityEvidenceArtifactRecord,
): RuntimeMode | undefined {
  const mode = artifact.fingerprint?.runtime?.mode;
  return typeof mode === 'string' ? mode as RuntimeMode : undefined;
}
