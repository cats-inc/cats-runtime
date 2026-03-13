import { spawn } from 'node:child_process';
import type {
  CliRuntimeConfig,
  ProviderRuntimeConfig,
  RuntimeMode,
  WslDiscoveryPolicy,
} from '../config.js';
import type { SessionRegistry } from '../pool/SessionRegistry.js';
import { syncNativeSessions, type NativeSessionSummary } from './nativeDiscovery.js';

const WSL_DISCOVERY_PROVIDERS = [
  'cursor',
  'kiro',
] as const;
const PROVIDER_STATES = [
  'not_applicable',
  'idle',
  'running',
  'active',
  'skipped',
  'disabled',
  'failed',
] as const;
const SUMMARY_STATES = [
  'not_applicable',
  'idle',
  'active',
  'skipped',
  'disabled',
  'failed',
] as const;

type CommandRunner = (command: string, args: string[]) => Promise<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export type WslDiscoveryProviderName = typeof WSL_DISCOVERY_PROVIDERS[number];
export type WslDiscoveryProviderState = typeof PROVIDER_STATES[number];
export type WslDiscoverySummaryState = typeof SUMMARY_STATES[number];
export type WslDistroInspector = (distro: string) => Promise<boolean>;

export interface WslDiscoveryProviderStatus {
  provider: WslDiscoveryProviderName;
  runtimeMode: RuntimeMode;
  distro?: string;
  state: WslDiscoveryProviderState;
  message: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  importedCount?: number;
  wslRunning?: boolean;
}

export interface WslDiscoveryStatusSnapshot {
  backgroundEnabled: boolean;
  nativeDiscoveryIntervalMs: number;
  policy: WslDiscoveryPolicy;
  summary: {
    state: WslDiscoverySummaryState;
    message: string;
  };
  providers: Record<WslDiscoveryProviderName, WslDiscoveryProviderStatus>;
}

export interface DiscoveryStatusPayload {
  wsl: WslDiscoveryStatusSnapshot;
}

export interface RunWslAwareNativeDiscoveryInput {
  provider: WslDiscoveryProviderName;
  listAllSessions: () => Promise<NativeSessionSummary[]>;
  registry: SessionRegistry;
  runtime: ProviderRuntimeConfig;
  policy: WslDiscoveryPolicy;
  statusStore: WslDiscoveryStatusStore;
  inspector?: WslDistroInspector;
}

export interface WslAwareNativeDiscoveryResult {
  outcome: 'scanned' | 'skipped' | 'disabled';
  newCount: number;
  syncedCount: number;
}

export class WslDiscoveryStatusStore {
  private readonly policy: WslDiscoveryPolicy;
  private readonly nativeDiscoveryIntervalMs: number;
  private readonly providers: Record<WslDiscoveryProviderName, WslDiscoveryProviderStatus>;

  constructor(config: Pick<
    CliRuntimeConfig,
    'cursorRuntime' | 'kiroRuntime' | 'nativeDiscoveryIntervalMs' | 'wslDiscoveryPolicy'
  >) {
    this.policy = config.wslDiscoveryPolicy ?? 'always';
    this.nativeDiscoveryIntervalMs = config.nativeDiscoveryIntervalMs;
    this.providers = {
      cursor: this.createInitialProviderStatus('cursor', config.cursorRuntime),
      kiro: this.createInitialProviderStatus('kiro', config.kiroRuntime),
    };
  }

  snapshot(): WslDiscoveryStatusSnapshot {
    const providers = {
      cursor: { ...this.providers.cursor },
      kiro: { ...this.providers.kiro },
    };

    return {
      backgroundEnabled: this.nativeDiscoveryIntervalMs > 0,
      nativeDiscoveryIntervalMs: this.nativeDiscoveryIntervalMs,
      policy: this.policy,
      summary: summarizeProviders(this.policy, this.nativeDiscoveryIntervalMs, providers),
      providers,
    };
  }

  markScanStart(
    provider: WslDiscoveryProviderName,
    input: { message: string; wslRunning?: boolean },
  ): void {
    this.updateProvider(provider, {
      state: 'running',
      message: input.message,
      wslRunning: input.wslRunning,
      lastAttemptAt: nowIso(),
    });
  }

  markScanSuccess(
    provider: WslDiscoveryProviderName,
    input: { importedCount: number; message: string; wslRunning?: boolean },
  ): void {
    const timestamp = nowIso();
    this.updateProvider(provider, {
      state: 'active',
      message: input.message,
      importedCount: input.importedCount,
      wslRunning: input.wslRunning,
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
    });
  }

  markSkipped(
    provider: WslDiscoveryProviderName,
    input: { message: string; wslRunning?: boolean },
  ): void {
    this.updateProvider(provider, {
      state: 'skipped',
      message: input.message,
      importedCount: 0,
      wslRunning: input.wslRunning,
      lastAttemptAt: nowIso(),
    });
  }

  markDisabled(provider: WslDiscoveryProviderName, message: string): void {
    this.updateProvider(provider, {
      state: 'disabled',
      message,
      importedCount: 0,
      wslRunning: false,
    });
  }

  markFailure(provider: WslDiscoveryProviderName, error: unknown): void {
    this.updateProvider(provider, {
      state: 'failed',
      message: errorMessage(error),
      importedCount: 0,
      lastAttemptAt: nowIso(),
    });
  }

  private createInitialProviderStatus(
    provider: WslDiscoveryProviderName,
    runtime: ProviderRuntimeConfig,
  ): WslDiscoveryProviderStatus {
    if (runtime.mode !== 'wsl') {
      return {
        provider,
        runtimeMode: runtime.mode,
        state: 'not_applicable',
        message: `${providerLabel(provider)} uses ${runtime.mode} runtime`,
      };
    }

    if (this.nativeDiscoveryIntervalMs <= 0) {
      return {
        provider,
        runtimeMode: runtime.mode,
        distro: runtime.distro || 'Ubuntu',
        state: 'disabled',
        message: 'Background native discovery is disabled',
        wslRunning: false,
      };
    }

    if (this.policy === 'manual_only') {
      return {
        provider,
        runtimeMode: runtime.mode,
        distro: runtime.distro || 'Ubuntu',
        state: 'disabled',
        message: 'Background WSL discovery is disabled by policy',
        wslRunning: false,
      };
    }

    return {
      provider,
      runtimeMode: runtime.mode,
      distro: runtime.distro || 'Ubuntu',
      state: 'idle',
      message: this.policy === 'if_running'
        ? 'Waiting to scan when the WSL distro is already running'
        : 'Waiting for the first background WSL scan',
    };
  }

  private updateProvider(
    provider: WslDiscoveryProviderName,
    next: Partial<WslDiscoveryProviderStatus>,
  ): void {
    this.providers[provider] = {
      ...this.providers[provider],
      ...next,
    };
  }
}

export async function runWslAwareNativeDiscovery(
  input: RunWslAwareNativeDiscoveryInput,
): Promise<WslAwareNativeDiscoveryResult> {
  if (input.runtime.mode !== 'wsl') {
    const result = syncNativeSessions(input.registry, input.provider, await input.listAllSessions());
    return {
      outcome: 'scanned',
      newCount: result.newCount,
      syncedCount: result.syncedCount,
    };
  }

  if (input.policy === 'manual_only') {
    input.statusStore.markDisabled(
      input.provider,
      'Background WSL discovery is disabled by policy',
    );
    return {
      outcome: 'disabled',
      newCount: 0,
      syncedCount: 0,
    };
  }

  const distro = input.runtime.distro || 'Ubuntu';

  try {
    let wslRunning: boolean | undefined;

    if (input.policy === 'if_running') {
      wslRunning = await (input.inspector || isWslDistroRunning)(distro);
      if (!wslRunning) {
        input.statusStore.markSkipped(input.provider, {
          wslRunning,
          message: `Skipped background scan because WSL distro '${distro}' is not running`,
        });
        return {
          outcome: 'skipped',
          newCount: 0,
          syncedCount: 0,
        };
      }
    }

    input.statusStore.markScanStart(input.provider, {
      wslRunning,
      message: `Scanning ${providerLabel(input.provider)} sessions in WSL distro '${distro}'`,
    });

    const result = syncNativeSessions(
      input.registry,
      input.provider,
      await input.listAllSessions(),
    );

    input.statusStore.markScanSuccess(input.provider, {
      importedCount: result.newCount,
      wslRunning: wslRunning ?? true,
      message: result.newCount > 0
        ? `Imported ${result.newCount} native ${providerLabel(input.provider)} session(s)`
        : `Scanned native ${providerLabel(input.provider)} sessions`,
    });

    return {
      outcome: 'scanned',
      newCount: result.newCount,
      syncedCount: result.syncedCount,
    };
  } catch (error) {
    input.statusStore.markFailure(input.provider, error);
    throw error;
  }
}

export async function isWslDistroRunning(
  distro: string,
  runner: CommandRunner = defaultCommandRunner,
): Promise<boolean> {
  const result = await runner('wsl', ['--list', '--running', '--quiet']);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim()
        || result.stdout.trim()
        || 'Failed to inspect running WSL distros',
    );
  }

  const target = distro.trim().toLowerCase();
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

export function createDiscoveryStatusPayload(
  config: Pick<
    CliRuntimeConfig,
    'cursorRuntime' | 'kiroRuntime' | 'nativeDiscoveryIntervalMs' | 'wslDiscoveryPolicy'
  >,
): DiscoveryStatusPayload {
  return {
    wsl: new WslDiscoveryStatusStore(config).snapshot(),
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function summarizeProviders(
  policy: WslDiscoveryPolicy,
  nativeDiscoveryIntervalMs: number,
  providers: Record<WslDiscoveryProviderName, WslDiscoveryProviderStatus>,
): { state: WslDiscoverySummaryState; message: string } {
  const relevant = Object.values(providers).filter((provider) => provider.runtimeMode === 'wsl');

  if (relevant.length === 0) {
    return {
      state: 'not_applicable',
      message: 'Cursor and Kiro are not using WSL runtime',
    };
  }

  if (relevant.some((provider) => provider.state === 'failed')) {
    return {
      state: 'failed',
      message: 'Background WSL discovery is degraded',
    };
  }

  if (relevant.some((provider) => provider.state === 'running' || provider.state === 'active')) {
    return {
      state: 'active',
      message: 'Background WSL discovery is active',
    };
  }

  if (relevant.some((provider) => provider.state === 'skipped')) {
    return {
      state: 'skipped',
      message: 'Background WSL discovery is skipping stopped distros',
    };
  }

  if (relevant.every((provider) => provider.state === 'disabled')) {
    return {
      state: 'disabled',
      message: nativeDiscoveryIntervalMs <= 0
        ? 'Background native discovery is disabled'
        : policy === 'manual_only'
          ? 'Background WSL discovery is disabled by policy'
          : 'Background WSL discovery is disabled',
    };
  }

  return {
    state: 'idle',
    message: 'Background WSL discovery is waiting for the first scan',
  };
}

function providerLabel(provider: WslDiscoveryProviderName): string {
  return provider === 'cursor' ? 'Cursor' : 'Kiro';
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
