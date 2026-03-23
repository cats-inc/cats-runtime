import type { ProviderRuntimeConfig } from '../../backends/cli/config.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';

export type ProviderExecutionPlatform = 'windows' | 'macos' | 'linux';
export type ProviderInstallPack = 'native-cli' | 'npm-global';
export type ProviderInstallMethod = 'native_installer' | 'npm_global';
export type ProviderCommandStatus =
  | 'ready'
  | 'missing_install'
  | 'missing_path'
  | 'misconfigured_command'
  | 'probe_failed';
export type ProviderAuthStatus = 'not_required' | 'missing' | 'unknown';
export type ProviderVersionStatus = 'ready' | 'unsupported' | 'unknown';
export type ProviderPrerequisiteStatus = 'ready' | 'missing' | 'unknown';
export type ProviderPathPersistenceStatus = 'ready' | 'missing' | 'unknown' | 'not_applicable';
export type ProviderNpmConfigStatus = 'ready' | 'missing_prefix' | 'unknown' | 'not_applicable';
export type ProviderRemediationCode =
  | 'install_provider'
  | 'install_prerequisite'
  | 'fix_path'
  | 'persist_path'
  | 'update_provider_command'
  | 'authenticate_provider'
  | 'configure_npm_prefix'
  | 'upgrade_provider'
  | 'review_probe_failure'
  | 'switch_runtime';

export interface ProviderPrerequisiteMetadata {
  id: string;
  label: string;
  command: string;
  summary: string;
}

export interface ProviderPathHint {
  expectedPath?: string;
  directoryHint?: string;
  exportCommand?: string;
  reloadHint?: string;
  shellRcPath?: string;
  persistenceEntry?: string;
}

export interface ProviderPlatformInstallMetadata {
  supported: boolean;
  installerId: string;
  method: ProviderInstallMethod;
  command?: string;
  docsUrl?: string;
  prerequisites?: string[];
  needsAdmin?: boolean;
  requiresShellRestart?: boolean;
  mayRequireRestart?: boolean;
  notes?: string[];
}

export interface ProviderAuthMetadata {
  requiredAfterInstall: boolean;
  envVars?: string[];
  interactive?: boolean;
  docsUrl?: string;
  hint: string;
  errorPatterns?: string[];
}

export interface ProviderCheckMetadata {
  versionArgs?: string[];
  helpArgs?: string[];
  expectedPaths?: Partial<Record<ProviderExecutionPlatform, string>>;
  pathHints?: Partial<Record<ProviderExecutionPlatform, ProviderPathHint>>;
  prerequisites?: Partial<Record<ProviderExecutionPlatform, ProviderPrerequisiteMetadata[]>>;
  npmPackage?: string;
  npmExpectedPrefix?: Partial<Record<ProviderExecutionPlatform, string>>;
}

export interface ProviderInstallKnowledge {
  provider: ProviderName;
  familyLabel: string;
  installPack: ProviderInstallPack;
  binaryName: string;
  defaultDocsUrl?: string;
  check: ProviderCheckMetadata;
  auth: ProviderAuthMetadata;
  platforms: Record<ProviderExecutionPlatform, ProviderPlatformInstallMetadata>;
}

export interface ProviderInstallCatalogView {
  provider: ProviderName;
  familyLabel: string;
  installPack: ProviderInstallPack;
  executionPlatform: ProviderExecutionPlatform;
  runtime: ProviderRuntimeConfig;
  binaryName: string;
  prerequisites: ProviderPrerequisiteMetadata[];
  install: ProviderPlatformInstallMetadata;
  auth: {
    requiredAfterInstall: boolean;
    envVars: string[];
    docsUrl?: string;
    interactive: boolean;
    hint: string;
  };
  path: ProviderPathHint;
  npm?: {
    packageName: string;
    expectedPrefix?: string;
  };
}

export interface ProviderCommandSummary {
  configuredCommand: string;
  binaryName: string;
  status: ProviderCommandStatus;
  summary: string;
  resolvedCommand?: string;
  expectedPath?: string;
  expectedPathExists?: boolean;
  packageInstalled?: boolean;
}

export interface ProviderAuthSummary {
  requiredAfterInstall: boolean;
  status: ProviderAuthStatus;
  summary: string;
  envVars: string[];
  docsUrl?: string;
}

export interface ProviderVersionSummary {
  status: ProviderVersionStatus;
  summary: string;
  detected?: string;
  supportedRange?: string;
}

export interface ProviderPrerequisiteSummary {
  id: string;
  label: string;
  command: string;
  status: ProviderPrerequisiteStatus;
  summary: string;
  resolvedCommand?: string;
}

export interface ProviderPathPersistenceSummary {
  status: ProviderPathPersistenceStatus;
  summary: string;
  shellRcPath?: string;
  expectedEntry?: string;
  exportCommand?: string;
}

export interface ProviderNpmConfigSummary {
  status: ProviderNpmConfigStatus;
  summary: string;
  packageName?: string;
  expectedPrefix?: string;
  detectedPrefix?: string;
}

export interface ProviderRemediationStep {
  code: ProviderRemediationCode;
  summary: string;
  command?: string;
  docsUrl?: string;
  requiresShellRestart?: boolean;
  mayRequireRestart?: boolean;
}

export interface ProviderSetupSummary {
  familyLabel: string;
  executionPlatform: ProviderExecutionPlatform;
  runtime: ProviderRuntimeConfig;
  install: ProviderInstallCatalogView;
  prerequisites: ProviderPrerequisiteSummary[];
  command: ProviderCommandSummary;
  pathPersistence: ProviderPathPersistenceSummary;
  npm: ProviderNpmConfigSummary;
  auth: ProviderAuthSummary;
  version: ProviderVersionSummary;
  remediation: ProviderRemediationStep[];
}
