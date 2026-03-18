import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface RuntimePackageJson {
  version?: string;
}

function readRuntimePackageVersion(): string {
  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'package.json',
  );
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf8'),
  ) as RuntimePackageJson;

  if (!packageJson.version) {
    throw new Error(`Could not resolve version from ${packageJsonPath}`);
  }

  return packageJson.version;
}

export const RUNTIME_VERSION = readRuntimePackageVersion();

export type RuntimeStartupMode = 'standalone' | 'app-managed';
export type RuntimeReadyOutput = 'plain' | 'json' | 'silent';
export type RuntimeReadySignal = 'http';

export interface RuntimeCliOptions {
  help?: boolean;
  startupMode?: RuntimeStartupMode;
  managedBy?: string;
  readyOutput?: RuntimeReadyOutput;
  host?: string;
  port?: string;
  configPath?: string;
}

export interface RuntimeListeningAddress {
  host: string;
  port: number;
  healthUrl: string;
}

export interface RuntimeStartupState {
  mode: RuntimeStartupMode;
  managedBy?: string;
  readyOutput: RuntimeReadyOutput;
  readySignal: RuntimeReadySignal;
  pid: number;
  startedAt: string;
  ready: boolean;
  address?: RuntimeListeningAddress;
  version: string;
}

interface LifecycleEventPayload {
  event: 'runtime.ready' | 'runtime.startup_error';
  service: 'cats-runtime';
  version: string;
  pid: number;
  mode: RuntimeStartupMode;
  managedBy?: string;
  startedAt: string;
  readySignal?: RuntimeReadySignal;
  ready?: boolean;
  host?: string;
  port?: number;
  healthUrl?: string;
  error?: string;
}

function isStartupMode(value: string): value is RuntimeStartupMode {
  return value === 'standalone' || value === 'app-managed';
}

function isReadyOutput(value: string): value is RuntimeReadyOutput {
  return value === 'plain' || value === 'json' || value === 'silent';
}

function readOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseRuntimeCliOptions(argv: string[]): RuntimeCliOptions {
  const options: RuntimeCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--startup-mode') {
      const value = readOptionValue(argv, index, arg);
      if (!isStartupMode(value)) {
        throw new Error(`Invalid --startup-mode value '${value}'`);
      }
      options.startupMode = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--startup-mode=')) {
      const value = arg.slice('--startup-mode='.length);
      if (!isStartupMode(value)) {
        throw new Error(`Invalid --startup-mode value '${value}'`);
      }
      options.startupMode = value;
      continue;
    }

    if (arg === '--managed-by') {
      options.managedBy = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--managed-by=')) {
      options.managedBy = arg.slice('--managed-by='.length);
      continue;
    }

    if (arg === '--ready-output') {
      const value = readOptionValue(argv, index, arg);
      if (!isReadyOutput(value)) {
        throw new Error(`Invalid --ready-output value '${value}'`);
      }
      options.readyOutput = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--ready-output=')) {
      const value = arg.slice('--ready-output='.length);
      if (!isReadyOutput(value)) {
        throw new Error(`Invalid --ready-output value '${value}'`);
      }
      options.readyOutput = value;
      continue;
    }

    if (arg === '--host') {
      options.host = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
      continue;
    }

    if (arg === '--port') {
      options.port = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--port=')) {
      options.port = arg.slice('--port='.length);
      continue;
    }

    if (arg === '--config') {
      options.configPath = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length);
      continue;
    }

    throw new Error(`Unknown argument '${arg}'`);
  }

  return options;
}

export function applyRuntimeCliEnvOverrides(
  options: RuntimeCliOptions,
  env: NodeJS.ProcessEnv,
): void {
  if (options.host) {
    env.CATS_RUNTIME_HOST = options.host;
  }
  if (options.port) {
    env.CATS_RUNTIME_PORT = options.port;
  }
  if (options.configPath) {
    env.CATS_RUNTIME_CONFIG_PATH = options.configPath;
  }
}

export function createRuntimeStartupState(
  init: Partial<RuntimeStartupState> = {},
): RuntimeStartupState {
  return {
    mode: init.mode ?? 'standalone',
    managedBy: init.managedBy,
    readyOutput: init.readyOutput ?? 'plain',
    readySignal: init.readySignal ?? 'http',
    pid: init.pid ?? process.pid,
    startedAt: init.startedAt ?? new Date().toISOString(),
    ready: init.ready ?? false,
    address: init.address,
    version: init.version ?? RUNTIME_VERSION,
  };
}

export function resolveRuntimeStartupState(
  options: RuntimeCliOptions,
  env: NodeJS.ProcessEnv,
): RuntimeStartupState {
  const modeFromEnv = env.CATS_RUNTIME_STARTUP_MODE;
  const managedByFromEnv = env.CATS_RUNTIME_MANAGED_BY;
  const readyOutputFromEnv = env.CATS_RUNTIME_READY_OUTPUT;
  const normalizedModeFromEnv: RuntimeStartupMode | undefined = isStartupMode(modeFromEnv ?? '')
    ? modeFromEnv as RuntimeStartupMode
    : undefined;
  const normalizedReadyOutputFromEnv: RuntimeReadyOutput | undefined = isReadyOutput(readyOutputFromEnv ?? '')
    ? readyOutputFromEnv as RuntimeReadyOutput
    : undefined;

  const mode = options.startupMode
    ?? normalizedModeFromEnv
    ?? 'standalone';
  const readyOutput = options.readyOutput
    ?? normalizedReadyOutputFromEnv
    ?? (mode === 'app-managed' ? 'json' : 'plain');

  return createRuntimeStartupState({
    mode,
    managedBy: options.managedBy ?? managedByFromEnv,
    readyOutput,
  });
}

export function formatRuntimeReadyMessage(
  startup: RuntimeStartupState,
  address: RuntimeListeningAddress,
): string | null {
  if (startup.readyOutput === 'silent') {
    return null;
  }

  if (startup.readyOutput === 'json') {
    const payload: LifecycleEventPayload = {
      event: 'runtime.ready',
      service: 'cats-runtime',
      version: startup.version,
      pid: startup.pid,
      mode: startup.mode,
      managedBy: startup.managedBy,
      startedAt: startup.startedAt,
      readySignal: startup.readySignal,
      ready: true,
      host: address.host,
      port: address.port,
      healthUrl: address.healthUrl,
    };
    return `${JSON.stringify(payload)}\n`;
  }

  return `cats-runtime listening on http://${address.host}:${address.port}\n`;
}

export function formatRuntimeStartupError(
  startup: RuntimeStartupState,
  error: unknown,
): string {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  if (startup.readyOutput === 'json') {
    const payload: LifecycleEventPayload = {
      event: 'runtime.startup_error',
      service: 'cats-runtime',
      version: startup.version,
      pid: startup.pid,
      mode: startup.mode,
      managedBy: startup.managedBy,
      startedAt: startup.startedAt,
      error: message,
    };
    return `${JSON.stringify(payload)}\n`;
  }

  return `${message}\n`;
}

export function getRuntimeHelpText(): string {
  return [
    'Usage: cats-runtime [options]',
    '',
    'Options:',
    '  --startup-mode <standalone|app-managed>',
    '  --managed-by <name>',
    '  --ready-output <plain|json|silent>',
    '  --host <host>',
    '  --port <port>',
    '  --config <path>',
    '  -h, --help',
  ].join('\n');
}
