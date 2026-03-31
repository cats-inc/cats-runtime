import { spawn } from 'node:child_process';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';
import type {
  CliRuntimeConfig,
  DockerDiscoveryPolicy,
  RuntimeMode,
  WslDiscoveryPolicy,
} from '../config.js';
import type { SessionRegistry } from '../pool/SessionRegistry.js';
import { syncNativeSessions, type NativeSessionSummary } from './nativeDiscovery.js';

const WSL_DISCOVERY_PROVIDERS = [
  'cursor',
  'kiro',
] as const;
const DOCKER_DISCOVERY_PROVIDERS = [
  'cursor',
  'goose',
  'kiro',
  'opencode',
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
  instanceId: string;
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
  providers: Record<string, WslDiscoveryProviderStatus>;
}

export interface DockerDiscoveryStatusSnapshot {
  backgroundEnabled: boolean;
  nativeDiscoveryIntervalMs: number;
  policy: DockerDiscoveryPolicy;
  summary: {
    state: 'not_applicable' | 'active' | 'disabled';
    message: string;
  };
  configuredTargets: number;
}

export interface DiscoveryStatusPayload {
  wsl: WslDiscoveryStatusSnapshot;
  docker: DockerDiscoveryStatusSnapshot;
}

export interface RunWslAwareNativeDiscoveryInput {
  provider: WslDiscoveryProviderName;
  providerInstanceId?: string;
  listAllSessions: () => Promise<NativeSessionSummary[]>;
  registry: SessionRegistry;
  runtime: CliRuntimeConfig['cursorRuntime'];
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
  private readonly providers: Record<string, WslDiscoveryProviderStatus>;
  private readonly defaultInstances: Record<WslDiscoveryProviderName, string>;

  constructor(config: Pick<
    CliRuntimeConfig,
    | 'cursorRuntime'
    | 'kiroRuntime'
    | 'nativeDiscoveryIntervalMs'
    | 'wslDiscoveryPolicy'
    | 'providerDefaultInstances'
    | 'providerInstances'
  >) {
    this.policy = config.wslDiscoveryPolicy ?? 'always';
    this.nativeDiscoveryIntervalMs = config.nativeDiscoveryIntervalMs;
    this.defaultInstances = {
      cursor: config.providerDefaultInstances?.cursor || 'default',
      kiro: config.providerDefaultInstances?.kiro || 'default',
    };
    this.providers = {};

    for (const instance of getConfiguredProviderRuntimes(config, 'cursor')) {
      this.providers[this.providerKey('cursor', instance.instanceId)] = this.createInitialProviderStatus(
        'cursor',
        instance.instanceId,
        instance.runtime,
      );
    }

    for (const instance of getConfiguredProviderRuntimes(config, 'kiro')) {
      this.providers[this.providerKey('kiro', instance.instanceId)] = this.createInitialProviderStatus(
        'kiro',
        instance.instanceId,
        instance.runtime,
      );
    }
  }

  snapshot(): WslDiscoveryStatusSnapshot {
    const providers = Object.fromEntries(
      Object.entries(this.providers).map(([key, value]) => [key, { ...value }]),
    );

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
    providerInstanceId: string | undefined,
    input: { message: string; wslRunning?: boolean },
  ): void {
    this.updateProvider(provider, providerInstanceId, {
      state: 'running',
      message: input.message,
      wslRunning: input.wslRunning,
      lastAttemptAt: nowIso(),
    });
  }

  markScanSuccess(
    provider: WslDiscoveryProviderName,
    providerInstanceId: string | undefined,
    input: { importedCount: number; message: string; wslRunning?: boolean },
  ): void {
    const timestamp = nowIso();
    this.updateProvider(provider, providerInstanceId, {
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
    providerInstanceId: string | undefined,
    input: { message: string; wslRunning?: boolean },
  ): void {
    this.updateProvider(provider, providerInstanceId, {
      state: 'skipped',
      message: input.message,
      importedCount: 0,
      wslRunning: input.wslRunning,
      lastAttemptAt: nowIso(),
    });
  }

  markDisabled(
    provider: WslDiscoveryProviderName,
    providerInstanceId: string | undefined,
    message: string,
  ): void {
    this.updateProvider(provider, providerInstanceId, {
      state: 'disabled',
      message,
      importedCount: 0,
      wslRunning: false,
    });
  }

  markFailure(
    provider: WslDiscoveryProviderName,
    providerInstanceId: string | undefined,
    error: unknown,
  ): void {
    this.updateProvider(provider, providerInstanceId, {
      state: 'failed',
      message: errorMessage(error),
      importedCount: 0,
      lastAttemptAt: nowIso(),
    });
  }

  private createInitialProviderStatus(
    provider: WslDiscoveryProviderName,
    instanceId: string,
    runtime: CliRuntimeConfig['cursorRuntime'],
  ): WslDiscoveryProviderStatus {
    if (runtime.mode !== 'wsl') {
      return {
        provider,
        instanceId,
        runtimeMode: runtime.mode,
        state: 'not_applicable',
        message: `${providerLabel(provider)} uses ${runtime.mode} runtime`,
      };
    }

    if (this.nativeDiscoveryIntervalMs <= 0) {
      return {
        provider,
        instanceId,
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
        instanceId,
        runtimeMode: runtime.mode,
        distro: runtime.distro || 'Ubuntu',
        state: 'disabled',
        message: 'Background WSL discovery is disabled by policy',
        wslRunning: false,
      };
    }

    return {
      provider,
      instanceId,
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
    providerInstanceId: string | undefined,
    next: Partial<WslDiscoveryProviderStatus>,
  ): void {
    const key = this.providerKey(provider, providerInstanceId);
    this.providers[key] = {
      ...this.providers[key],
      ...next,
    };
  }

  private providerKey(
    provider: WslDiscoveryProviderName,
    providerInstanceId?: string,
  ): string {
    const instanceId = providerInstanceId || this.defaultInstances[provider];
    return instanceId === this.defaultInstances[provider]
      ? provider
      : `${provider}@${instanceId}`;
  }
}

export async function runWslAwareNativeDiscovery(
  input: RunWslAwareNativeDiscoveryInput,
): Promise<WslAwareNativeDiscoveryResult> {
  if (input.runtime.mode !== 'wsl') {
    const result = syncNativeSessions(
      input.registry,
      input.provider,
      await input.listAllSessions(),
      input.providerInstanceId,
    );
    return {
      outcome: 'scanned',
      newCount: result.newCount,
      syncedCount: result.syncedCount,
    };
  }

  if (input.policy === 'manual_only') {
    input.statusStore.markDisabled(
      input.provider,
      input.providerInstanceId,
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
    let wslRunning: boolean | undefined = input.policy === 'always' ? true : undefined;

    if (input.policy === 'if_running') {
      wslRunning = await (input.inspector || isWslDistroRunning)(distro);
      if (!wslRunning) {
        input.statusStore.markSkipped(input.provider, input.providerInstanceId, {
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

    input.statusStore.markScanStart(input.provider, input.providerInstanceId, {
      wslRunning,
      message: `Scanning ${providerLabel(input.provider)} sessions in WSL distro '${distro}'`,
    });

    const result = syncNativeSessions(
      input.registry,
      input.provider,
      await input.listAllSessions(),
      input.providerInstanceId,
    );

    input.statusStore.markScanSuccess(input.provider, input.providerInstanceId, {
      importedCount: result.newCount,
      wslRunning,
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
    input.statusStore.markFailure(input.provider, input.providerInstanceId, error);
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
    | 'cursorRuntime'
    | 'kiroRuntime'
    | 'nativeDiscoveryIntervalMs'
    | 'dockerDiscoveryPolicy'
    | 'wslDiscoveryPolicy'
    | 'providerDefaultInstances'
    | 'providerInstances'
  >,
): DiscoveryStatusPayload {
  return {
    wsl: new WslDiscoveryStatusStore(config).snapshot(),
    docker: createDockerDiscoveryStatusSnapshot(config),
  };
}

function getConfiguredProviderRuntimes(
  config: Pick<
    CliRuntimeConfig,
    | 'cursorRuntime'
    | 'kiroRuntime'
    | 'providerDefaultInstances'
    | 'providerInstances'
  >,
  provider: WslDiscoveryProviderName,
): Array<{ instanceId: string; runtime: CliRuntimeConfig['cursorRuntime'] }> {
  const configured = config.providerInstances?.[provider];
  if (configured && Object.keys(configured).length > 0) {
    return Object.values(configured).map((instance) => ({
      instanceId: instance.id,
      runtime: instance.commandConfig.runtime,
    }));
  }

  return [{
    instanceId: config.providerDefaultInstances?.[provider] || 'default',
    runtime: provider === 'cursor' ? config.cursorRuntime : config.kiroRuntime,
  }];
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...hiddenWindowsSpawnOptions(),
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
  providers: Record<string, WslDiscoveryProviderStatus>,
): { state: WslDiscoverySummaryState; message: string } {
  const relevant = Object.values(providers).filter((provider) => provider.runtimeMode === 'wsl');

  if (relevant.length === 0) {
    return {
      state: 'not_applicable',
      message: 'No WSL-backed native discovery targets configured',
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

export function createDockerDiscoveryStatusSnapshot(
  config: Pick<
    CliRuntimeConfig,
    | 'nativeDiscoveryIntervalMs'
    | 'dockerDiscoveryPolicy'
    | 'providerInstances'
  >,
): DockerDiscoveryStatusSnapshot {
  const policy = config.dockerDiscoveryPolicy ?? 'if_running';
  const configuredTargets = DOCKER_DISCOVERY_PROVIDERS
    .flatMap((provider) => Object.values(config.providerInstances?.[provider] || {}))
    .filter((instance) => instance.commandConfig.runtime.mode === 'docker')
    .length;

  if (configuredTargets === 0) {
    return {
      backgroundEnabled: config.nativeDiscoveryIntervalMs > 0,
      nativeDiscoveryIntervalMs: config.nativeDiscoveryIntervalMs,
      policy,
      summary: {
        state: 'not_applicable',
        message: 'No Docker-backed native discovery targets configured',
      },
      configuredTargets,
    };
  }

  if (config.nativeDiscoveryIntervalMs <= 0) {
    return {
      backgroundEnabled: false,
      nativeDiscoveryIntervalMs: config.nativeDiscoveryIntervalMs,
      policy,
      summary: {
        state: 'disabled',
        message: 'Background native discovery is disabled',
      },
      configuredTargets,
    };
  }

  if (policy === 'manual_only') {
    return {
      backgroundEnabled: true,
      nativeDiscoveryIntervalMs: config.nativeDiscoveryIntervalMs,
      policy,
      summary: {
        state: 'disabled',
        message: 'Background Docker discovery is disabled by policy',
      },
      configuredTargets,
    };
  }

  return {
    backgroundEnabled: true,
    nativeDiscoveryIntervalMs: config.nativeDiscoveryIntervalMs,
    policy,
    summary: {
      state: 'active',
      message: policy === 'if_running'
        ? 'Background Docker discovery scans when containers are running'
        : 'Background Docker discovery is active',
    },
    configuredTargets,
  };
}
