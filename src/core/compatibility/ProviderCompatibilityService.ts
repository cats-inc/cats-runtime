import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  CliRuntimeConfig,
  ProviderCommandConfig,
  ProviderInstanceConfig,
} from '../../backends/cli/config.js';
import { buildProcessSpawnConfig } from '../../backends/cli/runtime/runtime.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import {
  getDefaultCompatibilityProfile,
  getProviderCompatibilityKnowledge,
} from './knowledge.js';
import type {
  CompatibilityAssessment,
  CompatibilityAssessmentOptions,
  CompatibilityCheck,
  CompatibilityClassification,
  CompatibilityEvidenceArtifact,
  CompatibilityProbeRecord,
  CompatibilityProfileSelection,
  CompatibilitySummaryView,
} from './types.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_SAMPLE_LIMIT = 2_048;
const EVIDENCE_SCHEMA_VERSION = 1;

interface ProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

interface CacheEntry {
  assessment: CompatibilityAssessment;
  cachedAtMs: number;
}

interface CompatibilityRunner {
  run(
    providerName: ProviderName,
    commandConfig: ProviderCommandConfig,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<ProbeResult>;
}

interface ProviderCompatibilityServiceOptions {
  cacheTtlMs?: number;
  probeTimeoutMs?: number;
  evidenceDir?: string;
  runner?: CompatibilityRunner;
  now?: () => number;
}

export class ProviderCompatibilityService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly probeTimeoutMs: number;
  private readonly evidenceDir: string;
  private readonly runner: CompatibilityRunner;
  private readonly now: () => number;

  constructor(
    private readonly config: Pick<CliRuntimeConfig, 'dataDir' | 'sessionBaseDir'>,
    options: ProviderCompatibilityServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.evidenceDir = options.evidenceDir
      || join(config.dataDir || join(config.sessionBaseDir, '..', 'data'), 'compatibility');
    this.runner = options.runner || { run: runCompatibilityProbe };
    this.now = options.now || (() => Date.now());
  }

  getEvidenceDir(): string {
    return this.evidenceDir;
  }

  getCachedAssessment(
    providerName: ProviderName,
    instanceId: string,
  ): CompatibilityAssessment | undefined {
    return this.cache.get(createCacheKey(providerName, instanceId))?.assessment;
  }

  getCachedSummary(
    providerName: ProviderName,
    instanceId: string,
  ): CompatibilitySummaryView | undefined {
    const assessment = this.getCachedAssessment(providerName, instanceId);
    return assessment ? toCompatibilitySummaryView(assessment) : undefined;
  }

  async assessCliTarget(
    target: ProviderTargetDescriptor,
    options: CompatibilityAssessmentOptions = {},
  ): Promise<CompatibilityAssessment> {
    if (target.backend !== 'cli' || !target.cliInstance) {
      throw new Error('Compatibility probes only support CLI targets');
    }

    const cacheKey = createCacheKey(target.providerName as ProviderName, target.instanceId);
    const cached = this.cache.get(cacheKey);
    const ageMs = cached ? this.now() - cached.cachedAtMs : Number.POSITIVE_INFINITY;
    const stale = ageMs > this.cacheTtlMs;
    if (!options.force && cached && !stale) {
      return {
        ...cached.assessment,
        cache: {
          hit: true,
          stale: false,
          ttlMs: this.cacheTtlMs,
        },
      };
    }

    const assessment = await this.buildAssessment(target, {
      purpose: options.purpose || 'diagnostics',
      stale,
    });
    this.cache.set(cacheKey, {
      assessment,
      cachedAtMs: this.now(),
    });
    return assessment;
  }

  private async buildAssessment(
    target: ProviderTargetDescriptor,
    options: { purpose: 'diagnostics' | 'execution' | 'setup'; stale: boolean },
  ): Promise<CompatibilityAssessment> {
    const instance = target.cliInstance as ProviderInstanceConfig;
    const knowledge = getProviderCompatibilityKnowledge(target.providerName as ProviderName);
    const defaultProfile = getDefaultCompatibilityProfile(target.providerName as ProviderName);
    const checkedAt = new Date(this.now()).toISOString();
    const key = createCacheKey(target.providerName as ProviderName, target.instanceId);
    const checks: CompatibilityCheck[] = [];
    const probeCwd = this.config.dataDir || this.config.sessionBaseDir;
    const versionArgs = knowledge?.versionArgs?.length ? knowledge.versionArgs : ['--version'];
    const helpArgs = knowledge?.helpArgs?.length ? knowledge.helpArgs : undefined;
    const versionProbe = versionArgs.length
      ? await this.runner.run(
        target.providerName as ProviderName,
        instance.commandConfig,
        versionArgs,
        probeCwd,
        this.probeTimeoutMs,
      )
      : undefined;
    const helpProbe = helpArgs?.length
      ? await this.runner.run(
        target.providerName as ProviderName,
        instance.commandConfig,
        helpArgs,
        probeCwd,
        this.probeTimeoutMs,
      )
      : undefined;

    const versionProbeRecord = versionProbe ? toProbeRecord(versionArgs, versionProbe) : undefined;
    const helpProbeRecord = helpProbe ? toProbeRecord(helpArgs || [], helpProbe) : undefined;
    const commandAvailable = didExecuteProbe(versionProbeRecord) || didExecuteProbe(helpProbeRecord);

    checks.push(createCheck(
      'command_available',
      commandAvailable ? 'ok' : 'unavailable',
      commandAvailable
        ? `Executed compatibility probe for '${target.providerName}/${target.instanceId}'`
        : `Failed to execute compatibility probe for '${target.providerName}/${target.instanceId}'`,
      {
        command: instance.commandConfig.path,
        runtime: instance.commandConfig.runtime,
      },
    ));

    const parsedVersion = parseVersion(
      versionProbe?.stdout || versionProbe?.stderr,
    );
    if (parsedVersion) {
      checks.push(createCheck(
        'version_detected',
        'ok',
        `Detected ${target.providerName} version ${parsedVersion.normalized}`,
      ));
    } else if (versionProbe?.timedOut || versionProbe?.error) {
      checks.push(createCheck(
        'version_probe_failed',
        'degraded',
        versionProbe.timedOut
          ? `Timed out while probing ${target.providerName} version`
          : `Could not determine ${target.providerName} version`,
      ));
    } else {
      checks.push(createCheck(
        'version_unknown',
        'degraded',
        `${target.providerName} version could not be determined`,
      ));
    }

    const helpText = `${helpProbe?.stdout || ''}\n${helpProbe?.stderr || ''}`;
    const detectedFeatures = (knowledge?.primaryProfile.helpTokens || [])
      .filter((token) => helpText.includes(token))
      .map((token) => `token:${token}`);
    const missingHelpTokens = (knowledge?.primaryProfile.helpTokens || [])
      .filter((token) => !helpText.includes(token));

    if (knowledge?.primaryProfile.helpTokens?.length) {
      checks.push(createCheck(
        missingHelpTokens.length === 0 ? 'feature_signature_matched' : 'feature_signature_partial',
        missingHelpTokens.length === 0 ? 'ok' : 'degraded',
        missingHelpTokens.length === 0
          ? `Detected expected ${knowledge.familyLabel} feature signature`
          : `Compatibility probe did not observe all expected ${knowledge.familyLabel} feature markers`,
        missingHelpTokens.length === 0 ? undefined : {
          missingTokens: missingHelpTokens,
        },
      ));
    }

    const {
      classification,
      profile,
      summary,
      warnings,
    } = selectProfile({
      providerName: target.providerName as ProviderName,
      parsedVersion,
      commandAvailable,
      missingHelpTokens,
      knowledge,
      defaultProfile,
    });

    checks.push(createCheck(
      'profile_selected',
      mapClassificationToStatus(classification),
      summary,
      {
        profileId: profile.id,
        protocolFamily: profile.protocolFamily,
        confidence: profile.confidence,
      },
    ));

    const assessment: CompatibilityAssessment = {
      key,
      provider: target.providerName as ProviderName,
      instanceId: target.instanceId,
      checkedAt,
      classification,
      status: mapClassificationToStatus(classification),
      summary,
      fingerprint: {
        provider: target.providerName as ProviderName,
        instanceId: target.instanceId,
        command: instance.commandConfig.path,
        runner: instance.commandConfig.runner,
        runtime: { ...instance.commandConfig.runtime },
        version: parsedVersion ? {
          raw: parsedVersion.raw,
          normalized: parsedVersion.normalized,
          major: parsedVersion.major,
          minor: parsedVersion.minor,
          patch: parsedVersion.patch,
          source: 'command',
          detected: true,
        } : {
          raw: extractFirstLine(versionProbe?.stdout || versionProbe?.stderr),
          source: 'unknown',
          detected: false,
        },
        features: detectedFeatures,
        checkedAt,
      },
      profile,
      warnings,
      checks,
      probes: {
        version: versionProbeRecord,
        help: helpProbeRecord,
      },
      cache: {
        hit: false,
        stale: options.stale,
        ttlMs: this.cacheTtlMs,
      },
    };

    if (classification !== 'ready') {
      assessment.evidence = await this.captureEvidenceBundle(assessment, instance.commandConfig);
      if (assessment.evidence) {
        assessment.checks.push(createCheck(
          'evidence_captured',
          'degraded',
          `Captured compatibility evidence for ${target.providerName}/${target.instanceId}`,
          {
            artifact: assessment.evidence.relativePath,
          },
        ));
      }
    }

    return assessment;
  }

  private async captureEvidenceBundle(
    assessment: CompatibilityAssessment,
    commandConfig: ProviderCommandConfig,
  ): Promise<CompatibilityEvidenceArtifact | undefined> {
    const captureId = buildEvidenceId(assessment);
    const relativePath = join(
      assessment.provider,
      `${captureId}.json`,
    );
    const outputPath = join(this.evidenceDir, relativePath);
    const payload = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      id: captureId,
      capturedAt: assessment.checkedAt,
      classification: assessment.classification,
      summary: assessment.summary,
      target: {
        provider: assessment.provider,
        instanceId: assessment.instanceId,
      },
      profile: assessment.profile,
      fingerprint: {
        ...assessment.fingerprint,
        command: redactText(assessment.fingerprint.command),
      },
      command: {
        runner: commandConfig.runner,
        runtime: commandConfig.runtime,
      },
      warnings: assessment.warnings,
      probes: {
        version: redactProbeRecord(assessment.probes.version),
        help: redactProbeRecord(assessment.probes.help),
      },
      checks: assessment.checks,
    };

    try {
      await mkdir(join(this.evidenceDir, assessment.provider), { recursive: true });
      await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
      return {
        id: captureId,
        relativePath: relativePath.replace(/\\/g, '/'),
        capturedAt: assessment.checkedAt,
      };
    } catch {
      return undefined;
    }
  }
}

export function toCompatibilitySummaryView(
  assessment: CompatibilityAssessment,
): CompatibilitySummaryView {
  return {
    classification: assessment.classification,
    status: assessment.status,
    summary: assessment.summary,
    checkedAt: assessment.checkedAt,
    profile: assessment.profile,
    fingerprint: {
      version: assessment.fingerprint.version,
      features: [...assessment.fingerprint.features],
      runtime: { ...assessment.fingerprint.runtime },
    },
    warnings: [...assessment.warnings],
    evidence: assessment.evidence ? { ...assessment.evidence } : undefined,
  };
}

function selectProfile(input: {
  providerName: ProviderName;
  parsedVersion: ParsedVersion | undefined;
  commandAvailable: boolean;
  missingHelpTokens: string[];
  knowledge: ReturnType<typeof getProviderCompatibilityKnowledge>;
  defaultProfile: ReturnType<typeof getDefaultCompatibilityProfile>;
}): {
  classification: CompatibilityClassification;
  profile: CompatibilityProfileSelection;
  summary: string;
  warnings: string[];
} {
  if (!input.commandAvailable) {
    return {
      classification: 'probe_failed',
      profile: toSelection(input.defaultProfile, 'weak'),
      summary: `Compatibility probe could not execute '${input.providerName}' in the configured runtime.`,
      warnings: ['The runtime could not execute the configured provider command.'],
    };
  }

  const knowledge = input.knowledge;
  if (!knowledge) {
    return {
      classification: 'degraded',
      profile: toSelection(input.defaultProfile, 'weak'),
      summary: `No provider-specific compatibility profile is shipped for '${input.providerName}'.`,
      warnings: ['Using the runtime default provider adapter without family-specific compatibility knowledge.'],
    };
  }

  if (
    input.parsedVersion
    && knowledge.primaryProfile.minVersionMajor !== undefined
    && input.parsedVersion.major < knowledge.primaryProfile.minVersionMajor
  ) {
    return {
      classification: 'unsupported_version',
      profile: toSelection(knowledge.fallbackProfile || knowledge.primaryProfile, 'weak'),
      summary: `${knowledge.familyLabel} version ${input.parsedVersion.normalized} is older than the supported compatibility baseline.`,
      warnings: ['The detected CLI version is older than the first supported compatibility profile.'],
    };
  }

  if (input.parsedVersion && input.missingHelpTokens.length === 0) {
    return {
      classification: 'ready',
      profile: toSelection(knowledge.primaryProfile, 'exact'),
      summary: `${knowledge.familyLabel} matched compatibility profile '${knowledge.primaryProfile.id}'.`,
      warnings: [],
    };
  }

  if (!input.parsedVersion && knowledge.primaryProfile.allowUnknownVersion) {
    return {
      classification: 'degraded',
      profile: toSelection(knowledge.fallbackProfile || knowledge.primaryProfile, 'fallback'),
      summary: `${knowledge.familyLabel} is running with a best-fit compatibility profile because version detection was inconclusive.`,
      warnings: ['Version detection was inconclusive; the runtime selected a best-fit compatibility profile.'],
    };
  }

  if (input.missingHelpTokens.length > 0) {
    return {
      classification: 'degraded',
      profile: toSelection(knowledge.fallbackProfile || knowledge.primaryProfile, 'weak'),
      summary: `${knowledge.familyLabel} did not expose the full expected compatibility signature; the runtime is using a degraded path.`,
      warnings: [
        `Expected feature markers were missing: ${input.missingHelpTokens.join(', ')}`,
      ],
    };
  }

  return {
    classification: 'degraded',
    profile: toSelection(knowledge.fallbackProfile || knowledge.primaryProfile, 'fallback'),
    summary: `${knowledge.familyLabel} is using a degraded compatibility fallback.`,
    warnings: ['The runtime selected a degraded compatibility fallback.'],
  };
}

function toSelection(
  profile: {
    id: string;
    label: string;
    protocolFamily: string;
    parserId: string;
    spawnBaseArgs?: string[];
  },
  confidence: CompatibilityProfileSelection['confidence'],
): CompatibilityProfileSelection {
  return {
    id: profile.id,
    label: profile.label,
    protocolFamily: profile.protocolFamily,
    parserId: profile.parserId,
    spawnBaseArgs: profile.spawnBaseArgs ? [...profile.spawnBaseArgs] : undefined,
    confidence,
  };
}

function createCacheKey(
  providerName: ProviderName,
  instanceId: string,
): string {
  return `${providerName}:${instanceId}`;
}

function buildEvidenceId(assessment: CompatibilityAssessment): string {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      provider: assessment.provider,
      instanceId: assessment.instanceId,
      classification: assessment.classification,
      profileId: assessment.profile.id,
      version: assessment.fingerprint.version.normalized || assessment.fingerprint.version.raw || 'unknown',
      features: assessment.fingerprint.features,
    }))
    .digest('hex')
    .slice(0, 12);
  return `${assessment.checkedAt.replace(/[:.]/g, '-')}-${digest}-${randomUUID().slice(0, 8)}`;
}

function extractFirstLine(text: string | undefined): string | undefined {
  return text
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function createCheck(
  code: string,
  status: CompatibilityCheck['status'],
  message: string,
  details?: Record<string, unknown>,
): CompatibilityCheck {
  return {
    code,
    status,
    message,
    details,
  };
}

function mapClassificationToStatus(
  classification: CompatibilityClassification,
): CompatibilityCheck['status'] {
  switch (classification) {
    case 'ready':
      return 'ok';
    case 'degraded':
      return 'degraded';
    default:
      return 'unavailable';
  }
}

interface ParsedVersion {
  raw: string;
  normalized: string;
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(text: string | undefined): ParsedVersion | undefined {
  const firstLine = extractFirstLine(text);
  if (!firstLine) {
    return undefined;
  }

  const match = firstLine.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return undefined;
  }

  const major = Number.parseInt(match[1] || '0', 10);
  const minor = Number.parseInt(match[2] || '0', 10);
  const patch = Number.parseInt(match[3] || '0', 10);
  return {
    raw: firstLine,
    normalized: `${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
  };
}

function toProbeRecord(args: string[], result: ProbeResult): CompatibilityProbeRecord {
  return {
    commandSummary: args.join(' '),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    ok: !result.timedOut && !result.error && result.exitCode === 0,
    stdoutSample: truncateSample(result.stdout),
    stderrSample: truncateSample(result.stderr),
    error: result.error,
  };
}

function didExecuteProbe(probe: CompatibilityProbeRecord | undefined): boolean {
  return Boolean(
    probe
    && !probe.timedOut
    && !probe.error
    && probe.exitCode !== null,
  );
}

function redactProbeRecord(
  probe: CompatibilityProbeRecord | undefined,
): CompatibilityProbeRecord | undefined {
  if (!probe) {
    return undefined;
  }

  return {
    ...probe,
    stdoutSample: redactText(probe.stdoutSample),
    stderrSample: redactText(probe.stderrSample),
    error: redactText(probe.error),
  };
}

function truncateSample(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, DEFAULT_SAMPLE_LIMIT);
}

function redactText(text: string | undefined): string | undefined {
  if (!text) {
    return text;
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  const homeUnixSafe = home ? escapeRegExp(home.replace(/\\/g, '/')) : undefined;
  const homeWindowsSafe = home ? escapeRegExp(home.replace(/\//g, '\\')) : undefined;
  let output = text;
  output = output.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*)\s*[:=]\s*([^\s,"']+)/gi, '$1=<redacted>');
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+\-/=]+\b/gi, 'Bearer <redacted>');
  output = output.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|AIza[0-9A-Za-z\-_]{20,})\b/g, '<redacted>');
  output = output.replace(/"[A-Za-z]:(?:\\[^"\r\n]+)+"/g, '"<path>"');
  output = output.replace(/[A-Za-z]:(?:\\|\/)[^\s"']+/g, '<path>');
  output = output.replace(/\/(?:Users|home)\/[^\s"']+/g, '<path>');
  if (homeUnixSafe) {
    output = output.replace(new RegExp(homeUnixSafe, 'gi'), '<home>');
  }
  if (homeWindowsSafe) {
    output = output.replace(new RegExp(homeWindowsSafe, 'gi'), '<home>');
  }
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runCompatibilityProbe(
  providerName: ProviderName,
  commandConfig: ProviderCommandConfig,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const spawnConfig = buildProcessSpawnConfig(
    commandConfig,
    providerName,
    args,
    cwd,
  );
  const env = { ...process.env };
  delete env.CLAUDECODE;
  if (spawnConfig.env) {
    Object.assign(env, spawnConfig.env);
  }

  return new Promise((resolveProbe) => {
    const startedAt = Date.now();
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd ?? cwd,
      shell: spawnConfig.shell,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<ProbeResult, 'durationMs'>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveProbe({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Ignore kill failures and report the timeout.
      }
      finish({
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
        error: `Timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      });
    });
    child.once('close', (exitCode) => {
      finish({
        exitCode,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
