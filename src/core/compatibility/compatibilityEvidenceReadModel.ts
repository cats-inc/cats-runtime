import { getRuntimeResolvedPaths } from '../config.js';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';
import {
  CompatibilityEvidenceService,
  type CompatibilityEvidenceArtifactSummary,
} from './compatibilityEvidence.js';

export type CompatibilityEvidenceLatestArtifactReadModel = Pick<
  CompatibilityEvidenceArtifactSummary,
  | 'artifactId'
  | 'classification'
  | 'summary'
  | 'capturedAt'
  | 'parserId'
  | 'profileId'
  | 'relativePath'
>;

export function createCompatibilityEvidenceService(
  config: Pick<CliRuntimeConfig, 'configPath' | 'dataDir' | 'sessionBaseDir'>,
): CompatibilityEvidenceService {
  return new CompatibilityEvidenceService({
    rootDir: getRuntimeResolvedPaths(config).compatibilityEvidenceDir,
  });
}

export function summarizeCompatibilityEvidenceArtifactForReadModel(
  artifact: CompatibilityEvidenceArtifactSummary,
): CompatibilityEvidenceLatestArtifactReadModel {
  return {
    artifactId: artifact.artifactId,
    classification: artifact.classification,
    summary: artifact.summary,
    capturedAt: artifact.capturedAt,
    parserId: artifact.parserId,
    profileId: artifact.profileId,
    relativePath: artifact.relativePath,
  };
}
