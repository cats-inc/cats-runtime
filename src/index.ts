#!/usr/bin/env node

import { isDirectCliEntrypoint } from './core/cliEntrypoint.js';
import { loadDotEnv } from './core/dotenv.js';
import { loadConfig } from './core/config.js';
import {
  cleanupStaleRuntimeTempDirs,
  DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_HOURS,
  formatRuntimeTempCleanupSummary,
} from './core/runtimeTempDirs.js';
import {
  formatCompatibilityEvidenceArtifactListSummary,
  formatCompatibilityEvidenceArtifactReadSummary,
  listCompatibilityEvidenceArtifacts,
  readCompatibilityEvidenceArtifact,
} from './core/compatibility/compatibilityEvidenceEntry.js';
import {
  formatProviderEvolutionProbeArtifactListSummary,
  formatProviderEvolutionProbeArtifactReadSummary,
  formatProviderEvolutionProbeArtifactReviewSummary,
  formatProviderEvolutionProbeSummary,
  generateProviderEvolutionProbeArtifact,
  listProviderEvolutionProbeArtifacts,
  readProviderEvolutionProbeArtifact,
  reviewProviderEvolutionProbeArtifact,
} from './core/compatibility/providerEvolutionEntry.js';
import {
  formatSetupDiagnosticReportListSummary,
  formatSetupDiagnosticReportReadSummary,
  formatSetupDiagnosticEntrySummary,
  generateSetupDiagnosticEntryArtifact,
  listSetupDiagnosticEntryReports,
  readSetupDiagnosticEntryReport,
} from './core/diagnostics/setupDiagnosticEntry.js';
import { inspectRuntimeConfig, shouldEnterBootstrapMode } from './core/configInspection.js';
import { createRuntimeServer } from './server.js';
import {
  applyRuntimeCliEnvOverrides,
  createRuntimeStartupState,
  formatRuntimeReadyMessage,
  formatRuntimeStoppedMessage,
  formatRuntimeStoppingMessage,
  formatRuntimeStartupError,
  getRuntimeHelpText,
  markRuntimeStopping,
  parseRuntimeCliOptions,
  resolveRuntimeStartupState,
  validateRuntimeServerStartupState,
  type RuntimeShutdownReason,
} from './startup.js';

export { loadConfig } from './core/config.js';
export { createRuntimeServer } from './server.js';
export { createRuntimeApp } from './http/app.js';

let startup = createRuntimeStartupState();

function resolveCleanupTempAgeHours(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_HOURS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --cleanup-temp-age-hours value '${raw}'`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const cliOptions = parseRuntimeCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    process.stdout.write(`${getRuntimeHelpText()}\n`);
    return;
  }

  if (cliOptions.cleanupTempDirs) {
    const maxAgeHours = resolveCleanupTempAgeHours(cliOptions.cleanupTempAgeHours);
    const summary = await cleanupStaleRuntimeTempDirs({
      maxAgeMs: maxAgeHours * 60 * 60 * 1000,
    });
    process.stderr.write(formatRuntimeTempCleanupSummary(summary));
    process.stdout.write(`${JSON.stringify({
      status: 'cleaned',
      maxAgeHours,
      summary,
    })}\n`);
    return;
  }

  loadDotEnv();
  applyRuntimeCliEnvOverrides(cliOptions, process.env);

  if (cliOptions.diagnoseSetup) {
    const result = await generateSetupDiagnosticEntryArtifact(cliOptions, process.env);
    process.stderr.write(formatSetupDiagnosticEntrySummary(result));
    process.stdout.write(`${JSON.stringify({
      status: 'generated',
      artifactPath: result.artifactPath,
      report: result.report,
    })}\n`);
    return;
  }

  if (cliOptions.listSetupDiagnosticReports) {
    const artifacts = listSetupDiagnosticEntryReports(cliOptions, process.env);
    process.stderr.write(formatSetupDiagnosticReportListSummary(artifacts));
    process.stdout.write(`${JSON.stringify({
      status: 'listed',
      count: artifacts.length,
      artifacts,
    })}\n`);
    return;
  }

  if (cliOptions.readSetupDiagnosticReport) {
    const artifact = readSetupDiagnosticEntryReport(cliOptions, process.env);
    if (!artifact) {
      throw new Error(
        `Setup diagnostic report '${cliOptions.readSetupDiagnosticReport}' was not found.`,
      );
    }
    process.stderr.write(formatSetupDiagnosticReportReadSummary(artifact));
    process.stdout.write(`${JSON.stringify({
      status: 'loaded',
      artifactPath: artifact.artifactPath,
      report: artifact.report,
    })}\n`);
    return;
  }

  if (cliOptions.listCompatibilityEvidence) {
    const artifacts = await listCompatibilityEvidenceArtifacts(cliOptions, process.env);
    process.stderr.write(formatCompatibilityEvidenceArtifactListSummary(artifacts, cliOptions));
    process.stdout.write(`${JSON.stringify({
      status: 'listed',
      count: artifacts.length,
      artifacts,
    })}\n`);
    return;
  }

  if (cliOptions.readCompatibilityEvidence) {
    const artifact = await readCompatibilityEvidenceArtifact(cliOptions, process.env);
    process.stderr.write(formatCompatibilityEvidenceArtifactReadSummary(artifact));
    process.stdout.write(`${JSON.stringify({
      status: 'loaded',
      artifactPath: artifact.artifactPath,
      artifact: artifact.artifact,
    })}\n`);
    return;
  }

  if (cliOptions.probeProviderEvolution) {
    const result = await generateProviderEvolutionProbeArtifact(cliOptions, process.env);
    process.stderr.write(formatProviderEvolutionProbeSummary(result));
    process.stdout.write(`${JSON.stringify({
      status: 'generated',
      artifactPath: result.artifactPath,
      artifact: result.artifact,
    })}\n`);
    return;
  }

  if (cliOptions.listProviderEvolutionArtifacts) {
    const artifacts = await listProviderEvolutionProbeArtifacts(cliOptions, process.env);
    process.stderr.write(formatProviderEvolutionProbeArtifactListSummary(artifacts, cliOptions));
    process.stdout.write(`${JSON.stringify({
      status: 'listed',
      count: artifacts.length,
      artifacts,
    })}\n`);
    return;
  }

  if (cliOptions.readProviderEvolutionArtifact) {
    const result = await readProviderEvolutionProbeArtifact(cliOptions, process.env);
    process.stderr.write(formatProviderEvolutionProbeArtifactReadSummary(result));
    process.stdout.write(`${JSON.stringify({
      status: 'loaded',
      artifactPath: result.artifactPath,
      artifact: result.artifact,
    })}\n`);
    return;
  }

  if (cliOptions.reviewProviderEvolutionArtifact) {
    const result = await reviewProviderEvolutionProbeArtifact(cliOptions, process.env);
    process.stderr.write(formatProviderEvolutionProbeArtifactReviewSummary(result));
    process.stdout.write(`${JSON.stringify({
      status: 'reviewed',
      artifactPath: result.artifactPath,
      artifact: result.artifact,
    })}\n`);
    return;
  }

  startup = resolveRuntimeStartupState(cliOptions, process.env);
  validateRuntimeServerStartupState(cliOptions, process.env, startup);

  const inspection = inspectRuntimeConfig(process.env);
  if (shouldEnterBootstrapMode(inspection, cliOptions.bootstrap === true)) {
    startup.bootstrapRequired = true;
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    // Semantically invalid config (e.g. provider in multiple backends without
    // disambiguation) — enter bootstrap mode instead of crashing.
    if (!startup.bootstrapRequired) {
      startup.bootstrapRequired = true;
      process.stderr.write(
        `Config error: ${error instanceof Error ? error.message : String(error)}\n`
        + 'Entering bootstrap mode for provider setup.\n',
      );
    }
    // Retry in an explicit env-derived mode that ignores any providers.yaml,
    // including the default config path in the current working directory.
    config = loadConfig(process.env, { skipProviderFile: true });
  }
  const runtime = createRuntimeServer(config, { startup });
  let shutdownPromise: Promise<void> | null = null;

  const writeLifecycle = (line: string | null) => {
    if (line) {
      process.stdout.write(line);
    }
  };

  const shutdown = (reason: RuntimeShutdownReason): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    markRuntimeStopping(startup, reason);
    writeLifecycle(formatRuntimeStoppingMessage(startup, reason));

    shutdownPromise = runtime.close()
      .then(() => {
        writeLifecycle(formatRuntimeStoppedMessage(startup, reason));
      })
      .catch((error) => {
        process.stderr.write(
          `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      })
      .finally(() => {
        process.exit(process.exitCode ?? 0);
      });

    return shutdownPromise;
  };

  const requestShutdown = (reason: RuntimeShutdownReason) => {
    void shutdown(reason);
  };

  process.on('SIGINT', () => {
    requestShutdown('sigint');
  });
  process.on('SIGTERM', () => {
    requestShutdown('sigterm');
  });

  if (startup.mode === 'app-managed' && process.stdin.readable && !process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on('end', () => {
      requestShutdown('stdin_closed');
    });
  }

  const address = await runtime.start();
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  const readyMessage = formatRuntimeReadyMessage(startup, {
    host: address.host,
    port: address.port,
    healthUrl: `http://${address.host}:${address.port}/health`,
  });
  writeLifecycle(readyMessage);

  if (startup.bootstrapRequired) {
    process.stdout.write(
      `cats-runtime is in bootstrap mode. Open http://${address.host}:${address.port}/ to set up providers.\n`,
    );
  }
}

if (isDirectCliEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(formatRuntimeStartupError(startup, error));
    process.exitCode = 1;
    process.exit(1);
  });
}
