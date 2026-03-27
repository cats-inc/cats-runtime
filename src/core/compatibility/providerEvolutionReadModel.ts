import { join } from 'node:path';
import type { CliRuntimeConfig, BackendKind } from '../../backends/cli/config.js';
import { getRuntimeResolvedPaths } from '../config.js';
import {
  ProviderEvolutionProbeService,
  type ProviderEvolutionProbeArtifactSummary,
} from './providerEvolutionProbe.js';

export type ProviderEvolutionLatestArtifactReadModel = Pick<
  ProviderEvolutionProbeArtifactSummary,
  | 'artifactId'
  | 'capturedAt'
  | 'probeProfile'
  | 'transport'
  | 'version'
  | 'execution'
  | 'capabilitySnapshot'
  | 'compare'
  | 'review'
  | 'reviewContext'
  | 'relativePath'
>;

export function createProviderEvolutionProbeService(
  config: Pick<CliRuntimeConfig, 'configPath' | 'dataDir' | 'sessionBaseDir'>,
): ProviderEvolutionProbeService {
  return new ProviderEvolutionProbeService({
    rootDir: join(getRuntimeResolvedPaths(config).compatibilityEvidenceDir, 'provider-evolution'),
  });
}

export function resolveProviderEvolutionArtifactInstance(
  target: { backend: BackendKind; instanceId: string },
): string {
  return target.backend === 'cli'
    ? target.instanceId
    : `${target.backend}/${target.instanceId}`;
}

export function summarizeProviderEvolutionArtifactForReadModel(
  artifact: ProviderEvolutionProbeArtifactSummary,
): ProviderEvolutionLatestArtifactReadModel {
  return {
    artifactId: artifact.artifactId,
    capturedAt: artifact.capturedAt,
    probeProfile: artifact.probeProfile,
    transport: artifact.transport,
    version: artifact.version,
    execution: artifact.execution,
    capabilitySnapshot: artifact.capabilitySnapshot,
    compare: artifact.compare,
    review: artifact.review,
    reviewContext: artifact.reviewContext,
    relativePath: artifact.relativePath,
  };
}
