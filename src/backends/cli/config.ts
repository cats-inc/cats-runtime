import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parse } from 'yaml';
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
const WSL_DISCOVERY_POLICIES = [
  'always',
  'if_running',
  'manual_only',
] as const;
const CONFIG_FILE_DEFAULT = join('config', 'providers.yaml');

export type RunnerMode = typeof RUNNER_MODES[number];
export type RuntimeMode = typeof RUNTIME_MODES[number];
export type WslDiscoveryPolicy = typeof WSL_DISCOVERY_POLICIES[number];

export interface ProviderRuntimeConfig {
  mode: RuntimeMode;
  distro?: string;
  environmentId?: string;
}

export interface ProviderCommandConfig {
  path: string;
  runner: RunnerMode;
  runnerPath?: string;
  runtime: ProviderRuntimeConfig;
}

export interface ProviderInstanceConfig {
  id: string;
  providerName: ProviderName;
  commandConfig: ProviderCommandConfig;
  auggieSessionsDir?: string;
  claudeProjectsDir?: string;
  codexSessionsDir?: string;
  copilotSessionsDir?: string;
  cursorChatsDir?: string;
  geminiSessionsDir?: string;
  kiroDbPath?: string;
  opencodeServerHost?: string;
  opencodeServerPort?: number;
  opencodeServerStartupTimeoutMs?: number;
}

export interface CliRuntimeConfig {
  host: string;
  port: number;
  apiKey: string;
  dataDir?: string;
  configPath?: string;
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
  cursorRuntime: ProviderRuntimeConfig;
  geminiSessionsDir: string;
  kiroDbPath: string;
  kiroRuntime: ProviderRuntimeConfig;
  wslDiscoveryPolicy?: WslDiscoveryPolicy;
  nativeDiscoveryIntervalMs: number;
  externalSessionLiveWindowMs: number;
  maxSessions: number;
  spawnRetries: number;
  spawnTimeoutMs: number;
  sessionBaseDir: string;
  providerCommands: Record<ProviderName, ProviderCommandConfig>;
  providerDefaultInstances?: Partial<Record<ProviderName, string>>;
  providerInstances?: Partial<Record<ProviderName, Record<string, ProviderInstanceConfig>>>;
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
  opencodeServerHost: string;
  opencodeServerPort: number;
  opencodeServerStartupTimeoutMs: number;
}

interface ParsedEnvironmentConfig {
  mode: RuntimeMode;
  distro?: string;
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
  return 50;
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

export function defaultWslDiscoveryPolicy(): WslDiscoveryPolicy {
  return 'always';
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliRuntimeConfig {
  const home = env.HOME || env.USERPROFILE || '';
  const apiKey = env.CATS_RUNTIME_API_KEY || '';
  const host = env.CATS_RUNTIME_HOST || (apiKey ? '' : '127.0.0.1');
  const port = parsePositiveInt(
    env.CATS_RUNTIME_PORT || env.PORT || '3110',
    3110,
    'CATS_RUNTIME_PORT',
  );
  const dataDir = env.CATS_RUNTIME_DATA_DIR
    || join(home, '.cats-runtime', 'data');
  const sessionBaseDir = env.CATS_RUNTIME_SESSION_BASE_DIR
    || join(home, '.cats-runtime', 'sessions');

  const legacy = buildLegacyRuntimeShape(env, home);
  const configPath = resolveConfigPath(env.CATS_RUNTIME_CONFIG_PATH);
  const configured = existsSync(configPath)
    ? applyFileBasedProviderConfig(configPath, legacy)
    : legacy;

  return {
    host,
    port,
    apiKey,
    dataDir,
    configPath: existsSync(configPath) ? configPath : undefined,
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
    opencodePath: configured.providerCommands.opencode.path,
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
    wslDiscoveryPolicy: parseWslDiscoveryPolicy(
      env.CATS_RUNTIME_WSL_DISCOVERY_POLICY,
      defaultWslDiscoveryPolicy(),
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
    providerCommands: configured.providerCommands,
    providerDefaultInstances: configured.providerDefaultInstances,
    providerInstances: configured.providerInstances,
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
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
  >,
  provider: ProviderName,
): ProviderInstanceConfig[] {
  const configured = config.providerInstances?.[provider];
  if (configured && Object.keys(configured).length > 0) {
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
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
  >,
  provider: ProviderName,
  instanceId?: string,
): ProviderInstanceConfig {
  const configured = config.providerInstances?.[provider];
  if (configured && Object.keys(configured).length > 0) {
    const selected = instanceId || getProviderDefaultInstanceId(config, provider);
    const instance = configured[selected];
    if (instance) {
      return instance;
    }

    throw new Error(
      `Unknown ${provider} instance '${selected}'. Valid: ${Object.keys(configured).join(', ')}`,
    );
  }

  const defaultInstanceId = getProviderDefaultInstanceId(config, provider);
  if (instanceId && instanceId !== defaultInstanceId && instanceId !== 'default') {
    throw new Error(
      `Unknown ${provider} instance '${instanceId}'. Valid: ${defaultInstanceId}`,
    );
  }

  return buildLegacyProviderInstance(
    provider,
    defaultInstanceId,
    config.providerCommands[provider],
    config,
  );
}

function resolveConfigPath(value: string | undefined): string {
  if (!value) {
    return resolve(process.cwd(), CONFIG_FILE_DEFAULT);
  }

  return isAbsolute(value)
    ? value
    : resolve(process.cwd(), value);
}

function buildLegacyRuntimeShape(
  env: NodeJS.ProcessEnv,
  home: string,
): LegacyRuntimeShape {
  const providerCommands = buildLegacyProviderCommands(env);
  const providerDefaultInstances = {
    auggie: 'default',
    claude: 'default',
    codex: 'default',
    copilot: 'default',
    cursor: 'default',
    gemini: 'default',
    kiro: 'default',
    opencode: 'default',
  } satisfies Record<ProviderName, string>;

  const auggieSessionsDir = env.AUGGIE_SESSIONS_DIR || defaultAuggieSessionsDir();
  const cursorChatsDir = env.CURSOR_CHATS_DIR || defaultCursorChatsDir();
  const kiroDbPath = env.KIRO_DB_PATH || defaultKiroDbPath();
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
    kiroRuntime: providerCommands.kiro.runtime,
    opencodeServerHost,
    opencodeServerPort,
    opencodeServerStartupTimeoutMs,
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
  const opencodePath = env.OPENCODE_PATH || 'opencode';

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
    opencode: readProviderCommandConfig(
      'OPENCODE',
      opencodePath,
      defaultProviderRuntimeMode('opencode'),
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
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
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
    opencodeServerHost: provider === 'opencode' ? config.opencodeServerHost : undefined,
    opencodeServerPort: provider === 'opencode' ? config.opencodeServerPort : undefined,
    opencodeServerStartupTimeoutMs: provider === 'opencode'
      ? config.opencodeServerStartupTimeoutMs
      : undefined,
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

  const environments = parseEnvironmentMap(doc.environments);
  const providerCommands = cloneProviderCommands(legacy.providerCommands);
  const providerDefaultInstances = { ...legacy.providerDefaultInstances };
  const providerInstances = cloneProviderInstances(legacy.providerInstances);
  let auggieSessionsDir = legacy.auggieSessionsDir;
  let claudeProjectsDir = legacy.claudeProjectsDir;
  let codexSessionsDir = legacy.codexSessionsDir;
  let copilotSessionsDir = legacy.copilotSessionsDir;
  let cursorChatsDir = legacy.cursorChatsDir;
  let cursorRuntime = legacy.cursorRuntime;
  let geminiSessionsDir = legacy.geminiSessionsDir;
  let kiroDbPath = legacy.kiroDbPath;
  let kiroRuntime = legacy.kiroRuntime;
  let opencodeServerHost = legacy.opencodeServerHost;
  let opencodeServerPort = legacy.opencodeServerPort;
  let opencodeServerStartupTimeoutMs = legacy.opencodeServerStartupTimeoutMs;

  const rawProviders = doc.providers;
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
        };
      }

      if (Object.keys(nextInstances).length === 0) {
        throw new Error(`Provider '${provider}' must define at least one instance in '${filePath}'`);
      }

      const defaultInstance = readString(providerDoc.default_instance)
        || readString(providerDoc.defaultInstance)
        || providerDefaultInstances[provider]
        || Object.keys(nextInstances)[0];
      if (!nextInstances[defaultInstance]) {
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
      if (provider === 'opencode') {
        opencodeServerHost = nextInstances[defaultInstance].opencodeServerHost || opencodeServerHost;
        opencodeServerPort = nextInstances[defaultInstance].opencodeServerPort || opencodeServerPort;
        opencodeServerStartupTimeoutMs = nextInstances[defaultInstance].opencodeServerStartupTimeoutMs
          || opencodeServerStartupTimeoutMs;
      }
      if (provider === 'auggie') {
        auggieSessionsDir = nextInstances[defaultInstance].auggieSessionsDir || auggieSessionsDir;
      }
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
    opencodeServerHost,
    opencodeServerPort,
    opencodeServerStartupTimeoutMs,
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

function parseEnvironmentMap(raw: unknown): Record<string, ParsedEnvironmentConfig> {
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

    result[environmentId] = {
      mode,
      distro: readString(environment.distro),
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
      environmentId,
    };
  }

  const inlineRuntime = readString(raw.runtime)
    || readString(raw.kind)
    || readString(raw.mode);
  const mode = parseRuntimeModeValue(
    inlineRuntime,
    fallback.mode,
    `${label}.runtime`,
  );

  return {
    mode,
    distro: readString(raw.distro) || fallback.distro,
    environmentId: fallback.environmentId,
  };
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
    opencode: cloneProviderCommandConfig(commands.opencode),
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
    opencode: cloneInstanceMap(instances.opencode),
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

function isKnownProvider(value: string): value is ProviderName {
  return [
    'auggie',
    'claude',
    'codex',
    'copilot',
    'cursor',
    'gemini',
    'kiro',
    'opencode',
  ].includes(value);
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
