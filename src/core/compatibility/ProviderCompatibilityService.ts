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
  defaultProviderInstallCheckRunner,
  type ProviderInstallCheckRunner,
  type RuntimeCommandLookupResult,
  type RuntimePathCheckResult,
  type RuntimeValueCheckResult,
} from '../provider-install/ProviderInstallCheckRunner.js';
import {
  buildProviderInstallCatalogView,
  GENERIC_AUTH_ERROR_PATTERNS,
  getProviderInstallKnowledge,
} from '../provider-install/knowledge.js';
import type {
  ProviderCommandStatus,
  ProviderInstallCatalogView,
  ProviderRemediationStep,
  ProviderSetupSummary,
} from '../provider-install/types.js';
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
const EVIDENCE_SCHEMA_VERSION = 3;
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
  installCheckRunner?: ProviderInstallCheckRunner;
  now?: () => number;
}

export class ProviderCompatibilityService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly probeTimeoutMs: number;
  private readonly evidenceDir: string;
  private readonly runner: CompatibilityRunner;
  private readonly installCheckRunner: ProviderInstallCheckRunner;
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
    this.installCheckRunner = options.installCheckRunner || defaultProviderInstallCheckRunner;
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
    const providerName = target.providerName as ProviderName;
    const compatibilityKnowledge = getProviderCompatibilityKnowledge(providerName);
    const installKnowledge = getProviderInstallKnowledge(providerName);
    const installView = buildProviderInstallCatalogView(
      providerName,
      instance.commandConfig.runtime,
    );
    const defaultProfile = getDefaultCompatibilityProfile(target.providerName as ProviderName);
    const checkedAt = new Date(this.now()).toISOString();
    const key = createCacheKey(providerName, target.instanceId);
    const checks: CompatibilityCheck[] = [];
    const probeCwd = this.config.dataDir || this.config.sessionBaseDir;
    const versionArgs = installKnowledge.check.versionArgs?.length
      ? installKnowledge.check.versionArgs
      : compatibilityKnowledge?.versionArgs?.length
        ? compatibilityKnowledge.versionArgs
        : ['--version'];
    const helpArgs = installKnowledge.check.helpArgs?.length
      ? installKnowledge.check.helpArgs
      : compatibilityKnowledge?.helpArgs?.length
        ? compatibilityKnowledge.helpArgs
        : undefined;
    const versionProbePromise = versionArgs.length
      ? this.runner.run(
        providerName,
        instance.commandConfig,
        versionArgs,
        probeCwd,
        this.probeTimeoutMs,
      )
      : Promise.resolve(undefined);
    const helpProbePromise = helpArgs?.length
      ? this.runner.run(
        providerName,
        instance.commandConfig,
        helpArgs,
        probeCwd,
        this.probeTimeoutMs,
      )
      : Promise.resolve(undefined);
    const [versionProbe, helpProbe] = await Promise.all([
      versionProbePromise,
      helpProbePromise,
    ]);

    const versionProbeRecord = versionProbe ? toProbeRecord(versionArgs, versionProbe) : undefined;
    const helpProbeRecord = helpProbe ? toProbeRecord(helpArgs || [], helpProbe) : undefined;
    const commandAvailable = didExecuteProbe(versionProbeRecord) || didExecuteProbe(helpProbeRecord);
    const configuredLookupPromise = this.installCheckRunner.lookupCommand(
      instance.commandConfig.path,
      instance.commandConfig.runtime,
      this.probeTimeoutMs,
    );
    const binaryLookupPromise = instance.commandConfig.path === installKnowledge.binaryName
      ? configuredLookupPromise
      : this.installCheckRunner.lookupCommand(
        installKnowledge.binaryName,
        instance.commandConfig.runtime,
        this.probeTimeoutMs,
      );
    const expectedPath = installView.path.expectedPath;
    const expectedPathCheckPromise = expectedPath
      ? this.installCheckRunner.checkPath(
        expectedPath,
        instance.commandConfig.runtime,
        this.probeTimeoutMs,
      )
      : Promise.resolve(undefined);
    const packageCheckPromise = installKnowledge.check.npmPackage
      ? this.installCheckRunner.checkNpmPackage(
        installKnowledge.check.npmPackage,
        instance.commandConfig.runtime,
        this.probeTimeoutMs,
      )
      : Promise.resolve(undefined);
    const pathPersistenceCheckPromise = installView.path.shellRcPath && installView.path.persistenceEntry
      ? this.installCheckRunner.checkShellRcEntry(
        installView.path.shellRcPath,
        installView.path.persistenceEntry,
        instance.commandConfig.runtime,
        this.probeTimeoutMs,
      )
      : Promise.resolve(undefined);
    const npmPrefixPromise = installView.npm?.expectedPrefix
      ? this.installCheckRunner.getNpmPrefix(
        instance.commandConfig.runtime,
        this.probeTimeoutMs,
      )
      : Promise.resolve(undefined);
    const prerequisiteLookupsPromise = Promise.all(
      installView.prerequisites.map(async (prerequisite) => ({
        prerequisite,
        lookup: await this.installCheckRunner.lookupCommand(
          prerequisite.command,
          instance.commandConfig.runtime,
          this.probeTimeoutMs,
        ),
      })),
    );
    const [
      configuredLookup,
      binaryLookup,
      expectedPathCheck,
      packageCheck,
      prerequisiteLookups,
      pathPersistenceCheck,
      npmPrefix,
    ] = await Promise.all([
      configuredLookupPromise,
      binaryLookupPromise,
      expectedPathCheckPromise,
      packageCheckPromise,
      prerequisiteLookupsPromise,
      pathPersistenceCheckPromise,
      npmPrefixPromise,
    ]);

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

    const commandSummary = buildCommandSummary({
      configuredCommand: instance.commandConfig.path,
      installView,
      commandAvailable,
      configuredLookup,
      binaryLookup,
      expectedPathCheck,
      packageCheck,
    });
    if (commandSummary.status !== 'ready') {
      checks.push(createCheck(
        mapCommandStatusToCode(commandSummary.status),
        mapCommandStatusToHealth(commandSummary.status),
        commandSummary.summary,
        {
          configuredCommand: commandSummary.configuredCommand,
          binaryName: commandSummary.binaryName,
          resolvedCommand: commandSummary.resolvedCommand,
          expectedPath: commandSummary.expectedPath,
          expectedPathExists: commandSummary.expectedPathExists,
          packageInstalled: commandSummary.packageInstalled,
        },
      ));
    }
    const prerequisiteSummaries = prerequisiteLookups.map(({ prerequisite, lookup }) => (
      buildPrerequisiteSummary(prerequisite, lookup)
    ));
    for (const prerequisiteSummary of prerequisiteSummaries) {
      if (prerequisiteSummary.status !== 'missing') {
        continue;
      }

      checks.push(createCheck(
        'prerequisite_missing',
        'unavailable',
        prerequisiteSummary.summary,
        {
          prerequisiteId: prerequisiteSummary.id,
          prerequisite: prerequisiteSummary.label,
          command: prerequisiteSummary.command,
        },
      ));
    }

    const pathPersistenceSummary = buildPathPersistenceSummary({
      installView,
      commandSummary,
      pathPersistenceCheck,
    });
    if (pathPersistenceSummary.status === 'missing') {
      checks.push(createCheck(
        'path_persistence_missing',
        'degraded',
        pathPersistenceSummary.summary,
        {
          shellRcPath: pathPersistenceSummary.shellRcPath,
          expectedEntry: pathPersistenceSummary.expectedEntry,
        },
      ));
    }

    const npmSummary = buildNpmConfigSummary({
      installView,
      commandSummary,
      npmPrefix,
    });
    if (npmSummary.status === 'missing_prefix') {
      checks.push(createCheck(
        'npm_prefix_missing',
        'degraded',
        npmSummary.summary,
        {
          packageName: npmSummary.packageName,
          expectedPrefix: npmSummary.expectedPrefix,
          detectedPrefix: npmSummary.detectedPrefix,
        },
      ));
    }

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
    const detectedFeatures = (compatibilityKnowledge?.primaryProfile.helpTokens || [])
      .filter((token) => helpText.includes(token))
      .map((token) => `token:${token}`);
    const missingHelpTokens = (compatibilityKnowledge?.primaryProfile.helpTokens || [])
      .filter((token) => !helpText.includes(token));

    if (compatibilityKnowledge?.primaryProfile.helpTokens?.length) {
      checks.push(createCheck(
        missingHelpTokens.length === 0 ? 'feature_signature_matched' : 'feature_signature_partial',
        missingHelpTokens.length === 0 ? 'ok' : 'degraded',
        missingHelpTokens.length === 0
          ? `Detected expected ${compatibilityKnowledge.familyLabel} feature signature`
          : `Compatibility probe did not observe all expected ${compatibilityKnowledge.familyLabel} feature markers`,
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
      providerName,
      parsedVersion,
      commandAvailable,
      missingHelpTokens,
      knowledge: compatibilityKnowledge,
      defaultProfile,
    });

    const authSummary = buildAuthSummary({
      installKnowledge,
      installView,
      versionProbe: versionProbeRecord,
      helpProbe: helpProbeRecord,
      commandStatus: commandSummary.status,
    });
    if (authSummary.status === 'missing') {
      checks.push(createCheck(
        'auth_missing',
        'unavailable',
        authSummary.summary,
      ));
    }

    const versionSummary = buildVersionSummary({
      installView,
      compatibilityKnowledge,
      parsedVersion,
      classification,
    });
    if (versionSummary.status === 'unsupported') {
      checks.push(createCheck(
        'version_unsupported',
        'unavailable',
        versionSummary.summary,
        {
          detectedVersion: versionSummary.detected,
          supportedRange: versionSummary.supportedRange,
        },
      ));
    }

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

    const setup: ProviderSetupSummary = {
      familyLabel: installView.familyLabel,
      executionPlatform: installView.executionPlatform,
      runtime: { ...instance.commandConfig.runtime },
      install: installView,
      prerequisites: prerequisiteSummaries,
      command: commandSummary,
      pathPersistence: pathPersistenceSummary,
      npm: npmSummary,
      auth: authSummary,
      version: versionSummary,
      remediation: buildRemediationSteps({
        providerName,
        installView,
        prerequisiteSummaries,
        commandSummary,
        pathPersistenceSummary,
        npmSummary,
        authSummary,
        versionSummary,
        classification,
      }),
    };

    const assessment: CompatibilityAssessment = {
      key,
      provider: providerName,
      instanceId: target.instanceId,
      checkedAt,
      classification,
      status: mapClassificationToStatus(classification),
      summary,
      fingerprint: {
        provider: providerName,
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
      setup,
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
    const payload = redactJsonValue({
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
      fingerprint: assessment.fingerprint,
      command: {
        runner: commandConfig.runner,
        runtime: commandConfig.runtime,
      },
      warnings: assessment.warnings,
      setup: assessment.setup,
      probes: assessment.probes,
      checks: assessment.checks,
    });

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

function buildCommandSummary(input: {
  configuredCommand: string;
  installView: ProviderInstallCatalogView;
  commandAvailable: boolean;
  configuredLookup: RuntimeCommandLookupResult;
  binaryLookup: RuntimeCommandLookupResult;
  expectedPathCheck?: RuntimePathCheckResult;
  packageCheck?: RuntimePathCheckResult;
}): ProviderSetupSummary['command'] {
  if (input.commandAvailable || input.configuredLookup.available) {
    return {
      configuredCommand: input.configuredCommand,
      binaryName: input.installView.binaryName,
      status: 'ready',
      summary: `Resolved ${input.installView.familyLabel} command for compatibility checks.`,
      resolvedCommand: input.configuredLookup.resolvedPath || input.binaryLookup.resolvedPath,
      expectedPath: input.installView.path.expectedPath,
      expectedPathExists: input.expectedPathCheck?.exists,
      packageInstalled: input.packageCheck?.exists,
    };
  }

  if (!input.installView.install.supported) {
    return {
      configuredCommand: input.configuredCommand,
      binaryName: input.installView.binaryName,
      status: 'missing_install',
      summary: `${input.installView.familyLabel} is not installable for the current execution platform.`,
      expectedPath: input.installView.path.expectedPath,
      expectedPathExists: input.expectedPathCheck?.exists,
      packageInstalled: input.packageCheck?.exists,
    };
  }

  if (input.binaryLookup.available) {
    return {
      configuredCommand: input.configuredCommand,
      binaryName: input.installView.binaryName,
      status: 'misconfigured_command',
      summary: `Configured command '${input.configuredCommand}' is not executable, but '${input.installView.binaryName}' is available in the execution environment.`,
      resolvedCommand: input.binaryLookup.resolvedPath,
      expectedPath: input.installView.path.expectedPath,
      expectedPathExists: input.expectedPathCheck?.exists,
      packageInstalled: input.packageCheck?.exists,
    };
  }

  if (input.expectedPathCheck?.exists || input.packageCheck?.exists) {
    return {
      configuredCommand: input.configuredCommand,
      binaryName: input.installView.binaryName,
      status: 'missing_path',
      summary: `${input.installView.familyLabel} appears to be installed, but the runtime cannot resolve '${input.installView.binaryName}' on PATH.`,
      expectedPath: input.installView.path.expectedPath,
      expectedPathExists: input.expectedPathCheck?.exists,
      packageInstalled: input.packageCheck?.exists,
    };
  }

  if (input.configuredLookup.timedOut || input.binaryLookup.timedOut) {
    return {
      configuredCommand: input.configuredCommand,
      binaryName: input.installView.binaryName,
      status: 'probe_failed',
      summary: `Timed out while resolving '${input.installView.binaryName}' in the execution environment.`,
      expectedPath: input.installView.path.expectedPath,
      expectedPathExists: input.expectedPathCheck?.exists,
      packageInstalled: input.packageCheck?.exists,
    };
  }

  return {
    configuredCommand: input.configuredCommand,
    binaryName: input.installView.binaryName,
    status: 'missing_install',
    summary: `${input.installView.familyLabel} does not appear to be installed in the execution environment.`,
    expectedPath: input.installView.path.expectedPath,
    expectedPathExists: input.expectedPathCheck?.exists,
    packageInstalled: input.packageCheck?.exists,
  };
}

function buildPrerequisiteSummary(
  prerequisite: ProviderSetupSummary['install']['prerequisites'][number],
  lookup: RuntimeCommandLookupResult,
): ProviderSetupSummary['prerequisites'][number] {
  if (lookup.available) {
    return {
      id: prerequisite.id,
      label: prerequisite.label,
      command: prerequisite.command,
      status: 'ready',
      summary: `${prerequisite.label} is available in the execution environment.`,
      resolvedCommand: lookup.resolvedPath,
    };
  }

  if (lookup.timedOut) {
    return {
      id: prerequisite.id,
      label: prerequisite.label,
      command: prerequisite.command,
      status: 'unknown',
      summary: `Timed out while checking whether ${prerequisite.label} is available in the execution environment.`,
    };
  }

  return {
    id: prerequisite.id,
    label: prerequisite.label,
    command: prerequisite.command,
    status: 'missing',
    summary: prerequisite.summary,
  };
}

function buildPathPersistenceSummary(input: {
  installView: ProviderInstallCatalogView;
  commandSummary: ProviderSetupSummary['command'];
  pathPersistenceCheck?: RuntimePathCheckResult;
}): ProviderSetupSummary['pathPersistence'] {
  if (!input.installView.path.persistenceEntry || !input.installView.path.shellRcPath) {
    return {
      status: 'not_applicable',
      summary: `No shell PATH persistence hint is defined for ${input.installView.familyLabel}.`,
    };
  }

  if (input.pathPersistenceCheck?.exists) {
    return {
      status: 'ready',
      summary: `${input.installView.path.persistenceEntry} is already persisted in ${input.installView.path.shellRcPath}.`,
      shellRcPath: input.installView.path.shellRcPath,
      expectedEntry: input.installView.path.persistenceEntry,
      exportCommand: input.installView.path.exportCommand,
    };
  }

  if (input.pathPersistenceCheck?.timedOut) {
    return {
      status: 'unknown',
      summary: `Timed out while checking ${input.installView.path.shellRcPath} for ${input.installView.path.persistenceEntry}.`,
      shellRcPath: input.installView.path.shellRcPath,
      expectedEntry: input.installView.path.persistenceEntry,
      exportCommand: input.installView.path.exportCommand,
    };
  }

  if (input.commandSummary.status === 'missing_path') {
    return {
      status: 'missing',
      summary: `${input.installView.path.persistenceEntry} is not persisted in ${input.installView.path.shellRcPath}, so new shells may not resolve ${input.installView.binaryName}.`,
      shellRcPath: input.installView.path.shellRcPath,
      expectedEntry: input.installView.path.persistenceEntry,
      exportCommand: input.installView.path.exportCommand,
    };
  }

  return {
    status: 'unknown',
    summary: `${input.installView.familyLabel} PATH persistence could not be confirmed from ${input.installView.path.shellRcPath}.`,
    shellRcPath: input.installView.path.shellRcPath,
    expectedEntry: input.installView.path.persistenceEntry,
    exportCommand: input.installView.path.exportCommand,
  };
}

function buildNpmConfigSummary(input: {
  installView: ProviderInstallCatalogView;
  commandSummary: ProviderSetupSummary['command'];
  npmPrefix?: RuntimeValueCheckResult;
}): ProviderSetupSummary['npm'] {
  if (!input.installView.npm) {
    return {
      status: 'not_applicable',
      summary: `${input.installView.familyLabel} does not use npm-global install metadata.`,
    };
  }

  if (input.npmPrefix?.timedOut) {
    return {
      status: 'unknown',
      summary: 'Timed out while checking npm global prefix configuration.',
      packageName: input.installView.npm.packageName,
      expectedPrefix: input.installView.npm.expectedPrefix,
    };
  }

  if (!input.installView.npm.expectedPrefix) {
    return {
      status: 'not_applicable',
      summary: `No runtime-owned npm prefix baseline is defined for ${input.installView.executionPlatform}.`,
      packageName: input.installView.npm.packageName,
    };
  }

  if (input.installView.npm.expectedPrefix && input.npmPrefix?.value) {
    if (matchesExpectedPrefix(input.installView.npm.expectedPrefix, input.npmPrefix.value)) {
      return {
        status: 'ready',
        summary: `npm global prefix matches the expected ${input.installView.npm.expectedPrefix} layout.`,
        packageName: input.installView.npm.packageName,
        expectedPrefix: input.installView.npm.expectedPrefix,
        detectedPrefix: input.npmPrefix.value,
      };
    }

    if (input.commandSummary.status === 'missing_path') {
      return {
        status: 'missing_prefix',
        summary: `npm global prefix is ${input.npmPrefix.value}, but ${input.installView.familyLabel} expects ${input.installView.npm.expectedPrefix} for the documented PATH layout.`,
        packageName: input.installView.npm.packageName,
        expectedPrefix: input.installView.npm.expectedPrefix,
        detectedPrefix: input.npmPrefix.value,
      };
    }
  }

  return {
    status: 'unknown',
    summary: input.npmPrefix?.value
      ? `Detected npm global prefix ${input.npmPrefix.value}, but the runtime could not confirm whether it matches the expected setup path.`
      : 'npm global prefix could not be determined for this execution environment.',
    packageName: input.installView.npm.packageName,
    expectedPrefix: input.installView.npm.expectedPrefix,
    detectedPrefix: input.npmPrefix?.value,
  };
}

function buildAuthSummary(input: {
  installKnowledge: ReturnType<typeof getProviderInstallKnowledge>;
  installView: ProviderInstallCatalogView;
  versionProbe?: CompatibilityProbeRecord;
  helpProbe?: CompatibilityProbeRecord;
  commandStatus: ProviderCommandStatus;
}): ProviderSetupSummary['auth'] {
  if (!input.installView.auth.requiredAfterInstall) {
    return {
      requiredAfterInstall: false,
      status: 'not_required',
      summary: `${input.installView.familyLabel} does not require a post-install authentication step.`,
      envVars: [],
      docsUrl: input.installView.auth.docsUrl,
    };
  }

  if (detectAuthFailure(
    input.installKnowledge.auth.errorPatterns,
    input.installView.auth.envVars,
    input.versionProbe,
    input.helpProbe,
  )) {
    return {
      requiredAfterInstall: true,
      status: 'missing',
      summary: `${input.installView.familyLabel} reported an authentication or login requirement during probing.`,
      envVars: [...input.installView.auth.envVars],
      docsUrl: input.installView.auth.docsUrl,
    };
  }

  return {
    requiredAfterInstall: true,
    status: 'unknown',
    summary: input.commandStatus === 'ready'
      ? `${input.installView.familyLabel} usually requires authentication after install, but version/help probes did not verify credentials.`
      : `${input.installView.familyLabel} authentication could not be checked because the command was not ready.`,
    envVars: [...input.installView.auth.envVars],
    docsUrl: input.installView.auth.docsUrl,
  };
}

function buildVersionSummary(input: {
  installView: ProviderInstallCatalogView;
  compatibilityKnowledge: ReturnType<typeof getProviderCompatibilityKnowledge>;
  parsedVersion: ParsedVersion | undefined;
  classification: CompatibilityClassification;
}): ProviderSetupSummary['version'] {
  const supportedRange = buildSupportedRange(input.compatibilityKnowledge);
  if (input.parsedVersion && input.classification === 'unsupported_version') {
    return {
      status: 'unsupported',
      summary: `${input.installView.familyLabel} version ${input.parsedVersion.normalized} is outside the supported compatibility baseline.`,
      detected: input.parsedVersion.normalized,
      supportedRange,
    };
  }

  if (input.parsedVersion) {
    return {
      status: 'ready',
      summary: `Detected ${input.installView.familyLabel} version ${input.parsedVersion.normalized}.`,
      detected: input.parsedVersion.normalized,
      supportedRange,
    };
  }

  return {
    status: 'unknown',
    summary: `The runtime could not determine a stable ${input.installView.familyLabel} version from compatibility probes.`,
    supportedRange,
  };
}

function buildRemediationSteps(input: {
  providerName: ProviderName;
  installView: ProviderInstallCatalogView;
  prerequisiteSummaries: ProviderSetupSummary['prerequisites'];
  commandSummary: ProviderSetupSummary['command'];
  pathPersistenceSummary: ProviderSetupSummary['pathPersistence'];
  npmSummary: ProviderSetupSummary['npm'];
  authSummary: ProviderSetupSummary['auth'];
  versionSummary: ProviderSetupSummary['version'];
  classification: CompatibilityClassification;
}): ProviderRemediationStep[] {
  const remediation: ProviderRemediationStep[] = [];

  if (!input.installView.install.supported) {
    remediation.push({
      code: 'switch_runtime',
      summary: input.installView.install.notes?.[0]
        || `Switch ${input.providerName} to a supported execution platform before probing again.`,
      docsUrl: input.installView.install.docsUrl,
    });
    return remediation;
  }

  for (const prerequisite of input.prerequisiteSummaries) {
    if (prerequisite.status !== 'missing') {
      continue;
    }

    remediation.push({
      code: 'install_prerequisite',
      summary: `Install ${prerequisite.label} in the ${input.installView.executionPlatform} execution environment before retrying ${input.providerName}.`,
      docsUrl: input.installView.install.docsUrl,
    });
  }

  if (input.commandSummary.status === 'missing_install') {
    remediation.push({
      code: 'install_provider',
      summary: `Install ${input.installView.familyLabel} in the ${input.installView.executionPlatform} execution environment.`,
      command: input.installView.install.command,
      docsUrl: input.installView.install.docsUrl,
      requiresShellRestart: input.installView.install.requiresShellRestart,
      mayRequireRestart: input.installView.install.mayRequireRestart,
    });
  }

  if (input.commandSummary.status === 'missing_path') {
    remediation.push({
      code: 'fix_path',
      summary: input.installView.path.directoryHint
        ? `Add ${input.installView.path.directoryHint} to PATH for the execution environment and retry the probe.`
        : `Update PATH so ${input.installView.binaryName} is discoverable in the execution environment.`,
      command: input.installView.path.exportCommand,
      docsUrl: input.installView.install.docsUrl,
      requiresShellRestart: true,
    });
  }

  if (input.pathPersistenceSummary.status === 'missing') {
    remediation.push({
      code: 'persist_path',
      summary: `Persist ${input.pathPersistenceSummary.expectedEntry} into ${input.pathPersistenceSummary.shellRcPath} before reopening the shell.`,
      command: input.pathPersistenceSummary.exportCommand,
      docsUrl: input.installView.install.docsUrl,
      requiresShellRestart: true,
    });
  }

  if (input.commandSummary.status === 'misconfigured_command') {
    remediation.push({
      code: 'update_provider_command',
      summary: `Update the configured provider command to '${input.installView.binaryName}' or a valid absolute path in the execution environment.`,
      docsUrl: input.installView.install.docsUrl,
    });
  }

  if (input.authSummary.status === 'missing') {
    remediation.push({
      code: 'authenticate_provider',
      summary: input.installView.auth.hint,
      docsUrl: input.installView.auth.docsUrl,
    });
  }

  if (input.npmSummary.status === 'missing_prefix') {
    remediation.push({
      code: 'configure_npm_prefix',
      summary: `Configure npm global installs to use ${input.npmSummary.expectedPrefix} before reinstalling ${input.installView.familyLabel}.`,
      command: input.npmSummary.expectedPrefix
        ? `npm config set prefix ${input.npmSummary.expectedPrefix}`
        : undefined,
      docsUrl: input.installView.install.docsUrl,
      requiresShellRestart: true,
    });
  }

  if (input.versionSummary.status === 'unsupported') {
    remediation.push({
      code: 'upgrade_provider',
      summary: `Upgrade ${input.installView.familyLabel} to a supported release before retrying.`,
      command: buildUpgradeCommand(input.installView),
      docsUrl: input.installView.install.docsUrl,
      requiresShellRestart: input.installView.install.requiresShellRestart,
    });
  }

  if (
    remediation.length === 0
    && input.classification === 'probe_failed'
    && input.commandSummary.status === 'ready'
  ) {
    remediation.push({
      code: 'review_probe_failure',
      summary: `Review the captured compatibility evidence for ${input.providerName} and retry with force=1 after correcting the runtime environment.`,
      docsUrl: input.installView.install.docsUrl,
    });
  }

  return remediation;
}

function matchesExpectedPrefix(expectedPrefix: string, detectedPrefix: string): boolean {
  const normalizedExpected = expectedPrefix.replace(/\\/gu, '/').replace(/^~\//u, '/');
  const normalizedDetected = detectedPrefix.replace(/\\/gu, '/');
  return normalizedDetected === normalizedExpected || normalizedDetected.endsWith(normalizedExpected);
}

function mapCommandStatusToCode(status: ProviderCommandStatus): string {
  switch (status) {
    case 'missing_install':
      return 'install_missing';
    case 'missing_path':
      return 'path_missing';
    case 'misconfigured_command':
      return 'command_misconfigured';
    case 'probe_failed':
      return 'command_lookup_failed';
    default:
      return 'command_ready';
  }
}

function mapCommandStatusToHealth(status: ProviderCommandStatus): CompatibilityCheck['status'] {
  switch (status) {
    case 'missing_path':
    case 'misconfigured_command':
      return 'degraded';
    case 'missing_install':
    case 'probe_failed':
      return 'unavailable';
    default:
      return 'ok';
  }
}

function buildUpgradeCommand(installView: ProviderInstallCatalogView): string | undefined {
  if (!installView.install.command) {
    return undefined;
  }

  if (installView.install.method === 'npm_global') {
    return installView.install.command.replace(/npm install -g (.+)$/u, 'npm install -g $1@latest');
  }

  return installView.install.command;
}

function buildSupportedRange(
  knowledge: ReturnType<typeof getProviderCompatibilityKnowledge>,
): string | undefined {
  if (!knowledge) {
    return undefined;
  }

  const min = knowledge.primaryProfile.minVersionMajor;
  const max = knowledge.primaryProfile.maxVersionMajor;
  if (min !== undefined && max !== undefined) {
    return `>=${min} <=${max}`;
  }
  if (min !== undefined) {
    return `>=${min}`;
  }
  if (max !== undefined) {
    return `<=${max}`;
  }
  return undefined;
}

function detectAuthFailure(
  patterns: string[] | undefined,
  envVars: string[],
  ...probes: Array<CompatibilityProbeRecord | undefined>
): boolean {
  const authPatterns = [
    ...GENERIC_AUTH_ERROR_PATTERNS,
    ...(patterns || []).map((pattern) => pattern.toLowerCase()),
    ...envVars.map((envVar) => envVar.toLowerCase()),
  ];
  return probes.some((probe) => {
    if (!probe) {
      return false;
    }

    const haystack = [
      probe.stdoutSample,
      probe.stderrSample,
      probe.error,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    const hasAuthPattern = authPatterns.some((pattern) => haystack.includes(pattern));
    if (!hasAuthPattern) {
      return false;
    }

    return Boolean(probe.error)
      || probe.timedOut
      || (probe.exitCode !== null && probe.exitCode !== 0);
  });
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

function redactJsonValue<T>(value: T): T {
  if (typeof value === 'string') {
    return (redactText(value) || value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactJsonValue(entryValue)]),
    ) as T;
  }

  return value;
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
