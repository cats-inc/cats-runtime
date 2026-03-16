import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultAuggieMaxTurns,
  defaultAuggieSessionsDir,
  defaultCursorAndKiroRuntimeMode,
  defaultCursorChatsDir,
  defaultExternalSessionLiveWindowMs,
  defaultNativeDiscoveryIntervalMs,
  defaultKiroDbPath,
  defaultOpencodeServerHost,
  defaultOpencodeServerPort,
  defaultOpencodeServerStartupTimeoutMs,
  defaultProviderRuntimeMode,
  defaultSpawnRetries,
  defaultSpawnTimeoutMs,
  defaultWslDiscoveryPolicy,
  listProviderInstances,
  loadConfig,
  resolveProviderInstance,
} from './config.js';

const MISSING_CONFIG_PATH = join(
  tmpdir(),
  `cats-runtime-config-missing-${process.pid}-providers.yaml`,
);

function loadConfigWithoutProviderFile(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    ...process.env,
    ...env,
    CATS_RUNTIME_CONFIG_PATH: env.CATS_RUNTIME_CONFIG_PATH || MISSING_CONFIG_PATH,
  });
}

describe('config platform defaults', () => {
  it('defaults Cursor and Kiro to WSL only on Windows', () => {
    expect(defaultCursorAndKiroRuntimeMode('win32')).toBe('wsl');
    expect(defaultCursorAndKiroRuntimeMode('darwin')).toBe('native');
    expect(defaultCursorAndKiroRuntimeMode('linux')).toBe('native');
  });

  it('defaults provider runtimes explicitly for all CLIs', () => {
    expect(defaultProviderRuntimeMode('claude', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('codex', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('gemini', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('copilot', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('opencode', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('auggie', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('cursor', 'win32')).toBe('wsl');
    expect(defaultProviderRuntimeMode('kiro', 'win32')).toBe('wsl');
    expect(defaultProviderRuntimeMode('cursor', 'darwin')).toBe('native');
    expect(defaultProviderRuntimeMode('kiro', 'linux')).toBe('native');
  });

  it('uses the shared Cursor chats path on every platform', () => {
    expect(defaultCursorChatsDir()).toBe('~/.cursor/chats');
  });

  it('uses the shared Auggie session path on every platform', () => {
    expect(defaultAuggieSessionsDir()).toBe('~/.augment/sessions');
  });

  it('uses 50 Auggie max turns by default', () => {
    expect(defaultAuggieMaxTurns()).toBe(50);
  });

  it('uses the macOS Kiro database path on Darwin', () => {
    expect(defaultKiroDbPath('darwin'))
      .toBe('~/Library/Application Support/kiro-cli/data.sqlite3');
  });

  it('uses the Linux/WSL Kiro database path elsewhere', () => {
    expect(defaultKiroDbPath('linux')).toBe('~/.local/share/kiro-cli/data.sqlite3');
    expect(defaultKiroDbPath('win32')).toBe('~/.local/share/kiro-cli/data.sqlite3');
  });

  it('defaults OpenCode server settings for a sidecar local server', () => {
    expect(defaultOpencodeServerHost()).toBe('127.0.0.1');
    expect(defaultOpencodeServerPort()).toBe(4097);
    expect(defaultOpencodeServerStartupTimeoutMs()).toBe(10000);
  });

  it('polls native provider storage every 5 seconds by default', () => {
    expect(defaultNativeDiscoveryIntervalMs()).toBe(5000);
  });

  it('defaults WSL discovery policy to always', () => {
    expect(defaultWslDiscoveryPolicy()).toBe('always');
  });

  it('treats discovered sessions as externally live for 15 seconds after activity', () => {
    expect(defaultExternalSessionLiveWindowMs()).toBe(15000);
  });

  it('defaults spawn retries to 1 (no retry)', () => {
    expect(defaultSpawnRetries()).toBe(1);
  });

  it('defaults spawn timeout to 30 seconds', () => {
    expect(defaultSpawnTimeoutMs()).toBe(30000);
  });

  it('loads spawn resilience settings from the environment', () => {
    const config = loadConfigWithoutProviderFile({
      CATS_RUNTIME_SPAWN_RETRIES: '3',
      CATS_RUNTIME_SPAWN_TIMEOUT_MS: '15000',
    });
    expect(config.spawnRetries).toBe(3);
    expect(config.spawnTimeoutMs).toBe(15000);
  });

  it('rejects non-positive spawn retries', () => {
    expect(() => loadConfigWithoutProviderFile({
      CATS_RUNTIME_SPAWN_RETRIES: '0',
    })).toThrow(/CATS_RUNTIME_SPAWN_RETRIES/);
  });

  it('allows spawn timeout of zero to disable it', () => {
    const config = loadConfigWithoutProviderFile({
      CATS_RUNTIME_SPAWN_TIMEOUT_MS: '0',
    });
    expect(config.spawnTimeoutMs).toBe(0);
  });

  it('loads Auggie max turns from the environment', () => {
    expect(loadConfigWithoutProviderFile({ AUGGIE_MAX_TURNS: '7' }).auggieMaxTurns).toBe(7);
  });

  it('loads WSL discovery policy from the environment', () => {
    expect(
      loadConfigWithoutProviderFile({
        CATS_RUNTIME_WSL_DISCOVERY_POLICY: 'if_running',
      }).wslDiscoveryPolicy,
    ).toBe('if_running');
  });

  it('rejects invalid WSL discovery policy values', () => {
    expect(() => loadConfigWithoutProviderFile({
      CATS_RUNTIME_WSL_DISCOVERY_POLICY: 'sometimes',
    })).toThrow(/Invalid CATS_RUNTIME_WSL_DISCOVERY_POLICY/);
  });

  it('defaults runtime data and session directories under ~/.cats-runtime', () => {
    const config = loadConfigWithoutProviderFile({
      HOME: '/home/tester',
      USERPROFILE: '',
    });

    expect(config.dataDir).toBe(join('/home/tester', '.cats-runtime', 'data'));
    expect(config.sessionBaseDir).toBe(join('/home/tester', '.cats-runtime', 'sessions'));
  });

  it('loads Auggie and OpenCode command overrides from the environment', () => {
    const config = loadConfigWithoutProviderFile({
      AUGGIE_PATH: '/custom/auggie',
      AUGGIE_RUNNER: 'pwsh',
      AUGGIE_RUNNER_PATH: '/custom/pwsh',
      AUGGIE_RUNTIME: 'native',
      AUGGIE_SESSIONS_DIR: '/custom/augment/sessions',
      OPENCODE_PATH: '/custom/opencode',
      OPENCODE_RUNNER: 'direct',
      OPENCODE_RUNNER_PATH: '/custom/direct-runner',
      OPENCODE_RUNTIME: 'native',
      OPENCODE_SERVER_HOST: '0.0.0.0',
      OPENCODE_SERVER_PORT: '5001',
      OPENCODE_SERVER_STARTUP_TIMEOUT_MS: '2500',
    });

    expect(config.auggiePath).toBe('/custom/auggie');
    expect(config.auggieSessionsDir).toBe('/custom/augment/sessions');
    expect(config.providerCommands.auggie).toEqual({
      path: '/custom/auggie',
      runner: 'pwsh',
      runnerPath: '/custom/pwsh',
      runtime: { mode: 'native', distro: undefined },
    });

    expect(config.opencodePath).toBe('/custom/opencode');
    expect(config.opencodeServerHost).toBe('0.0.0.0');
    expect(config.opencodeServerPort).toBe(5001);
    expect(config.opencodeServerStartupTimeoutMs).toBe(2500);
    expect(config.providerCommands.opencode).toEqual({
      path: '/custom/opencode',
      runner: 'direct',
      runnerPath: '/custom/direct-runner',
      runtime: { mode: 'native', distro: undefined },
    });
  });

  it('loads runtime overrides for every CLI provider family', () => {
    const previous = {
      CLAUDE_RUNTIME: process.env.CLAUDE_RUNTIME,
      CLAUDE_RUNTIME_DISTRO: process.env.CLAUDE_RUNTIME_DISTRO,
      CODEX_RUNTIME: process.env.CODEX_RUNTIME,
      CODEX_RUNTIME_DISTRO: process.env.CODEX_RUNTIME_DISTRO,
      GEMINI_RUNTIME: process.env.GEMINI_RUNTIME,
      GEMINI_RUNTIME_DISTRO: process.env.GEMINI_RUNTIME_DISTRO,
      COPILOT_RUNTIME: process.env.COPILOT_RUNTIME,
      COPILOT_RUNTIME_DISTRO: process.env.COPILOT_RUNTIME_DISTRO,
      OPENCODE_RUNTIME: process.env.OPENCODE_RUNTIME,
      OPENCODE_RUNTIME_DISTRO: process.env.OPENCODE_RUNTIME_DISTRO,
      AUGGIE_RUNTIME: process.env.AUGGIE_RUNTIME,
      AUGGIE_RUNTIME_DISTRO: process.env.AUGGIE_RUNTIME_DISTRO,
      CURSOR_RUNTIME: process.env.CURSOR_RUNTIME,
      CURSOR_RUNTIME_DISTRO: process.env.CURSOR_RUNTIME_DISTRO,
      KIRO_RUNTIME: process.env.KIRO_RUNTIME,
      KIRO_RUNTIME_DISTRO: process.env.KIRO_RUNTIME_DISTRO,
    };

    process.env.CLAUDE_RUNTIME = 'wsl';
    process.env.CLAUDE_RUNTIME_DISTRO = 'Ubuntu';
    process.env.CODEX_RUNTIME = 'wsl';
    process.env.CODEX_RUNTIME_DISTRO = 'Ubuntu';
    process.env.GEMINI_RUNTIME = 'wsl';
    process.env.GEMINI_RUNTIME_DISTRO = 'Ubuntu';
    process.env.COPILOT_RUNTIME = 'wsl';
    process.env.COPILOT_RUNTIME_DISTRO = 'Ubuntu';
    process.env.OPENCODE_RUNTIME = 'wsl';
    process.env.OPENCODE_RUNTIME_DISTRO = 'Ubuntu';
    process.env.AUGGIE_RUNTIME = 'wsl';
    process.env.AUGGIE_RUNTIME_DISTRO = 'Ubuntu';
    process.env.CURSOR_RUNTIME = 'wsl';
    process.env.CURSOR_RUNTIME_DISTRO = 'Ubuntu';
    process.env.KIRO_RUNTIME = 'wsl';
    process.env.KIRO_RUNTIME_DISTRO = 'Ubuntu';

    try {
      const config = loadConfigWithoutProviderFile();

      expect(config.providerCommands.claude.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.codex.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.gemini.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.copilot.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.opencode.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.auggie.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.cursor.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
      expect(config.providerCommands.kiro.runtime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('loads provider instances from providers.yaml and resolves per-instance runtimes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
  ubuntu:
    kind: wsl
    distro: Ubuntu
providers:
  codex:
    default_instance: native
    instances:
      native:
        environment: native
        command: codex
        runner: auto
        sessions_dir: /native/codex/sessions
      ubuntu:
        environment: ubuntu
        command: codex
        runner: auto
        sessions_dir: /wsl/codex/sessions
  cursor:
    default_instance: native
    instances:
      native:
        environment: native
        command: cursor-agent
        runner: auto
        chats_dir: /native/cursor/chats
      ubuntu:
        environment: ubuntu
        command: cursor-agent
        runner: auto
        chats_dir: /wsl/cursor/chats
  kiro:
    default_instance: ubuntu
    instances:
      ubuntu:
        environment: ubuntu
        command: kiro-cli
        runner: auto
        db_path: /wsl/kiro/data.sqlite3
  opencode:
    instances:
      default:
        environment: native
        command: opencode
        runner: direct
        server:
          host: 0.0.0.0
          port: 5001
          startup_timeout_ms: 2500
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      });

      expect(config.configPath).toBe(configPath);
      expect(config.providerDefaultInstances?.codex).toBe('native');
      expect(config.providerDefaultInstances?.cursor).toBe('native');
      expect(config.providerDefaultInstances?.kiro).toBe('ubuntu');

      expect(config.codexSessionsDir).toBe('/native/codex/sessions');
      expect(resolveProviderInstance(config, 'codex', 'ubuntu')).toMatchObject({
        id: 'ubuntu',
        codexSessionsDir: '/wsl/codex/sessions',
        commandConfig: {
          path: 'codex',
          runner: 'auto',
          runtime: {
            mode: 'wsl',
            distro: 'Ubuntu',
            environmentId: 'ubuntu',
          },
        },
      });

      expect(config.providerCommands.cursor).toEqual({
        path: 'cursor-agent',
        runner: 'auto',
        runnerPath: undefined,
        runtime: {
          mode: 'native',
          distro: undefined,
          environmentId: 'native',
        },
      });
      expect(config.cursorChatsDir).toBe('/native/cursor/chats');
      expect(config.cursorRuntime).toEqual({
        mode: 'native',
        distro: undefined,
        environmentId: 'native',
      });

      expect(resolveProviderInstance(config, 'cursor', 'ubuntu')).toMatchObject({
        id: 'ubuntu',
        cursorChatsDir: '/wsl/cursor/chats',
        commandConfig: {
          path: 'cursor-agent',
          runner: 'auto',
          runtime: {
            mode: 'wsl',
            distro: 'Ubuntu',
            environmentId: 'ubuntu',
          },
        },
      });
      expect(listProviderInstances(config, 'cursor').map((instance) => instance.id)).toEqual([
        'native',
        'ubuntu',
      ]);

      expect(config.kiroDbPath).toBe('/wsl/kiro/data.sqlite3');
      expect(config.kiroRuntime).toEqual({
        mode: 'wsl',
        distro: 'Ubuntu',
        environmentId: 'ubuntu',
      });
      expect(resolveProviderInstance(config, 'kiro', 'default')).toMatchObject({
        id: 'ubuntu',
        commandConfig: {
          runtime: {
            mode: 'wsl',
            distro: 'Ubuntu',
            environmentId: 'ubuntu',
          },
        },
      });

      expect(config.opencodeServerHost).toBe('0.0.0.0');
      expect(config.opencodeServerPort).toBe(5001);
      expect(config.opencodeServerStartupTimeoutMs).toBe(2500);
      expect(config.providerCommands.opencode).toEqual({
        path: 'opencode',
        runner: 'direct',
        runnerPath: undefined,
        runtime: {
          mode: 'native',
          distro: undefined,
          environmentId: 'native',
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects WSL environments without a distro in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  ubuntu:
    kind: wsl
providers:
  cursor:
    instances:
      default:
        environment: ubuntu
        command: cursor-agent
        runner: auto
`.trimStart());

    try {
      expect(() => loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      })).toThrow(/environments\.ubuntu.*distro/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects inline WSL instances without a distro in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
providers:
  cursor:
    instances:
      default:
        runtime: wsl
        command: cursor-agent
        runner: auto
`.trimStart());

    try {
      expect(() => loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      })).toThrow(/cursor\.instances\.default.*distro/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows explicit WSL runtime to inherit distro from the referenced environment', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  ubuntu:
    kind: wsl
    distro: Ubuntu
providers:
  cursor:
    instances:
      default:
        environment: ubuntu
        runtime: wsl
        command: cursor-agent
        runner: auto
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      });

      expect(resolveProviderInstance(config, 'cursor')).toMatchObject({
        id: 'default',
        commandConfig: {
          runtime: {
            mode: 'wsl',
            distro: 'Ubuntu',
            environmentId: 'ubuntu',
          },
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('only enables providers listed in providers.yaml (positive list)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
providers:
  claude:
    instances:
      default:
        environment: native
        command: claude
        runner: auto
        projects_dir: ~/.claude/projects
  codex:
    instances:
      default:
        environment: native
        command: codex
        runner: auto
        sessions_dir: ~/.codex/sessions
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      });

      // Listed providers have instances
      expect(listProviderInstances(config, 'claude')).toHaveLength(1);
      expect(listProviderInstances(config, 'codex')).toHaveLength(1);

      // Unlisted providers return empty
      expect(listProviderInstances(config, 'gemini')).toHaveLength(0);
      expect(listProviderInstances(config, 'kiro')).toHaveLength(0);
      expect(listProviderInstances(config, 'cursor')).toHaveLength(0);
      expect(listProviderInstances(config, 'copilot')).toHaveLength(0);
      expect(listProviderInstances(config, 'auggie')).toHaveLength(0);
      expect(listProviderInstances(config, 'opencode')).toHaveLength(0);

      // Resolving an unlisted provider throws ProviderNotConfiguredError
      expect(() => resolveProviderInstance(config, 'gemini'))
        .toThrow(/Provider 'gemini' is not configured/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads separated backend config without mixing CLI and API instances', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    claude:
      default_target:
        backend: cli
        instance: native
    codex:
      default_target:
        backend: api
        instance: main
    ollama:
      default_target:
        backend: local
        instance: local
backends:
  cli:
    providers:
      claude:
        instances:
          native:
            environment: native
            command: claude
            runner: auto
            projects_dir: /native/claude/projects
  api:
    providers:
      codex:
        instances:
          main:
            transport: openai
            api_key_env: OPENAI_API_KEY
            model: gpt-5
            system_prompt: You are the cats-runtime API backend.
            headers:
              x-project: cats-runtime
            max_output_tokens: 8192
            timeout_ms: 30000
            max_retries: 2
            max_tool_steps: 24
  local:
    providers:
      ollama:
        instances:
          local:
            transport: ollama
            base_url: http://127.0.0.1:11434
            model: qwen3:latest
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      });

      expect(config.providerDefaultTargets).toEqual({
        claude: {
          backend: 'cli',
          instance: 'native',
        },
        codex: {
          backend: 'api',
          instance: 'main',
        },
        ollama: {
          backend: 'local',
          instance: 'local',
        },
      });

      expect(config.providerDefaultInstances?.claude).toBe('native');
      expect(config.providerDefaultTargets?.gemini).toBeUndefined();
      expect(listProviderInstances(config, 'claude')).toHaveLength(1);
      expect(listProviderInstances(config, 'gemini')).toHaveLength(0);

      expect(config.remoteProviderCatalog).toEqual({
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              model: 'gpt-5',
              systemPrompt: 'You are the cats-runtime API backend.',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: undefined,
              baseUrlEnv: undefined,
              organizationEnv: undefined,
              projectEnv: undefined,
              headers: {
                'x-project': 'cats-runtime',
              },
              maxOutputTokens: 8192,
              timeoutMs: 30000,
              maxRetries: 2,
              maxToolSteps: 24,
              toolProfile: undefined,
            },
          },
        },
        local: {
          ollama: {
            local: {
              id: 'local',
              providerName: 'ollama',
              backend: 'local',
              transport: 'ollama',
              model: 'qwen3:latest',
              systemPrompt: undefined,
              apiKeyEnv: undefined,
              baseUrl: 'http://127.0.0.1:11434',
              baseUrlEnv: undefined,
              organizationEnv: undefined,
              projectEnv: undefined,
              headers: undefined,
              maxOutputTokens: undefined,
              timeoutMs: undefined,
              maxRetries: undefined,
              maxToolSteps: undefined,
              toolProfile: undefined,
            },
          },
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects providers that are configured in multiple backends without routing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
backends:
  cli:
    providers:
      claude:
        instances:
          native:
            environment: native
            command: claude
            runner: auto
            projects_dir: /native/claude/projects
  api:
    providers:
      claude:
        instances:
          sonnet:
            transport: anthropic
            api_key_env: ANTHROPIC_API_KEY
            model: claude-sonnet-4-6
`.trimStart());

    try {
      expect(() => loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      })).toThrow(/configured in multiple backends/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts API default targets for providers that can now run outside CLI', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  api:
    providers:
      claude:
        instances:
          sonnet:
            transport: anthropic
            api_key_env: ANTHROPIC_API_KEY
            model: claude-sonnet-4-6
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      });

      expect(config.providerDefaultTargets?.claude).toEqual({
        backend: 'api',
        instance: 'sonnet',
      });
      expect(config.remoteProviderCatalog?.api.claude.sonnet).toEqual({
        id: 'sonnet',
        providerName: 'claude',
        backend: 'api',
        transport: 'anthropic',
        model: 'claude-sonnet-4-6',
        systemPrompt: undefined,
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        maxRetries: undefined,
        maxToolSteps: undefined,
        toolProfile: undefined,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects mixing legacy providers with separated backends blocks', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const configPath = join(tempDir, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
providers:
  claude:
    instances:
      default:
        command: claude
        runner: auto
backends:
  api:
    providers:
      codex:
        instances:
          main:
            transport: openai
            api_key_env: OPENAI_API_KEY
            model: gpt-5
`.trimStart());

    try {
      expect(() => loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_CONFIG_PATH: configPath,
      })).toThrow(/Cannot mix top-level providers with backends\.\*/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
