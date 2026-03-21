import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { buildAgentAdapter } from '../backends/agent/adapters/registry.js';
import {
  loadConfig as loadCliConfig,
  type CliRuntimeConfig,
  type RemoteProviderInstanceConfig,
} from '../backends/cli/config.js';
import {
  getConfiguredFileBackedProviderPath,
  resolveFileBackedProviderPath,
  supportsHostFileBackedProviderDiscovery,
} from '../backends/cli/providerPaths.js';
import type { HealthStatus } from './types.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliRuntimeConfig {
  return loadCliConfig(env);
}

export interface RuntimeResolvedPaths {
  configPath: string | null;
  dataDir: string;
  sessionBaseDir: string;
}

export function getRuntimeResolvedPaths(
  config: Pick<CliRuntimeConfig, 'configPath' | 'dataDir' | 'sessionBaseDir'>,
): RuntimeResolvedPaths {
  return {
    configPath: config.configPath || null,
    dataDir: config.dataDir || join(config.sessionBaseDir, '..', 'data'),
    sessionBaseDir: config.sessionBaseDir,
  };
}

export function getRuntimeListenerConfig(
  config: Pick<CliRuntimeConfig, 'host' | 'port'>,
): { host: string; port: number } {
  return {
    host: config.host || '0.0.0.0',
    port: config.port,
  };
}

const FILE_BACKED_PROVIDER_NAMES = [
  'auggie',
  'claude',
  'codex',
  'copilot',
  'gemini',
  'pi',
] as const;

export type FileBackedProviderName = (typeof FILE_BACKED_PROVIDER_NAMES)[number];

export interface RuntimeCommandLookupResult {
  available: boolean;
  resolvedPath?: string;
}

export interface FileBackedProviderDiscoveryInfo {
  configuredPath: string;
  hostDiscoverySupported: boolean;
  resolvedPath?: string;
}

export interface RuntimeAgentProbeResult {
  kind: string;
  supported: boolean;
  result?: HealthStatus;
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

async function runCommandLookup(
  command: string,
  args: string[],
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolveLookup) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    let settled = false;

    const finish = (result: { status: number | null; stdout: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveLookup(result);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.once('error', () => {
      finish({ status: null, stdout: '' });
    });
    child.once('close', (status) => {
      finish({ status, stdout });
    });
  });
}

export function getRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<NodeJS.ProcessEnv> {
  return env;
}

export function isFileBackedProvider(
  providerName: string,
): providerName is FileBackedProviderName {
  return (FILE_BACKED_PROVIDER_NAMES as readonly string[]).includes(providerName);
}

export async function runtimePathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

export async function lookupRuntimeCommand(
  command: string,
): Promise<RuntimeCommandLookupResult> {
  if (!command.trim()) {
    return { available: false };
  }

  if (isAbsolute(command) || hasPathSeparator(command)) {
    const resolvedPath = isAbsolute(command) ? command : resolvePath(command);
    return {
      available: await runtimePathExists(resolvedPath),
      resolvedPath,
    };
  }

  const lookupCommandName = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runCommandLookup(lookupCommandName, [command]);
  const resolvedPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return {
    available: result.status === 0 && Boolean(resolvedPath),
    resolvedPath,
  };
}

export function getFileBackedProviderDiscoveryInfo(
  config: CliRuntimeConfig,
  provider: FileBackedProviderName,
  instanceId?: string,
): FileBackedProviderDiscoveryInfo {
  const configuredPath = getConfiguredFileBackedProviderPath(
    config,
    provider,
    instanceId,
  );
  const hostDiscoverySupported = supportsHostFileBackedProviderDiscovery(
    config,
    provider,
    instanceId,
  );

  return {
    configuredPath,
    hostDiscoverySupported,
    resolvedPath: hostDiscoverySupported
      ? resolveFileBackedProviderPath(config, provider, instanceId)
      : undefined,
  };
}

export async function probeRuntimeAgentInstance(
  instance: RemoteProviderInstanceConfig,
  runProbe = true,
): Promise<RuntimeAgentProbeResult> {
  const adapter = buildAgentAdapter(instance);
  if (!adapter.probe) {
    return {
      kind: adapter.kind,
      supported: false,
    };
  }

  if (!runProbe) {
    return {
      kind: adapter.kind,
      supported: true,
    };
  }

  return {
    kind: adapter.kind,
    supported: true,
    result: await adapter.probe(instance),
  };
}

export type {
  CliRuntimeConfig as RuntimeConfig,
  ProviderRuntimeConfig,
  ProviderCommandConfig,
  RunnerMode,
  RuntimeMode,
} from '../backends/cli/config.js';
