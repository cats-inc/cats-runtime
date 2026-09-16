import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { KNOWN_PROVIDERS, type ProviderName } from '../../backends/cli/providers/types.js';
import { buildProviderInstallCatalogView } from '../provider-install/knowledge.js';
import type { ProviderInstallCatalogView, ProviderRemediationStep } from '../provider-install/types.js';
import type { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { getRuntimeConfigEnv, type RuntimeConfig } from '../config.js';
import {
  ProviderSelectionService, providerSelectionCatalog, selectedTarget,
  ProviderSelectionError, providerSelectionKey, configuredTargets,
  type ProviderSelectionSnapshot, type SelectedProviderTarget,
} from './ProviderSelectionService.js';
import { refreshWindowsProcessPath } from './windowsEnvironmentPath.js';
import { readSetupConnections, type SetupConnection } from './setupConnections.js';

export interface ProviderUniverseEntry extends SelectedProviderTarget {
  familyLabel: string;
  binaryName: string;
  install: ProviderInstallCatalogView | null;
}

export interface ProviderScanEntry extends SelectedProviderTarget {
  family: string;
  commandStatus: string;
  commandPath: string | null;
  version: string | null;
  authStatus: string;
  available: boolean;
  install: ProviderInstallCatalogView | null;
  remediation: ProviderRemediationStep[];
  connectionStatus?: 'connected' | 'failed' | 'not_checked';
  detail?: string;
}

export interface BootstrapScanResult {
  revision: string;
  scannedAt: string;
  scanType: 'auto' | 'manual';
  providers: ProviderScanEntry[];
}

export interface ProviderSetupObservation extends ProviderScanEntry {
  observedAt: string;
  scanType: BootstrapScanResult['scanType'];
  configurationStatus: 'unchanged' | 'changed' | 'not_selected';
}

interface StoredProviderObservation extends Omit<ProviderSetupObservation, 'configurationStatus'> {
  configurationFingerprint: string;
}

function canonicalConfiguration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalConfiguration);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonicalConfiguration(entry)]));
  }
  return value;
}

export interface SetupState {
  status: 'pending' | 'scanning' | 'ready' | 'applied' | 'error';
  lastScanAt: string | null;
  lastManualScanAt: string | null;
  appliedAt: string | null;
  appliedConfigPath: string | null;
  error: string | null;
  scanId?: string;
  scanCompleted?: number;
  scanTotal?: number;
}

function defaultSetupState(): SetupState {
  return { status: 'pending', lastScanAt: null, lastManualScanAt: null,
    appliedAt: null, appliedConfigPath: null, error: null };
}

function readJsonSafe<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

interface ScanOptions { manual?: boolean; targets?: unknown; expectedRevision?: unknown; includeConnections?: boolean }

export class BootstrapService {
  readonly selection: ProviderSelectionService;
  private readonly setupStatePath: string;
  private readonly scanPath: string;
  private readonly manualScanPath: string;
  private readonly observationsPath: string;
  private observations: StoredProviderObservation[] | null = null;
  private inFlightScan: Promise<BootstrapScanResult> | null = null;
  private inFlightScope: string | null = null;
  private volatileState: SetupState | null = null;
  private generation = 0;

  constructor(private readonly opts: {
    dataDir: string;
    configPath: string;
    config: RuntimeConfig;
    compatibility: ProviderCompatibilityService;
    scanConcurrency?: number;
    beforeActivate?: (candidate: RuntimeConfig, changed: SelectedProviderTarget[]) => void;
    activated?: () => void;
    activationRequired?: () => boolean;
    probeNonCliTarget?: (target: ProviderTargetDescriptor, options: { includeConnections: boolean }) => Promise<Partial<ProviderScanEntry> | null>;
  }) {
    this.setupStatePath = join(opts.dataDir, 'setup', 'setup-state.json');
    this.scanPath = join(opts.dataDir, 'setup', 'provider-scan.json');
    this.manualScanPath = join(opts.dataDir, 'setup', 'provider-manual-scan.json');
    this.observationsPath = join(opts.dataDir, 'setup', 'provider-observations.json');
    this.selection = new ProviderSelectionService({
      ...opts,
      beforeActivate: (candidate, changed) => {
        opts.beforeActivate?.(candidate, changed);
        // Capture completed results against the still-active configuration.
        // Historical observations never grant admission to a removed target.
        this.persistObservations(this.collectObservations());
      },
      activated: () => {
        this.cancelScan();
        opts.activated?.();
      },
    });
    const state = this.readSetupState();
    if (state.status === 'scanning') {
      writeJsonAtomic(this.setupStatePath, { ...state, status: state.lastScanAt ? 'ready' : 'pending' });
    }
  }

  getProviderUniverse(): ProviderUniverseEntry[] {
    return providerSelectionCatalog().map((entry) => ({
      ...entry,
      install: (KNOWN_PROVIDERS as readonly string[]).includes(entry.provider)
        ? buildProviderInstallCatalogView(entry.provider as ProviderName, { mode: 'native' }) : null,
    }));
  }

  getSelection(): ProviderSelectionSnapshot { return this.selection.getSnapshot(); }
  getConnections(): SetupConnection[] { return readSetupConnections(this.opts.config); }

  saveSelection(targets: unknown, expectedRevision: unknown): ProviderSelectionSnapshot {
    const result = this.selection.save(targets, expectedRevision);
    this.volatileState = { ...this.readSetupState(), status: 'applied', error: null,
      appliedAt: new Date().toISOString(), appliedConfigPath: this.opts.configPath };
    // Setup progress is best effort; it cannot roll back or prevent activation
    // of an already committed, authoritative provider configuration.
    try { writeJsonAtomic(this.setupStatePath, this.volatileState); } catch { /* Keep current state in memory. */ }
    return result;
  }

  startScan(options: ScanOptions = {}): { started: boolean; scanId?: string } {
    // Validate before coalescing so another scan cannot accept an invalid scope.
    if (options.expectedRevision !== undefined) this.selection.assertRevision(options.expectedRevision);
    const targets = this.selection.resolveTargets(options.targets);
    if (this.inFlightScan) {
      this.assertScanScope(targets, options);
      return { started: false, scanId: this.readSetupState().scanId };
    }
    void this.scan(options).catch(() => undefined);
    return { started: true, scanId: this.readSetupState().scanId };
  }

  scan(options: ScanOptions = {}): Promise<BootstrapScanResult> {
    if (options.expectedRevision !== undefined) this.selection.assertRevision(options.expectedRevision);
    const targets = this.selection.resolveTargets(options.targets);
    if (this.inFlightScan) {
      this.assertScanScope(targets, options);
      return this.inFlightScan;
    }
    this.inFlightScope = this.scanScope(targets, options);
    const generation = this.generation;
    const revision = this.getSelection().revision;
    const state = this.readSetupState();
    this.volatileState = null;
    writeJsonAtomic(this.setupStatePath, { ...state, status: 'scanning', error: null,
      scanId: randomUUID(), scanCompleted: 0, scanTotal: targets.length });
    const running = this.runScan(targets, revision, generation, options).finally(() => {
      if (this.inFlightScan === running) { this.inFlightScan = null; this.inFlightScope = null; }
    });
    this.inFlightScan = running;
    return running;
  }

  cancelScan(): void {
    this.generation += 1;
    this.inFlightScan = null;
    this.inFlightScope = null;
    this.volatileState = { ...this.readSetupState(), status: 'pending', error: null };
  }

  async getSetupState(): Promise<SetupState> { return this.readSetupState(); }
  private readSetupState(): SetupState {
    return this.volatileState ?? readJsonSafe<SetupState>(this.setupStatePath) ?? defaultSetupState();
  }

  private scanScope(targets: ProviderTargetDescriptor[], options: ScanOptions): string {
    return JSON.stringify([options.manual === true, options.includeConnections === true,
      targets.map((target) => providerSelectionKey(selectedTarget(target))).sort()]);
  }

  private assertScanScope(targets: ProviderTargetDescriptor[], options: ScanOptions): void {
    if (this.scanScope(targets, options) !== this.inFlightScope) {
      throw new ProviderSelectionError('A different provider scan is running. Retry after it finishes.', 409);
    }
  }

  async getLatestScan(): Promise<BootstrapScanResult | null> { return this.readScan(this.scanPath); }
  async getLatestManualScan(): Promise<BootstrapScanResult | null> { return this.readScan(this.manualScanPath); }
  private readScan(path: string): BootstrapScanResult | null {
    const result = readJsonSafe<BootstrapScanResult>(path);
    return result?.revision === this.getSelection().revision ? result : null;
  }

  getProviderObservations(): ProviderSetupObservation[] {
    const targets = new Map(configuredTargets(this.opts.config).map((target) =>
      [providerSelectionKey(selectedTarget(target)), target]));
    return [...this.collectObservations().values()].map(({ configurationFingerprint, ...entry }) => {
      const target = targets.get(providerSelectionKey(entry));
      return {
        ...entry,
        configurationStatus: !target ? 'not_selected'
          : configurationFingerprint === this.targetFingerprint(target) ? 'unchanged' : 'changed',
      };
    });
  }

  private targetFingerprint(target: ProviderTargetDescriptor): string {
    const remote = target.remoteInstance;
    const env = getRuntimeConfigEnv(this.opts.config);
    const envNames = remote ? [remote.urlEnv, remote.baseUrlEnv, remote.apiKeyEnv,
      remote.authTokenEnv, remote.passwordEnv, remote.organizationEnv, remote.projectEnv] : [];
    const configuration = {
      command: target.cliInstance?.commandConfig,
      remote,
      environment: envNames.filter((name): name is string => Boolean(name))
        .map((name) => [name, env[name] ?? null]),
    };
    // Persist only the digest, never endpoint credentials or environment values.
    return createHash('sha256').update(JSON.stringify(canonicalConfiguration(configuration))).digest('hex');
  }

  private collectObservations(): Map<string, StoredProviderObservation> {
    const stored = this.observations
      ?? readJsonSafe<StoredProviderObservation[]>(this.observationsPath);
    const records = new Map((Array.isArray(stored) ? stored : [])
      .map((entry) => [providerSelectionKey(entry), entry]));
    const targets = new Map(configuredTargets(this.opts.config).map((target) =>
      [providerSelectionKey(selectedTarget(target)), target]));
    // Current-revision scan snapshots are also completed evidence. Reading is
    // passive; archive them before activation makes those snapshots obsolete.
    for (const path of [this.manualScanPath, this.scanPath]) {
      const scan = this.readScan(path);
      for (const entry of scan?.providers ?? []) {
        if (entry.commandStatus === 'unknown' && !entry.connectionStatus) continue;
        const key = providerSelectionKey(entry);
        const target = targets.get(key);
        const previous = records.get(key);
        if (!target || (previous && previous.observedAt >= scan!.scannedAt)) continue;
        records.set(key, { ...entry, observedAt: scan!.scannedAt, scanType: scan!.scanType,
          configurationFingerprint: this.targetFingerprint(target) });
      }
    }
    return records;
  }

  private persistObservations(records: Map<string, StoredProviderObservation>): void {
    if (records.size === 0) return;
    this.observations = [...records.values()];
    // Like setup progress, history persistence must not prevent an intent save.
    try { writeJsonAtomic(this.observationsPath, this.observations); } catch { /* Retain in memory. */ }
  }

  private async runScan(
    targets: ProviderTargetDescriptor[], revision: string, generation: number, options: ScanOptions,
  ): Promise<BootstrapScanResult> {
    const current = () => generation === this.generation && revision === this.getSelection().revision;
    try {
      if (targets.some((target) => target.backend === 'cli' || target.remoteInstance?.command
        || (options.includeConnections && target.remoteInstance?.transport === 'ollama'))) {
        await refreshWindowsProcessPath().catch(() => undefined);
      }
      const entries = new Array<ProviderScanEntry>(targets.length);
      let next = 0;
      const concurrency = Math.max(1, Math.min(12, Math.trunc(this.opts.scanConcurrency || 4)));
      await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
        while (current() && next < targets.length) {
          const index = next++;
          entries[index] = await this.probeProvider(targets[index]!, options);
          if (current()) this.volatileState = { ...this.readSetupState(), scanCompleted: entries.filter(Boolean).length };
        }
      }));
      const result: BootstrapScanResult = {
        revision, scannedAt: new Date().toISOString(),
        scanType: options.manual ? 'manual' : 'auto', providers: current() ? entries : [],
      };
      if (!current()) return result;
      const records = this.collectObservations();
      entries.forEach((entry, index) => {
        // A passive run must not replace an actual endpoint observation with unknown.
        if (entry.commandStatus === 'unknown' && !entry.connectionStatus) return;
        records.set(providerSelectionKey(entry), {
          ...entry, observedAt: result.scannedAt, scanType: result.scanType,
          configurationFingerprint: this.targetFingerprint(targets[index]!),
        });
      });
      writeJsonAtomic(this.scanPath, result);
      if (options.manual) writeJsonAtomic(this.manualScanPath, result);
      this.persistObservations(records);
      this.volatileState = { ...this.readSetupState(), status: 'ready', error: null,
        lastScanAt: result.scannedAt, ...(options.manual ? { lastManualScanAt: result.scannedAt } : {}) };
      writeJsonAtomic(this.setupStatePath, this.volatileState);
      return result;
    } catch (error) {
      if (current()) {
        this.volatileState = { ...this.readSetupState(), status: 'error', error: 'Selected provider scan failed. Retry the scan.' };
        writeJsonAtomic(this.setupStatePath, this.volatileState);
      }
      throw error;
    }
  }

  private async probeProvider(target: ProviderTargetDescriptor, options: ScanOptions): Promise<ProviderScanEntry> {
    const entry = this.getProviderUniverse().find((candidate) => candidate.provider === target.providerName);
    const base: ProviderScanEntry = {
      ...selectedTarget(target), family: entry?.familyLabel ?? target.providerName,
      commandStatus: 'unknown', commandPath: null, version: null, authStatus: 'unknown',
      available: false,
      install: target.backend === 'cli' && target.cliInstance
        ? buildProviderInstallCatalogView(target.providerName as ProviderName, target.cliInstance.commandConfig.runtime)
        : null,
      remediation: [],
    };
    // Reachability belongs to selected-target diagnostics. Polling setup must
    // not contact endpoints or require local/agent targets to pass a CLI gate.
    if (target.backend !== 'cli') {
      try {
        const observation = await this.opts.probeNonCliTarget?.(target, { includeConnections: options.includeConnections === true });
        return observation ? { ...base, ...observation } : base;
      } catch {
        return { ...base, commandStatus: 'probe_failed', detail: 'Provider check failed. Check the service settings and retry.' };
      }
    }
    try {
      const assessment = await this.opts.compatibility.assessCliTarget(target, {
        force: options.manual === true, purpose: 'setup', probeMode: 'light',
      });
      return { ...base, commandStatus: assessment.setup.command.status,
        commandPath: assessment.setup.command.resolvedCommand || target.cliInstance!.commandConfig.path,
        version: assessment.setup.version.detected || null, authStatus: assessment.setup.auth.status,
        available: assessment.setup.command.status === 'ready', remediation: assessment.setup.remediation };
    } catch {
      return { ...base, commandStatus: 'probe_failed' };
    }
  }
}
