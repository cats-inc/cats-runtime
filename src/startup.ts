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
export const RUNTIME_SERVICE_NAME = 'cats-runtime';
export const RUNTIME_STARTUP_CONTRACT_VERSION = 1;
export const RUNTIME_READINESS_PATH = '/health';
export const RUNTIME_LIFECYCLE_EVENTS = [
  'runtime.ready',
  'runtime.startup_error',
  'runtime.stopping',
  'runtime.stopped',
] as const;

export type RuntimeStartupMode = 'standalone' | 'app-managed';
export type RuntimeReadyOutput = 'plain' | 'json' | 'silent';
export type RuntimeReadySignal = 'http';
export type RuntimeLifecycleEventName = typeof RUNTIME_LIFECYCLE_EVENTS[number];
export type RuntimeLifecyclePhase = 'starting' | 'ready' | 'stopping' | 'stopped';
export type RuntimeShutdownReason = 'sigint' | 'sigterm' | 'stdin_closed';

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
  contractVersion: number;
  mode: RuntimeStartupMode;
  managedBy?: string;
  readyOutput: RuntimeReadyOutput;
  readySignal: RuntimeReadySignal;
  readinessPath: string;
  phase: RuntimeLifecyclePhase;
  pid: number;
  startedAt: string;
  ready: boolean;
  address?: RuntimeListeningAddress;
  shutdownReason?: RuntimeShutdownReason;
  lastEvent?: RuntimeLifecycleEventName;
  version: string;
}

interface LifecycleEventPayload {
  event: RuntimeLifecycleEventName;
  service: typeof RUNTIME_SERVICE_NAME;
  contractVersion: number;
  version: string;
  pid: number;
  mode: RuntimeStartupMode;
  managedBy?: string;
  startedAt: string;
  timestamp: string;
  phase: RuntimeLifecyclePhase;
  readySignal: RuntimeReadySignal;
  readinessPath: string;
  ready: boolean;
  host?: string;
  port?: number;
  healthUrl?: string;
  reason?: RuntimeShutdownReason;
  error?: string;
}

export interface RuntimeReadinessSnapshot {
  endpoint: string;
  authoritative: true;
  readySignal: RuntimeReadySignal;
  phase: RuntimeLifecyclePhase;
  ready: boolean;
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
    contractVersion: init.contractVersion ?? RUNTIME_STARTUP_CONTRACT_VERSION,
    mode: init.mode ?? 'standalone',
    managedBy: init.managedBy,
    readyOutput: init.readyOutput ?? 'plain',
    readySignal: init.readySignal ?? 'http',
    readinessPath: init.readinessPath ?? RUNTIME_READINESS_PATH,
    phase: init.phase ?? (init.ready ? 'ready' : 'starting'),
    pid: init.pid ?? process.pid,
    startedAt: init.startedAt ?? new Date().toISOString(),
    ready: init.ready ?? false,
    address: init.address,
    shutdownReason: init.shutdownReason,
    lastEvent: init.lastEvent,
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

export function getRuntimeReadinessSnapshot(
  startup: RuntimeStartupState,
): RuntimeReadinessSnapshot {
  return {
    endpoint: startup.readinessPath,
    authoritative: true,
    readySignal: startup.readySignal,
    phase: startup.phase,
    ready: startup.ready && startup.phase === 'ready',
  };
}

export function markRuntimeReady(
  startup: RuntimeStartupState,
  address: RuntimeListeningAddress,
): RuntimeStartupState {
  startup.phase = 'ready';
  startup.ready = true;
  startup.address = address;
  return startup;
}

export function markRuntimeStopping(
  startup: RuntimeStartupState,
  reason?: RuntimeShutdownReason,
): RuntimeStartupState {
  startup.phase = 'stopping';
  startup.ready = false;
  if (reason) {
    startup.shutdownReason = reason;
  }
  return startup;
}

export function markRuntimeStopped(
  startup: RuntimeStartupState,
  reason?: RuntimeShutdownReason,
): RuntimeStartupState {
  startup.phase = 'stopped';
  startup.ready = false;
  if (reason) {
    startup.shutdownReason = reason;
  }
  return startup;
}

function buildLifecycleEventPayload(
  startup: RuntimeStartupState,
  event: RuntimeLifecycleEventName,
  details: {
    address?: RuntimeListeningAddress;
    error?: string;
    reason?: RuntimeShutdownReason;
  } = {},
): LifecycleEventPayload {
  startup.lastEvent = event;
  const address = details.address ?? startup.address;
  const readiness = getRuntimeReadinessSnapshot(startup);
  return {
    event,
    service: RUNTIME_SERVICE_NAME,
    contractVersion: startup.contractVersion,
    version: startup.version,
    pid: startup.pid,
    mode: startup.mode,
    managedBy: startup.managedBy,
    startedAt: startup.startedAt,
    timestamp: new Date().toISOString(),
    phase: startup.phase,
    readySignal: startup.readySignal,
    readinessPath: startup.readinessPath,
    ready: readiness.ready,
    host: address?.host,
    port: address?.port,
    healthUrl: address?.healthUrl,
    reason: details.reason ?? startup.shutdownReason,
    error: details.error,
  };
}

export function formatRuntimeLifecycleEvent(
  startup: RuntimeStartupState,
  event: RuntimeLifecycleEventName,
  details: {
    address?: RuntimeListeningAddress;
    error?: string;
    reason?: RuntimeShutdownReason;
  } = {},
): string | null {
  if (startup.readyOutput === 'silent' && event !== 'runtime.startup_error') {
    startup.lastEvent = event;
    return null;
  }

  const payload = buildLifecycleEventPayload(startup, event, details);

  if (startup.readyOutput === 'json') {
    return `${JSON.stringify(payload)}\n`;
  }

  switch (event) {
    case 'runtime.ready':
      return `cats-runtime listening on http://${payload.host}:${payload.port}\n`;
    case 'runtime.stopping':
      return `cats-runtime stopping (${payload.reason || 'shutdown'})\n`;
    case 'runtime.stopped':
      return `cats-runtime stopped (${payload.reason || 'shutdown'})\n`;
    case 'runtime.startup_error':
      return `${payload.error || 'Unknown startup error'}\n`;
    default:
      return null;
  }
}

export function formatRuntimeReadyMessage(
  startup: RuntimeStartupState,
  address: RuntimeListeningAddress,
): string | null {
  return formatRuntimeLifecycleEvent(startup, 'runtime.ready', { address });
}

export function formatRuntimeStoppingMessage(
  startup: RuntimeStartupState,
  reason: RuntimeShutdownReason,
): string | null {
  return formatRuntimeLifecycleEvent(startup, 'runtime.stopping', { reason });
}

export function formatRuntimeStoppedMessage(
  startup: RuntimeStartupState,
  reason: RuntimeShutdownReason,
): string | null {
  return formatRuntimeLifecycleEvent(startup, 'runtime.stopped', { reason });
}

export function formatRuntimeStartupError(
  startup: RuntimeStartupState,
  error: unknown,
): string {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  return formatRuntimeLifecycleEvent(startup, 'runtime.startup_error', {
    error: message,
  }) || `${message}\n`;
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
