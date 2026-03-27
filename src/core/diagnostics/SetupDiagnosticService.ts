import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { DiscoveryStatusPayload } from '../../backends/cli/discovery/wslDiscovery.js';
import { createDiscoveryStatusPayload } from '../../backends/cli/discovery/wslDiscovery.js';
import { RUNTIME_SERVICE_NAME, RUNTIME_VERSION, type RuntimeStartupState } from '../../startup.js';
import {
  getRuntimeConfigEnv,
  getRuntimeListenerConfig,
  getRuntimeResolvedPaths,
  type RuntimeConfig,
} from '../config.js';
import { inspectRuntimeConfig, type ConfigInspection } from '../configInspection.js';
import {
  listProviderCatalog,
  type ProviderCatalogEntry,
} from '../providerCatalog.js';
import {
  createCompatibilityEvidenceService,
  type CompatibilityEvidenceLatestArtifactReadModel,
} from '../compatibility/compatibilityEvidenceReadModel.js';
import { createProviderEvolutionProbeService } from '../compatibility/providerEvolutionReadModel.js';
import type { ProviderEvolutionProbeArtifactSummary } from '../compatibility/providerEvolutionProbe.js';
import type {
  BootstrapScanResult,
  ProviderUniverseEntry,
  SetupState,
} from '../bootstrap/BootstrapService.js';

const DEFAULT_REPORT_RETENTION_LIMIT = 5;
const DEFAULT_COMPATIBILITY_EVIDENCE_REFERENCE_LIMIT = 3;
const DEFAULT_PROVIDER_EVOLUTION_REFERENCE_LIMIT = 3;
const REPORT_FILE_PREFIX = 'setup-report-';
const REPORT_FILE_SUFFIX = '.json';
const COMMAND_LOOKUP_TIMEOUT_MS = 2_000;
const VERSION_LOOKUP_TIMEOUT_MS = 2_000;

export interface SetupDiagnosticIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export interface SetupDiagnosticProviderEvolutionReference {
  artifactId: string;
  provider: string;
  instance: string;
  parserId: string;
  probeProfile: string;
  transport: string;
  capturedAt: string;
  relativePath: string;
  review: Pick<ProviderEvolutionProbeArtifactSummary['review'], 'classifications' | 'summary'>;
}

export interface SetupDiagnosticCompatibilityEvidenceReference extends
  CompatibilityEvidenceLatestArtifactReadModel {
  provider: string;
  instance: string;
}

export interface SetupDiagnosticReport {
  service: typeof RUNTIME_SERVICE_NAME;
  version: string;
  generatedAt: string;
  artifactId: string;
  summary: {
    status: 'ok' | 'degraded' | 'unavailable';
    issueCounts: {
      info: number;
      warnings: number;
      errors: number;
    };
    headline: string;
    highlights: string[];
  };
  platform: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    cwd: string;
  };
  runtime: {
    startup?: {
      phase: RuntimeStartupState['phase'];
      ready: boolean;
      bootstrapRequired: boolean;
    };
    listener: {
      host: string;
      port: number;
    };
    paths: {
      configPath: string | null;
      dataDir: string;
      sessionBaseDir: string;
      diagnosticsDir: string;
      compatibilityEvidenceDir: string;
    };
    pathChecks: {
      dataDirWritable: boolean;
      diagnosticsDirWritable: boolean;
      configPathExists: boolean;
    };
  };
  config: {
    inspection: ConfigInspection;
    loadError?: string;
    port: {
      status: 'available' | 'active_listener' | 'in_use' | 'ephemeral' | 'probe_failed';
      message: string;
    };
  };
  discovery: DiscoveryStatusPayload;
  dependencies: {
    git: {
      available: boolean;
      resolvedPath?: string;
      version?: string | null;
      timedOut?: boolean;
    };
    compatibilityEvidence: {
      directory: string;
      fileCount: number;
    };
  };
  setup: {
    state: SetupState | null;
    providerUniverse: Array<Pick<ProviderUniverseEntry, 'provider' | 'familyLabel' | 'binaryName'>>;
    configured: {
      providers: number;
      targets: number;
      defaultTargets: number;
    };
    scan: {
      source: 'existing' | 'refreshed' | 'missing' | 'refresh_failed';
      latest: BootstrapScanResult | null;
      manual: BootstrapScanResult | null;
    };
  };
  references: {
    latestScanPath: string;
    latestManualScanPath: string;
    compatibilityEvidenceDir: string;
    compatibilityEvidenceArtifacts: SetupDiagnosticCompatibilityEvidenceReference[];
    providerEvolutionArtifacts: SetupDiagnosticProviderEvolutionReference[];
  };
  issues: SetupDiagnosticIssue[];
}

export interface SetupDiagnosticArtifact {
  artifactPath: string;
  report: SetupDiagnosticReport;
}

export interface SetupDiagnosticArtifactSummary {
  artifactId: string;
  artifactPath: string;
  generatedAt: string;
  summary: SetupDiagnosticReport['summary'];
}

export interface SetupDiagnosticServiceOptions {
  config: RuntimeConfig;
  startup?: RuntimeStartupState;
  bootstrapService?: SetupDiagnosticBootstrapService;
  configLoadError?: string;
  retentionLimit?: number;
  now?: () => Date;
}

export interface SetupDiagnosticBootstrapService {
  getProviderUniverse(): ProviderUniverseEntry[];
  getSetupState(): Promise<SetupState>;
  getLatestScan(): Promise<BootstrapScanResult | null>;
  getLatestManualScan(): Promise<BootstrapScanResult | null>;
  scan(options?: { manual?: boolean }): Promise<BootstrapScanResult>;
}

interface WritableCheckResult {
  writable: boolean;
  message?: string;
}

interface PortCheckResult {
  status: SetupDiagnosticReport['config']['port']['status'];
  message: string;
}

interface CommandLookupResult {
  available: boolean;
  resolvedPath?: string;
  timedOut: boolean;
}

export class SetupDiagnosticService {
  private readonly config: RuntimeConfig;
  private readonly startup?: RuntimeStartupState;
  private readonly bootstrapService?: SetupDiagnosticBootstrapService;
  private readonly configLoadError?: string;
  private readonly retentionLimit: number;
  private readonly now: () => Date;

  constructor(options: SetupDiagnosticServiceOptions) {
    this.config = options.config;
    this.startup = options.startup;
    this.bootstrapService = options.bootstrapService;
    this.configLoadError = options.configLoadError;
    this.retentionLimit = Math.max(
      1,
      Math.trunc(options.retentionLimit ?? DEFAULT_REPORT_RETENTION_LIMIT),
    );
    this.now = options.now ?? (() => new Date());
  }

  async generateReport(options: { refreshScan?: boolean } = {}): Promise<SetupDiagnosticArtifact> {
    const generatedAt = this.now().toISOString();
    const artifactId = `${REPORT_FILE_PREFIX}${toTimestampFileFragment(generatedAt)}`;
    const paths = getRuntimeResolvedPaths(this.config);
    const diagnosticsDir = join(paths.dataDir, 'diagnostics');
    const artifactPath = join(diagnosticsDir, `${artifactId}${REPORT_FILE_SUFFIX}`);
    const env = getRuntimeConfigEnv(this.config);
    const inspection = inspectRuntimeConfig(env);
    const listener = getRuntimeListenerConfig(this.config);
    const discovery = createDiscoveryStatusPayload(this.config);
    const catalog = listProviderCatalog(this.config);
    const issues: SetupDiagnosticIssue[] = [];

    const dataDirWritable = checkWritableDirectory(paths.dataDir);
    const diagnosticsDirWritable = checkWritableDirectory(diagnosticsDir);
    const port = await checkPortAvailability(listener.host, listener.port, this.startup);
    const git = await inspectGit();
    const evidenceFileCount = countJsonArtifacts(paths.compatibilityEvidenceDir);
    const compatibilityEvidenceArtifacts = await listCompatibilityEvidenceReferences(this.config);
    const providerEvolutionArtifacts = await listProviderEvolutionReferences(this.config);

    let scanSource: SetupDiagnosticReport['setup']['scan']['source'] = 'missing';
    let state: SetupState | null = null;
    let latestScan: BootstrapScanResult | null = null;
    let latestManualScan: BootstrapScanResult | null = null;
    let refreshError: unknown;

    if (this.bootstrapService) {
      if (options.refreshScan) {
        try {
          latestScan = await this.bootstrapService.scan({ manual: true });
          scanSource = 'refreshed';
        } catch (error) {
          refreshError = error;
          scanSource = 'refresh_failed';
        }
      }

      state = await this.bootstrapService.getSetupState();
      latestScan = latestScan ?? await this.bootstrapService.getLatestScan();
      latestManualScan = await this.bootstrapService.getLatestManualScan();
      if (!options.refreshScan && latestScan) {
        scanSource = 'existing';
      }
    }

    appendPathIssues(issues, inspection, dataDirWritable, diagnosticsDirWritable, port, this.startup);
    appendConfigLoadIssues(issues, this.configLoadError, inspection.configPath);
    appendDiscoveryIssues(issues, discovery);
    appendGitIssues(issues, git);
    appendScanIssues(issues, latestScan, scanSource, refreshError);
    if (!this.bootstrapService) {
      issues.push({
        code: 'setup_substrate_unavailable',
        severity: 'warning',
        message: 'Bootstrap setup services are unavailable, so the report could not include setup-state or scan snapshots.',
      });
    }

    const providerUniverse = this.bootstrapService
      ? this.bootstrapService.getProviderUniverse().map((entry) => ({
          provider: entry.provider,
          familyLabel: entry.familyLabel,
          binaryName: entry.binaryName,
        }))
      : [];

    const report: SetupDiagnosticReport = redactReport({
      service: RUNTIME_SERVICE_NAME,
      version: RUNTIME_VERSION,
      generatedAt,
      artifactId,
      summary: summarizeIssues(issues),
      platform: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: process.cwd(),
      },
      runtime: {
        ...(this.startup
          ? {
              startup: {
                phase: this.startup.phase,
                ready: this.startup.ready,
                bootstrapRequired: this.startup.bootstrapRequired,
              },
            }
          : {}),
        listener,
        paths: {
          configPath: paths.configPath,
          dataDir: paths.dataDir,
          sessionBaseDir: paths.sessionBaseDir,
          diagnosticsDir,
          compatibilityEvidenceDir: paths.compatibilityEvidenceDir,
        },
        pathChecks: {
          dataDirWritable: dataDirWritable.writable,
          diagnosticsDirWritable: diagnosticsDirWritable.writable,
          configPathExists: inspection.fileExists,
        },
      },
      config: {
        inspection,
        ...(this.configLoadError ? { loadError: this.configLoadError } : {}),
        port,
      },
      discovery,
      dependencies: {
        git: {
          available: git.available,
          ...(git.resolvedPath ? { resolvedPath: git.resolvedPath } : {}),
          ...(git.version !== undefined ? { version: git.version } : {}),
          ...(git.timedOut ? { timedOut: true } : {}),
        },
        compatibilityEvidence: {
          directory: paths.compatibilityEvidenceDir,
          fileCount: evidenceFileCount,
        },
      },
      setup: {
        state,
        providerUniverse,
        configured: summarizeConfiguredTargets(catalog),
        scan: {
          source: scanSource,
          latest: latestScan,
          manual: latestManualScan,
        },
      },
      references: {
        latestScanPath: join(paths.dataDir, 'setup', 'provider-scan.json'),
        latestManualScanPath: join(paths.dataDir, 'setup', 'provider-manual-scan.json'),
        compatibilityEvidenceDir: paths.compatibilityEvidenceDir,
        compatibilityEvidenceArtifacts,
        providerEvolutionArtifacts,
      },
      issues,
    }, env);

    mkdirSync(diagnosticsDir, { recursive: true });
    writeFileSync(artifactPath, JSON.stringify(report, null, 2), 'utf8');
    this.enforceRetention(diagnosticsDir);

    return {
      artifactPath,
      report,
    };
  }

  readLatestReport(): SetupDiagnosticArtifact | null {
    const diagnosticsDir = join(getRuntimeResolvedPaths(this.config).dataDir, 'diagnostics');
    const latestPath = this.resolveLatestReportPath(diagnosticsDir);
    if (!latestPath) {
      return null;
    }

    return readReportArtifact(latestPath);
  }

  readReport(artifactId: string): SetupDiagnosticArtifact | null {
    const diagnosticsDir = join(getRuntimeResolvedPaths(this.config).dataDir, 'diagnostics');
    const artifactPath = this.resolveReportPath(diagnosticsDir, artifactId);
    if (!artifactPath) {
      return null;
    }

    return readReportArtifact(artifactPath);
  }

  listReports(options: { limit?: number } = {}): SetupDiagnosticArtifactSummary[] {
    const diagnosticsDir = join(getRuntimeResolvedPaths(this.config).dataDir, 'diagnostics');
    const limit = normalizeReportListLimit(options.limit, this.retentionLimit);
    return listReportPaths(diagnosticsDir)
      .slice(0, limit)
      .map((artifactPath) => summarizeReportArtifact(artifactPath));
  }

  private enforceRetention(diagnosticsDir: string): void {
    const reportPaths = listReportPaths(diagnosticsDir);
    for (const stalePath of reportPaths.slice(this.retentionLimit)) {
      rmSync(stalePath, { force: true });
    }
  }

  private resolveLatestReportPath(diagnosticsDir: string): string | null {
    return listReportPaths(diagnosticsDir)[0] || null;
  }

  private resolveReportPath(diagnosticsDir: string, artifactId: string): string | null {
    if (!isValidReportArtifactId(artifactId)) {
      return null;
    }

    const artifactPath = join(diagnosticsDir, `${artifactId}${REPORT_FILE_SUFFIX}`);
    return existsSync(artifactPath) ? artifactPath : null;
  }
}

function appendConfigLoadIssues(
  issues: SetupDiagnosticIssue[],
  configLoadError: string | undefined,
  configPath: string,
): void {
  if (!configLoadError) {
    return;
  }

  issues.push({
    code: 'config_load_error',
    severity: 'error',
    message: configLoadError,
    details: {
      configPath,
    },
  });
}

function appendPathIssues(
  issues: SetupDiagnosticIssue[],
  inspection: ConfigInspection,
  dataDirWritable: WritableCheckResult,
  diagnosticsDirWritable: WritableCheckResult,
  port: PortCheckResult,
  startup?: RuntimeStartupState,
): void {
  if (startup?.bootstrapRequired) {
    issues.push({
      code: 'bootstrap_required',
      severity: 'warning',
      message: 'Runtime is in bootstrap mode and still requires provider setup before normal execution.',
    });
  }

  if (!inspection.fileExists) {
    issues.push({
      code: 'config_missing',
      severity: 'warning',
      message: 'Runtime config file is missing.',
      details: {
        configPath: inspection.configPath,
      },
    });
  } else if (inspection.parseError) {
    issues.push({
      code: 'config_parse_error',
      severity: 'error',
      message: inspection.parseError,
      details: {
        configPath: inspection.configPath,
      },
    });
  } else if (!inspection.hasUsableTargets) {
    issues.push({
      code: 'config_no_usable_targets',
      severity: 'warning',
      message: 'Runtime config exists but does not currently enable any usable provider targets.',
      details: {
        configPath: inspection.configPath,
      },
    });
  }

  if (!dataDirWritable.writable) {
    issues.push({
      code: 'data_dir_unwritable',
      severity: 'error',
      message: dataDirWritable.message || 'Runtime data directory is not writable.',
    });
  }

  if (!diagnosticsDirWritable.writable) {
    issues.push({
      code: 'diagnostics_dir_unwritable',
      severity: 'error',
      message: diagnosticsDirWritable.message || 'Runtime diagnostics directory is not writable.',
    });
  }

  if (port.status === 'in_use' || port.status === 'probe_failed') {
    issues.push({
      code: 'listener_port_unavailable',
      severity: 'error',
      message: port.message,
    });
  }
}

function appendDiscoveryIssues(
  issues: SetupDiagnosticIssue[],
  discovery: DiscoveryStatusPayload,
): void {
  if (discovery.wsl.summary.state === 'failed') {
    issues.push({
      code: 'wsl_discovery_failed',
      severity: 'warning',
      message: discovery.wsl.summary.message,
    });
  }
}

function appendGitIssues(
  issues: SetupDiagnosticIssue[],
  git: CommandLookupResult & { version?: string | null },
): void {
  if (!git.available) {
    issues.push({
      code: 'git_unavailable',
      severity: 'warning',
      message: git.timedOut
        ? 'Timed out while checking Git availability.'
        : 'Git is not currently available on PATH.',
    });
  }
}

function appendScanIssues(
  issues: SetupDiagnosticIssue[],
  latestScan: BootstrapScanResult | null,
  scanSource: SetupDiagnosticReport['setup']['scan']['source'],
  refreshError: unknown,
): void {
  if (scanSource === 'refresh_failed') {
    issues.push({
      code: 'setup_scan_refresh_failed',
      severity: 'warning',
      message: refreshError instanceof Error ? refreshError.message : String(refreshError),
    });
  }

  if (!latestScan) {
    issues.push({
      code: 'setup_scan_missing',
      severity: 'warning',
      message: 'No setup scan snapshot is currently available.',
    });
    return;
  }

  const availableCount = latestScan.providers.filter((provider) => provider.available).length;
  if (availableCount === 0) {
    issues.push({
      code: 'provider_scan_all_unavailable',
      severity: 'error',
      message: 'The latest setup scan did not find any ready providers.',
    });
  }

  for (const provider of latestScan.providers.filter((entry) => !entry.available)) {
    issues.push({
      code: 'provider_scan_unavailable',
      severity: 'warning',
      message: `${provider.provider} is not ready in the latest setup scan.`,
      details: {
        provider: provider.provider,
        commandStatus: provider.commandStatus,
        authStatus: provider.authStatus,
      },
    });
  }
}

function summarizeIssues(
  issues: SetupDiagnosticIssue[],
): SetupDiagnosticReport['summary'] {
  const counts = issues.reduce(
    (summary, issue) => {
      if (issue.severity === 'info') {
        summary.info += 1;
      } else if (issue.severity === 'warning') {
        summary.warnings += 1;
      } else {
        summary.errors += 1;
      }
      return summary;
    },
    {
      info: 0,
      warnings: 0,
      errors: 0,
    },
  );
  const status = counts.errors > 0 ? 'unavailable' : counts.warnings > 0 ? 'degraded' : 'ok';
  const headline = status === 'ok'
    ? 'No setup issues detected.'
    : counts.errors > 0
      ? `Setup report found ${counts.errors} error(s) and ${counts.warnings} warning(s).`
      : `Setup report found ${counts.warnings} warning(s).`;
  const highlights = issues
    .filter((issue) => issue.severity !== 'info')
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, 3)
    .map((issue) => issue.message);

  return {
    status,
    issueCounts: counts,
    headline,
    highlights,
  };
}

function severityRank(severity: SetupDiagnosticIssue['severity']): number {
  switch (severity) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

function summarizeConfiguredTargets(
  catalog: Record<string, ProviderCatalogEntry>,
): SetupDiagnosticReport['setup']['configured'] {
  const targets = Object.values(catalog).flatMap((entry) => entry.instances);
  return {
    providers: Object.keys(catalog).length,
    targets: targets.length,
    defaultTargets: targets.filter((target) => target.defaultTarget).length,
  };
}

function redactReport(
  report: SetupDiagnosticReport,
  env: Readonly<NodeJS.ProcessEnv>,
): SetupDiagnosticReport {
  return redactValue(report, env) as SetupDiagnosticReport;
}

function redactValue(
  value: unknown,
  env: Readonly<NodeJS.ProcessEnv>,
): unknown {
  if (typeof value === 'string') {
    return redactText(value, env);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, env));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactValue(entryValue, env)]),
    );
  }

  return value;
}

function redactText(
  value: string,
  env: Readonly<NodeJS.ProcessEnv>,
): string {
  const home = env.HOME || env.USERPROFILE;
  let output = value;

  if (home) {
    const escapedUnixHome = escapeRegExp(home.replace(/\\/g, '/'));
    const escapedWindowsHome = escapeRegExp(home.replace(/\//g, '\\'));
    output = output.replace(new RegExp(escapedUnixHome, 'gi'), '<home>');
    output = output.replace(new RegExp(escapedWindowsHome, 'gi'), '<home>');
  }

  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+\-/=]+\b/gi, 'Bearer <redacted>');
  output = output.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*)\s*[:=]\s*([^\s,"']+)/gi, '$1=<redacted>');

  return output;
}

function checkWritableDirectory(pathValue: string): WritableCheckResult {
  try {
    mkdirSync(pathValue, { recursive: true });
    const markerPath = join(pathValue, `.write-check-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(markerPath, 'ok', 'utf8');
    rmSync(markerPath, { force: true });
    return {
      writable: true,
    };
  } catch (error) {
    return {
      writable: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkPortAvailability(
  host: string,
  port: number,
  startup?: RuntimeStartupState,
): Promise<PortCheckResult> {
  if (port === 0) {
    return {
      status: 'ephemeral',
      message: 'Runtime listener uses an ephemeral port, so no fixed port conflict applies.',
    };
  }

  if (
    startup?.phase === 'ready'
    && startup.address?.port === port
    && (startup.address.host === host || host === '0.0.0.0' || host === '::')
  ) {
    return {
      status: 'active_listener',
      message: 'Configured listener port is already held by this running runtime instance.',
    };
  }

  return new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolvePort({
        status: error.code === 'EADDRINUSE' ? 'in_use' : 'probe_failed',
        message: error.code === 'EADDRINUSE'
          ? `Configured listener port ${port} is already in use.`
          : error.message,
      });
    });
    server.listen(port, host, () => {
      server.close(() => {
        resolvePort({
          status: 'available',
          message: `Configured listener port ${port} is available.`,
        });
      });
    });
  });
}

async function inspectGit(): Promise<CommandLookupResult & { version?: string | null }> {
  const command = await lookupCommand('git');
  if (!command.available || !command.resolvedPath) {
    return {
      ...command,
      version: null,
    };
  }

  const version = await readCommandVersion(command.resolvedPath, ['--version']);
  return {
    ...command,
    version,
  };
}

async function lookupCommand(command: string): Promise<CommandLookupResult> {
  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runCommand(lookupCommand, [command], COMMAND_LOOKUP_TIMEOUT_MS);
  const resolvedPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return {
    available: result.code === 0 && Boolean(resolvedPath),
    resolvedPath,
    timedOut: result.timedOut,
  };
}

async function readCommandVersion(command: string, args: string[]): Promise<string | null> {
  const result = await runCommand(command, args, VERSION_LOOKUP_TIMEOUT_MS);
  if (result.code !== 0 && !result.stdout && !result.stderr) {
    return null;
  }

  const line = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line || null;
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (result: { code: number | null; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveCommand(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Ignore cleanup failures and surface the timeout.
      }
      finish({
        code: null,
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      finish({
        code: null,
        stdout,
        stderr: error.message,
        timedOut,
      });
    });
    child.once('close', (code) => {
      finish({
        code,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function countJsonArtifacts(pathValue: string): number {
  if (!existsSync(pathValue)) {
    return 0;
  }

  return readdirSync(pathValue).filter((entry) => entry.endsWith('.json')).length;
}

async function listProviderEvolutionReferences(
  config: Pick<RuntimeConfig, 'configPath' | 'dataDir' | 'sessionBaseDir'>,
): Promise<SetupDiagnosticProviderEvolutionReference[]> {
  try {
    return (await createProviderEvolutionProbeService(config)
      .listArtifacts({
        limit: DEFAULT_PROVIDER_EVOLUTION_REFERENCE_LIMIT,
      }))
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        provider: artifact.provider,
        instance: artifact.instance,
        parserId: artifact.parserId,
        probeProfile: artifact.probeProfile,
        transport: artifact.transport,
        capturedAt: artifact.capturedAt,
        relativePath: artifact.relativePath,
        review: {
          classifications: [...artifact.review.classifications],
          summary: artifact.review.summary,
        },
      }));
  } catch {
    return [];
  }
}

async function listCompatibilityEvidenceReferences(
  config: Pick<RuntimeConfig, 'configPath' | 'dataDir' | 'sessionBaseDir'>,
): Promise<SetupDiagnosticCompatibilityEvidenceReference[]> {
  try {
    return (await createCompatibilityEvidenceService(config)
      .listArtifacts({
        limit: DEFAULT_COMPATIBILITY_EVIDENCE_REFERENCE_LIMIT,
      }))
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        provider: artifact.provider,
        instance: artifact.instance,
        classification: artifact.classification,
        summary: artifact.summary,
        capturedAt: artifact.capturedAt,
        parserId: artifact.parserId,
        profileId: artifact.profileId,
        relativePath: artifact.relativePath,
      }));
  } catch {
    return [];
  }
}

function listReportPaths(diagnosticsDir: string): string[] {
  if (!existsSync(diagnosticsDir)) {
    return [];
  }

  return readdirSync(diagnosticsDir)
    .filter((entry) => entry.startsWith(REPORT_FILE_PREFIX) && entry.endsWith(REPORT_FILE_SUFFIX))
    .map((entry) => join(diagnosticsDir, entry))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function readReportArtifact(artifactPath: string): SetupDiagnosticArtifact {
  const report = JSON.parse(readFileSync(artifactPath, 'utf8')) as SetupDiagnosticReport;
  return {
    artifactPath,
    report,
  };
}

function summarizeReportArtifact(artifactPath: string): SetupDiagnosticArtifactSummary {
  const artifact = readReportArtifact(artifactPath);
  return {
    artifactId: artifact.report.artifactId,
    artifactPath,
    generatedAt: artifact.report.generatedAt,
    summary: artifact.report.summary,
  };
}

function isValidReportArtifactId(value: string): boolean {
  return /^setup-report-[A-Za-z0-9_-]+$/.test(value);
}

function normalizeReportListLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function toTimestampFileFragment(value: string): string {
  return value.replace(/[:.]/g, '-');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
