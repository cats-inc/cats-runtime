import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GooseNativeSessionService } from '../../backends/cli/goose/GooseNativeSessionService.js';
import {
  getProviderDefaultInstanceId,
  resolveProviderInstance,
  type CliRuntimeConfig,
} from '../../backends/cli/config.js';
import type { Provider, ProviderName } from '../../backends/cli/providers/types.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
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
import type { ProviderEvolutionEvidenceObserver } from './providerEvolution.js';
import {
  formatProviderEvolutionProbeEntrySummary,
  getProviderEvolutionProbeProfile,
  summarizeProviderEvolutionProbeArtifact,
  type ProviderEvolutionProbeArtifactSummary,
  ProviderEvolutionProbeService,
  type ProviderEvolutionProbeProfile,
  type ProviderEvolutionProbeStoredArtifact,
} from './providerEvolutionProbe.js';
import {
  parseRuntimeCliOptions,
  type RuntimeCliOptions,
} from '../../startup.js';

const SUPPORTED_PROBE_PROVIDERS = new Set<ProviderName>([
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

export async function generateProviderEvolutionProbeArtifact(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderEvolutionProbeStoredArtifact> {
  const providerName = parseProbeProviderName(cliOptions.probeProvider);
  if (!SUPPORTED_PROBE_PROVIDERS.has(providerName)) {
    throw new Error(
      `Provider evolution probes currently support: ${Array.from(SUPPORTED_PROBE_PROVIDERS).join(', ')}`,
    );
  }

  const context = resolveProviderEvolutionEntryContext(env);
  const instance = resolveProviderInstance(
    context.config,
    providerName,
    cliOptions.probeInstance || getProviderDefaultInstanceId(context.config, providerName),
  );
  const profile = getProviderEvolutionProbeProfile(cliOptions.probeProfile);
  const assessment = await context.compatibility.assessCliTarget({
    providerName,
    backend: 'cli',
    instanceId: instance.id,
    defaultTarget: instance.id === getProviderDefaultInstanceId(context.config, providerName),
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
      version: assessment.fingerprint.version.normalized || assessment.fingerprint.version.raw,
    },
    profile,
    run: ({ profile: selectedProfile, observer }) => runCliProbeProfile({
      config: context.config,
      providerName,
      instanceId: instance.id,
      model: cliOptions.probeModel,
      profile: selectedProfile,
      observer,
      compatibilityProfile: assessment.profile,
    }),
  });
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

  const providerName = parseOptionalProbeProviderName(cliOptions.probeProvider);
  const context = resolveProviderEvolutionEntryContext(env);
  const artifact = await context.probeService.readArtifactById(artifactId, providerName);
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

function parseProbeProviderName(value: string | undefined): ProviderName {
  if (!value) {
    throw new Error('Missing --probe-provider value');
  }

  const normalized = value.trim().toLowerCase();
  const provider = normalized as ProviderName;
  if (!SUPPORTED_PROBE_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported --probe-provider '${value}'`);
  }
  return provider;
}

export function parseProviderEvolutionProbeCliOptions(argv: string[]): RuntimeCliOptions {
  return parseRuntimeCliOptions(argv);
}

function resolveProbeArtifactQuery(
  cliOptions: RuntimeCliOptions,
): {
  provider?: string;
  instance?: string;
  probeProfile?: string;
  limit?: number;
} {
  const provider = parseOptionalProbeProviderName(cliOptions.probeProvider);
  const limit = parseOptionalProbeLimit(cliOptions.probeLimit);
  return {
    ...(provider ? { provider } : {}),
    ...(cliOptions.probeInstance ? { instance: cliOptions.probeInstance.trim() } : {}),
    ...(cliOptions.probeProfile ? { probeProfile: cliOptions.probeProfile.trim() } : {}),
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

function parseOptionalProbeProviderName(value: string | undefined): ProviderName | undefined {
  return value ? parseProbeProviderName(value) : undefined;
}

function describeProbeArtifactScope(cliOptions: RuntimeCliOptions): string {
  const parts = [
    cliOptions.probeProvider?.trim(),
    cliOptions.probeInstance?.trim(),
    cliOptions.probeProfile?.trim(),
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
