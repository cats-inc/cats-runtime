import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KNOWN_PROVIDERS, type ProviderName } from '../../backends/cli/providers/types.js';
import { buildProviderInstallCatalogView } from '../provider-install/knowledge.js';
import type { ProviderInstallCatalogView, ProviderRemediationStep } from '../provider-install/types.js';
import type { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { RuntimeConfig } from '../config.js';
import {
  ProviderSelectionService, providerSelectionCatalog, selectedTarget,
  ProviderSelectionError, providerSelectionKey,
  type ProviderSelectionSnapshot, type SelectedProviderTarget,
} from './ProviderSelectionService.js';
import { refreshWindowsProcessPath } from './windowsEnvironmentPath.js';

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
}

export interface BootstrapScanResult {
  revision: string;
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
  writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
  renameSync(temporary, path);
}

interface ScanOptions { manual?: boolean; targets?: unknown }

export class BootstrapService {
  readonly selection: ProviderSelectionService;
  private readonly setupStatePath: string;
  private readonly scanPath: string;
  private readonly manualScanPath: string;
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
  }) {
    this.setupStatePath = join(opts.dataDir, 'setup', 'setup-state.json');
    this.scanPath = join(opts.dataDir, 'setup', 'provider-scan.json');
    this.manualScanPath = join(opts.dataDir, 'setup', 'provider-manual-scan.json');
    this.selection = new ProviderSelectionService({
      ...opts,
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

  saveSelection(targets: unknown, expectedRevision: unknown): ProviderSelectionSnapshot {
    const result = this.selection.save(targets, expectedRevision);
    this.volatileState = { ...defaultSetupState(), status: 'applied',
      appliedAt: new Date().toISOString(), appliedConfigPath: this.opts.configPath };
    // Setup progress is best effort; it cannot roll back or prevent activation
    // of an already committed, authoritative provider configuration.
    try { writeJsonAtomic(this.setupStatePath, this.volatileState); } catch { /* Keep current state in memory. */ }
    return result;
  }

  startScan(options: ScanOptions = {}): { started: boolean } {
    // Validate before coalescing so another scan cannot accept an invalid scope.
    const targets = this.selection.resolveTargets(options.targets);
    if (this.inFlightScan) {
      this.assertScanScope(targets, options);
      return { started: false };
    }
    void this.scan(options).catch(() => undefined);
    return { started: true };
  }

  scan(options: ScanOptions = {}): Promise<BootstrapScanResult> {
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
    writeJsonAtomic(this.setupStatePath, { ...state, status: 'scanning', error: null });
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
    this.volatileState = defaultSetupState();
  }

  async getSetupState(): Promise<SetupState> { return this.readSetupState(); }
  private readSetupState(): SetupState {
    return this.volatileState ?? readJsonSafe<SetupState>(this.setupStatePath) ?? defaultSetupState();
  }

  private scanScope(targets: ProviderTargetDescriptor[], options: ScanOptions): string {
    return JSON.stringify([options.manual === true, targets.map((target) => providerSelectionKey(selectedTarget(target))).sort()]);
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

  private async runScan(
    targets: ProviderTargetDescriptor[], revision: string, generation: number, options: ScanOptions,
  ): Promise<BootstrapScanResult> {
    const current = () => generation === this.generation && revision === this.getSelection().revision;
    try {
      if (targets.some((target) => target.backend === 'cli' || target.remoteInstance?.command)) {
        await refreshWindowsProcessPath().catch(() => undefined);
      }
      const entries = new Array<ProviderScanEntry>(targets.length);
      let next = 0;
      const concurrency = Math.max(1, Math.min(12, Math.trunc(this.opts.scanConcurrency || 4)));
      await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
        while (current() && next < targets.length) {
          const index = next++;
          entries[index] = await this.probeProvider(targets[index]!, options.manual === true);
        }
      }));
      const result: BootstrapScanResult = {
        revision, scannedAt: new Date().toISOString(),
        scanType: options.manual ? 'manual' : 'auto', providers: current() ? entries : [],
      };
      if (!current()) return result;
      writeJsonAtomic(this.scanPath, result);
      if (options.manual) writeJsonAtomic(this.manualScanPath, result);
      writeJsonAtomic(this.setupStatePath, { ...this.readSetupState(), status: 'ready', error: null,
        lastScanAt: result.scannedAt, ...(options.manual ? { lastManualScanAt: result.scannedAt } : {}) });
      return result;
    } catch (error) {
      if (current()) writeJsonAtomic(this.setupStatePath, {
        ...this.readSetupState(), status: 'error', error: 'Selected provider scan failed. Retry the scan.',
      });
      throw error;
    }
  }

  private async probeProvider(target: ProviderTargetDescriptor, manual: boolean): Promise<ProviderScanEntry> {
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
    if (target.backend !== 'cli') return base;
    try {
      const assessment = await this.opts.compatibility.assessCliTarget(target, {
        force: manual, purpose: 'setup', probeMode: 'light',
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
