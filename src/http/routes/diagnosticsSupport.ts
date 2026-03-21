import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { buildAgentAdapter } from '../../backends/agent/adapters/registry.js';
import type { RemoteProviderInstanceConfig } from '../../backends/cli/config.js';
import {
  getConfiguredFileBackedProviderPath,
  resolveFileBackedProviderPath,
  supportsHostFileBackedProviderDiscovery,
} from '../../backends/cli/providerPaths.js';
import type { RuntimeConfig } from '../../core/config.js';
import type { HealthStatus } from '../../core/types.js';
import type { AppContext } from '../app.js';

const FILE_BACKED_PROVIDER_NAMES = [
  'auggie',
  'claude',
  'codex',
  'copilot',
  'gemini',
  'pi',
] as const;

const DEFAULT_RUNTIME_COMMAND_LOOKUP_TIMEOUT_MS = 5000;

export type FileBackedProviderName = (typeof FILE_BACKED_PROVIDER_NAMES)[number];

export type RuntimeRouteEnv = {
  Variables: {
    ctx: AppContext;
  };
};

export interface RuntimeCommandLookupResult {
  available: boolean;
  resolvedPath?: string;
  timedOut?: boolean;
}

export interface RuntimeCommandLookupOptions {
  timeoutMs?: number;
  lookupCommandName?: string;
  lookupArgs?: string[];
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
  timeoutMs: number,
): Promise<{ status: number | null; stdout: string; timedOut: boolean }> {
  return new Promise((resolveLookup) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    let settled = false;
    let timedOut = false;

    const finish = (result: { status: number | null; stdout: string; timedOut: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveLookup(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Ignore kill errors and surface the timeout result.
      }
      finish({ status: null, stdout, timedOut: true });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.once('error', () => {
      finish({ status: null, stdout, timedOut });
    });
    child.once('close', (status) => {
      finish({ status, stdout, timedOut });
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
  options: RuntimeCommandLookupOptions = {},
): Promise<RuntimeCommandLookupResult> {
  if (!command.trim()) {
    return { available: false };
  }

  if (isAbsolute(command) || hasPathSeparator(command)) {
    const resolvedPath = isAbsolute(command) ? command : resolvePath(command);
    return {
      available: await runtimePathExists(resolvedPath),
      resolvedPath,
      timedOut: false,
    };
  }

  const lookupCommandName = options.lookupCommandName
    || (process.platform === 'win32' ? 'where.exe' : 'which');
  const lookupArgs = options.lookupArgs || [command];
  const result = await runCommandLookup(
    lookupCommandName,
    lookupArgs,
    options.timeoutMs ?? DEFAULT_RUNTIME_COMMAND_LOOKUP_TIMEOUT_MS,
  );
  const resolvedPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return {
    available: result.status === 0 && Boolean(resolvedPath),
    resolvedPath,
    timedOut: result.timedOut,
  };
}

export function getFileBackedProviderDiscoveryInfo(
  config: RuntimeConfig,
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
