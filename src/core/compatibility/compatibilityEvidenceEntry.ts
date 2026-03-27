import { join } from 'node:path';
import { getRuntimeResolvedPaths, loadConfig, type RuntimeConfig } from '../config.js';
import {
  CompatibilityEvidenceService,
  summarizeCompatibilityEvidenceArtifact,
  type CompatibilityEvidenceArtifactQuery,
  type CompatibilityEvidenceArtifactSummary,
  type CompatibilityEvidenceStoredArtifact,
} from './compatibilityEvidence.js';
import type { RuntimeCliOptions } from '../../startup.js';

interface CompatibilityEvidenceEntryContext {
  config: RuntimeConfig;
  evidenceService: CompatibilityEvidenceService;
}

export async function listCompatibilityEvidenceArtifacts(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompatibilityEvidenceArtifactSummary[]> {
  const context = resolveCompatibilityEvidenceEntryContext(env);
  return context.evidenceService.listArtifacts(resolveCompatibilityEvidenceQuery(cliOptions));
}

export async function readCompatibilityEvidenceArtifact(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompatibilityEvidenceStoredArtifact> {
  const artifactId = cliOptions.readCompatibilityEvidence?.trim();
  if (!artifactId) {
    throw new Error('Missing --read-compatibility-evidence value');
  }

  const context = resolveCompatibilityEvidenceEntryContext(env);
  const artifact = await context.evidenceService.readArtifactById(
    artifactId,
    resolveCompatibilityEvidenceQuery(cliOptions),
  );
  if (!artifact) {
    throw new Error(`Compatibility evidence artifact '${artifactId}' was not found.`);
  }
  return artifact;
}

export function resolveCompatibilityEvidenceEntryContext(
  env: NodeJS.ProcessEnv = process.env,
): CompatibilityEvidenceEntryContext {
  const config = loadConfig(env);
  const paths = getRuntimeResolvedPaths(config);
  const evidenceService = new CompatibilityEvidenceService({
    rootDir: paths.compatibilityEvidenceDir,
  });

  return {
    config,
    evidenceService,
  };
}

export function formatCompatibilityEvidenceArtifactListSummary(
  artifacts: CompatibilityEvidenceArtifactSummary[],
  cliOptions: RuntimeCliOptions,
): string {
  const scope = describeCompatibilityEvidenceScope(cliOptions);
  if (artifacts.length === 0) {
    return `No compatibility evidence artifacts matched ${scope}.\n`;
  }

  const lines = [
    `Listed ${artifacts.length} compatibility evidence artifact(s) for ${scope}.`,
    ...artifacts.map((artifact) => formatCompatibilityEvidenceSummaryLine(artifact)),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatCompatibilityEvidenceArtifactReadSummary(
  artifact: CompatibilityEvidenceStoredArtifact,
): string {
  const summary = summarizeCompatibilityEvidenceArtifact(artifact);
  const lines = [
    `Loaded compatibility evidence artifact ${summary.artifactId}: ${summary.summary}`,
    `- Classification: ${summary.classification}`,
    `- Parser: ${summary.parserId}`,
    `Artifact: ${artifact.artifactPath}`,
  ];
  return `${lines.join('\n')}\n`;
}

function resolveCompatibilityEvidenceQuery(
  cliOptions: RuntimeCliOptions,
): CompatibilityEvidenceArtifactQuery {
  const provider = parseOptionalProbeProviderName(cliOptions.probeProvider);
  const limit = parseOptionalProbeLimit(cliOptions.probeLimit);

  return {
    ...(provider ? { provider } : {}),
    ...(cliOptions.probeInstance ? { instance: cliOptions.probeInstance.trim() } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

function parseOptionalProbeLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --probe-limit value '${value}'`);
  }
  return parsed;
}

function parseOptionalProbeProviderName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function describeCompatibilityEvidenceScope(cliOptions: RuntimeCliOptions): string {
  const parts = [
    cliOptions.probeProvider?.trim(),
    cliOptions.probeInstance?.trim(),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join('/') : 'all retained compatibility evidence';
}

function formatCompatibilityEvidenceSummaryLine(
  artifact: CompatibilityEvidenceArtifactSummary,
): string {
  return [
    '-',
    artifact.capturedAt,
    `${artifact.provider}/${artifact.instance}`,
    `[${artifact.classification}]`,
    artifact.summary,
  ].join(' ');
}
