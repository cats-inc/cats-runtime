import { join } from 'node:path';
import type { ProviderName } from './providers/types.js';

const RUNNER_MODES = [
  'auto',
  'shell',
  'direct',
  'cmd',
  'pwsh',
  'powershell',
] as const;
const RUNTIME_MODES = [
  'native',
  'wsl',
] as const;

export type RunnerMode = typeof RUNNER_MODES[number];
export type RuntimeMode = typeof RUNTIME_MODES[number];

export interface RuntimeConfig {
  mode: RuntimeMode;
  distro?: string;
}

export interface ProviderCommandConfig {
  path: string;
  runner: RunnerMode;
  runnerPath?: string;
  runtime: RuntimeConfig;
}

export interface FleetConfig {
  host: string;
  port: number;
  apiKey: string;
  auggieMaxTurns: number;
  auggiePath: string;
  claudePath: string;
  codexPath: string;
  copilotPath: string;
  cursorPath: string;
  geminiPath: string;
  kiroPath: string;
  opencodePath: string;
  opencodeServerHost: string;
  opencodeServerPort: number;
  opencodeServerStartupTimeoutMs: number;
  auggieSessionsDir: string;
  claudeProjectsDir: string;
  codexSessionsDir: string;
  copilotSessionsDir: string;
  cursorChatsDir: string;
  cursorRuntime: RuntimeConfig;
  geminiSessionsDir: string;
  kiroDbPath: string;
  kiroRuntime: RuntimeConfig;
  nativeDiscoveryIntervalMs: number;
  externalSessionLiveWindowMs: number;
  maxSessions: number;
  sessionBaseDir: string;
  providerCommands: Record<ProviderName, ProviderCommandConfig>;
}

export function defaultCursorAndKiroRuntimeMode(
  platform: NodeJS.Platform = process.platform,
): RuntimeMode {
  return platform === 'win32' ? 'wsl' : 'native';
}

export function defaultProviderRuntimeMode(
  provider: ProviderName,
  platform: NodeJS.Platform = process.platform,
): RuntimeMode {
  if (provider === 'cursor' || provider === 'kiro') {
    return defaultCursorAndKiroRuntimeMode(platform);
  }

  return 'native';
}

export function defaultCursorChatsDir(): string {
  return '~/.cursor/chats';
}

export function defaultAuggieSessionsDir(): string {
  return '~/.augment/sessions';
}

export function defaultAuggieMaxTurns(): number {
  return 10;
}

export function defaultKiroDbPath(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'darwin') {
    return '~/Library/Application Support/kiro-cli/data.sqlite3';
  }

  return '~/.local/share/kiro-cli/data.sqlite3';
}

export function defaultOpencodeServerHost(): string {
  return '127.0.0.1';
}

export function defaultOpencodeServerPort(): number {
  return 4097;
}

export function defaultOpencodeServerStartupTimeoutMs(): number {
  return 10000;
}

export function defaultNativeDiscoveryIntervalMs(): number {
  return 5000;
}

export function defaultExternalSessionLiveWindowMs(): number {
  return 15000;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FleetConfig {
  const home = env.HOME || env.USERPROFILE || '';

  const auggiePath = env.AUGGIE_PATH || 'auggie';
  const claudePath = env.CLAUDE_PATH || 'claude';
  const codexPath = env.CODEX_PATH || 'codex';
  const copilotPath = env.COPILOT_PATH || 'copilot';
  const cursorPath = env.CURSOR_PATH || 'cursor-agent';
  const geminiPath = env.GEMINI_PATH || 'gemini';
  const kiroPath = env.KIRO_PATH || 'kiro-cli';
  const opencodePath = env.OPENCODE_PATH || 'opencode';

  const apiKey = env.CATS_RUNTIME_API_KEY || env.FLEET_API_KEY || '';
  const host = env.CATS_RUNTIME_HOST
    || env.FLEET_HOST
    || (apiKey ? '' : '127.0.0.1');
  const port = parsePositiveInt(
    env.CATS_RUNTIME_PORT || env.PORT || env.FLEET_PORT || '3110',
    3110,
    'CATS_RUNTIME_PORT',
  );
  const sessionBaseDir = env.CATS_RUNTIME_SESSION_BASE_DIR
    || env.FLEET_SESSION_BASE_DIR
    || join(home, '.cats-runtime', 'sessions');

  return {
    host,
    port,
    apiKey,
    auggieMaxTurns: parsePositiveInt(
      env.AUGGIE_MAX_TURNS,
      defaultAuggieMaxTurns(),
      'AUGGIE_MAX_TURNS',
    ),
    auggiePath,
    claudePath,
    codexPath,
    copilotPath,
    cursorPath,
    geminiPath,
    kiroPath,
    opencodePath,
    opencodeServerHost: env.OPENCODE_SERVER_HOST
      || defaultOpencodeServerHost(),
    opencodeServerPort: parseInt(
      env.OPENCODE_SERVER_PORT || String(defaultOpencodeServerPort()),
      10,
    ),
    opencodeServerStartupTimeoutMs: parsePositiveInt(
      env.OPENCODE_SERVER_STARTUP_TIMEOUT_MS,
      defaultOpencodeServerStartupTimeoutMs(),
      'OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
    ),
    auggieSessionsDir: env.AUGGIE_SESSIONS_DIR
      || defaultAuggieSessionsDir(),
    claudeProjectsDir: env.CLAUDE_PROJECTS_DIR
      || `${home}/.claude/projects`,
    codexSessionsDir: env.CODEX_SESSIONS_DIR
      || `${home}/.codex/sessions`,
    copilotSessionsDir: env.COPILOT_SESSIONS_DIR
      || `${home}/.copilot/session-state`,
    cursorChatsDir: env.CURSOR_CHATS_DIR
      || defaultCursorChatsDir(),
    cursorRuntime: readRuntimeConfig(
      'CURSOR',
      defaultProviderRuntimeMode('cursor'),
      env,
    ),
    geminiSessionsDir: env.GEMINI_SESSIONS_DIR
      || `${home}/.gemini/tmp`,
    kiroDbPath: env.KIRO_DB_PATH
      || defaultKiroDbPath(),
    kiroRuntime: readRuntimeConfig(
      'KIRO',
      defaultProviderRuntimeMode('kiro'),
      env,
    ),
    nativeDiscoveryIntervalMs: parseNonNegativeInt(
      env.CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS
        || env.NATIVE_DISCOVERY_INTERVAL_MS,
      defaultNativeDiscoveryIntervalMs(),
      'CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS',
    ),
    externalSessionLiveWindowMs: parseNonNegativeInt(
      env.CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS
        || env.EXTERNAL_SESSION_LIVE_WINDOW_MS,
      defaultExternalSessionLiveWindowMs(),
      'CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS',
    ),
    maxSessions: parsePositiveInt(
      env.CATS_RUNTIME_MAX_SESSIONS || env.FLEET_MAX_SESSIONS,
      10,
      'CATS_RUNTIME_MAX_SESSIONS',
    ),
    sessionBaseDir,
    providerCommands: {
      auggie: readProviderCommandConfig(
        'AUGGIE',
        auggiePath,
        defaultProviderRuntimeMode('auggie'),
        env,
      ),
      claude: readProviderCommandConfig(
        'CLAUDE',
        claudePath,
        defaultProviderRuntimeMode('claude'),
        env,
      ),
      codex: readProviderCommandConfig(
        'CODEX',
        codexPath,
        defaultProviderRuntimeMode('codex'),
        env,
      ),
      copilot: readProviderCommandConfig(
        'COPILOT',
        copilotPath,
        defaultProviderRuntimeMode('copilot'),
        env,
      ),
      cursor: readProviderCommandConfig(
        'CURSOR',
        cursorPath,
        defaultProviderRuntimeMode('cursor'),
        env,
      ),
      gemini: readProviderCommandConfig(
        'GEMINI',
        geminiPath,
        defaultProviderRuntimeMode('gemini'),
        env,
      ),
      kiro: readProviderCommandConfig(
        'KIRO',
        kiroPath,
        defaultProviderRuntimeMode('kiro'),
        env,
      ),
      opencode: readProviderCommandConfig(
        'OPENCODE',
        opencodePath,
        defaultProviderRuntimeMode('opencode'),
        env,
      ),
    },
  };
}

function readProviderCommandConfig(
  prefix: string,
  defaultPath: string,
  defaultRuntimeMode: RuntimeMode = 'native',
  env: NodeJS.ProcessEnv = process.env,
): ProviderCommandConfig {
  return {
    path: env[`${prefix}_PATH`] || defaultPath,
    runner: parseRunnerMode(prefix, env),
    runnerPath: readRunnerPath(prefix, env),
    runtime: readRuntimeConfig(prefix, defaultRuntimeMode, env),
  };
}

function parseRunnerMode(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): RunnerMode {
  const value = (env[`${prefix}_RUNNER`] || 'auto').trim().toLowerCase();
  if ((RUNNER_MODES as readonly string[]).includes(value)) {
    return value as RunnerMode;
  }

  throw new Error(
    `Invalid ${prefix}_RUNNER='${value}'. Valid values: ${RUNNER_MODES.join(', ')}`,
  );
}

function readRuntimeConfig(
  prefix: string,
  defaultMode: RuntimeMode,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const value = (env[`${prefix}_RUNTIME`] || defaultMode).trim().toLowerCase();
  if (!(RUNTIME_MODES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid ${prefix}_RUNTIME='${value}'. Valid values: ${RUNTIME_MODES.join(', ')}`,
    );
  }

  return {
    mode: value as RuntimeMode,
    distro: env[`${prefix}_RUNTIME_DISTRO`]
      || env[`${prefix}_WSL_DISTRO`]
      || undefined,
  };
}

function readRunnerPath(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[`${prefix}_RUNNER_PATH`]
    || env[`${prefix}_SHELL_PATH`]
    || undefined;
}

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
  envName: string,
): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative integer, got '${value}'`);
  }

  return parsed;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  envName: string,
): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer, got '${value}'`);
  }

  return parsed;
}
