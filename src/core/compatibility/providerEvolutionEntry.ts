import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GooseNativeSessionService } from '../../backends/cli/goose/GooseNativeSessionService.js';
import {
  getProviderDefaultInstanceId,
  resolveProviderInstance,
  type CliRuntimeConfig,
  type RuntimeMode,
  type RemoteProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type { Provider, ProviderName } from '../../backends/cli/providers/types.js';
import { buildAgentAdapter } from '../../backends/agent/adapters/registry.js';
import type { AgentAdapter } from '../../backends/agent/types.js';
import { observeNormalized } from './providerEvolution.js';
import { resolveProviderTarget, type ProviderTargetDescriptor } from '../providerCatalog.js';
import { ClaudeProvider } from '../../backends/cli/providers/claude.js';
import { CodexProvider } from '../../backends/cli/providers/codex.js';
import { CopilotProvider } from '../../backends/cli/providers/copilot.js';
import { GeminiProvider } from '../../backends/cli/providers/gemini.js';
import { GooseProvider } from '../../backends/cli/providers/goose.js';
import { PiProvider } from '../../backends/cli/providers/pi.js';
import { WorkerProcess } from '../../backends/cli/pool/WorkerProcess.js';
import {
  getRuntimeResolvedPaths,
  loadConfig,
  type RuntimeConfig,
} from '../config.js';
import { ProviderCompatibilityService } from './ProviderCompatibilityService.js';
import type {
  ProviderEvolutionEvidenceObserver,
  ProviderEvolutionTransport,
} from './providerEvolution.js';
import {
  formatProviderEvolutionProbeEntrySummary,
  getProviderEvolutionProbeProfile,
  summarizeProviderEvolutionProbeArtifact,
  type ProviderEvolutionExternalReference,
  type ProviderEvolutionProbeArtifactQuery,
  type ProviderEvolutionReviewClassification,
  type ProviderEvolutionProbeReviewUpdate,
  type ProviderEvolutionProbeArtifactSummary,
  ProviderEvolutionProbeService,
  type ProviderEvolutionProbeProfile,
  type ProviderEvolutionProbeStoredArtifact,
} from './providerEvolutionProbe.js';
import {
  parseRuntimeCliOptions,
  type RuntimeCliOptions,
} from '../../startup.js';

const SUPPORTED_CLI_PROBE_PROVIDERS = new Set<ProviderName>([
  'codex',
  'copilot',
  'pi',
  'goose',
  'gemini',
  'claude',
]);

export interface ProviderEvolutionEntryContext {
  config: RuntimeConfig;
  compatibility: ProviderCompatibilityService;
  probeService: ProviderEvolutionProbeService;
}

interface AgentProbeTargetDescriptor extends ProviderTargetDescriptor {
  backend: 'agent';
  remoteInstance: RemoteProviderInstanceConfig;
}

export async function generateProviderEvolutionProbeArtifact(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderEvolutionProbeStoredArtifact> {
  const context = resolveProviderEvolutionEntryContext(env);
  const providerName = parseProbeProviderName(cliOptions.probeProvider);
  const target = resolveProviderTarget(
    context.config,
    providerName,
    cliOptions.probeInstance,
  );
  const profile = getProviderEvolutionProbeProfile(cliOptions.probeProfile);

  if (target.backend === 'cli') {
    if (!SUPPORTED_CLI_PROBE_PROVIDERS.has(providerName as ProviderName)) {
      throw new Error(
        `CLI provider evolution probes currently support: ${Array.from(SUPPORTED_CLI_PROBE_PROVIDERS).join(', ')}`,
      );
    }

    const instance = resolveProviderInstance(
      context.config,
      providerName as ProviderName,
      cliOptions.probeInstance || getProviderDefaultInstanceId(context.config, providerName as ProviderName),
    );
    const assessment = await context.compatibility.assessCliTarget({
      providerName,
      backend: 'cli',
      instanceId: instance.id,
      defaultTarget: instance.id === getProviderDefaultInstanceId(context.config, providerName as ProviderName),
      cliInstance: instance,
    } satisfies ProviderTargetDescriptor, {
      force: true,
      purpose: 'diagnostics',
      probeMode: 'light',
    });

    return context.probeService.run({
      target: {
        provider: providerName,
        instance: instance.id,
        parserId: assessment.profile.parserId,
        probeProfile: profile.id,
        transport: 'cli',
        runtimeMode: assessment.fingerprint.runtime.mode,
        version: assessment.fingerprint.version.normalized || assessment.fingerprint.version.raw,
      },
      reviewContext: {
        references: resolveProbeReferences(cliOptions),
      },
      profile,
      run: ({ profile: selectedProfile, observer }) => runCliProbeProfile({
        config: context.config,
        providerName: providerName as ProviderName,
        instanceId: instance.id,
        model: cliOptions.probeModel,
        profile: selectedProfile,
        observer,
        compatibilityProfile: assessment.profile,
      }),
    });
  }

  if (isAgentProbeTarget(target)) {
    const adapter = buildAgentAdapter(target.remoteInstance, {
      env,
    });
    const parserId = resolveAgentProbeParserId(adapter, target.remoteInstance);
    return context.probeService.run({
      target: {
        provider: providerName,
        instance: `${target.backend}/${target.remoteInstance.id}`,
        parserId,
        probeProfile: profile.id,
        transport: 'agent',
      },
      reviewContext: {
        references: resolveProbeReferences(cliOptions),
      },
      profile,
      run: ({ profile: selectedProfile, observer }) => runAgentProbeProfile({
        adapter,
        target,
        model: cliOptions.probeModel,
        profile: selectedProfile,
        observer,
      }),
    });
  }

  throw new Error(
    `Provider evolution probes currently support CLI and agent targets only; `
    + `${providerName}/${cliOptions.probeInstance || 'default'} resolved to '${target.backend}'.`,
  );
}

export async function listProviderEvolutionProbeArtifacts(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderEvolutionProbeArtifactSummary[]> {
  const context = resolveProviderEvolutionEntryContext(env);
  return context.probeService.listArtifacts(resolveProbeArtifactQuery(cliOptions));
}

export async function readProviderEvolutionProbeArtifact(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderEvolutionProbeStoredArtifact> {
  const artifactId = cliOptions.readProviderEvolutionArtifact?.trim();
  if (!artifactId) {
    throw new Error('Missing --read-provider-evolution-artifact value');
  }

  const context = resolveProviderEvolutionEntryContext(env);
  const artifact = await context.probeService.readArtifactById(
    artifactId,
    resolveProbeArtifactQuery(cliOptions),
  );
  if (!artifact) {
    throw new Error(`Provider-evolution artifact '${artifactId}' was not found.`);
  }
  return artifact;
}

export async function reviewProviderEvolutionProbeArtifact(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderEvolutionProbeStoredArtifact> {
  const artifactId = cliOptions.reviewProviderEvolutionArtifact?.trim();
  if (!artifactId) {
    throw new Error('Missing --review-provider-evolution-artifact value');
  }

  const update = resolveProbeReviewUpdate(cliOptions);
  const context = resolveProviderEvolutionEntryContext(env);
  const artifact = await context.probeService.updateArtifactReviewById(
    artifactId,
    update,
    resolveProbeArtifactIdentityQuery(cliOptions),
  );
  if (!artifact) {
    throw new Error(`Provider-evolution artifact '${artifactId}' was not found.`);
  }
  return artifact;
}

export function resolveProviderEvolutionEntryContext(
  env: NodeJS.ProcessEnv = process.env,
): ProviderEvolutionEntryContext {
  const config = loadConfig(env);
  const compatibility = new ProviderCompatibilityService(config);
  const paths = getRuntimeResolvedPaths(config);
  const probeService = new ProviderEvolutionProbeService({
    rootDir: join(paths.compatibilityEvidenceDir, 'provider-evolution'),
  });

  return {
    config,
    compatibility,
    probeService,
  };
}

export function formatProviderEvolutionProbeSummary(
  result: ProviderEvolutionProbeStoredArtifact,
): string {
  return formatProviderEvolutionProbeEntrySummary(result);
}

export function formatProviderEvolutionProbeArtifactListSummary(
  artifacts: ProviderEvolutionProbeArtifactSummary[],
  cliOptions: RuntimeCliOptions,
): string {
  const scope = describeProbeArtifactScope(cliOptions);
  if (artifacts.length === 0) {
    return `No provider-evolution artifacts matched ${scope}.\n`;
  }

  const lines = [
    `Listed ${artifacts.length} provider-evolution artifact(s) for ${scope}.`,
    ...artifacts.map((artifact) => formatProbeArtifactSummaryLine(artifact)),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatProviderEvolutionProbeArtifactReadSummary(
  artifact: ProviderEvolutionProbeStoredArtifact,
): string {
  const summary = summarizeProviderEvolutionProbeArtifact(artifact);
  const lines = [
    `Loaded provider-evolution artifact ${summary.artifactId}: ${summary.review.summary}`,
    ...summary.review.highlights.map((highlight) => `- ${highlight}`),
    ...(summary.reviewContext?.references.length
      ? [`- External references: ${summary.reviewContext.references
          .map((reference) => `${reference.kind}=${reference.url}`)
          .join(', ')}`]
      : []),
    `Artifact: ${artifact.artifactPath}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function formatProviderEvolutionProbeArtifactReviewSummary(
  artifact: ProviderEvolutionProbeStoredArtifact,
): string {
  const summary = summarizeProviderEvolutionProbeArtifact(artifact);
  const lines = [
    `Updated provider-evolution artifact ${summary.artifactId}: ${summary.review.summary}`,
    ...summary.review.highlights.map((highlight) => `- ${highlight}`),
    ...(summary.reviewContext?.references.length
      ? [`- External references: ${summary.reviewContext.references
          .map((reference) => `${reference.kind}=${reference.url}`)
          .join(', ')}`]
      : []),
    `Artifact: ${artifact.artifactPath}`,
  ];
  return `${lines.join('\n')}\n`;
}

interface RunCliProbeProfileOptions {
  config: CliRuntimeConfig;
  providerName: ProviderName;
  instanceId: string;
  model?: string;
  profile: ProviderEvolutionProbeProfile;
  observer: ProviderEvolutionEvidenceObserver;
  compatibilityProfile: {
    id: string;
    label: string;
    protocolFamily: string;
    parserId: string;
    spawnBaseArgs?: string[];
    confidence: 'exact' | 'fallback' | 'weak';
  };
}

async function runCliProbeProfile(
  options: RunCliProbeProfileOptions,
): Promise<{
  status: 'completed' | 'failed';
  turnsCompleted: number;
  emittedEventCount: number;
  error?: string;
}> {
  const instance = resolveProviderInstance(options.config, options.providerName, options.instanceId);
  const provider = createProbeProvider(instance, options.providerName, options.compatibilityProfile, options.observer);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'cats-runtime-provider-evolution-'));
  const worker = new WorkerProcess(
    provider,
    {
      cwd: workspaceRoot,
      permissionMode: 'skip',
      workspaceMode: 'shared',
      ...(options.model ? { model: options.model } : {}),
    },
    instance.commandConfig,
    {
      retries: 1,
      timeoutMs: options.config.spawnTimeoutMs,
    },
  );

  let turnsCompleted = 0;
  let emittedEventCount = 0;

  try {
    await writeFile(
      join(workspaceRoot, 'probe-note.txt'),
      [
        'This file exists for provider-evolution manual probes.',
        'Tool-capable providers may inspect it during probe execution.',
      ].join('\n'),
      'utf8',
    );

    if (!provider.ephemeral) {
      worker.start();
    }

    for (const turn of options.profile.turns) {
      for await (const _event of worker.streamMessage({
        message: turn.prompt,
      })) {
        emittedEventCount += 1;
      }
      turnsCompleted += 1;
    }

    return {
      status: 'completed',
      turnsCompleted,
      emittedEventCount,
    };
  } catch (error) {
    return {
      status: 'failed',
      turnsCompleted,
      emittedEventCount,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    worker.kill();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

interface RunAgentProbeProfileOptions {
  adapter: AgentAdapter;
  target: AgentProbeTargetDescriptor;
  model?: string;
  profile: ProviderEvolutionProbeProfile;
  observer: ProviderEvolutionEvidenceObserver;
}

async function runAgentProbeProfile(
  options: RunAgentProbeProfileOptions,
): Promise<{
  status: 'completed' | 'failed';
  turnsCompleted: number;
  emittedEventCount: number;
  error?: string;
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'cats-runtime-provider-evolution-agent-'));
  const sessionId = `provider-evolution-${randomUUID()}`;
  const sessionKey = `provider-evolution-${randomUUID()}`;
  let providerSessionId: string | undefined;
  let turnsCompleted = 0;
  let emittedEventCount = 0;

  try {
    await writeFile(
      join(workspaceRoot, 'probe-note.txt'),
      [
        'This file exists for provider-evolution manual probes.',
        'Agent-backed providers may or may not expose runtime-local workspace access.',
      ].join('\n'),
      'utf8',
    );

    for (const turn of options.profile.turns) {
      for await (const event of options.adapter.invoke({
        sessionId,
        sessionKey,
        providerName: options.target.providerName,
        instance: options.target.remoteInstance,
        model: options.model || options.target.remoteInstance.model,
        providerSessionId,
        signal: new AbortController().signal,
        evolutionObserver: options.observer,
        turn: {
          message: turn.prompt,
          outputDir: workspaceRoot,
        },
      })) {
        emittedEventCount += 1;
        providerSessionId = event.providerSessionId || providerSessionId;
        observeNormalized(options.observer, {
          rawEventType: event.type,
          details: {
            adapter: options.adapter.kind,
            backend: options.target.backend,
          },
          rawSample: event.raw,
        }, event);
      }
      turnsCompleted += 1;
    }

    return {
      status: 'completed',
      turnsCompleted,
      emittedEventCount,
    };
  } catch (error) {
    return {
      status: 'failed',
      turnsCompleted,
      emittedEventCount,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function createProbeProvider(
  instance: ReturnType<typeof resolveProviderInstance>,
  providerName: ProviderName,
  compatibilityProfile: RunCliProbeProfileOptions['compatibilityProfile'],
  observer: ProviderEvolutionEvidenceObserver,
): Provider {
  switch (providerName) {
    case 'claude':
      return new ClaudeProvider(compatibilityProfile, observer);
    case 'codex':
      return new CodexProvider(compatibilityProfile, observer);
    case 'gemini':
      return new GeminiProvider(compatibilityProfile, observer);
    case 'copilot':
      return new CopilotProvider(compatibilityProfile, observer);
    case 'pi':
      return new PiProvider({
        instructionsFile: instance.piInstructionsFile,
        evolutionObserver: observer,
      });
    case 'goose':
      return new GooseProvider(
        new GooseNativeSessionService({ command: instance.commandConfig.path }),
        observer,
      );
    default:
      throw new Error(`Unsupported provider evolution probe target '${providerName}'`);
  }
}

function parseProbeProviderName(value: string | undefined): string {
  if (!value) {
    throw new Error('Missing --probe-provider value');
  }

  return value.trim().toLowerCase();
}

export function parseProviderEvolutionProbeCliOptions(argv: string[]): RuntimeCliOptions {
  return parseRuntimeCliOptions(argv);
}

function resolveProbeArtifactQuery(
  cliOptions: RuntimeCliOptions,
): ProviderEvolutionProbeArtifactQuery {
  const query = resolveProbeArtifactIdentityQuery(cliOptions);
  const limit = parseOptionalProbeLimit(cliOptions.probeLimit);
  const reviewClassifications = parseOptionalProbeClassifications(cliOptions.probeClassifications);
  return {
    ...query,
    ...(reviewClassifications ? { reviewClassifications } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

function resolveProbeArtifactIdentityQuery(
  cliOptions: RuntimeCliOptions,
): ProviderEvolutionProbeArtifactQuery {
  const provider = parseOptionalProbeProviderName(cliOptions.probeProvider);
  const transport = parseOptionalProbeTransport(cliOptions.probeTransport);
  const runtimeMode = parseOptionalProbeRuntimeMode(cliOptions.probeRuntime);
  return {
    ...(provider ? { provider } : {}),
    ...(cliOptions.probeInstance ? { instance: cliOptions.probeInstance.trim() } : {}),
    ...(cliOptions.probeParser ? { parserId: cliOptions.probeParser.trim() } : {}),
    ...(cliOptions.probeProfile ? { probeProfile: cliOptions.probeProfile.trim() } : {}),
    ...(transport ? { transport } : {}),
    ...(runtimeMode ? { runtimeMode } : {}),
  };
}

function resolveProbeReviewUpdate(
  cliOptions: RuntimeCliOptions,
): ProviderEvolutionProbeReviewUpdate {
  const classifications = parseOptionalProbeClassifications(cliOptions.probeClassifications);
  const summary = parseOptionalProbeReviewSummary(cliOptions.probeReviewSummary);
  const highlights = parseOptionalProbeHighlights(cliOptions.probeHighlights);
  const references = resolveProbeReferences(cliOptions);

  if (!classifications && !summary && !highlights && !references) {
    throw new Error(
      'Manual provider-evolution review updates require at least one of '
      + '--probe-classification, --probe-review-summary, --probe-highlight, or --probe-reference.',
    );
  }

  return {
    ...(classifications ? { classifications } : {}),
    ...(summary ? { summary } : {}),
    ...(highlights ? { highlights } : {}),
    ...(references ? { references } : {}),
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
  return value ? parseProbeProviderName(value) : undefined;
}

function parseOptionalProbeTransport(
  value: string | undefined,
): ProviderEvolutionTransport | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized !== 'cli'
    && normalized !== 'agent'
    && normalized !== 'api'
    && normalized !== 'unknown'
  ) {
    throw new Error(
      `Invalid --probe-transport value '${value}'. Valid values: cli, agent, api, unknown`,
    );
  }

  return normalized;
}

function parseOptionalProbeRuntimeMode(
  value: string | undefined,
): RuntimeMode | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'native':
    case 'wsl':
    case 'docker':
      return normalized;
    default:
      throw new Error(
        `Invalid --probe-runtime value '${value}'. Valid values: native, wsl, docker`,
      );
  }
}

function parseOptionalProbeClassifications(
  values: string[] | undefined,
): ProviderEvolutionReviewClassification[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const classifications = Array.from(new Set(values.map(parseProbeClassification)));
  return classifications.length > 0 ? classifications : undefined;
}

function parseOptionalProbeReviewSummary(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function parseOptionalProbeHighlights(
  values: string[] | undefined,
): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const highlights = Array.from(new Set(
    values
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));
  return highlights.length > 0 ? highlights : undefined;
}

function resolveProbeReferences(
  cliOptions: RuntimeCliOptions,
): ProviderEvolutionExternalReference[] | undefined {
  const references = (cliOptions.probeReferences || []).map(parseProbeReference);
  return references.length > 0 ? references : undefined;
}

function parseProbeReference(value: string): ProviderEvolutionExternalReference {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Invalid --probe-reference value');
  }

  const separatorIndex = trimmed.indexOf('=');
  const rawKind = separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : 'other';
  const rawUrl = separatorIndex > 0 ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
  const kind = normalizeProbeReferenceKind(rawKind);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid --probe-reference URL '${rawUrl}'. Expected an absolute http(s) URL.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid --probe-reference URL '${rawUrl}'. Expected an absolute http(s) URL.`,
    );
  }

  return {
    kind,
    url: url.toString(),
  };
}

function normalizeProbeReferenceKind(
  value: string,
): ProviderEvolutionExternalReference['kind'] {
  switch (value.trim().toLowerCase()) {
    case 'release_notes':
    case 'release-notes':
      return 'release_notes';
    case 'changelog':
      return 'changelog';
    case 'issue':
      return 'issue';
    case 'announcement':
      return 'announcement';
    case 'other':
      return 'other';
    default:
      throw new Error(
        `Invalid --probe-reference kind '${value}'. Valid kinds: release_notes, changelog, issue, announcement, other`,
      );
  }
}

function parseProbeClassification(
  value: string,
): ProviderEvolutionReviewClassification {
  switch (value.trim().toLowerCase()) {
    case 'baseline':
    case 'stable':
    case 'upgrade':
    case 'regression':
      return value.trim().toLowerCase() as ProviderEvolutionReviewClassification;
    case 'schema_change':
    case 'schema-change':
      return 'schema_change';
    case 'semantic_drift_suspected':
    case 'semantic-drift-suspected':
      return 'semantic_drift_suspected';
    default:
      throw new Error(
        `Invalid --probe-classification value '${value}'. Valid values: baseline, stable, upgrade, regression, schema_change, semantic_drift_suspected`,
      );
  }
}

function resolveAgentProbeParserId(
  adapter: AgentAdapter,
  instance: RemoteProviderInstanceConfig,
): string {
  const inspection = adapter.inspect?.(instance);
  return inspection?.transport.protocol || adapter.kind;
}

function isAgentProbeTarget(target: ProviderTargetDescriptor): target is AgentProbeTargetDescriptor {
  return target.backend === 'agent' && Boolean(target.remoteInstance);
}

function describeProbeArtifactScope(cliOptions: RuntimeCliOptions): string {
  const parts = [
    cliOptions.probeProvider?.trim(),
    cliOptions.probeInstance?.trim(),
    cliOptions.probeProfile?.trim(),
    cliOptions.probeParser?.trim() ? `parser=${cliOptions.probeParser.trim()}` : undefined,
    cliOptions.probeRuntime?.trim() ? `runtime=${cliOptions.probeRuntime.trim()}` : undefined,
    cliOptions.probeTransport?.trim() ? `transport=${cliOptions.probeTransport.trim()}` : undefined,
    cliOptions.probeClassifications?.length
      ? `classification=${cliOptions.probeClassifications.join(',')}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join('/') : 'all retained probes';
}

function formatProbeArtifactSummaryLine(
  artifact: ProviderEvolutionProbeArtifactSummary,
): string {
  const classifications = artifact.review.classifications.join(', ');
  return [
    '-',
    artifact.capturedAt,
    `${artifact.provider}/${artifact.instance}`,
    artifact.probeProfile,
    `[${classifications}]`,
    artifact.review.summary,
  ].join(' ');
}
