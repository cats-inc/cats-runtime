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
  const context = resolveSetupDiagnosticEntryContext(cliOptions, env);
  const service = new SetupDiagnosticService({
    config: context.config,
    startup: context.startup,
    bootstrapService: context.bootstrapService,
    ...(context.configLoadError ? { configLoadError: context.configLoadError } : {}),
  });

  return service.generateReport({
    refreshScan: cliOptions.refreshSetupScan === true,
  });
}
