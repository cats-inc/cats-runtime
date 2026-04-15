import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { KNOWN_PROVIDERS, type ProviderName } from './providers/types.js';
import {
  resolveRuntimeDataDir,
  resolveRuntimeProvidersConfigPath,
  resolveRuntimeRoot,
  resolveRuntimeSessionsDir,
} from '../../shared/runtimePaths.js';

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
  'docker',
] as const;
const WSL_DISCOVERY_POLICIES = [
  'always',
  'if_running',
  'manual_only',
] as const;
const DOCKER_DISCOVERY_POLICIES = [
  'always',
  'if_running',
  'manual_only',
] as const;

export type RunnerMode = typeof RUNNER_MODES[number];
export type RuntimeMode = typeof RUNTIME_MODES[number];
export type WslDiscoveryPolicy = typeof WSL_DISCOVERY_POLICIES[number];
export type DockerDiscoveryPolicy = typeof DOCKER_DISCOVERY_POLICIES[number];
export type BackendKind = 'cli' | 'api' | 'local' | 'agent';

export interface LoadConfigOptions {
  skipProviderFile?: boolean;
}

export interface ProviderRuntimeConfig {
  mode: RuntimeMode;
  distro?: string;
  container?: string;
  environmentId?: string;
}

export interface ProviderCommandConfig {
  path: string;
  runner: RunnerMode;
  runnerPath?: string;
  runtime: ProviderRuntimeConfig;
}

export interface ProviderDefaultTarget {
  backend: BackendKind;
  instance: string;
}

export interface RemoteProviderInstanceConfig {
  id: string;
  providerName: string;
  backend: Exclude<BackendKind, 'cli'>;
  transport?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  urlEnv?: string;
  model?: string;
  systemPrompt?: string;
  apiKeyEnv?: string;
  authTokenEnv?: string;
  passwordEnv?: string;
  baseUrl?: string;
  baseUrlEnv?: string;
  organizationEnv?: string;
  projectEnv?: string;
  headers?: Record<string, string>;
  clientId?: string;
  clientMode?: string;
  clientVersion?: string;
  role?: string;
  scopes?: string[];
  payloadTemplate?: Record<string, unknown>;
  waitTimeoutMs?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  maxToolSteps?: number;
  toolProfile?: string;
  startupTimeoutMs?: number;
}

export interface RemoteProviderCatalog {
  api: Record<string, Record<string, RemoteProviderInstanceConfig>>;
  local: Record<string, Record<string, RemoteProviderInstanceConfig>>;
  agent: Record<string, Record<string, RemoteProviderInstanceConfig>>;
}

export class UnknownProviderInstanceError extends Error {
  readonly provider: ProviderName;
  readonly instanceId: string;
  readonly validInstances: string[];

  constructor(provider: ProviderName, instanceId: string, validInstances: string[]) {
    super(`Unknown ${provider} instance '${instanceId}'. Valid: ${validInstances.join(', ')}`);
    this.name = 'UnknownProviderInstanceError';
    this.provider = provider;
    this.instanceId = instanceId;
    this.validInstances = validInstances;
  }
}

export class ProviderNotConfiguredError extends Error {
  readonly provider: ProviderName;

  constructor(provider: ProviderName) {
    super(`Provider '${provider}' is not configured`);
    this.name = 'ProviderNotConfiguredError';
    this.provider = provider;
  }
}

export function isProviderNotConfiguredError(
  error: unknown,
): error is ProviderNotConfiguredError {
  return error instanceof ProviderNotConfiguredError;
}

export interface ProviderInstanceConfig {
  id: string;
  providerName: ProviderName;
  commandConfig: ProviderCommandConfig;
  timeoutMs?: number;
  auggieSessionsDir?: string;
  claudeProjectsDir?: string;
  codexSessionsDir?: string;
  copilotSessionsDir?: string;
  cursorChatsDir?: string;
  geminiSessionsDir?: string;
  kiroDbPath?: string;
  kiloServerHost?: string;
  kiloServerPort?: number;
  kiloServerStartupTimeoutMs?: number;
  opencodeServerHost?: string;
  opencodeServerPort?: number;
  opencodeServerStartupTimeoutMs?: number;
  piSessionsDir?: string;
  piInstructionsFile?: string;
}

export interface RuntimeMeteringConfig {
  sessionTotalTokensWarn?: number;
  sessionTotalTokensBlock?: number;
  rateLimitCooldownMs?: number;
}

export interface CliRuntimeConfig {
  host: string;
  port: number;
  apiKey: string;
  dataDir?: string;
  configPath: string;
  auggieMaxTurns: number;
  auggiePath: string;
  claudePath: string;
  codexPath: string;
  copilotPath: string;
  cursorPath: string;
  geminiPath: string;
  kiroPath: string;
  kiloPath: string;
  opencodePath: string;
  goosePath: string;
  juniePath: string;
  piPath: string;
  kiloServerHost: string;
  kiloServerPort: number;
  kiloServerStartupTimeoutMs: number;
  opencodeServerHost: string;
  opencodeServerPort: number;
  opencodeServerStartupTimeoutMs: number;
  auggieSessionsDir: string;
  claudeProjectsDir: string;
  codexSessionsDir: string;
  copilotSessionsDir: string;
  cursorChatsDir: string;
  cursorRuntime: ProviderRuntimeConfig;
  geminiSessionsDir: string;
  kiroDbPath: string;
  kiroRuntime: ProviderRuntimeConfig;
  piSessionsDir: string;
  wslDiscoveryPolicy?: WslDiscoveryPolicy;
  dockerDiscoveryPolicy?: DockerDiscoveryPolicy;
  compatibilityProbeTimeoutMs: number;
  compatibilityProbeWslTimeoutMs: number;
  compatibilityProbeDockerTimeoutMs: number;
  nativeDiscoveryIntervalMs: number;
  externalSessionLiveWindowMs: number;
  maxSessions: number;
  spawnRetries: number;
  spawnTimeoutMs: number;
  sessionBaseDir: string;
  metering?: RuntimeMeteringConfig;
  providerCommands: Record<ProviderName, ProviderCommandConfig>;
  providerDefaultInstances?: Partial<Record<ProviderName, string>>;
  providerInstances?: Partial<Record<ProviderName, Record<string, ProviderInstanceConfig>>>;
  providerDefaultTargets?: Record<string, ProviderDefaultTarget>;
  remoteProviderCatalog?: RemoteProviderCatalog;
  dashboardShowSessionDetails: boolean;
}

interface LegacyRuntimeShape {
  providerCommands: Record<ProviderName, ProviderCommandConfig>;
  providerDefaultInstances: Record<ProviderName, string>;
  providerInstances: Record<ProviderName, Record<string, ProviderInstanceConfig>>;
  auggieSessionsDir: string;
  claudeProjectsDir: string;
  codexSessionsDir: string;
  copilotSessionsDir: string;
  cursorChatsDir: string;
  cursorRuntime: ProviderRuntimeConfig;
  geminiSessionsDir: string;
  kiroDbPath: string;
  kiroRuntime: ProviderRuntimeConfig;
  kiloServerHost: string;
  kiloServerPort: number;
  kiloServerStartupTimeoutMs: number;
  opencodeServerHost: string;
  opencodeServerPort: number;
  opencodeServerStartupTimeoutMs: number;
  piSessionsDir: string;
  providerDefaultTargets: Record<string, ProviderDefaultTarget>;
  remoteProviderCatalog: RemoteProviderCatalog;
}

interface ParsedEnvironmentConfig {
  mode: RuntimeMode;
  distro?: string;
  container?: string;
}

interface ParsedRemoteBackendsResult {
  catalog: RemoteProviderCatalog;
  defaults: Record<string, ProviderDefaultTarget[]>;
}

export function defaultCursorRuntimeMode(
  platform: NodeJS.Platform = process.platform,
): RuntimeMode {
  void platform;
  return 'native';
}

export function defaultKiroRuntimeMode(
  platform: NodeJS.Platform = process.platform,
): RuntimeMode {
  void platform;
  return 'native';
}

export function defaultProviderRuntimeMode(
  provider: ProviderName,
  platform: NodeJS.Platform = process.platform,
): RuntimeMode {
  if (provider === 'cursor') {
    return defaultCursorRuntimeMode(platform);
  }

  if (provider === 'kiro') {
    return defaultKiroRuntimeMode(platform);
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
  return 50;
}

export function defaultKiroDbPath(
  platform: NodeJS.Platform = process.platform,
  runtimeMode: RuntimeMode = defaultKiroRuntimeMode(platform),
): string {
  if (runtimeMode === 'wsl' || runtimeMode === 'docker') {
    return '~/.local/share/kiro-cli/data.sqlite3';
  }

  if (platform === 'darwin') {
    return '~/Library/Application Support/kiro-cli/data.sqlite3';
  }

  if (platform === 'win32') {
    return '~/AppData/Local/kiro-cli/data.sqlite3';
  }

  return '~/.local/share/kiro-cli/data.sqlite3';
}

export function defaultPiSessionsDir(): string {
  return '~/.pi/agent/sessions';
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

export function defaultKiloServerHost(): string {
  return '127.0.0.1';
}

export function defaultKiloServerPort(): number {
  return 4313;
}

export function defaultKiloServerStartupTimeoutMs(): number {
  return 10000;
}

export function defaultNativeDiscoveryIntervalMs(): number {
  return 5000;
}

export function defaultWslDiscoveryPolicy(): WslDiscoveryPolicy {
  return 'if_running';
}

export function defaultDockerDiscoveryPolicy(): DockerDiscoveryPolicy {
  return 'if_running';
}

export function defaultExternalSessionLiveWindowMs(): number {
  return 15000;
}

export function defaultSpawnRetries(): number {
  return 1;
}

export function defaultSpawnTimeoutMs(): number {
  return 30000;
}

export function defaultCompatibilityProbeTimeoutMs(): number {
  return 10000;
}

export function defaultCompatibilityProbeWslTimeoutMs(): number {
  return 20000;
}

export function defaultCompatibilityProbeDockerTimeoutMs(): number {
  return 20000;
}

export function defaultRateLimitCooldownMs(): number {
  return 60000;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): CliRuntimeConfig {
  const apiKey = env.CATS_RUNTIME_API_KEY || '';
  const host = env.CATS_RUNTIME_HOST || (apiKey ? '' : '127.0.0.1');
  const port = parsePositiveInt(
    env.CATS_RUNTIME_PORT || env.PORT || '3110',
    3110,
    'CATS_RUNTIME_PORT',
  );
  const runtimeRoot = resolveRuntimeRoot(env);
  const dataDir = resolveRuntimeDataDir(runtimeRoot);
  const sessionBaseDir = resolveRuntimeSessionsDir(runtimeRoot);
  const compatibilityProbeTimeoutMs = parseNonNegativeInt(
    env.CATS_RUNTIME_COMPATIBILITY_PROBE_TIMEOUT_MS,
    defaultCompatibilityProbeTimeoutMs(),
    'CATS_RUNTIME_COMPATIBILITY_PROBE_TIMEOUT_MS',
  );
  const compatibilityProbeWslTimeoutMs = parseNonNegativeInt(
    env.CATS_RUNTIME_COMPATIBILITY_PROBE_WSL_TIMEOUT_MS,
    defaultCompatibilityProbeWslTimeoutMs(),
    'CATS_RUNTIME_COMPATIBILITY_PROBE_WSL_TIMEOUT_MS',
  );
  const compatibilityProbeDockerTimeoutMs = parseNonNegativeInt(
    env.CATS_RUNTIME_COMPATIBILITY_PROBE_DOCKER_TIMEOUT_MS,
    defaultCompatibilityProbeDockerTimeoutMs(),
    'CATS_RUNTIME_COMPATIBILITY_PROBE_DOCKER_TIMEOUT_MS',
  );

  const legacy = buildLegacyRuntimeShape(env, env.HOME || env.USERPROFILE || '');
  const configPath = resolveConfigPath(env.HOME || env.USERPROFILE || '', env);
  const hasProviderFile = !options.skipProviderFile && existsSync(configPath);
  const configured = hasProviderFile
    ? applyFileBasedProviderConfig(configPath, legacy)
    : legacy;

  return {
    host,
    port,
    apiKey,
    dataDir,
    configPath,
    auggieMaxTurns: parsePositiveInt(
      env.AUGGIE_MAX_TURNS,
      defaultAuggieMaxTurns(),
      'AUGGIE_MAX_TURNS',
    ),
    auggiePath: configured.providerCommands.auggie.path,
    claudePath: configured.providerCommands.claude.path,
    codexPath: configured.providerCommands.codex.path,
    copilotPath: configured.providerCommands.copilot.path,
    cursorPath: configured.providerCommands.cursor.path,
    geminiPath: configured.providerCommands.gemini.path,
    kiroPath: configured.providerCommands.kiro.path,
    kiloPath: configured.providerCommands.kilo.path,
    opencodePath: configured.providerCommands.opencode.path,
    piPath: configured.providerCommands.pi.path,
    goosePath: configured.providerCommands.goose.path,
    juniePath: configured.providerCommands.junie.path,
    kiloServerHost: configured.kiloServerHost,
    kiloServerPort: configured.kiloServerPort,
    kiloServerStartupTimeoutMs: configured.kiloServerStartupTimeoutMs,
    opencodeServerHost: configured.opencodeServerHost,
    opencodeServerPort: configured.opencodeServerPort,
    opencodeServerStartupTimeoutMs: configured.opencodeServerStartupTimeoutMs,
    auggieSessionsDir: configured.auggieSessionsDir,
    claudeProjectsDir: configured.claudeProjectsDir,
    codexSessionsDir: configured.codexSessionsDir,
    copilotSessionsDir: configured.copilotSessionsDir,
    cursorChatsDir: configured.cursorChatsDir,
    cursorRuntime: configured.cursorRuntime,
    geminiSessionsDir: configured.geminiSessionsDir,
    kiroDbPath: configured.kiroDbPath,
    kiroRuntime: configured.kiroRuntime,
    piSessionsDir: configured.piSessionsDir,
    wslDiscoveryPolicy: parseWslDiscoveryPolicy(
      env.CATS_RUNTIME_WSL_DISCOVERY_POLICY,
      defaultWslDiscoveryPolicy(),
    ),
    dockerDiscoveryPolicy: parseDockerDiscoveryPolicy(
      env.CATS_RUNTIME_DOCKER_DISCOVERY_POLICY,
      defaultDockerDiscoveryPolicy(),
    ),
    compatibilityProbeTimeoutMs,
    compatibilityProbeWslTimeoutMs,
    compatibilityProbeDockerTimeoutMs,
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
      env.CATS_RUNTIME_MAX_SESSIONS,
      10,
      'CATS_RUNTIME_MAX_SESSIONS',
    ),
    spawnRetries: parsePositiveInt(
      env.CATS_RUNTIME_SPAWN_RETRIES,
      defaultSpawnRetries(),
      'CATS_RUNTIME_SPAWN_RETRIES',
    ),
    spawnTimeoutMs: parseNonNegativeInt(
      env.CATS_RUNTIME_SPAWN_TIMEOUT_MS,
      defaultSpawnTimeoutMs(),
      'CATS_RUNTIME_SPAWN_TIMEOUT_MS',
    ),
    sessionBaseDir,
    metering: {
      sessionTotalTokensWarn: parseOptionalNonNegativeInt(
        env.CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_WARN,
        'CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_WARN',
      ),
      sessionTotalTokensBlock: parseOptionalNonNegativeInt(
        env.CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_BLOCK,
        'CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_BLOCK',
      ),
      rateLimitCooldownMs: parseNonNegativeInt(
        env.CATS_RUNTIME_RATE_LIMIT_COOLDOWN_MS,
        defaultRateLimitCooldownMs(),
        'CATS_RUNTIME_RATE_LIMIT_COOLDOWN_MS',
      ),
    },
    providerCommands: configured.providerCommands,
    providerDefaultInstances: configured.providerDefaultInstances,
    providerInstances: configured.providerInstances,
    providerDefaultTargets: configured.providerDefaultTargets,
    remoteProviderCatalog: configured.remoteProviderCatalog,
    dashboardShowSessionDetails:
      env.CATS_RUNTIME_DASHBOARD_SHOW_SESSION_DETAILS?.trim().toLowerCase() === 'true',
  };
}

export function getProviderDefaultInstanceId(
  config: Pick<CliRuntimeConfig, 'providerDefaultInstances'>,
  provider: ProviderName,
): string {
  return config.providerDefaultInstances?.[provider] || 'default';
}

export function listProviderInstances(
  config: Pick<
    CliRuntimeConfig,
    | 'providerCommands'
    | 'providerDefaultInstances'
    | 'providerInstances'
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'kiloServerHost'
    | 'kiloServerPort'
    | 'kiloServerStartupTimeoutMs'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
  >,
  provider: ProviderName,
): ProviderInstanceConfig[] {
  const configured = config.providerInstances?.[provider];
  if (configured !== undefined) {
    return Object.values(configured);
  }

  return [
    buildLegacyProviderInstance(
      provider,
      getProviderDefaultInstanceId(config, provider),
      config.providerCommands[provider],
      config,
    ),
  ];
}

export function isUnknownProviderInstanceError(
  error: unknown,
): error is UnknownProviderInstanceError {
  return error instanceof UnknownProviderInstanceError;
}

export function resolveProviderInstance(
  config: Pick<
    CliRuntimeConfig,
    | 'providerCommands'
    | 'providerDefaultInstances'
    | 'providerInstances'
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'kiloServerHost'
    | 'kiloServerPort'
    | 'kiloServerStartupTimeoutMs'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
  >,
  provider: ProviderName,
  instanceId?: string,
): ProviderInstanceConfig {
  const configured = config.providerInstances?.[provider];
  if (configured !== undefined) {
    if (Object.keys(configured).length === 0) {
      throw new ProviderNotConfiguredError(provider);
    }

    const selected = !instanceId || instanceId === 'default'
      ? getProviderDefaultInstanceId(config, provider)
      : instanceId;
    const instance = configured[selected];
    if (instance) {
      return instance;
    }

    throw new UnknownProviderInstanceError(provider, selected, Object.keys(configured));
  }

  const defaultInstanceId = getProviderDefaultInstanceId(config, provider);
  if (instanceId && instanceId !== defaultInstanceId && instanceId !== 'default') {
    throw new UnknownProviderInstanceError(provider, instanceId, [defaultInstanceId]);
  }

  return buildLegacyProviderInstance(
    provider,
    defaultInstanceId,
    config.providerCommands[provider],
    config,
  );
}

export function resolveConfigPath(
  home = '',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const runtimeRoot = resolveRuntimeRoot({
    ...env,
    ...(home ? { HOME: home } : {}),
  }, home);
  return resolveRuntimeProvidersConfigPath(runtimeRoot);
}

function buildLegacyRuntimeShape(
  env: NodeJS.ProcessEnv,
  home: string,
): LegacyRuntimeShape {
  const providerCommands = buildLegacyProviderCommands(env);
  const kiroRuntime = providerCommands.kiro.runtime;
  const providerDefaultInstances = {
    auggie: 'default',
    claude: 'default',
    codex: 'default',
    copilot: 'default',
    cursor: 'default',
    gemini: 'default',
    opencode: 'default',
    kilo: 'default',
    goose: 'default',
    pi: 'default',
    junie: 'default',
    kiro: 'default',
  } satisfies Record<ProviderName, string>;
  const providerDefaultTargets = Object.fromEntries(
    Object.entries(providerDefaultInstances).map(([provider, instance]) => [provider, {
      backend: 'cli' as const,
      instance,
    }]),
  );

  const auggieSessionsDir = env.AUGGIE_SESSIONS_DIR || defaultAuggieSessionsDir();
  const cursorChatsDir = env.CURSOR_CHATS_DIR || defaultCursorChatsDir();
  const kiroDbPath = env.KIRO_DB_PATH || defaultKiroDbPath(process.platform, kiroRuntime.mode);
  const kiloServerHost = env.KILO_SERVER_HOST || defaultKiloServerHost();
  const kiloServerPort = parsePositiveInt(
    env.KILO_SERVER_PORT,
    defaultKiloServerPort(),
    'KILO_SERVER_PORT',
  );
  const kiloServerStartupTimeoutMs = parsePositiveInt(
    env.KILO_SERVER_STARTUP_TIMEOUT_MS,
    defaultKiloServerStartupTimeoutMs(),
    'KILO_SERVER_STARTUP_TIMEOUT_MS',
  );
  const opencodeServerHost = env.OPENCODE_SERVER_HOST || defaultOpencodeServerHost();
  const opencodeServerPort = parsePositiveInt(
    env.OPENCODE_SERVER_PORT,
    defaultOpencodeServerPort(),
    'OPENCODE_SERVER_PORT',
  );
  const opencodeServerStartupTimeoutMs = parsePositiveInt(
    env.OPENCODE_SERVER_STARTUP_TIMEOUT_MS,
    defaultOpencodeServerStartupTimeoutMs(),
    'OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
  );

  const providerInstances: Record<ProviderName, Record<string, ProviderInstanceConfig>> = {
    auggie: {
      default: {
        id: 'default',
        providerName: 'auggie',
        commandConfig: providerCommands.auggie,
        auggieSessionsDir,
      },
    },
    claude: {
      default: {
        id: 'default',
        providerName: 'claude',
        commandConfig: providerCommands.claude,
        claudeProjectsDir: env.CLAUDE_PROJECTS_DIR || `${home}/.claude/projects`,
      },
    },
    codex: {
      default: {
        id: 'default',
        providerName: 'codex',
        commandConfig: providerCommands.codex,
        codexSessionsDir: env.CODEX_SESSIONS_DIR || `${home}/.codex/sessions`,
      },
    },
    copilot: {
      default: {
        id: 'default',
        providerName: 'copilot',
        commandConfig: providerCommands.copilot,
        copilotSessionsDir: env.COPILOT_SESSIONS_DIR || `${home}/.copilot/session-state`,
      },
    },
    cursor: {
      default: {
        id: 'default',
        providerName: 'cursor',
        commandConfig: providerCommands.cursor,
        cursorChatsDir,
      },
    },
    gemini: {
      default: {
        id: 'default',
        providerName: 'gemini',
        commandConfig: providerCommands.gemini,
        geminiSessionsDir: env.GEMINI_SESSIONS_DIR || `${home}/.gemini/tmp`,
      },
    },
    kiro: {
      default: {
        id: 'default',
        providerName: 'kiro',
        commandConfig: providerCommands.kiro,
        kiroDbPath,
      },
    },
    kilo: {
      default: {
        id: 'default',
        providerName: 'kilo',
        commandConfig: providerCommands.kilo,
        kiloServerHost,
        kiloServerPort,
        kiloServerStartupTimeoutMs,
      },
    },
    opencode: {
      default: {
        id: 'default',
        providerName: 'opencode',
        commandConfig: providerCommands.opencode,
        opencodeServerHost,
        opencodeServerPort,
        opencodeServerStartupTimeoutMs,
      },
    },
    pi: {
      default: {
        id: 'default',
        providerName: 'pi',
        commandConfig: providerCommands.pi,
        piSessionsDir: env.PI_SESSIONS_DIR || defaultPiSessionsDir(),
      },
    },
    goose: {
      default: {
        id: 'default',
        providerName: 'goose',
        commandConfig: providerCommands.goose,
      },
    },
    junie: {
      default: {
        id: 'default',
        providerName: 'junie',
        commandConfig: providerCommands.junie,
      },
    },
  };

  return {
    providerCommands,
    providerDefaultInstances,
    providerInstances,
    auggieSessionsDir,
    claudeProjectsDir: env.CLAUDE_PROJECTS_DIR || `${home}/.claude/projects`,
    codexSessionsDir: env.CODEX_SESSIONS_DIR || `${home}/.codex/sessions`,
    copilotSessionsDir: env.COPILOT_SESSIONS_DIR || `${home}/.copilot/session-state`,
    cursorChatsDir,
    cursorRuntime: providerCommands.cursor.runtime,
    geminiSessionsDir: env.GEMINI_SESSIONS_DIR || `${home}/.gemini/tmp`,
    kiroDbPath,
    kiroRuntime,
    kiloServerHost,
    kiloServerPort,
    kiloServerStartupTimeoutMs,
    opencodeServerHost,
    opencodeServerPort,
    opencodeServerStartupTimeoutMs,
    piSessionsDir: env.PI_SESSIONS_DIR || defaultPiSessionsDir(),
    providerDefaultTargets,
    remoteProviderCatalog: {
      api: {},
      local: {},
      agent: {},
    },
  };
}

function buildLegacyProviderCommands(
  env: NodeJS.ProcessEnv,
): Record<ProviderName, ProviderCommandConfig> {
  const auggiePath = env.AUGGIE_PATH || 'auggie';
  const claudePath = env.CLAUDE_PATH || 'claude';
  const codexPath = env.CODEX_PATH || 'codex';
  const copilotPath = env.COPILOT_PATH || 'copilot';
  const cursorPath = env.CURSOR_PATH || 'cursor-agent';
  const geminiPath = env.GEMINI_PATH || 'gemini';
  const kiroPath = env.KIRO_PATH || 'kiro-cli';
  const kiloPath = env.KILO_PATH || 'kilo';
  const opencodePath = env.OPENCODE_PATH || 'opencode';
  const piPath = env.PI_PATH || 'pi';
  const goosePath = env.GOOSE_PATH || 'goose';
  const juniePath = env.JUNIE_PATH || 'junie';

  return {
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
    kilo: readProviderCommandConfig(
      'KILO',
      kiloPath,
      defaultProviderRuntimeMode('kilo'),
      env,
    ),
    opencode: readProviderCommandConfig(
      'OPENCODE',
      opencodePath,
      defaultProviderRuntimeMode('opencode'),
      env,
    ),
    pi: readProviderCommandConfig(
      'PI',
      piPath,
      defaultProviderRuntimeMode('pi'),
      env,
    ),
    goose: readProviderCommandConfig(
      'GOOSE',
      goosePath,
      defaultProviderRuntimeMode('goose'),
      env,
    ),
    junie: readProviderCommandConfig(
      'JUNIE',
      juniePath,
      defaultProviderRuntimeMode('junie'),
      env,
    ),
  };
}

function buildLegacyProviderInstance(
  provider: ProviderName,
  id: string,
  commandConfig: ProviderCommandConfig,
  config: Pick<
    CliRuntimeConfig,
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'kiloServerHost'
    | 'kiloServerPort'
    | 'kiloServerStartupTimeoutMs'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
  >,
): ProviderInstanceConfig {
  return {
    id,
    providerName: provider,
    commandConfig,
    auggieSessionsDir: provider === 'auggie' ? config.auggieSessionsDir : undefined,
    claudeProjectsDir: provider === 'claude' ? config.claudeProjectsDir : undefined,
    codexSessionsDir: provider === 'codex' ? config.codexSessionsDir : undefined,
    copilotSessionsDir: provider === 'copilot' ? config.copilotSessionsDir : undefined,
    cursorChatsDir: provider === 'cursor' ? config.cursorChatsDir : undefined,
    geminiSessionsDir: provider === 'gemini' ? config.geminiSessionsDir : undefined,
    kiroDbPath: provider === 'kiro' ? config.kiroDbPath : undefined,
    kiloServerHost: provider === 'kilo' ? config.kiloServerHost : undefined,
    kiloServerPort: provider === 'kilo' ? config.kiloServerPort : undefined,
    kiloServerStartupTimeoutMs: provider === 'kilo'
      ? config.kiloServerStartupTimeoutMs
      : undefined,
    opencodeServerHost: provider === 'opencode' ? config.opencodeServerHost : undefined,
    opencodeServerPort: provider === 'opencode' ? config.opencodeServerPort : undefined,
    opencodeServerStartupTimeoutMs: provider === 'opencode'
      ? config.opencodeServerStartupTimeoutMs
      : undefined,
    piSessionsDir: provider === 'pi' ? config.piSessionsDir : undefined,
  };
}

function applyFileBasedProviderConfig(
  filePath: string,
  legacy: LegacyRuntimeShape,
): LegacyRuntimeShape {
  const raw = parse(readFileSync(filePath, 'utf-8'));
  const doc = asObject(raw, `Invalid provider config '${filePath}'`);
  const version = doc.version;
  if (version !== undefined && version !== 1) {
    throw new Error(`Unsupported provider config version '${String(version)}'. Expected 1.`);
  }

  const environments = parseEnvironmentMap(doc.environments, filePath);
  const providerCommands = cloneProviderCommands(legacy.providerCommands);
  const providerDefaultInstances = { ...legacy.providerDefaultInstances };
  const providerInstances = cloneProviderInstances(legacy.providerInstances);
  const providerDefaultTargets: Record<string, ProviderDefaultTarget> = {};
  const remoteProviderCatalog = cloneRemoteProviderCatalog(legacy.remoteProviderCatalog);
  let auggieSessionsDir = legacy.auggieSessionsDir;
  let claudeProjectsDir = legacy.claudeProjectsDir;
  let codexSessionsDir = legacy.codexSessionsDir;
  let copilotSessionsDir = legacy.copilotSessionsDir;
  let cursorChatsDir = legacy.cursorChatsDir;
  let cursorRuntime = legacy.cursorRuntime;
  let geminiSessionsDir = legacy.geminiSessionsDir;
  let kiroDbPath = legacy.kiroDbPath;
  let kiroRuntime = legacy.kiroRuntime;
  let kiloServerHost = legacy.kiloServerHost;
  let kiloServerPort = legacy.kiloServerPort;
  let kiloServerStartupTimeoutMs = legacy.kiloServerStartupTimeoutMs;
  let opencodeServerHost = legacy.opencodeServerHost;
  let opencodeServerPort = legacy.opencodeServerPort;
  let opencodeServerStartupTimeoutMs = legacy.opencodeServerStartupTimeoutMs;
  let piSessionsDir = legacy.piSessionsDir;
  let piInstructionsFile: string | undefined;
  const rawBackends = asOptionalObject(doc.backends);
  if (doc.backends !== undefined && !rawBackends) {
    throw new Error(`Invalid backends block in '${filePath}'`);
  }
  if (rawBackends && doc.providers !== undefined) {
    throw new Error(
      `Cannot mix top-level providers with backends.* in '${filePath}'. `
      + 'Move CLI providers under backends.cli.providers.',
    );
  }
  const usesSeparatedBackends = rawBackends !== undefined;

  if (usesSeparatedBackends) {
    for (const known of KNOWN_PROVIDERS) {
      providerInstances[known] = {};
    }
  }

  const rawProviders = usesSeparatedBackends
    ? asOptionalObject(asOptionalObject(rawBackends?.cli)?.providers)
    : doc.providers;
  if (rawProviders !== undefined) {
    for (const known of KNOWN_PROVIDERS) {
      providerInstances[known] = {};
    }
  }
  if (rawProviders !== undefined) {
    const providers = asObject(rawProviders, `Invalid providers block in '${filePath}'`);

    for (const [providerKey, rawProvider] of Object.entries(providers)) {
      if (!isKnownProvider(providerKey)) {
        throw new Error(`Unknown provider '${providerKey}' in '${filePath}'`);
      }

      const provider = providerKey as ProviderName;
      const providerDoc = asObject(
        rawProvider,
        `Invalid '${provider}' config in '${filePath}'`,
      );
      const discovery = asOptionalObject(providerDoc.discovery);

      switch (provider) {
        case 'auggie':
          auggieSessionsDir = readString(discovery?.sessions_dir)
            || readString(providerDoc.sessions_dir)
            || auggieSessionsDir;
          break;
        case 'claude':
          claudeProjectsDir = readString(discovery?.projects_dir)
            || readString(providerDoc.projects_dir)
            || claudeProjectsDir;
          break;
        case 'codex':
          codexSessionsDir = readString(discovery?.sessions_dir)
            || readString(providerDoc.sessions_dir)
            || codexSessionsDir;
          break;
        case 'copilot':
          copilotSessionsDir = readString(discovery?.sessions_dir)
            || readString(providerDoc.sessions_dir)
            || copilotSessionsDir;
          break;
        case 'gemini':
          geminiSessionsDir = readString(discovery?.sessions_dir)
            || readString(providerDoc.sessions_dir)
            || geminiSessionsDir;
          break;
        case 'pi':
          piSessionsDir = readString(discovery?.sessions_dir)
            || readString(providerDoc.sessions_dir)
            || piSessionsDir;
          piInstructionsFile = readString(providerDoc.instructions_file)
            || readString(providerDoc.instructionsFile)
            || piInstructionsFile;
          break;
        default:
          break;
      }

      const hasExplicitInstances = providerDoc.instances !== undefined;
      const rawInstances = hasExplicitInstances
        ? asObject(providerDoc.instances, `Invalid '${provider}.instances' block in '${filePath}'`)
        : {};
      const nextInstances: Record<string, ProviderInstanceConfig> = hasExplicitInstances
        ? {}
        : { ...providerInstances[provider] };

      for (const [instanceId, rawInstance] of Object.entries(rawInstances)) {
        const instanceDoc = asObject(
          rawInstance,
          `Invalid '${provider}.instances.${instanceId}' config in '${filePath}'`,
        );
        const fallback = nextInstances[instanceId]
          || Object.values(nextInstances)[0]
          || legacy.providerInstances[provider].default;
        const commandConfig = buildCommandConfigFromFile(
          provider,
          instanceId,
          instanceDoc,
          environments,
          fallback.commandConfig,
          filePath,
        );

        nextInstances[instanceId] = {
          id: instanceId,
          providerName: provider,
          commandConfig,
          timeoutMs: parseOptionalIntValue(
            instanceDoc.timeout_ms ?? instanceDoc.timeoutMs,
            `${provider}.instances.${instanceId}.timeout_ms`,
          ) ?? fallback.timeoutMs,
          auggieSessionsDir: provider === 'auggie'
            ? readString(instanceDoc.sessions_dir)
              || fallback.auggieSessionsDir
              || auggieSessionsDir
            : undefined,
          claudeProjectsDir: provider === 'claude'
            ? readString(instanceDoc.projects_dir)
              || fallback.claudeProjectsDir
              || claudeProjectsDir
            : undefined,
          codexSessionsDir: provider === 'codex'
            ? readString(instanceDoc.sessions_dir)
              || fallback.codexSessionsDir
              || codexSessionsDir
            : undefined,
          copilotSessionsDir: provider === 'copilot'
            ? readString(instanceDoc.sessions_dir)
              || fallback.copilotSessionsDir
              || copilotSessionsDir
            : undefined,
          cursorChatsDir: provider === 'cursor'
            ? readString(instanceDoc.chats_dir)
              || fallback.cursorChatsDir
              || cursorChatsDir
            : undefined,
          geminiSessionsDir: provider === 'gemini'
            ? readString(instanceDoc.sessions_dir)
              || fallback.geminiSessionsDir
              || geminiSessionsDir
            : undefined,
          kiroDbPath: provider === 'kiro'
            ? readString(instanceDoc.db_path)
              || fallback.kiroDbPath
              || kiroDbPath
            : undefined,
          kiloServerHost: provider === 'kilo'
            ? readString(asOptionalObject(instanceDoc.server)?.host)
              || readString(instanceDoc.server_host)
              || fallback.kiloServerHost
              || kiloServerHost
            : undefined,
          kiloServerPort: provider === 'kilo'
            ? parseOptionalPositiveInt(
              asOptionalObject(instanceDoc.server)?.port
                ?? instanceDoc.server_port,
              fallback.kiloServerPort || kiloServerPort,
              `${provider}.instances.${instanceId}.server.port`,
            )
            : undefined,
          kiloServerStartupTimeoutMs: provider === 'kilo'
            ? parseOptionalPositiveInt(
              asOptionalObject(instanceDoc.server)?.startup_timeout_ms
                ?? instanceDoc.server_startup_timeout_ms,
              fallback.kiloServerStartupTimeoutMs || kiloServerStartupTimeoutMs,
              `${provider}.instances.${instanceId}.server.startup_timeout_ms`,
            )
            : undefined,
          opencodeServerHost: provider === 'opencode'
            ? readString(asOptionalObject(instanceDoc.server)?.host)
              || readString(instanceDoc.server_host)
              || fallback.opencodeServerHost
              || opencodeServerHost
            : undefined,
          opencodeServerPort: provider === 'opencode'
            ? parseOptionalPositiveInt(
              asOptionalObject(instanceDoc.server)?.port
                ?? instanceDoc.server_port,
              fallback.opencodeServerPort || opencodeServerPort,
              `${provider}.instances.${instanceId}.server.port`,
            )
            : undefined,
          opencodeServerStartupTimeoutMs: provider === 'opencode'
            ? parseOptionalPositiveInt(
              asOptionalObject(instanceDoc.server)?.startup_timeout_ms
                ?? instanceDoc.server_startup_timeout_ms,
              fallback.opencodeServerStartupTimeoutMs || opencodeServerStartupTimeoutMs,
              `${provider}.instances.${instanceId}.server.startup_timeout_ms`,
            )
            : undefined,
          piSessionsDir: provider === 'pi'
            ? readString(instanceDoc.sessions_dir)
              || fallback.piSessionsDir
              || piSessionsDir
            : undefined,
          piInstructionsFile: provider === 'pi'
            ? readString(instanceDoc.instructions_file)
              || readString(instanceDoc.instructionsFile)
              || fallback.piInstructionsFile
              || piInstructionsFile
            : undefined,
        };
      }

      if (Object.keys(nextInstances).length === 0) {
        throw new Error(`Provider '${provider}' must define at least one instance in '${filePath}'`);
      }

      const configuredDefaultInstance = readString(providerDoc.default_instance)
        || readString(providerDoc.defaultInstance);
      const defaultInstance = configuredDefaultInstance
        || (providerDefaultInstances[provider] && nextInstances[providerDefaultInstances[provider]]
          ? providerDefaultInstances[provider]
          : Object.keys(nextInstances)[0]);
      if (configuredDefaultInstance && !nextInstances[defaultInstance]) {
        throw new Error(
          `Provider '${provider}' default instance '${defaultInstance}' is not defined in '${filePath}'`,
        );
      }

      providerInstances[provider] = nextInstances;
      providerDefaultInstances[provider] = defaultInstance;
      providerCommands[provider] = nextInstances[defaultInstance].commandConfig;

      if (provider === 'cursor') {
        cursorChatsDir = nextInstances[defaultInstance].cursorChatsDir || cursorChatsDir;
        cursorRuntime = nextInstances[defaultInstance].commandConfig.runtime;
      }
      if (provider === 'claude') {
        claudeProjectsDir = nextInstances[defaultInstance].claudeProjectsDir || claudeProjectsDir;
      }
      if (provider === 'codex') {
        codexSessionsDir = nextInstances[defaultInstance].codexSessionsDir || codexSessionsDir;
      }
      if (provider === 'copilot') {
        copilotSessionsDir = nextInstances[defaultInstance].copilotSessionsDir || copilotSessionsDir;
      }
      if (provider === 'gemini') {
        geminiSessionsDir = nextInstances[defaultInstance].geminiSessionsDir || geminiSessionsDir;
      }
      if (provider === 'kiro') {
        kiroDbPath = nextInstances[defaultInstance].kiroDbPath || kiroDbPath;
        kiroRuntime = nextInstances[defaultInstance].commandConfig.runtime;
      }
      if (provider === 'kilo') {
        kiloServerHost = nextInstances[defaultInstance].kiloServerHost || kiloServerHost;
        kiloServerPort = nextInstances[defaultInstance].kiloServerPort || kiloServerPort;
        kiloServerStartupTimeoutMs = nextInstances[defaultInstance].kiloServerStartupTimeoutMs
          || kiloServerStartupTimeoutMs;
      }
      if (provider === 'opencode') {
        opencodeServerHost = nextInstances[defaultInstance].opencodeServerHost || opencodeServerHost;
        opencodeServerPort = nextInstances[defaultInstance].opencodeServerPort || opencodeServerPort;
        opencodeServerStartupTimeoutMs = nextInstances[defaultInstance].opencodeServerStartupTimeoutMs
          || opencodeServerStartupTimeoutMs;
      }
      if (provider === 'auggie') {
        auggieSessionsDir = nextInstances[defaultInstance].auggieSessionsDir || auggieSessionsDir;
      }
      if (provider === 'pi') {
        piSessionsDir = nextInstances[defaultInstance].piSessionsDir || piSessionsDir;
      }
    }

    for (const known of KNOWN_PROVIDERS) {
      if (Object.keys(providerInstances[known]).length === 0) {
        providerInstances[known] = {};
      }
    }
  } else if (!usesSeparatedBackends && doc.providers !== undefined) {
    throw new Error(`Invalid providers block in '${filePath}'`);
  }

  let parsedRemote: ParsedRemoteBackendsResult | undefined;
  if (usesSeparatedBackends) {
    parsedRemote = parseRemoteBackends(rawBackends, filePath);
    Object.assign(remoteProviderCatalog.api, parsedRemote.catalog.api);
    Object.assign(remoteProviderCatalog.local, parsedRemote.catalog.local);
    Object.assign(remoteProviderCatalog.agent, parsedRemote.catalog.agent);
  }

  const resolvedDefaultTargets = resolveProviderDefaultTargets(
    doc,
    filePath,
    providerInstances,
    providerDefaultInstances,
    parsedRemote?.defaults || {},
  );

  for (const [providerName, target] of Object.entries(resolvedDefaultTargets)) {
    providerDefaultTargets[providerName] = target;

    if (!isKnownProvider(providerName)) {
      continue;
    }

    const provider = providerName as ProviderName;
    if (target.backend !== 'cli') {
      continue;
    }

    const instance = providerInstances[provider][target.instance];
    if (!instance) {
      throw new Error(
        `Provider '${provider}' default target instance '${target.instance}' is not defined in '${filePath}'`,
      );
    }

    providerDefaultInstances[provider] = target.instance;
    providerCommands[provider] = instance.commandConfig;

    if (provider === 'cursor') {
      cursorChatsDir = instance.cursorChatsDir || cursorChatsDir;
      cursorRuntime = instance.commandConfig.runtime;
    }
    if (provider === 'claude') {
      claudeProjectsDir = instance.claudeProjectsDir || claudeProjectsDir;
    }
    if (provider === 'codex') {
      codexSessionsDir = instance.codexSessionsDir || codexSessionsDir;
    }
    if (provider === 'copilot') {
      copilotSessionsDir = instance.copilotSessionsDir || copilotSessionsDir;
    }
    if (provider === 'gemini') {
      geminiSessionsDir = instance.geminiSessionsDir || geminiSessionsDir;
    }
    if (provider === 'kiro') {
      kiroDbPath = instance.kiroDbPath || kiroDbPath;
      kiroRuntime = instance.commandConfig.runtime;
    }
    if (provider === 'kilo') {
      kiloServerHost = instance.kiloServerHost || kiloServerHost;
      kiloServerPort = instance.kiloServerPort || kiloServerPort;
      kiloServerStartupTimeoutMs = instance.kiloServerStartupTimeoutMs
        || kiloServerStartupTimeoutMs;
    }
    if (provider === 'opencode') {
      opencodeServerHost = instance.opencodeServerHost || opencodeServerHost;
      opencodeServerPort = instance.opencodeServerPort || opencodeServerPort;
      opencodeServerStartupTimeoutMs = instance.opencodeServerStartupTimeoutMs
        || opencodeServerStartupTimeoutMs;
    }
    if (provider === 'auggie') {
      auggieSessionsDir = instance.auggieSessionsDir || auggieSessionsDir;
    }
    if (provider === 'pi') {
      piSessionsDir = instance.piSessionsDir || piSessionsDir;
    }
  }

  return {
    providerCommands,
    providerDefaultInstances,
    providerInstances,
    auggieSessionsDir,
    claudeProjectsDir,
    codexSessionsDir,
    copilotSessionsDir,
    cursorChatsDir,
    cursorRuntime,
    geminiSessionsDir,
    kiroDbPath,
    kiroRuntime,
    kiloServerHost,
    kiloServerPort,
    kiloServerStartupTimeoutMs,
    opencodeServerHost,
    opencodeServerPort,
    opencodeServerStartupTimeoutMs,
    piSessionsDir,
    providerDefaultTargets,
    remoteProviderCatalog,
  };
}

function buildCommandConfigFromFile(
  provider: ProviderName,
  instanceId: string,
  raw: Record<string, unknown>,
  environments: Record<string, ParsedEnvironmentConfig>,
  fallback: ProviderCommandConfig,
  filePath: string,
): ProviderCommandConfig {
  const runtime = resolveRuntimeFromFile(
    raw,
    environments,
    fallback.runtime,
    `${provider}.instances.${instanceId}`,
    filePath,
  );
  const path = readString(raw.command)
    || readString(raw.path)
    || fallback.path;
  const runner = parseRunnerModeValue(
    raw.runner,
    fallback.runner,
    `${provider}.instances.${instanceId}.runner`,
  );
  const runnerPath = readString(raw.runner_path)
    || readString(raw.runnerPath)
    || fallback.runnerPath;

  return {
    path,
    runner,
    runnerPath,
    runtime,
  };
}

function parseEnvironmentMap(
  raw: unknown,
  filePath: string,
): Record<string, ParsedEnvironmentConfig> {
  if (raw === undefined) {
    return {};
  }

  const environments = asObject(raw, 'Invalid environments block');
  const result: Record<string, ParsedEnvironmentConfig> = {};

  for (const [environmentId, value] of Object.entries(environments)) {
    const environment = asObject(value, `Invalid environments.${environmentId} entry`);
    const kind = readString(environment.kind)
      || readString(environment.runtime)
      || readString(environment.mode)
      || 'native';
    const mode = parseRuntimeModeValue(
      kind,
      'native',
      `environments.${environmentId}.kind`,
    );
    const distro = readString(environment.distro);
    const container = readString(environment.container);
    assertExplicitWslHasDistro(
      mode,
      distro,
      `environments.${environmentId}`,
      filePath,
    );
    assertExplicitDockerHasContainer(
      mode,
      container,
      `environments.${environmentId}`,
      filePath,
    );

    result[environmentId] = {
      mode,
      distro,
      container,
    };
  }

  return result;
}

function resolveRuntimeFromFile(
  raw: Record<string, unknown>,
  environments: Record<string, ParsedEnvironmentConfig>,
  fallback: ProviderRuntimeConfig,
  label: string,
  filePath: string,
): ProviderRuntimeConfig {
  const environmentId = readString(raw.environment)
    || readString(raw.environment_id)
    || readString(raw.environmentId);
  if (environmentId) {
    const resolved = environments[environmentId];
    if (!resolved) {
      throw new Error(
        `Unknown environment '${environmentId}' for '${label}' in '${filePath}'`,
      );
    }

    return {
      mode: resolved.mode,
      distro: resolved.distro,
      container: resolved.container,
      environmentId,
    };
  }

  const inlineRuntime = readString(raw.runtime)
    || readString(raw.kind)
    || readString(raw.mode);
  const inlineDistro = readString(raw.distro);
  const inlineContainer = readString(raw.container);
  const mode = parseRuntimeModeValue(
    inlineRuntime,
    fallback.mode,
    `${label}.runtime`,
  );
  const effectiveDistro = inlineDistro || fallback.distro;
  const effectiveContainer = inlineContainer || fallback.container;
  assertExplicitWslHasDistro(
    mode,
    effectiveDistro,
    label,
    filePath,
    Boolean(inlineRuntime),
  );
  assertExplicitDockerHasContainer(
    mode,
    effectiveContainer,
    label,
    filePath,
    Boolean(inlineRuntime),
  );

  return {
    mode,
    distro: effectiveDistro,
    container: effectiveContainer,
    environmentId: fallback.environmentId,
  };
}

function assertExplicitWslHasDistro(
  mode: RuntimeMode,
  distro: string | undefined,
  label: string,
  filePath: string,
  isExplicitWsl = true,
): void {
  if (mode !== 'wsl') {
    return;
  }

  if (!isExplicitWsl) {
    return;
  }

  if (!distro) {
    throw new Error(
      `'${label}' in '${filePath}' sets runtime to 'wsl' but does not define 'distro'`,
    );
  }
}

function assertExplicitDockerHasContainer(
  mode: RuntimeMode,
  container: string | undefined,
  label: string,
  filePath: string,
  isExplicitDocker = true,
): void {
  if (mode !== 'docker') {
    return;
  }

  if (!isExplicitDocker) {
    return;
  }

  if (!container) {
    throw new Error(
      `'${label}' in '${filePath}' sets runtime to 'docker' but does not define 'container'`,
    );
  }
}

function cloneProviderCommands(
  commands: Record<ProviderName, ProviderCommandConfig>,
): Record<ProviderName, ProviderCommandConfig> {
  return {
    auggie: cloneProviderCommandConfig(commands.auggie),
    claude: cloneProviderCommandConfig(commands.claude),
    codex: cloneProviderCommandConfig(commands.codex),
    copilot: cloneProviderCommandConfig(commands.copilot),
    cursor: cloneProviderCommandConfig(commands.cursor),
    gemini: cloneProviderCommandConfig(commands.gemini),
    kiro: cloneProviderCommandConfig(commands.kiro),
    kilo: cloneProviderCommandConfig(commands.kilo),
    opencode: cloneProviderCommandConfig(commands.opencode),
    pi: cloneProviderCommandConfig(commands.pi),
    goose: cloneProviderCommandConfig(commands.goose),
    junie: cloneProviderCommandConfig(commands.junie),
  };
}

function cloneProviderInstances(
  instances: Record<ProviderName, Record<string, ProviderInstanceConfig>>,
): Record<ProviderName, Record<string, ProviderInstanceConfig>> {
  return {
    auggie: cloneInstanceMap(instances.auggie),
    claude: cloneInstanceMap(instances.claude),
    codex: cloneInstanceMap(instances.codex),
    copilot: cloneInstanceMap(instances.copilot),
    cursor: cloneInstanceMap(instances.cursor),
    gemini: cloneInstanceMap(instances.gemini),
    kiro: cloneInstanceMap(instances.kiro),
    kilo: cloneInstanceMap(instances.kilo),
    opencode: cloneInstanceMap(instances.opencode),
    pi: cloneInstanceMap(instances.pi),
    goose: cloneInstanceMap(instances.goose),
    junie: cloneInstanceMap(instances.junie),
  };
}

function cloneInstanceMap(
  input: Record<string, ProviderInstanceConfig>,
): Record<string, ProviderInstanceConfig> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, {
      ...value,
      commandConfig: cloneProviderCommandConfig(value.commandConfig),
    }]),
  );
}

function cloneProviderCommandConfig(input: ProviderCommandConfig): ProviderCommandConfig {
  return {
    ...input,
    runtime: { ...input.runtime },
  };
}

function cloneRemoteProviderCatalog(input: RemoteProviderCatalog): RemoteProviderCatalog {
  return {
    api: cloneRemoteProviderMap(input.api),
    local: cloneRemoteProviderMap(input.local),
    agent: cloneRemoteProviderMap(input.agent),
  };
}

function cloneRemoteProviderMap(
  input: Record<string, Record<string, RemoteProviderInstanceConfig>>,
): Record<string, Record<string, RemoteProviderInstanceConfig>> {
  return Object.fromEntries(
    Object.entries(input).map(([providerName, instances]) => [providerName, Object.fromEntries(
      Object.entries(instances).map(([instanceId, instance]) => [instanceId, {
        ...instance,
        args: instance.args ? [...instance.args] : undefined,
        headers: instance.headers ? { ...instance.headers } : undefined,
        scopes: instance.scopes ? [...instance.scopes] : undefined,
        payloadTemplate: instance.payloadTemplate ? structuredClone(instance.payloadTemplate) : undefined,
      }]),
    )]),
  );
}

function parseRemoteBackends(
  rawBackends: Record<string, unknown> | undefined,
  filePath: string,
): ParsedRemoteBackendsResult {
  const catalog: RemoteProviderCatalog = {
    api: {},
    local: {},
    agent: {},
  };
  const defaults: Record<string, ProviderDefaultTarget[]> = {};

  for (const backend of ['api', 'local', 'agent'] as const) {
    const backendDoc = asOptionalObject(rawBackends?.[backend]);
    const providers = asOptionalObject(backendDoc?.providers);
    if (!providers) {
      continue;
    }

    for (const [providerName, rawProvider] of Object.entries(providers)) {
      const providerDoc = asObject(
        rawProvider,
        `Invalid backends.${backend}.providers.${providerName} block in '${filePath}'`,
      );
      const instances = asObject(
        providerDoc.instances,
        `Provider '${providerName}' in backends.${backend} must define instances in '${filePath}'`,
      );
      if (Object.keys(instances).length === 0) {
        throw new Error(
          `Provider '${providerName}' in backends.${backend} must define at least one instance `
          + `in '${filePath}'`,
        );
      }

      const providerHeaders = parseStringMap(
        asOptionalObject(providerDoc.headers),
        `backends.${backend}.providers.${providerName}.headers`,
      );

      const parsedInstances: Record<string, RemoteProviderInstanceConfig> = {};
      for (const [instanceId, rawInstance] of Object.entries(instances)) {
        const instanceDoc = asObject(
          rawInstance,
          `Invalid backends.${backend}.providers.${providerName}.instances.${instanceId} `
            + `block in '${filePath}'`,
        );

        const instanceHeaders = parseStringMap(
          asOptionalObject(instanceDoc.headers),
          `backends.${backend}.providers.${providerName}.instances.${instanceId}.headers`,
        );

        parsedInstances[instanceId] = {
          id: instanceId,
          providerName,
          backend,
          transport: readString(instanceDoc.transport)
            || readString(providerDoc.transport),
          command: readString(instanceDoc.command)
            || readString(providerDoc.command),
          args: parseOptionalStringArray(
            instanceDoc.args ?? providerDoc.args,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.args`,
          ),
          cwd: readString(instanceDoc.cwd)
            || readString(providerDoc.cwd),
          url: readString(instanceDoc.url)
            || readString(providerDoc.url),
          urlEnv: readString(instanceDoc.url_env)
            || readString(instanceDoc.urlEnv)
            || readString(providerDoc.url_env)
            || readString(providerDoc.urlEnv),
          model: readString(instanceDoc.model)
            || readString(providerDoc.model),
          systemPrompt: readString(instanceDoc.system_prompt)
            || readString(instanceDoc.systemPrompt)
            || readString(providerDoc.system_prompt)
            || readString(providerDoc.systemPrompt),
          apiKeyEnv: readString(instanceDoc.api_key_env)
            || readString(instanceDoc.apiKeyEnv)
            || readString(providerDoc.api_key_env)
            || readString(providerDoc.apiKeyEnv),
          authTokenEnv: readString(instanceDoc.auth_token_env)
            || readString(instanceDoc.authTokenEnv)
            || readString(providerDoc.auth_token_env)
            || readString(providerDoc.authTokenEnv),
          passwordEnv: readString(instanceDoc.password_env)
            || readString(instanceDoc.passwordEnv)
            || readString(providerDoc.password_env)
            || readString(providerDoc.passwordEnv),
          baseUrl: readString(instanceDoc.base_url)
            || readString(instanceDoc.baseUrl)
            || readString(providerDoc.base_url)
            || readString(providerDoc.baseUrl),
          baseUrlEnv: readString(instanceDoc.base_url_env)
            || readString(instanceDoc.baseUrlEnv)
            || readString(providerDoc.base_url_env)
            || readString(providerDoc.baseUrlEnv),
          organizationEnv: readString(instanceDoc.organization_env)
            || readString(instanceDoc.organizationEnv)
            || readString(providerDoc.organization_env)
            || readString(providerDoc.organizationEnv),
          projectEnv: readString(instanceDoc.project_env)
            || readString(instanceDoc.projectEnv)
            || readString(providerDoc.project_env)
            || readString(providerDoc.projectEnv),
          headers: mergeStringMaps(providerHeaders, instanceHeaders),
          clientId: readString(instanceDoc.client_id)
            || readString(instanceDoc.clientId)
            || readString(providerDoc.client_id)
            || readString(providerDoc.clientId),
          clientMode: readString(instanceDoc.client_mode)
            || readString(instanceDoc.clientMode)
            || readString(providerDoc.client_mode)
            || readString(providerDoc.clientMode),
          clientVersion: readString(instanceDoc.client_version)
            || readString(instanceDoc.clientVersion)
            || readString(providerDoc.client_version)
            || readString(providerDoc.clientVersion),
          role: readString(instanceDoc.role)
            || readString(providerDoc.role),
          scopes: parseOptionalStringArray(
            instanceDoc.scopes ?? providerDoc.scopes,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.scopes`,
          ),
          payloadTemplate: parseOptionalObjectValue(
            instanceDoc.payload_template
              ?? instanceDoc.payloadTemplate
              ?? providerDoc.payload_template
              ?? providerDoc.payloadTemplate,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.payload_template`,
          ),
          waitTimeoutMs: parseOptionalIntValue(
            instanceDoc.wait_timeout_ms
              ?? instanceDoc.waitTimeoutMs
              ?? providerDoc.wait_timeout_ms
              ?? providerDoc.waitTimeoutMs,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.wait_timeout_ms`,
          ),
          maxOutputTokens: parseOptionalIntValue(
            instanceDoc.max_output_tokens
              ?? instanceDoc.maxOutputTokens
              ?? providerDoc.max_output_tokens
              ?? providerDoc.maxOutputTokens,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.max_output_tokens`,
          ),
          timeoutMs: parseOptionalIntValue(
            instanceDoc.timeout_ms
              ?? instanceDoc.timeoutMs
              ?? providerDoc.timeout_ms
              ?? providerDoc.timeoutMs,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.timeout_ms`,
          ),
          maxRetries: parseOptionalIntValue(
            instanceDoc.max_retries
              ?? instanceDoc.maxRetries
              ?? providerDoc.max_retries
              ?? providerDoc.maxRetries,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.max_retries`,
          ),
          maxToolSteps: parseOptionalIntValue(
            instanceDoc.max_tool_steps
              ?? instanceDoc.maxToolSteps
              ?? providerDoc.max_tool_steps
              ?? providerDoc.maxToolSteps,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.max_tool_steps`,
          ),
          toolProfile: readString(instanceDoc.tool_profile)
            || readString(instanceDoc.toolProfile)
            || readString(providerDoc.tool_profile)
            || readString(providerDoc.toolProfile),
          startupTimeoutMs: parseOptionalIntValue(
            instanceDoc.startup_timeout_ms
              ?? instanceDoc.startupTimeoutMs
              ?? providerDoc.startup_timeout_ms
              ?? providerDoc.startupTimeoutMs,
            `backends.${backend}.providers.${providerName}.instances.${instanceId}.startup_timeout_ms`,
          ),
        };
      }

      catalog[backend][providerName] = parsedInstances;

      const defaultInstance = readString(providerDoc.default_instance)
        || readString(providerDoc.defaultInstance)
        || Object.keys(parsedInstances)[0];
      if (!parsedInstances[defaultInstance]) {
        throw new Error(
          `Provider '${providerName}' default instance '${defaultInstance}' `
          + `is not defined in backends.${backend} of '${filePath}'`,
        );
      }

      defaults[providerName] = [
        ...(defaults[providerName] || []),
        { backend, instance: defaultInstance },
      ];
    }
  }

  return {
    catalog,
    defaults,
  };
}

function resolveProviderDefaultTargets(
  doc: Record<string, unknown>,
  filePath: string,
  providerInstances: Record<ProviderName, Record<string, ProviderInstanceConfig>>,
  providerDefaultInstances: Record<ProviderName, string>,
  remoteDefaults: Record<string, ProviderDefaultTarget[]>,
): Record<string, ProviderDefaultTarget> {
  const availableTargets = new Map<string, ProviderDefaultTarget[]>();

  for (const provider of KNOWN_PROVIDERS) {
    const instances = providerInstances[provider];
    if (Object.keys(instances).length === 0) {
      continue;
    }
    const defaultInstance = providerDefaultInstances[provider] || Object.keys(instances)[0];
    pushProviderTarget(availableTargets, provider, {
      backend: 'cli',
      instance: defaultInstance,
    });
  }

  for (const [providerName, targets] of Object.entries(remoteDefaults)) {
    for (const target of targets) {
      pushProviderTarget(availableTargets, providerName, target);
    }
  }

  const routingProviders = asOptionalObject(asOptionalObject(doc.routing)?.providers);
  const explicitTargets: Record<string, ProviderDefaultTarget> = {};
  if (routingProviders) {
    for (const [providerName, rawProvider] of Object.entries(routingProviders)) {
      const providerDoc = asObject(
        rawProvider,
        `Invalid routing.providers.${providerName} block in '${filePath}'`,
      );
      const defaultTargetDoc = asOptionalObject(providerDoc.default_target)
        || asOptionalObject(providerDoc.defaultTarget);
      if (!defaultTargetDoc) {
        throw new Error(
          `routing.providers.${providerName} in '${filePath}' must define default_target`,
        );
      }

      const backend = parseBackendKindValue(
        defaultTargetDoc.backend,
        'cli',
        `routing.providers.${providerName}.default_target.backend`,
      );
      const instance = readString(defaultTargetDoc.instance)
        || readString(defaultTargetDoc.instance_id)
        || readString(defaultTargetDoc.instanceId);
      if (!instance) {
        throw new Error(
          `routing.providers.${providerName}.default_target.instance is required in '${filePath}'`,
        );
      }

      explicitTargets[providerName] = { backend, instance };
    }
  }

  for (const [providerName, target] of Object.entries(explicitTargets)) {
    const candidates = availableTargets.get(providerName);
    if (!candidates) {
      throw new Error(
        `routing.providers.${providerName} references an unconfigured provider in '${filePath}'`,
      );
    }
    if (!candidates.some((candidate) => (
      candidate.backend === target.backend && candidate.instance === target.instance
    ))) {
      throw new Error(
        `routing.providers.${providerName} default target '${target.backend}/${target.instance}' `
        + `is not defined in '${filePath}'`,
      );
    }
  }

  const resolved: Record<string, ProviderDefaultTarget> = {};
  for (const [providerName, targets] of availableTargets.entries()) {
    const explicit = explicitTargets[providerName];
    if (explicit) {
      resolved[providerName] = explicit;
      continue;
    }

    if (targets.length === 1) {
      resolved[providerName] = targets[0];
      continue;
    }

    throw new Error(
      `Provider '${providerName}' is configured in multiple backends in '${filePath}'. `
      + 'Set routing.providers.'
      + `${providerName}.default_target to disambiguate.`,
    );
  }

  return resolved;
}

function pushProviderTarget(
  targets: Map<string, ProviderDefaultTarget[]>,
  providerName: string,
  target: ProviderDefaultTarget,
): void {
  const next = targets.get(providerName) || [];
  next.push(target);
  targets.set(providerName, next);
}

function isKnownProvider(value: string): value is ProviderName {
  return (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

function parseBackendKindValue(
  value: unknown,
  fallback: BackendKind,
  label: string,
): BackendKind {
  const raw = normalizeString(value);
  if (!raw) {
    return fallback;
  }
  if (raw === 'cli' || raw === 'api' || raw === 'local' || raw === 'agent') {
    return raw;
  }

  throw new Error(`Invalid ${label}='${raw}'. Valid values: cli, api, local, agent`);
}

function parseStringMap(
  value: Record<string, unknown> | undefined,
  label: string,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const parsed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const stringValue = readString(entry);
    if (stringValue === undefined) {
      throw new Error(`${label}.${key} must be a string`);
    }
    parsed[key] = stringValue;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseOptionalStringArray(
  value: unknown,
  label: string,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const parsed = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string or string[]`);
  }

  const parsed = value.map((entry) => {
    const stringValue = readString(entry);
    if (stringValue === undefined) {
      throw new Error(`${label} entries must be strings`);
    }
    return stringValue;
  }).filter(Boolean);

  return parsed.length > 0 ? parsed : undefined;
}

function parseOptionalObjectValue(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return structuredClone(value as Record<string, unknown>);
}

function mergeStringMaps(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...(base || {}),
    ...(override || {}),
  };
}

function parseOptionalIntValue(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer, got '${String(value)}'`);
    }

    return Math.trunc(value);
  }

  const raw = readString(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer, got '${String(value)}'`);
  }

  return parsed;
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
  return parseRunnerModeValue(
    env[`${prefix}_RUNNER`],
    'auto',
    `${prefix}_RUNNER`,
  );
}

function parseRunnerModeValue(
  value: unknown,
  fallback: RunnerMode,
  label: string,
): RunnerMode {
  const raw = normalizeString(value);
  if (!raw) {
    return fallback;
  }
  if ((RUNNER_MODES as readonly string[]).includes(raw)) {
    return raw as RunnerMode;
  }

  throw new Error(
    `Invalid ${label}='${raw}'. Valid values: ${RUNNER_MODES.join(', ')}`,
  );
}

function readRuntimeConfig(
  prefix: string,
  defaultMode: RuntimeMode,
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeConfig {
  const value = normalizeString(env[`${prefix}_RUNTIME`]) || defaultMode;
  const mode = parseRuntimeModeValue(value, defaultMode, `${prefix}_RUNTIME`);

  return {
    mode,
    distro: env[`${prefix}_RUNTIME_DISTRO`]
      || env[`${prefix}_WSL_DISTRO`]
      || undefined,
    container: env[`${prefix}_RUNTIME_CONTAINER`]
      || env[`${prefix}_DOCKER_CONTAINER`]
      || undefined,
  };
}

function parseRuntimeModeValue(
  value: unknown,
  fallback: RuntimeMode,
  label: string,
): RuntimeMode {
  const raw = normalizeString(value);
  if (!raw) {
    return fallback;
  }
  if (!(RUNTIME_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid ${label}='${raw}'. Valid values: ${RUNTIME_MODES.join(', ')}`,
    );
  }

  return raw as RuntimeMode;
}

function parseWslDiscoveryPolicy(
  value: string | undefined,
  fallback: WslDiscoveryPolicy,
): WslDiscoveryPolicy {
  const raw = value?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if ((WSL_DISCOVERY_POLICIES as readonly string[]).includes(raw)) {
    return raw as WslDiscoveryPolicy;
  }

  throw new Error(
    `Invalid CATS_RUNTIME_WSL_DISCOVERY_POLICY='${raw}'. `
      + `Valid values: ${WSL_DISCOVERY_POLICIES.join(', ')}`,
  );
}

function parseDockerDiscoveryPolicy(
  value: string | undefined,
  fallback: DockerDiscoveryPolicy,
): DockerDiscoveryPolicy {
  const raw = value?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if ((DOCKER_DISCOVERY_POLICIES as readonly string[]).includes(raw)) {
    return raw as DockerDiscoveryPolicy;
  }

  throw new Error(
    `Invalid CATS_RUNTIME_DOCKER_DISCOVERY_POLICY='${raw}'. `
      + `Valid values: ${DOCKER_DISCOVERY_POLICIES.join(', ')}`,
  );
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

function parseOptionalNonNegativeInt(
  value: string | undefined,
  envName: string,
): number | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
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

function parseOptionalPositiveInt(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer, got '${String(value)}'`);
    }

    return Math.trunc(value);
  }

  const raw = normalizeString(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got '${String(value)}'`);
  }

  return parsed;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function asOptionalObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
