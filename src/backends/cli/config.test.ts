import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultAuggieMaxTurns,
  defaultAuggieSessionsDir,
  defaultCursorChatsDir,
  defaultCursorRuntimeMode,
  defaultExternalSessionLiveWindowMs,
  defaultNativeDiscoveryIntervalMs,
  defaultCompatibilityProbeDockerTimeoutMs,
  defaultCompatibilityProbeTimeoutMs,
  defaultCompatibilityProbeWslTimeoutMs,
  defaultKiroDbPath,
  defaultKiroRuntimeMode,
  defaultOpencodeServerHost,
  defaultOpencodeServerPort,
  defaultOpencodeServerStartupTimeoutMs,
  defaultPiSessionsDir,
  defaultProviderRuntimeMode,
  defaultSpawnRetries,
  defaultSpawnTimeoutMs,
  defaultDockerDiscoveryPolicy,
  defaultWslDiscoveryPolicy,
  listProviderInstances,
  loadConfig,
  resolveConfigPath,
  resolveProviderInstance,
} from './config.js';

const MISSING_RUNTIME_ROOT = join(
  tmpdir(),
  `cats-runtime-config-missing-${process.pid}`,
);
const MISSING_CONFIG_PATH = join(MISSING_RUNTIME_ROOT, 'config', 'providers.yaml');

function createRuntimeRootTestPaths(runtimeDir: string) {
  return {
    configDir: join(runtimeDir, 'config'),
    configPath: join(runtimeDir, 'config', 'providers.yaml'),
  };
}

function loadConfigWithoutProviderFile(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    ...process.env,
    ...env,
    ...(
      env.CATS_RUNTIME_DIR || env.HOME || env.USERPROFILE
        ? {}
        : { CATS_RUNTIME_DIR: MISSING_RUNTIME_ROOT }
    ),
  }, {
    skipProviderFile: true,
  });
}

describe('config platform defaults', () => {
  it('defaults Cursor and Kiro to native on every platform', () => {
    expect(defaultCursorRuntimeMode('win32')).toBe('native');
    expect(defaultCursorRuntimeMode('darwin')).toBe('native');
    expect(defaultCursorRuntimeMode('linux')).toBe('native');
    expect(defaultKiroRuntimeMode('win32')).toBe('native');
    expect(defaultKiroRuntimeMode('darwin')).toBe('native');
    expect(defaultKiroRuntimeMode('linux')).toBe('native');
  });

  it('defaults provider runtimes explicitly for all CLIs', () => {
    expect(defaultProviderRuntimeMode('claude', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('codex', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('gemini', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('copilot', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('opencode', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('auggie', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('pi', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('cursor', 'win32')).toBe('native');
    expect(defaultProviderRuntimeMode('kiro', 'win32')).toBe('native');
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

  it('uses the Windows-native Kiro database path on win32', () => {
    expect(defaultKiroDbPath('win32')).toBe('~/AppData/Local/kiro-cli/data.sqlite3');
  });

  it('uses the Linux Kiro database path on Linux', () => {
    expect(defaultKiroDbPath('linux')).toBe('~/.local/share/kiro-cli/data.sqlite3');
  });

  it('uses the Linux Kiro database path for WSL and Docker runtimes on every host', () => {
    expect(defaultKiroDbPath('darwin', 'wsl')).toBe('~/.local/share/kiro-cli/data.sqlite3');
    expect(defaultKiroDbPath('darwin', 'docker')).toBe('~/.local/share/kiro-cli/data.sqlite3');
    expect(defaultKiroDbPath('win32', 'docker')).toBe('~/.local/share/kiro-cli/data.sqlite3');
  });

  it('uses the shared Pi sessions path on every platform', () => {
    expect(defaultPiSessionsDir()).toBe('~/.pi/agent/sessions');
  });

  it('defaults OpenCode server settings for a sidecar local server', () => {
    expect(defaultOpencodeServerHost()).toBe('127.0.0.1');
    expect(defaultOpencodeServerPort()).toBe(4097);
    expect(defaultOpencodeServerStartupTimeoutMs()).toBe(10000);
  });

  it('polls native provider storage every 5 seconds by default', () => {
    expect(defaultNativeDiscoveryIntervalMs()).toBe(5000);
  });

  it('defaults WSL discovery policy to if_running', () => {
    expect(defaultWslDiscoveryPolicy()).toBe('if_running');
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

  it('defaults compatibility probe timeouts to 10 seconds for native and 20 seconds for WSL/Docker', () => {
    expect(defaultCompatibilityProbeTimeoutMs()).toBe(10000);
    expect(defaultCompatibilityProbeWslTimeoutMs()).toBe(20000);
    expect(defaultCompatibilityProbeDockerTimeoutMs()).toBe(20000);
  });

  it('loads spawn resilience settings from the environment', () => {
    const config = loadConfigWithoutProviderFile({
      CATS_RUNTIME_SPAWN_RETRIES: '3',
      CATS_RUNTIME_SPAWN_TIMEOUT_MS: '15000',
    });
    expect(config.spawnRetries).toBe(3);
    expect(config.spawnTimeoutMs).toBe(15000);
  });

  it('loads compatibility probe timeouts from the environment', () => {
    const config = loadConfigWithoutProviderFile({
      CATS_RUNTIME_COMPATIBILITY_PROBE_TIMEOUT_MS: '12000',
      CATS_RUNTIME_COMPATIBILITY_PROBE_WSL_TIMEOUT_MS: '18000',
      CATS_RUNTIME_COMPATIBILITY_PROBE_DOCKER_TIMEOUT_MS: '24000',
    });
    expect(config.compatibilityProbeTimeoutMs).toBe(12000);
    expect(config.compatibilityProbeWslTimeoutMs).toBe(18000);
    expect(config.compatibilityProbeDockerTimeoutMs).toBe(24000);
  });

  it('rejects non-positive spawn retries', () => {
    expect(() => loadConfigWithoutProviderFile({
      CATS_RUNTIME_SPAWN_RETRIES: '0',
    })).toThrow(/CATS_RUNTIME_SPAWN_RETRIES/);
  });

  it('rejects invalid compatibility probe timeouts', () => {
    expect(() => loadConfigWithoutProviderFile({
      CATS_RUNTIME_COMPATIBILITY_PROBE_WSL_TIMEOUT_MS: '-1',
    })).toThrow(/CATS_RUNTIME_COMPATIBILITY_PROBE_WSL_TIMEOUT_MS/);
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

  it('defaults Docker discovery policy to if_running', () => {
    expect(defaultDockerDiscoveryPolicy()).toBe('if_running');
  });

  it('loads Docker discovery policy from the environment', () => {
    expect(
      loadConfigWithoutProviderFile({
        CATS_RUNTIME_DOCKER_DISCOVERY_POLICY: 'always',
      }).dockerDiscoveryPolicy,
    ).toBe('always');
  });

  it('loads dashboard session details visibility from the environment', () => {
    expect(loadConfigWithoutProviderFile({}).dashboardShowSessionDetails).toBe(false);
    expect(loadConfigWithoutProviderFile({
      CATS_RUNTIME_DASHBOARD_SHOW_SESSION_DETAILS: 'true',
    }).dashboardShowSessionDetails).toBe(true);
  });

  it('rejects invalid Docker discovery policy values', () => {
    expect(() => loadConfigWithoutProviderFile({
      CATS_RUNTIME_DOCKER_DISCOVERY_POLICY: 'sometimes',
    })).toThrow(/Invalid CATS_RUNTIME_DOCKER_DISCOVERY_POLICY/);
  });

  it('defaults runtime config, data, and session directories under ~/.cats/runtime', () => {
    const config = loadConfigWithoutProviderFile({
      HOME: '/home/tester',
      USERPROFILE: '',
    });

    expect(config.dataDir).toBe(join('/home/tester', '.cats', 'runtime', 'data'));
    expect(config.sessionBaseDir).toBe(join('/home/tester', '.cats', 'runtime', 'sessions'));
    expect(resolveConfigPath('/home/tester')).toBe(
      join('/home/tester', '.cats', 'runtime', 'config', 'providers.yaml'),
    );
    expect(config.configPath).toBe(join('/home/tester', '.cats', 'runtime', 'config', 'providers.yaml'));
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

  it('loads Pi command and sessions dir overrides from the environment', () => {
    const config = loadConfigWithoutProviderFile({
      PI_PATH: '/custom/pi',
      PI_SESSIONS_DIR: '/custom/pi/sessions',
    });

    expect(config.piPath).toBe('/custom/pi');
    expect(config.piSessionsDir).toBe('/custom/pi/sessions');
    expect(config.providerCommands.pi).toEqual({
      path: '/custom/pi',
      runner: 'auto',
      runnerPath: undefined,
      runtime: { mode: 'native', distro: undefined },
    });
  });

  it('derives the Kiro database path from the configured runtime mode', () => {
    const nativeConfig = loadConfigWithoutProviderFile({
      KIRO_RUNTIME: 'native',
    });
    const dockerConfig = loadConfigWithoutProviderFile({
      KIRO_RUNTIME: 'docker',
    });

    expect(resolveProviderInstance(nativeConfig, 'kiro').kiroDbPath)
      .toBe(defaultKiroDbPath(process.platform, 'native'));
    expect(resolveProviderInstance(dockerConfig, 'kiro').kiroDbPath)
      .toBe(defaultKiroDbPath(process.platform, 'docker'));
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

  it('can skip the default providers file when bootstrap fallback is needed', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-config-invalid-default-'));
    try {
      const configDir = join(root, 'config');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'providers.yaml'), [
        'version: 1',
        'environments:',
        '  native:',
        '    kind: native',
        'backends:',
        '  cli:',
        '    providers:',
        '      claude:',
        '        instances:',
        '          default:',
        '            environment: native',
        '            command: claude',
        '            runner: auto',
        '            projects_dir: /native/claude/projects',
        '  api:',
        '    providers:',
        '      claude:',
        '        instances:',
        '          sonnet:',
        '            transport: anthropic',
        '            api_key_env: ANTHROPIC_API_KEY',
        '            model: claude-sonnet-4-6',
        '',
      ].join('\n'), 'utf8');

      const config = loadConfig({
        ...process.env,
        HOME: root,
        USERPROFILE: root,
      }, {
        skipProviderFile: true,
      });

      expect(config.configPath).toBe(
        join(root, '.cats', 'runtime', 'config', 'providers.yaml'),
      );
      expect(config.providerCommands.claude.path).toBeTruthy();
      expect(config.providerDefaultTargets.claude).toEqual({
        backend: 'cli',
        instance: 'default',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loads provider instances from providers.yaml and resolves per-instance runtimes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = join(runtimeDir, 'config', 'providers.yaml');
    mkdirSync(join(runtimeDir, 'config'), { recursive: true });
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
    default_instance: native
    instances:
      native:
        environment: native
        command: kiro-cli
        runner: auto
        db_path: /native/kiro/data.sqlite3
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
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.configPath).toBe(configPath);
      expect(config.providerDefaultInstances?.codex).toBe('native');
      expect(config.providerDefaultInstances?.cursor).toBe('native');
      expect(config.providerDefaultInstances?.kiro).toBe('native');

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

      expect(config.kiroDbPath).toBe('/native/kiro/data.sqlite3');
      expect(config.kiroRuntime).toEqual({
        mode: 'native',
        distro: undefined,
        environmentId: 'native',
      });
      expect(resolveProviderInstance(config, 'kiro', 'default')).toMatchObject({
        id: 'native',
        commandConfig: {
          runtime: {
            mode: 'native',
            distro: undefined,
            environmentId: 'native',
          },
        },
      });
      expect(resolveProviderInstance(config, 'kiro', 'ubuntu')).toMatchObject({
        id: 'ubuntu',
        kiroDbPath: '/wsl/kiro/data.sqlite3',
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

  it('parses Pi instructions_file from providers.yaml instances', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
providers:
  pi:
    instances:
      default:
        environment: native
        command: pi
        runner: auto
        sessions_dir: /native/pi/sessions
        instructions_file: /native/pi/system.md
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(resolveProviderInstance(config, 'pi', 'default')).toMatchObject({
        piSessionsDir: '/native/pi/sessions',
        piInstructionsFile: '/native/pi/system.md',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects WSL environments without a distro in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
      })).toThrow(/environments\.ubuntu.*distro/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects inline WSL instances without a distro in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
      })).toThrow(/cursor\.instances\.default.*distro/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows explicit WSL runtime to inherit distro from the referenced environment', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
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

  it('parses Docker environments with container in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  docker-dev:
    kind: docker
    container: cats-cli-dev
providers:
  claude:
    instances:
      docker:
        environment: docker-dev
        command: claude
        runner: auto
        projects_dir: ~/.claude/projects
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(resolveProviderInstance(config, 'claude', 'docker')).toMatchObject({
        id: 'docker',
        commandConfig: {
          path: 'claude',
          runtime: {
            mode: 'docker',
            container: 'cats-cli-dev',
            environmentId: 'docker-dev',
          },
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects Docker environments without a container in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  docker-dev:
    kind: docker
providers:
  claude:
    instances:
      docker:
        environment: docker-dev
        command: claude
        runner: auto
`.trimStart());

    try {
      expect(() => loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      })).toThrow(/environments\.docker-dev.*container/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects inline Docker instances without a container in providers.yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
providers:
  claude:
    instances:
      docker:
        runtime: docker
        command: claude
        runner: auto
`.trimStart());

    try {
      expect(() => loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      })).toThrow(/claude\.instances\.docker.*container/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('only enables providers listed in providers.yaml (positive list)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
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
      expect(listProviderInstances(config, 'pi')).toHaveLength(0);

      // Resolving an unlisted provider throws ProviderNotConfiguredError
      expect(() => resolveProviderInstance(config, 'gemini'))
        .toThrow(/Provider 'gemini' is not configured/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads separated backend config without mixing CLI and API instances', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
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

      expect(config.remoteProviderCatalog).toMatchObject({
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
            },
          },
        },
        agent: {},
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('inherits remote provider defaults while allowing per-instance overrides', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        default_instance: sonnet
        transport: anthropic
        api_key_env: ANTHROPIC_API_KEY
        system_prompt: You are the default Claude worker.
        headers:
          x-provider-family: claude
          x-shared: base
        max_output_tokens: 8192
        timeout_ms: 30000
        max_retries: 2
        max_tool_steps: 24
        tool_profile: standard
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
          opus:
            model: claude-opus-4-20250514
            headers:
              x-shared: opus
              x-instance: opus
            max_output_tokens: 16384
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
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
        command: undefined,
        args: undefined,
        cwd: undefined,
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are the default Claude worker.',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: {
          'x-provider-family': 'claude',
          'x-shared': 'base',
        },
        maxOutputTokens: 8192,
        timeoutMs: 30000,
        maxRetries: 2,
        maxToolSteps: 24,
        toolProfile: 'standard',
        startupTimeoutMs: undefined,
      });

      expect(config.remoteProviderCatalog?.api.claude.opus).toEqual({
        id: 'opus',
        providerName: 'claude',
        backend: 'api',
        transport: 'anthropic',
        command: undefined,
        args: undefined,
        cwd: undefined,
        model: 'claude-opus-4-20250514',
        systemPrompt: 'You are the default Claude worker.',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: {
          'x-provider-family': 'claude',
          'x-shared': 'opus',
          'x-instance': 'opus',
        },
        maxOutputTokens: 16384,
        timeoutMs: 30000,
        maxRetries: 2,
        maxToolSteps: 24,
        toolProfile: 'standard',
        startupTimeoutMs: undefined,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads agent-backed provider defaults and per-instance overrides', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    openclaw:
      default_target:
        backend: agent
        instance: gateway
backends:
  agent:
    providers:
      openclaw:
        default_instance: gateway
        transport: openclaw_gateway
        url: ws://gateway.example/ws
        auth_token_env: OPENCLAW_TOKEN
        client_id: cats-runtime
        client_mode: interactive
        role: operator
        scopes:
          - operator.admin
        payload_template:
          mode: agent
        wait_timeout_ms: 45000
        timeout_ms: 15000
        max_retries: 2
        instances:
          gateway:
            model: openclaw-coder
          preview:
            model: openclaw-preview
            client_mode: preview
            scopes:
              - operator.read
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.providerDefaultTargets?.openclaw).toEqual({
        backend: 'agent',
        instance: 'gateway',
      });

      expect(config.remoteProviderCatalog?.agent.openclaw.gateway).toEqual({
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
        command: undefined,
        args: undefined,
        cwd: undefined,
        url: 'ws://gateway.example/ws',
        urlEnv: undefined,
        model: 'openclaw-coder',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: 'OPENCLAW_TOKEN',
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        clientId: 'cats-runtime',
        clientMode: 'interactive',
        clientVersion: undefined,
        role: 'operator',
        scopes: ['operator.admin'],
        payloadTemplate: {
          mode: 'agent',
        },
        waitTimeoutMs: 45000,
        maxOutputTokens: undefined,
        timeoutMs: 15000,
        maxRetries: 2,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: undefined,
      });

      expect(config.remoteProviderCatalog?.agent.openclaw.preview).toEqual({
        id: 'preview',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
        command: undefined,
        args: undefined,
        cwd: undefined,
        url: 'ws://gateway.example/ws',
        urlEnv: undefined,
        model: 'openclaw-preview',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: 'OPENCLAW_TOKEN',
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        clientId: 'cats-runtime',
        clientMode: 'preview',
        clientVersion: undefined,
        role: 'operator',
        scopes: ['operator.read'],
        payloadTemplate: {
          mode: 'agent',
        },
        waitTimeoutMs: 45000,
        maxOutputTokens: undefined,
        timeoutMs: 15000,
        maxRetries: 2,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: undefined,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads agent-backed provider client identity from a nested client block', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    openclaw:
      default_target:
        backend: agent
        instance: gateway
backends:
  agent:
    providers:
      openclaw:
        default_instance: gateway
        transport: openclaw_gateway
        url: ws://gateway.example/ws
        auth_token_env: OPENCLAW_TOKEN
        client:
          id: cats-runtime
          mode: interactive
          version: 0.2.0
        role: operator
        scopes:
          - operator.admin
        instances:
          gateway:
            model: openclaw-coder
          preview:
            model: openclaw-preview
            client:
              mode: preview
              version: 0.2.1
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.remoteProviderCatalog?.agent.openclaw.gateway).toEqual({
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
        command: undefined,
        args: undefined,
        cwd: undefined,
        url: 'ws://gateway.example/ws',
        urlEnv: undefined,
        model: 'openclaw-coder',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: 'OPENCLAW_TOKEN',
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        clientId: 'cats-runtime',
        clientMode: 'interactive',
        clientVersion: '0.2.0',
        role: 'operator',
        scopes: ['operator.admin'],
        payloadTemplate: undefined,
        waitTimeoutMs: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        maxRetries: undefined,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: undefined,
      });

      expect(config.remoteProviderCatalog?.agent.openclaw.preview).toEqual({
        id: 'preview',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
        command: undefined,
        args: undefined,
        cwd: undefined,
        url: 'ws://gateway.example/ws',
        urlEnv: undefined,
        model: 'openclaw-preview',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: 'OPENCLAW_TOKEN',
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        clientId: 'cats-runtime',
        clientMode: 'preview',
        clientVersion: '0.2.1',
        role: 'operator',
        scopes: ['operator.admin'],
        payloadTemplate: undefined,
        waitTimeoutMs: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        maxRetries: undefined,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: undefined,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads ACP-backed agent provider launch settings under the existing remote backend shape', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    codex:
      default_target:
        backend: agent
        instance: acp-local
backends:
  agent:
    providers:
      codex:
        default_instance: acp-local
        transport: acp_stdio
        command: codex-acp
        args:
          - serve
        startup_timeout_ms: 15000
        instances:
          acp-local:
            cwd: /tmp/codex-acp
            model: gpt-5.4
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.providerDefaultTargets?.codex).toEqual({
        backend: 'agent',
        instance: 'acp-local',
      });

      expect(config.remoteProviderCatalog?.agent.codex['acp-local']).toEqual({
        id: 'acp-local',
        providerName: 'codex',
        backend: 'agent',
        transport: 'acp_stdio',
        command: 'codex-acp',
        args: ['serve'],
        cwd: '/tmp/codex-acp',
        url: undefined,
        urlEnv: undefined,
        model: 'gpt-5.4',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: undefined,
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        clientId: undefined,
        clientMode: undefined,
        clientVersion: undefined,
        role: undefined,
        scopes: undefined,
        payloadTemplate: undefined,
        waitTimeoutMs: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        maxRetries: undefined,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: 15000,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads ACP-backed agent provider launch settings from a nested launch block', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    codex:
      default_target:
        backend: agent
        instance: acp-local
backends:
  agent:
    providers:
      codex:
        default_instance: acp-local
        transport: acp_stdio
        launch:
          command: codex-acp
          args:
            - serve
          startup_timeout_ms: 15000
        instances:
          acp-local:
            launch:
              cwd: /tmp/codex-acp
            model: gpt-5.4
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.providerDefaultTargets?.codex).toEqual({
        backend: 'agent',
        instance: 'acp-local',
      });

      expect(config.remoteProviderCatalog?.agent.codex['acp-local']).toEqual({
        id: 'acp-local',
        providerName: 'codex',
        backend: 'agent',
        transport: 'acp_stdio',
        command: 'codex-acp',
        args: ['serve'],
        cwd: '/tmp/codex-acp',
        url: undefined,
        urlEnv: undefined,
        model: 'gpt-5.4',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: undefined,
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: undefined,
        clientId: undefined,
        clientMode: undefined,
        clientVersion: undefined,
        role: undefined,
        scopes: undefined,
        payloadTemplate: undefined,
        waitTimeoutMs: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        maxRetries: undefined,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: 15000,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads ACP-backed agent connect settings from a nested connect block', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
routing:
  providers:
    codex:
      default_target:
        backend: agent
        instance: acp-remote
backends:
  agent:
    providers:
      codex:
        default_instance: acp-remote
        transport: acp
        connect:
          url: https://acp.example.test/rpc
          auth_token_env: CODEX_ACP_TOKEN
        instances:
          acp-remote:
            connect:
              headers:
                x-client-id: cats-runtime
            model: gpt-5.4
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.providerDefaultTargets?.codex).toEqual({
        backend: 'agent',
        instance: 'acp-remote',
      });

      expect(config.remoteProviderCatalog?.agent.codex['acp-remote']).toEqual({
        id: 'acp-remote',
        providerName: 'codex',
        backend: 'agent',
        transport: 'acp',
        command: undefined,
        args: undefined,
        cwd: undefined,
        url: 'https://acp.example.test/rpc',
        urlEnv: undefined,
        model: 'gpt-5.4',
        systemPrompt: undefined,
        apiKeyEnv: undefined,
        authTokenEnv: 'CODEX_ACP_TOKEN',
        passwordEnv: undefined,
        baseUrl: undefined,
        baseUrlEnv: undefined,
        organizationEnv: undefined,
        projectEnv: undefined,
        headers: {
          'x-client-id': 'cats-runtime',
        },
        clientId: undefined,
        clientMode: undefined,
        clientVersion: undefined,
        role: undefined,
        scopes: undefined,
        payloadTemplate: undefined,
        waitTimeoutMs: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        maxRetries: undefined,
        maxToolSteps: undefined,
        toolProfile: undefined,
        startupTimeoutMs: undefined,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects providers that are configured in multiple backends without routing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
      })).toThrow(/configured in multiple backends/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts API default targets for providers that can now run outside CLI', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
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
        command: undefined,
        args: undefined,
        cwd: undefined,
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
        startupTimeoutMs: undefined,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads Pi provider instances from providers.yaml with sessions_dir', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
providers:
  pi:
    instances:
      native:
        environment: native
        command: pi
        runner: auto
        sessions_dir: /custom/pi/sessions
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(listProviderInstances(config, 'pi')).toHaveLength(1);
      expect(config.piSessionsDir).toBe('/custom/pi/sessions');
      expect(resolveProviderInstance(config, 'pi')).toMatchObject({
        id: 'native',
        providerName: 'pi',
        piSessionsDir: '/custom/pi/sessions',
        commandConfig: {
          path: 'pi',
          runner: 'auto',
          runtime: {
            mode: 'native',
            distro: undefined,
            environmentId: 'native',
          },
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads Pi provider from separated backends config', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    pi:
      default_target:
        backend: cli
        instance: native
backends:
  cli:
    providers:
      pi:
        instances:
          native:
            environment: native
            command: pi
            runner: auto
            sessions_dir: ~/.pi/agent/sessions
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(config.providerDefaultTargets?.pi).toEqual({
        backend: 'cli',
        instance: 'native',
      });
      expect(listProviderInstances(config, 'pi')).toHaveLength(1);
      expect(config.piSessionsDir).toBe('~/.pi/agent/sessions');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads CLI provider instance timeout overrides from separated backends config', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    gemini:
      default_target:
        backend: cli
        instance: native
backends:
  cli:
    providers:
      gemini:
        instances:
          native:
            environment: native
            command: gemini
            runner: auto
            timeout_ms: 60000
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(resolveProviderInstance(config, 'gemini', 'native')).toMatchObject({
        id: 'native',
        timeoutMs: 60000,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads CLI provider instance timeout overrides for copilot too', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    copilot:
      default_target:
        backend: cli
        instance: native
backends:
  cli:
    providers:
      copilot:
        instances:
          native:
            environment: native
            command: copilot
            runner: auto
            timeout_ms: 45000
`.trimStart());

    try {
      const config = loadConfig({
        HOME: '/home/tester',
        USERPROFILE: '',
        CATS_RUNTIME_DIR: runtimeDir,
      });

      expect(resolveProviderInstance(config, 'copilot', 'native')).toMatchObject({
        id: 'native',
        timeoutMs: 45000,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects mixing legacy providers with separated backends blocks', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-config-test-'));
    const runtimeDir = tempDir;
    const configPath = createRuntimeRootTestPaths(runtimeDir).configPath;
    mkdirSync(createRuntimeRootTestPaths(runtimeDir).configDir, { recursive: true });
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
        CATS_RUNTIME_DIR: runtimeDir,
      })).toThrow(/Cannot mix top-level providers with backends\.\*/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
