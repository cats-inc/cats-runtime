import { BootstrapService } from '../bootstrap/BootstrapService.js';
import { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import { getRuntimeResolvedPaths, loadConfig, type RuntimeConfig } from '../config.js';
import { inspectRuntimeConfig, shouldEnterBootstrapMode } from '../configInspection.js';
import {
  resolveRuntimeStartupState,
  type RuntimeCliOptions,
  type RuntimeStartupState,
} from '../../startup.js';
import {
  SetupDiagnosticService,
  type SetupDiagnosticArtifact,
  type SetupDiagnosticArtifactSummary,
} from './SetupDiagnosticService.js';

export interface SetupDiagnosticEntryContext {
  config: RuntimeConfig;
  startup: RuntimeStartupState;
  bootstrapService: BootstrapService;
  compatibility: ProviderCompatibilityService;
  configLoadError?: string;
}

export function resolveSetupDiagnosticEntryContext(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): SetupDiagnosticEntryContext {
  const startup = resolveRuntimeStartupState(cliOptions, env);
  const inspection = inspectRuntimeConfig(env);
  if (shouldEnterBootstrapMode(inspection, cliOptions.bootstrap === true)) {
    startup.bootstrapRequired = true;
  }

  let configLoadError: string | undefined;
  let config: RuntimeConfig;
  try {
    config = loadConfig(env);
  } catch (error) {
    configLoadError = error instanceof Error ? error.message : String(error);
    startup.bootstrapRequired = true;
    config = loadConfig(env, { skipProviderFile: true });
  }

  const compatibility = new ProviderCompatibilityService(config);
  const paths = getRuntimeResolvedPaths(config);
  const bootstrapService = new BootstrapService({
    dataDir: paths.dataDir,
    configPath: config.configPath || inspection.configPath,
    config,
    compatibility,
  });

  return {
    config,
    startup,
    bootstrapService,
    compatibility,
    ...(configLoadError ? { configLoadError } : {}),
  };
}

export async function generateSetupDiagnosticEntryArtifact(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SetupDiagnosticArtifact> {
  const service = createSetupDiagnosticEntryService(cliOptions, env);

  return service.generateReport({
    refreshScan: cliOptions.refreshSetupScan === true,
  });
}

export function listSetupDiagnosticEntryReports(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): SetupDiagnosticArtifactSummary[] {
  const service = createSetupDiagnosticEntryService(cliOptions, env);
  return service.listReports({
    limit: parseOptionalSetupReportLimit(cliOptions.setupReportLimit),
  });
}

export function readSetupDiagnosticEntryReport(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): SetupDiagnosticArtifact | null {
  const artifactId = cliOptions.readSetupDiagnosticReport?.trim();
  if (!artifactId) {
    throw new Error('Missing --read-setup-diagnostic-report value');
  }

  const service = createSetupDiagnosticEntryService(cliOptions, env);
  return service.readReport(artifactId);
}

export function formatSetupDiagnosticEntrySummary(
  artifact: SetupDiagnosticArtifact,
): string {
  const lines = [
    `Setup diagnostic report generated: ${artifact.report.summary.headline}`,
    ...formatSetupRepairSummaryLines(artifact.report),
    ...artifact.report.summary.highlights.map((highlight) => `- ${highlight}`),
    `Artifact: ${artifact.artifactPath}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function formatSetupDiagnosticReportListSummary(
  artifacts: SetupDiagnosticArtifactSummary[],
): string {
  if (artifacts.length === 0) {
    return 'No retained setup diagnostic reports were found.\n';
  }

  const lines = [
    `Listed ${artifacts.length} retained setup diagnostic report(s).`,
    ...artifacts.map((artifact) => (
      `- ${artifact.generatedAt} [${artifact.summary.status}] ${artifact.summary.headline}`
    )),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatSetupDiagnosticReportReadSummary(
  artifact: SetupDiagnosticArtifact,
): string {
  const lines = [
    `Loaded setup diagnostic report ${artifact.report.artifactId}: ${artifact.report.summary.headline}`,
    ...formatSetupRepairSummaryLines(artifact.report),
    ...artifact.report.summary.highlights.map((highlight) => `- ${highlight}`),
    `Artifact: ${artifact.artifactPath}`,
  ];
  return `${lines.join('\n')}\n`;
}

function formatSetupRepairSummaryLines(
  report: SetupDiagnosticArtifact['report'],
): string[] {
  const repair = report.setup?.repair;
  if (!repair) {
    return [];
  }

  const lines = [`Repair: ${repair.summary}`];
  if (repair.nextAction.kind === 'none') {
    return lines;
  }

  lines.push(`Next action: ${repair.nextAction.label} (${repair.nextAction.kind})`);
  if (repair.nextAction.summary) {
    lines.push(`Action summary: ${repair.nextAction.summary}`);
  }
  if (repair.nextAction.method && repair.nextAction.path) {
    lines.push(`Action route: ${repair.nextAction.method} ${repair.nextAction.path}`);
  }

  return lines;
}

function createSetupDiagnosticEntryService(
  cliOptions: RuntimeCliOptions,
  env: NodeJS.ProcessEnv,
): SetupDiagnosticService {
  const context = resolveSetupDiagnosticEntryContext(cliOptions, env);
  return new SetupDiagnosticService({
    config: context.config,
    startup: context.startup,
    bootstrapService: context.bootstrapService,
    ...(context.configLoadError ? { configLoadError: context.configLoadError } : {}),
  });
}

function parseOptionalSetupReportLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --setup-report-limit value '${value}'`);
  }

  return parsed;
}
