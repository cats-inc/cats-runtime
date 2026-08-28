import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import {
  KNOWN_PROVIDERS,
  type ProviderName,
} from '../../backends/cli/providers/types.js';
import type { ProviderRuntimeConfig } from '../../backends/cli/config.js';
import {
  getProviderInstallKnowledge,
  buildProviderInstallCatalogView,
} from '../provider-install/knowledge.js';
import type {
  ProviderInstallCatalogView,
  ProviderRemediationStep,
} from '../provider-install/types.js';
import type { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { RuntimeConfig } from '../config.js';
import { refreshWindowsProcessPath } from './windowsEnvironmentPath.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_CONCURRENCY = 12;

export interface ProviderUniverseEntry {
  provider: ProviderName;
  familyLabel: string;
  binaryName: string;
  install: ProviderInstallCatalogView;
}

export interface ProviderScanEntry {
  provider: ProviderName;
  family: string;
  commandStatus: string;
  commandPath: string | null;
  version: string | null;
  authStatus: string;
  available: boolean;
  install: ProviderInstallCatalogView | null;
  remediation: ProviderRemediationStep[];
}

export interface BootstrapScanResult {
  scannedAt: string;
  scanType: 'auto' | 'manual';
  providers: ProviderScanEntry[];
}

export interface SetupState {
  status: 'pending' | 'scanning' | 'ready' | 'applied' | 'error';
  lastScanAt: string | null;
  lastManualScanAt: string | null;
  appliedAt: string | null;
  appliedConfigPath: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSetupState(): SetupState {
  return {
    status: 'pending',
    lastScanAt: null,
    lastManualScanAt: null,
    appliedAt: null,
    appliedConfigPath: null,
    error: null,
  };
}

function readJsonSafe<T>(path: string): T | null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function buildBootstrapTarget(
  provider: ProviderName,
  commandPath: string,
  runtime: ProviderRuntimeConfig,
): ProviderTargetDescriptor {
  return {
    providerName: provider,
    backend: 'cli',
    instanceId: 'default',
    defaultTarget: true,
    cliInstance: {
      id: 'default',
      providerName: provider,
      commandConfig: {
        path: commandPath,
        runner: 'auto',
        runtime,
      },
    },
  };
}

function buildMinimalProvidersYaml(
  providers: ProviderName[],
  scanResult: BootstrapScanResult | null,
  config: RuntimeConfig,
): string {
  const cliProviders: Record<string, unknown> = {};
  const agentProviders: Record<string, unknown> = {};
  const routingProviders: Record<string, unknown> = {};

  for (const provider of providers) {
    const scanned = scanResult?.providers.find((entry) => entry.provider === provider);
    const commandPath = scanned?.commandPath
      || config.providerCommands[provider]?.path
      || provider;

    // Aider remains visible to setup for install, version, path, and auth
    // evidence, but has no machine-readable execution contract. Do not turn a
    // presence-only provider into a permanently degraded execution target.
    if (provider === 'aider') {
      continue;
    }

    // Devin's CLI surface is still probed by setup for install and version
    // evidence, but it cannot produce the structured events required by the
    // CLI execution backend. Its verified execution surface is `devin acp`,
    // so generated config must expose only that agent target instead of
    // creating a detect-only cli/native target that appears degraded forever.
    if (provider === 'devin') {
      agentProviders.devin = {
        default_instance: 'acp',
        transport: 'acp_stdio',
        instances: {
          acp: {
            command: commandPath,
            args: ['acp'],
            startup_timeout_ms: 15_000,
          },
        },
      };
      routingProviders.devin = {
        default_target: {
          backend: 'agent',
          instance: 'acp',
        },
      };
      continue;
    }

    const instanceDoc: Record<string, unknown> = {
      command: commandPath,
      runner: 'auto',
    };

    if (provider === 'kiro') {
      const kiroDbPath = config.providerInstances?.kiro?.native?.kiroDbPath;
      if (kiroDbPath) {
        instanceDoc.db_path = kiroDbPath;
      }
    }

    cliProviders[provider] = {
      instances: {
        native: instanceDoc,
      },
    };
  }

  const backends: Record<string, unknown> = {};
  if (Object.keys(cliProviders).length > 0) {
    backends.cli = {
      providers: cliProviders,
    };
  }
  if (Object.keys(agentProviders).length > 0) {
    backends.agent = {
      providers: agentProviders,
    };
  }

  const doc: Record<string, unknown> = {
    version: 1,
    ...(Object.keys(routingProviders).length > 0
      ? { routing: { providers: routingProviders } }
      : {}),
    backends,
  };

  return stringify(doc, {
    lineWidth: 0,
    singleQuote: true,
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BootstrapService {
  private readonly setupDir: string;
  private readonly setupStatePath: string;
  private readonly scanPath: string;
  private readonly manualScanPath: string;
  private readonly configPath: string;
  private readonly config: RuntimeConfig;
  private readonly compatibility: ProviderCompatibilityService;
  private readonly scanConcurrency: number;

  constructor(opts: {
    dataDir: string;
    configPath: string;
    config: RuntimeConfig;
    compatibility: ProviderCompatibilityService;
    scanConcurrency?: number;
  }) {
    this.setupDir = join(opts.dataDir, 'setup');
    this.setupStatePath = join(this.setupDir, 'setup-state.json');
    this.scanPath = join(this.setupDir, 'provider-scan.json');
    this.manualScanPath = join(this.setupDir, 'provider-manual-scan.json');
    this.configPath = opts.configPath;
    this.config = opts.config;
    this.compatibility = opts.compatibility;
    this.scanConcurrency = normalizeScanConcurrency(opts.scanConcurrency);
    this.recoverStrandedScanStatus();
  }

  // ---- Provider Universe (Layer 1) ----

  getProviderUniverse(): ProviderUniverseEntry[] {
    return KNOWN_PROVIDERS.map((provider) => {
      const knowledge = getProviderInstallKnowledge(provider);
      const runtime = this.config.providerCommands[provider]?.runtime
        ?? { mode: 'native' as const };
      const install = buildProviderInstallCatalogView(provider, runtime);
      return {
        provider,
        familyLabel: knowledge.familyLabel,
        binaryName: knowledge.binaryName,
        install,
      };
    });
  }

  // ---- Machine Detection (Layer 2) ----

  async scan(options: { manual?: boolean } = {}): Promise<BootstrapScanResult> {
    const state = await this.getSetupState();
    state.status = 'scanning';
    writeJsonAtomic(this.setupStatePath, state);

    try {
      // A CLI installed since this runtime started is only on the persisted
      // PATH, not on the one we inherited at boot. Pick it up before probing; a
      // failure here just means we scan with the PATH we already have.
      await refreshWindowsProcessPath().catch(() => ({ refreshed: false, added: [] }));

      const entries = await this.probeProviders();
      const isManual = options.manual === true;

      const result: BootstrapScanResult = {
        scannedAt: new Date().toISOString(),
        scanType: isManual ? 'manual' : 'auto',
        providers: entries,
      };

      writeJsonAtomic(this.scanPath, result);
      if (isManual) {
        writeJsonAtomic(this.manualScanPath, result);
        state.lastManualScanAt = result.scannedAt;
      }
      state.lastScanAt = result.scannedAt;
      state.status = 'ready';
      state.error = null;
      writeJsonAtomic(this.setupStatePath, state);

      return result;
    } catch (error) {
      // `scanning` is persisted, and callers read it as "a scan is running" --
      // the desktop host declines to start another one while it stands. A throw
      // that left it there would disable detection for good, so the failure has
      // to land in the file as a terminal state.
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      writeJsonAtomic(this.setupStatePath, state);
      throw error;
    }
  }

  /**
   * Clears a `scanning` status left behind by a process that is no longer
   * running.
   *
   * The status is written before probing and cleared after, so a runtime that
   * exits mid-scan strands it on disk. Nothing ever clears it: the desktop host
   * reads `scanning` as "a scan is already in flight" and backs off, on every
   * launch, forever -- which is exactly what happens when the packaged update
   * handoff drains the sidecars while the startup scan is still running.
   *
   * A scan cannot outlive the process that started it, so any `scanning` found
   * at construction belongs to a dead one and is stale by definition.
   */
  private recoverStrandedScanStatus(): void {
    const state = readJsonSafe<SetupState>(this.setupStatePath);
    if (state?.status !== 'scanning') {
      return;
    }
    writeJsonAtomic(this.setupStatePath, {
      ...state,
      // Fall back to what the file itself can prove: a scan that completed once
      // leaves lastScanAt behind, and its result is still on disk.
      status: state.lastScanAt ? 'ready' : 'pending',
    });
  }

  // ---- Setup State (persistence) ----

  async getSetupState(): Promise<SetupState> {
    return readJsonSafe<SetupState>(this.setupStatePath) ?? defaultSetupState();
  }

  async getLatestScan(): Promise<BootstrapScanResult | null> {
    return readJsonSafe<BootstrapScanResult>(this.scanPath);
  }

  async getLatestManualScan(): Promise<BootstrapScanResult | null> {
    return readJsonSafe<BootstrapScanResult>(this.manualScanPath);
  }

  // ---- Config Writer (Layer 3) ----

  async applyConfig(
    selectedProviders: string[],
  ): Promise<{ configPath: string }> {
    const validated = selectedProviders.filter(
      (name): name is ProviderName =>
        (KNOWN_PROVIDERS as readonly string[]).includes(name),
    );
    if (validated.length === 0) {
      throw new Error('No valid providers selected');
    }

    const scan = await this.getLatestScan();
    const yaml = buildMinimalProvidersYaml(validated, scan, this.config);
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, yaml, 'utf8');

    const state = await this.getSetupState();
    state.status = 'applied';
    state.appliedAt = new Date().toISOString();
    state.appliedConfigPath = this.configPath;
    writeJsonAtomic(this.setupStatePath, state);

    return { configPath: this.configPath };
  }

  // ---- Internal ----

  private async probeProviders(): Promise<ProviderScanEntry[]> {
    const entries = new Array<ProviderScanEntry>(KNOWN_PROVIDERS.length);
    const workerCount = Math.min(this.scanConcurrency, KNOWN_PROVIDERS.length);
    let nextIndex = 0;

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= KNOWN_PROVIDERS.length) {
          return;
        }

        entries[currentIndex] = await this.probeProvider(KNOWN_PROVIDERS[currentIndex]!);
      }
    }));

    return entries;
  }

  private async probeProvider(provider: ProviderName): Promise<ProviderScanEntry> {
    const commandConfig = this.config.providerCommands[provider];
    const runtime = commandConfig?.runtime ?? { mode: 'native' as const };
    const commandPath = commandConfig?.path ?? provider;
    const knowledge = getProviderInstallKnowledge(provider);
    const install = buildProviderInstallCatalogView(provider, runtime);

    const target = buildBootstrapTarget(provider, commandPath, runtime);

    try {
      const assessment = await this.compatibility.assessCliTarget(target, {
        force: true,
        purpose: 'setup',
        probeMode: 'light',
      });

      return {
        provider,
        family: knowledge.familyLabel,
        commandStatus: assessment.setup.command.status,
        commandPath: assessment.setup.command.resolvedCommand || commandPath,
        version: assessment.setup.version.detected || null,
        authStatus: assessment.setup.auth.status,
        available: assessment.setup.command.status === 'ready',
        install,
        remediation: assessment.setup.remediation,
      };
    } catch {
      return {
        provider,
        family: knowledge.familyLabel,
        commandStatus: 'probe_failed',
        commandPath: null,
        version: null,
        authStatus: 'unknown',
        available: false,
        install,
        remediation: [],
      };
    }
  }
}

function normalizeScanConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SCAN_CONCURRENCY;
  }

  return Math.max(1, Math.trunc(value as number));
}
