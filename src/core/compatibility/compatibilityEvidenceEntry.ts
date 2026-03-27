import { join } from 'node:path';
import { getRuntimeResolvedPaths, loadConfig, type RuntimeConfig } from '../config.js';
import type { RuntimeMode } from '../../backends/cli/config.js';
import {
  CompatibilityEvidenceService,
  summarizeCompatibilityEvidenceArtifact,
  type CompatibilityEvidenceArtifactQuery,
  type CompatibilityEvidenceArtifactSummary,
  type CompatibilityEvidenceStoredArtifact,
} from './compatibilityEvidence.js';
import type { CompatibilityClassification } from './types.js';
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
  const classifications = parseOptionalCompatibilityClassifications(cliOptions.probeClassifications);
  const runtimeMode = parseOptionalProbeRuntimeMode(cliOptions.probeRuntime);

  return {
    ...(provider ? { provider } : {}),
    ...(cliOptions.probeInstance ? { instance: cliOptions.probeInstance.trim() } : {}),
    ...(classifications ? { classifications } : {}),
    ...(cliOptions.probeParser?.trim() ? { parserId: cliOptions.probeParser.trim() } : {}),
    ...(runtimeMode ? { runtimeMode } : {}),
    ...(cliOptions.probeProfile?.trim() ? { profileId: cliOptions.probeProfile.trim() } : {}),
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

function parseOptionalProbeRuntimeMode(value: string | undefined): RuntimeMode | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  switch (trimmed) {
    case 'native':
    case 'wsl':
    case 'docker':
      return trimmed;
    default:
      throw new Error(
        `Invalid --probe-runtime value '${value}'. Valid values: native, wsl, docker`,
      );
  }
}

function parseOptionalCompatibilityClassifications(
  values: string[] | undefined,
): CompatibilityClassification[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const classifications = Array.from(new Set(values.map(parseCompatibilityClassification)));
  return classifications.length > 0 ? classifications : undefined;
}

function parseCompatibilityClassification(value: string): CompatibilityClassification {
  const trimmed = value.trim();
  switch (trimmed) {
    case 'ready':
    case 'degraded':
    case 'unsupported_version':
    case 'unrecognized_protocol':
    case 'probe_failed':
      return trimmed;
    default:
      throw new Error(
        `Invalid --probe-classification value '${value}'. Valid values: ready, degraded, unsupported_version, unrecognized_protocol, probe_failed`,
      );
  }
}

function describeCompatibilityEvidenceScope(cliOptions: RuntimeCliOptions): string {
  const parts = [
    cliOptions.probeProvider?.trim(),
    cliOptions.probeInstance?.trim(),
    cliOptions.probeParser?.trim() ? `parser=${cliOptions.probeParser.trim()}` : undefined,
    cliOptions.probeRuntime?.trim() ? `runtime=${cliOptions.probeRuntime.trim()}` : undefined,
    cliOptions.probeProfile?.trim() ? `profile=${cliOptions.probeProfile.trim()}` : undefined,
    cliOptions.probeClassifications?.length
      ? `classification=${cliOptions.probeClassifications.join(',')}`
      : undefined,
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
