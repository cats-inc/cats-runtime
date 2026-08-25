import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { buildAgentAdapter } from '../../backends/agent/adapters/registry.js';
import type {
  ProviderRuntimeConfig,
  RemoteProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type {
  AgentAdapterProbeOptions,
  AgentAdapterProbeResult,
} from '../../backends/agent/types.js';
import {
  getConfiguredFileBackedProviderPath,
  resolveFileBackedProviderPath,
  supportsHostFileBackedProviderDiscovery,
} from '../../backends/cli/providerPaths.js';
import {
  createRuntimeAdapter,
  quoteForBash,
} from '../../backends/cli/runtime/runtime.js';
import type { RuntimeConfig } from '../../core/config.js';
import type { AppContext } from '../app.js';

const FILE_BACKED_PROVIDER_NAMES = [
  'auggie',
  'claude',
  'codex',
  'copilot',
  'pi',
] as const;

const DEFAULT_RUNTIME_COMMAND_LOOKUP_TIMEOUT_MS = 5000;
// ACP diagnostics can perform three sequential bounded operations: a command
// help check, initialize, and session bootstrap. Devin 3000.5.20 takes about
// 8.5 seconds for the protocol bootstrap alone on Windows, so the old 5-second
// outer deadline incorrectly marked a healthy target unavailable before the
// adapter's own per-operation timeouts could run.
export const DEFAULT_RUNTIME_AGENT_PROBE_TIMEOUT_MS = 20000;

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

export interface RuntimeExecutionCommandLookupOptions {
  timeoutMs?: number;
  shellRunner?: (
    invocation: { command: string; args: string[] },
    timeoutMs: number,
  ) => Promise<{ status: number | null; stdout: string; timedOut: boolean }>;
}

export interface FileBackedProviderDiscoveryInfo {
  configuredPath: string;
  hostDiscoverySupported: boolean;
  resolvedPath?: string;
}

export interface RuntimeAgentProbeResult {
  kind: string;
  supported: boolean;
  result?: AgentAdapterProbeResult;
}

export interface RuntimeAgentProbeOptions {
  timeoutMs?: number;
  probe?: AgentAdapterProbeOptions;
  adapter?: {
    kind: string;
    probe?: (
      instance: RemoteProviderInstanceConfig,
      options?: AgentAdapterProbeOptions,
    ) => Promise<AgentAdapterProbeResult>;
  };
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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

export async function lookupRuntimeCommandInExecutionEnvironment(
  command: string,
  runtime: ProviderRuntimeConfig,
  options: RuntimeExecutionCommandLookupOptions = {},
): Promise<RuntimeCommandLookupResult> {
  if (!command.trim()) {
    return { available: false };
  }

  if (runtime.mode === 'native') {
    return lookupRuntimeCommand(command, {
      timeoutMs: options.timeoutMs,
    });
  }

  const invocation = createRuntimeAdapter(runtime).buildShellInvocation(
    `command -v ${quoteForBash(command)}`,
  );
  const result = await (options.shellRunner || runShellInvocation)(
    invocation,
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
  options: RuntimeAgentProbeOptions = {},
): Promise<RuntimeAgentProbeResult> {
  const adapter = options.adapter || buildAgentAdapter(instance);
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
    result: await withTimeout(
      adapter.probe(instance, options.probe),
      options.timeoutMs ?? DEFAULT_RUNTIME_AGENT_PROBE_TIMEOUT_MS,
      `Timed out while probing agent adapter '${adapter.kind}' for `
      + `${instance.providerName}/${instance.id}`,
    ),
  };
}

async function runShellInvocation(
  invocation: { command: string; args: string[] },
  timeoutMs: number,
): Promise<{ status: number | null; stdout: string; timedOut: boolean }> {
  return runCommandLookup(invocation.command, invocation.args, timeoutMs);
}
