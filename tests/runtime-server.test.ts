import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/core/config.js';
import { createDiscoveryController, createRuntimeServer } from '../src/server.js';
import {
  RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
  RUNTIME_DIAGNOSTICS_PATHS,
  RUNTIME_SHUTDOWN_REASONS,
  RUNTIME_SHUTDOWN_SIGNALS,
  RUNTIME_STARTUP_CONTRACT_VERSION,
  RUNTIME_VERSION,
  createRuntimeStartupState,
} from '../src/startup.js';

function alignDefaultProviderRuntime(
  config: ReturnType<typeof loadConfig>,
  provider: 'cursor' | 'kiro',
  runtime: { mode: 'native' | 'wsl'; distro?: string },
): void {
  const defaultInstanceId = config.providerDefaultInstances?.[provider] || 'default';
  const instance = config.providerInstances?.[provider]?.[defaultInstanceId];
  if (!instance) {
    return;
  }

  const nextRuntime = {
    ...instance.commandConfig.runtime,
    ...runtime,
  };
  instance.commandConfig = {
    ...instance.commandConfig,
    runtime: nextRuntime,
  };
  config.providerCommands[provider] = {
    ...config.providerCommands[provider],
    runtime: nextRuntime,
  };
}

function nativeExecutionPlatform(): 'windows' | 'macos' | 'linux' {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  return 'linux';
}

function createTestConfig(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-test-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: join(root, 'providers.missing.yaml'),
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    GEMINI_SESSIONS_DIR: join(root, '.gemini', 'tmp'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  };

  for (const dir of [
    env.CATS_RUNTIME_SESSION_BASE_DIR,
    env.CATS_RUNTIME_DATA_DIR,
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.GEMINI_SESSIONS_DIR,
    env.PI_SESSIONS_DIR,
    join(root, '.junie', 'sessions'),
    join(root, 'data'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    ...loadConfig(env),
    host: '127.0.0.1',
    port: 0,
    ...overrides,
  };

  const overrideRecord = overrides as Record<string, unknown>;
  const overriddenProviderInstances = (
    overrideRecord.providerInstances
    && typeof overrideRecord.providerInstances === 'object'
    && !Array.isArray(overrideRecord.providerInstances)
  ) ? overrideRecord.providerInstances as Record<string, unknown> : undefined;

  if (overrideRecord.cursorRuntime && !overriddenProviderInstances?.cursor) {
    alignDefaultProviderRuntime(
      config,
      'cursor',
      overrideRecord.cursorRuntime as { mode: 'native' | 'wsl'; distro?: string },
    );
  }

  if (overrideRecord.kiroRuntime && !overriddenProviderInstances?.kiro) {
    alignDefaultProviderRuntime(
      config,
      'kiro',
      overrideRecord.kiroRuntime as { mode: 'native' | 'wsl'; distro?: string },
    );
  }

  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function withRuntime(
  overrides: Record<string, unknown>,
  options: Parameters<typeof createRuntimeServer>[1],
  run: (runtime: ReturnType<typeof createRuntimeServer>) => Promise<void>,
) {
  const { config, cleanup } = createTestConfig(overrides);
  const runtime = createRuntimeServer(config, options);
  try {
    await run(runtime);
  } finally {
    await runtime.close();
    cleanup();
  }
}

describe('runtime server', () => {
  it('GET / serves the embedded dashboard', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Cats Runtime Dashboard');
      expect(html.indexOf('<option value="claude">claude</option>'))
        .toBeLessThan(html.indexOf('<option value="codex">codex</option>'));
      expect(html.indexOf('<option value="codex">codex</option>'))
        .toBeLessThan(html.indexOf('<option value="gemini">gemini</option>'));
      expect(html.indexOf('<option value="kiro">kiro</option>'))
        .toBeLessThan(html.indexOf('<option value="auggie">auggie</option>'));

      const openCreateModalMatch = html.match(
        /async function openCreateModal\(\) \{([\s\S]*?)\n\}/,
      );
      expect(openCreateModalMatch?.[1]).toBeTruthy();
      const openCreateModalBody = openCreateModalMatch![1];
      expect(openCreateModalBody.indexOf("classList.add('open')"))
        .toBeLessThan(openCreateModalBody.indexOf('await refreshProviderCatalog()'));
      expect(html).toContain('id="createSessionBtn"');
      expect(html).not.toContain("{ id: 'default', runtime: { mode: 'native' } }");
      expect(html).toContain(RUNTIME_DIAGNOSTICS_PATHS.health);
      expect(html).toContain('refreshRuntimeHealthStatus');
    });
  });

  it('GET /playground serves the embedded playground without auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, {}, async (runtime) => {
      const response = await runtime.app.request('/playground');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Playground');
      expect(html).toContain('Direct (same-origin API)');
      expect(html).toContain('class RuntimeClient');
      expect(html).toContain('/providers/config');
    });
  });

  it('GET /health enforces optional inbound auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, {}, async (runtime) => {
      const unauthenticated = await runtime.app.request('/health');
      expect(unauthenticated.status).toBe(401);

      const authenticated = await runtime.app.request(
        '/health',
        {
          headers: { authorization: 'Bearer runtime-secret' },
        },
      );

      expect(authenticated.status).toBe(200);
      expect(await authenticated.json()).toEqual({
        service: 'cats-runtime',
        status: 'degraded',
        summary: 'Runtime is starting and is not ready yet.',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        startup: {
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
          mode: 'standalone',
          managedBy: undefined,
          phase: 'starting',
          readySignal: 'http',
          ready: false,
          pid: expect.any(Number),
          startedAt: expect.any(String),
          address: undefined,
          shutdownReason: undefined,
          lastEvent: undefined,
        },
        shutdown: {
          signals: [...RUNTIME_SHUTDOWN_SIGNALS],
          reasons: [...RUNTIME_SHUTDOWN_REASONS],
          stdinCloseEnabled: false,
        },
      });
    });
  });

  it('GET /health exposes app-managed startup metadata after listen', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });

    try {
      const address = await runtime.start();
      const response = await fetch(`http://${address.host}:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        status: 'ok',
        summary: 'Runtime is ready to accept requests.',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'ready',
          ready: true,
        },
        startup: {
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
          mode: 'app-managed',
          managedBy: 'cats-inc',
          phase: 'ready',
          readySignal: 'http',
          ready: true,
          pid: expect.any(Number),
          startedAt: expect.any(String),
          address: {
            host: address.host,
            port: address.port,
            healthUrl: `http://${address.host}:${address.port}/health`,
          },
          shutdownReason: undefined,
          lastEvent: undefined,
        },
        shutdown: {
          signals: [...RUNTIME_SHUTDOWN_SIGNALS],
          reasons: [...RUNTIME_SHUTDOWN_REASONS],
          stdinCloseEnabled: true,
        },
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('close waits for an in-flight start to settle before tearing resources down', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });
    const poolKillSpy = vi.spyOn(runtime.context.pool, 'killAll');
    let pendingClose: Promise<void> | undefined;

    runtime.server.once('listening', () => {
      pendingClose = runtime.close();
      expect(poolKillSpy).not.toHaveBeenCalled();
    });

    try {
      await expect(runtime.start()).rejects.toThrow('cats-runtime closed during startup');
      expect(pendingClose).toBeDefined();
      if (!pendingClose) {
        throw new Error('close() was not triggered during startup');
      }

      await pendingClose;
      expect(poolKillSpy).toHaveBeenCalledTimes(1);
      expect(runtime.context.startup.ready).toBe(false);
      expect(runtime.context.startup.phase).toBe('stopped');
    } finally {
      poolKillSpy.mockRestore();
      await runtime.close();
      cleanup();
    }
  });

  it('GET /diagnostics/runtime exposes the frozen startup contract', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/diagnostics/runtime');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        status: 'degraded',
        summary: 'Runtime is starting and is not ready yet.',
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        runtime: {
          startup: expect.objectContaining({
            contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
            mode: 'standalone',
            phase: 'starting',
            readySignal: 'http',
            ready: false,
            pid: expect.any(Number),
            startedAt: expect.any(String),
          }),
          shutdown: {
            signals: [...RUNTIME_SHUTDOWN_SIGNALS],
            reasons: [...RUNTIME_SHUTDOWN_REASONS],
            stdinCloseEnabled: false,
          },
          listener: {
            host: '127.0.0.1',
            port: 0,
          },
          paths: {
            configPath: null,
            dataDir: expect.stringContaining('runtime-data'),
            sessionBaseDir: expect.stringContaining('runtime-sessions'),
            compatibilityEvidenceDir: expect.stringContaining('runtime-data'),
          },
          process: {
            pid: process.pid,
            ppid: process.ppid,
            platform: process.platform,
            nodeVersion: process.version,
          },
        },
        metering: {
          summary: {
            status: 'ok',
            summary: 'No active metering incidents or guardrails.',
            usageRecords: 0,
            incidents: 0,
            activeGuardrails: 0,
            activeCooldowns: 0,
            activeBlocks: 0,
          },
          usage: {
            totals: {
              observationCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              confidenceCounts: {
                reported: 0,
                aggregated: 0,
                estimated: 0,
                unknown: 0,
              },
            },
            byProviderInstance: [],
            bySession: [],
          },
          incidents: {
            recent: [],
            active: [],
          },
          guardrails: {
            configured: [
              {
                scope: 'provider_instance',
                metric: 'rate_limit_incidents',
                threshold: 1,
                action: 'cooldown',
                cooldownMs: 60000,
              },
            ],
            active: [],
          },
        },
      });
    });
  });

  it('GET /diagnostics/providers reports provider availability for hosts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-diagnostics-test-'));
    const configPath = join(root, 'providers.yaml');
    vi.stubEnv('CATS_RUNTIME_TEST_ANTHROPIC_KEY', 'test-secret');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      claude:
        transport: anthropic
        api_key_env: CATS_RUNTIME_TEST_ANTHROPIC_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
`.trimStart());

    const env = {
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    };

    for (const dir of [
      env.CATS_RUNTIME_DATA_DIR,
      env.CATS_RUNTIME_SESSION_BASE_DIR,
      env.CODEX_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const response = await runtime.app.request('/diagnostics/providers');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        probe: 'light',
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        summary: {
          status: 'degraded',
          summary: '2 provider target(s) need attention.',
          configuredProviders: 2,
          targets: 2,
          defaultTargets: 2,
          ok: 0,
          degraded: 2,
          unavailable: 0,
        },
        providers: expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude',
            backend: 'api',
            instance: 'sonnet',
            target: 'api/sonnet',
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'light',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'api_key_present',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'live_probe_unimplemented',
                status: 'degraded',
              }),
            ]),
          }),
          expect.objectContaining({
            provider: 'codex',
            backend: 'cli',
            instance: 'default',
            target: 'cli/default',
            defaultTarget: true,
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'light',
            }),
            setup: expect.objectContaining({
              prerequisites: expect.arrayContaining([
                expect.objectContaining({
                  id: 'node',
                }),
                expect.objectContaining({
                  id: 'npm',
                }),
              ]),
              command: expect.objectContaining({
                status: 'ready',
              }),
              install: expect.objectContaining({
                provider: 'codex',
                installPack: 'npm-global',
              }),
              npm: expect.objectContaining({
                packageName: '@openai/codex',
              }),
            }),
            compatibility: expect.objectContaining({
              classification: 'degraded',
              profile: expect.objectContaining({
                id: 'codex-cli-json-rpc-best-fit',
              }),
              evidence: expect.objectContaining({
                relativePath: expect.stringContaining('codex/'),
              }),
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'command_available',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'profile_selected',
                status: 'degraded',
              }),
            ]),
          }),
        ]),
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('GET /diagnostics/health summarizes runtime and default provider readiness for hosts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-health-summary-test-'));
    const configPath = join(root, 'providers.yaml');
    vi.stubEnv('CATS_RUNTIME_TEST_ANTHROPIC_KEY', 'test-secret');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      claude:
        transport: anthropic
        api_key_env: CATS_RUNTIME_TEST_ANTHROPIC_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
`.trimStart());

    const env = {
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    };

    for (const dir of [
      env.CATS_RUNTIME_DATA_DIR,
      env.CATS_RUNTIME_SESSION_BASE_DIR,
      env.CODEX_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const response = await runtime.app.request('/diagnostics/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        status: 'degraded',
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        runtime: {
          status: 'degraded',
          summary: 'Runtime is starting and is not ready yet.',
          startup: expect.objectContaining({
            contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
            mode: 'standalone',
            phase: 'starting',
            readySignal: 'http',
            ready: false,
          }),
          shutdown: {
            signals: [...RUNTIME_SHUTDOWN_SIGNALS],
            reasons: [...RUNTIME_SHUTDOWN_REASONS],
            stdinCloseEnabled: false,
          },
        },
        providers: {
          probe: 'light',
          summary: {
            status: 'degraded',
            summary: '2 provider target(s) need attention.',
            configuredProviders: 2,
            targets: 2,
            defaultTargets: 2,
            ok: 0,
            degraded: 2,
            unavailable: 0,
          },
          defaults: expect.arrayContaining([
            expect.objectContaining({
              provider: 'claude',
              target: 'api/sonnet',
              status: 'degraded',
            }),
            expect.objectContaining({
              provider: 'codex',
              target: 'cli/default',
              status: 'degraded',
            }),
          ]),
        },
        metering: {
          status: 'ok',
          summary: 'No active metering incidents or guardrails.',
          usageRecords: 0,
          incidents: 0,
          activeGuardrails: 0,
          activeCooldowns: 0,
          activeBlocks: 0,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('GET /diagnostics/health ignores non-default provider targets in the aggregate summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-health-defaults-only-test-'));
    const configPath = join(root, 'providers.yaml');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      codex:
        transport: openai
        api_key_env: OPENAI_API_KEY
        instances:
          main:
            model: gpt-5.2-codex
`.trimStart());

    const env = {
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    };

    for (const dir of [
      env.CATS_RUNTIME_DATA_DIR,
      env.CATS_RUNTIME_SESSION_BASE_DIR,
      env.CODEX_SESSIONS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const response = await runtime.app.request('/diagnostics/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.objectContaining({
        status: 'degraded',
        providers: {
          probe: 'light',
          summary: {
            status: 'degraded',
            summary: '1 provider target(s) need attention.',
            configuredProviders: 1,
            targets: 1,
            defaultTargets: 1,
            ok: 0,
            degraded: 1,
            unavailable: 0,
          },
          defaults: [
            expect.objectContaining({
              provider: 'codex',
              target: 'cli/default',
              status: 'degraded',
            }),
          ],
        },
      }));
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('GET /diagnostics/health stays degraded when only some provider targets are unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-health-partial-provider-outage-test-'));
    const configPath = join(root, 'providers.yaml');
    vi.stubEnv('CATS_RUNTIME_TEST_ANTHROPIC_KEY', 'test-secret');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: missing
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  cli:
    providers:
      codex:
        instances:
          missing:
            environment: native
            command: command-that-does-not-exist-for-cats-runtime-tests
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      claude:
        transport: anthropic
        api_key_env: CATS_RUNTIME_TEST_ANTHROPIC_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
`.trimStart());

    const env = {
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    };

    for (const dir of [
      env.CATS_RUNTIME_DATA_DIR,
      env.CATS_RUNTIME_SESSION_BASE_DIR,
      env.CODEX_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer({
      ...loadConfig(env),
      port: 0,
    });
    try {
      const address = await runtime.start();
      const response = await fetch(`http://${address.host}:${address.port}/diagnostics/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        status: 'degraded',
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'ready',
          ready: true,
        },
        runtime: {
          status: 'ok',
          summary: 'Runtime is ready to accept requests.',
          startup: expect.objectContaining({
            contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
            mode: 'standalone',
            phase: 'ready',
            readySignal: 'http',
            ready: true,
            address: {
              host: address.host,
              port: address.port,
              healthUrl: `http://${address.host}:${address.port}/health`,
            },
          }),
          shutdown: {
            signals: [...RUNTIME_SHUTDOWN_SIGNALS],
            reasons: [...RUNTIME_SHUTDOWN_REASONS],
            stdinCloseEnabled: false,
          },
        },
        providers: {
          probe: 'light',
          summary: {
            status: 'degraded',
            summary: '2 provider target(s) need attention.',
            configuredProviders: 2,
            targets: 2,
            defaultTargets: 2,
            ok: 0,
            degraded: 1,
            unavailable: 1,
          },
          defaults: expect.arrayContaining([
            expect.objectContaining({
              provider: 'claude',
              target: 'api/sonnet',
              status: 'degraded',
              summary: expect.stringContaining('light diagnostics'),
            }),
            expect.objectContaining({
              provider: 'codex',
              target: 'cli/missing',
              status: 'unavailable',
              summary: expect.stringContaining('Failed to execute compatibility probe'),
            }),
          ]),
        },
        metering: {
          status: 'ok',
          summary: 'No active metering incidents or guardrails.',
          usageRecords: 0,
          incidents: 0,
          activeGuardrails: 0,
          activeCooldowns: 0,
          activeBlocks: 0,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('runtime.start rejects when the configured port is already occupied', async () => {
    const occupiedServer = createServer();
    occupiedServer.listen(0, '127.0.0.1');
    await once(occupiedServer, 'listening');
    const address = occupiedServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve occupied test port');
    }
    const port = address.port;

    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer({
      ...config,
      host: '127.0.0.1',
      port,
    }, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });

    try {
      await expect(runtime.start()).rejects.toThrow(/EADDRINUSE/);
      expect(runtime.context.startup.ready).toBe(false);
      expect(runtime.context.startup.phase).toBe('starting');
    } finally {
      await runtime.close();
      await new Promise<void>((resolveClose, rejectClose) => {
        occupiedServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
      cleanup();
    }
  });

  it('GET /sessions returns the embedded registry state', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [],
        count: 0,
      });
    });
  });

  it('POST /sessions rejects unknown providers before spawning', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'unknown-cli', cwd: 'C:/repo' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'unknown-cli'/);
    });
  });

  it('GET /kiro/models returns the local catalog without an upstream proxy', async () => {
    await withRuntime({ kiroRuntime: { mode: 'wsl' } }, {}, async (runtime) => {
      const response = await runtime.app.request('/kiro/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        instance: 'default',
        runtime: { mode: 'wsl' },
        source: 'static',
        models: ['claude-sonnet-4.5', 'deepseek-3.2', 'minimax-m2.1'],
      });
    });
  });

  it('GET /providers/config returns configured provider instances for the dashboard', async () => {
    await withRuntime({
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        auggie: {},
        claude: {},
        codex: {},
        copilot: {},
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
          debian: {
            id: 'debian',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
            },
            cursorChatsDir: '/wsl/debian/.cursor/chats',
          },
        },
        gemini: {},
        kiro: {},
        opencode: {},
        pi: {},
        goose: {},
        junie: {},
      },
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        providers: {
          cursor: {
            defaultInstance: 'ubuntu',
            defaultBackend: 'cli',
            instances: [
              {
                id: 'ubuntu',
                target: 'cli/ubuntu',
                backend: 'cli',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
                install: expect.objectContaining({
                  provider: 'cursor',
                  executionPlatform: 'linux',
                  prerequisites: expect.arrayContaining([
                    expect.objectContaining({
                      id: 'bash',
                    }),
                    expect.objectContaining({
                      id: 'curl',
                    }),
                  ]),
                  path: expect.objectContaining({
                    persistenceEntry: '.local/bin',
                  }),
                  install: expect.objectContaining({
                    installerId: 'cursor-agent',
                  }),
                }),
                compatibility: null,
              },
              {
                id: 'debian',
                target: 'cli/debian',
                backend: 'cli',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
                install: expect.objectContaining({
                  provider: 'cursor',
                  executionPlatform: 'linux',
                  prerequisites: expect.arrayContaining([
                    expect.objectContaining({
                      id: 'bash',
                    }),
                    expect.objectContaining({
                      id: 'curl',
                    }),
                  ]),
                  path: expect.objectContaining({
                    persistenceEntry: '.local/bin',
                  }),
                  install: expect.objectContaining({
                    installerId: 'cursor-agent',
                  }),
                }),
                compatibility: null,
              },
            ],
          },
        },
      });
    });
  });

  it('surfaces runtime-owned Goose active config in provider metadata and model catalogs', async () => {
    const { root, config, cleanup } = createTestConfig({
      providerDefaultInstances: {
        goose: 'default',
      },
      providerInstances: {
        auggie: {},
        claude: {},
        codex: {},
        copilot: {},
        cursor: {},
        gemini: {},
        goose: {
          default: {
            id: 'default',
            providerName: 'goose',
            commandConfig: {
              path: process.execPath,
              runner: 'direct',
              runtime: { mode: 'native', environmentId: 'native' },
            },
          },
        },
        junie: {},
        kiro: {},
        opencode: {},
        pi: {},
      },
    });
    const gooseConfigPath = join(root, '.config', 'goose', 'config.yaml');
    mkdirSync(join(root, '.config', 'goose'), { recursive: true });
    writeFileSync(gooseConfigPath, [
      'GOOSE_PROVIDER: anthropic',
      'GOOSE_MODEL: claude-sonnet-4-5',
      '',
    ].join('\n'));
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);

    const runtime = createRuntimeServer(config);
    try {
      const providerResponse = await runtime.app.request('/providers/config');
      expect(providerResponse.status).toBe(200);
      const providerPayload = await providerResponse.json() as {
        providers: Record<string, {
          defaultInstance: string;
          defaultBackend: string;
          instances: Array<Record<string, unknown>>;
        }>;
      };
      expect(providerPayload.providers.goose).toEqual({
        defaultInstance: 'default',
        defaultBackend: 'cli',
        instances: [{
          id: 'default',
          target: 'cli/default',
          backend: 'cli',
          command: process.execPath,
          runner: 'direct',
          runtime: { mode: 'native', environmentId: 'native' },
          activeConfig: {
            source: 'goose_config',
            state: 'detected',
            configuredPath: '~/.config/goose/config.yaml',
            resolvedPath: gooseConfigPath,
            provider: 'anthropic',
            model: 'anthropic/claude-sonnet-4-5',
          },
          install: expect.objectContaining({
            provider: 'goose',
          }),
          compatibility: null,
        }],
      });

      const catalogResponse = await runtime.app.request('/providers/goose/models');
      expect(catalogResponse.status).toBe(200);
      expect(await catalogResponse.json()).toEqual({
        provider: 'goose',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'anthropic/claude-sonnet-4-5',
        source: 'static',
        cache: null,
        models: [
          {
            id: 'anthropic/claude-sonnet-4-5',
            label: 'anthropic/claude-sonnet-4-5',
            default: true,
            status: 'configured',
          },
          {
            id: 'openai/gpt-5-codex',
            label: 'openai/gpt-5-codex',
          },
          {
            id: 'openai/gpt-5',
            label: 'openai/gpt-5',
          },
        ],
        warnings: [],
      });

      const diagnosticsResponse = await runtime.app.request('/diagnostics/providers');
      expect(diagnosticsResponse.status).toBe(200);
      const diagnostics = await diagnosticsResponse.json() as {
        providers: Array<{ provider: string; config: Record<string, unknown> }>;
      };
      expect(diagnostics.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          provider: 'goose',
          config: expect.objectContaining({
            activeConfig: {
              source: 'goose_config',
              state: 'detected',
              configuredPath: '~/.config/goose/config.yaml',
              resolvedPath: gooseConfigPath,
              provider: 'anthropic',
              model: 'anthropic/claude-sonnet-4-5',
            },
          }),
        }),
      ]));
    } finally {
      vi.unstubAllEnvs();
      await runtime.close();
      cleanup();
    }
  });

  it('POST /sessions rejects providers omitted by positive-list YAML config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-positive-list-test-'));
    const configPath = join(root, 'providers.yaml');
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
`.trimStart());

    const env = {
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    };

    for (const dir of [
      env.CATS_RUNTIME_DATA_DIR,
      env.CATS_RUNTIME_SESSION_BASE_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const catalogResponse = await runtime.app.request('/providers/config');
      expect(catalogResponse.status).toBe(200);
      expect(await catalogResponse.json()).toEqual({
        providers: {
          claude: {
            defaultInstance: 'default',
            defaultBackend: 'cli',
            instances: [
              {
                id: 'default',
                target: 'cli/default',
                backend: 'cli',
                command: 'claude',
                runner: 'auto',
                runtime: { mode: 'native', environmentId: 'native' },
                install: expect.objectContaining({
                  provider: 'claude',
                  executionPlatform: nativeExecutionPlatform(),
                  install: expect.objectContaining({
                    installerId: 'claude-code',
                  }),
                }),
                compatibility: null,
              },
            ],
          },
        },
      });

      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'codex' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'codex'\. Valid: claude/);
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('GET /sessions treats instance=default as the provider default alias in YAML mode', async () => {
    await withRuntime({
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
          native: {
            id: 'native',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'native', environmentId: 'native' },
            },
            cursorChatsDir: 'C:/Users/test/.cursor/chats',
          },
        },
      },
    }, {}, async (runtime) => {
      runtime.context.registry.create({
        providerName: 'cursor',
        providerInstanceId: 'ubuntu',
        cwd: 'C:/repo',
      });
      runtime.context.registry.create({
        providerName: 'cursor',
        providerInstanceId: 'native',
        cwd: 'C:/repo-native',
      });

      const response = await runtime.app.request('/sessions?provider=cursor&instance=default');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [
          expect.objectContaining({
            providerName: 'cursor',
            providerInstanceId: 'ubuntu',
            cwd: 'C:/repo',
          }),
        ],
        count: 1,
      });
    });
  });

  it('GET /discovery/status reports WSL discovery policy state for dashboard polling', async () => {
    await withRuntime({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      wslDiscoveryPolicy: 'manual_only',
      nativeDiscoveryIntervalMs: 5000,
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/discovery/status');
      expect(response.status).toBe(200);

      const payload = await response.json() as {
        wsl: {
          policy: string;
          summary: { state: string; message: string };
          providers: Record<string, {
            state: string;
            runtimeMode: string;
            distro?: string;
            message: string;
          }>;
        };
      };

      expect(payload.wsl.policy).toBe('manual_only');
      expect(payload.wsl.summary).toEqual({
        state: 'disabled',
        message: 'Background WSL discovery is disabled by policy',
      });
      expect(payload.wsl.providers.cursor).toEqual(expect.objectContaining({
        state: 'disabled',
        runtimeMode: 'wsl',
        distro: 'Ubuntu',
      }));
      expect(payload.wsl.providers.kiro).toEqual(expect.objectContaining({
        state: 'disabled',
        runtimeMode: 'wsl',
        distro: 'Ubuntu',
      }));
    });
  });

  it('boots with Docker-backed file providers without trying to host-resolve their container paths', async () => {
    const { config, cleanup } = createTestConfig({
      providerDefaultInstances: {
        auggie: 'docker-dev',
        copilot: 'docker-dev',
      },
      providerInstances: {
        auggie: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'auggie',
            commandConfig: {
              path: 'auggie',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'cats-cli-test', environmentId: 'docker-dev' },
            },
            auggieSessionsDir: '~/.augment/sessions',
          },
        },
        copilot: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'copilot',
            commandConfig: {
              path: 'copilot',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'cats-cli-test', environmentId: 'docker-dev' },
            },
            copilotSessionsDir: '~/.copilot/session-state',
          },
        },
      },
    });

    const runtime = createRuntimeServer(config);
    try {
      await runtime.start();
      const response = await runtime.app.request('/health');
      expect(response.status).toBe(200);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('deduplicates overlapping file discovery watchers even when one path uses ~', async () => {
    const { root, config, cleanup } = createTestConfig();
    const sharedDir = join(root, '.augment', 'sessions');
    writeFileSync(
      join(sharedDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'auggie-1',
        created: '2026-03-10T00:00:00.000Z',
        modified: '2026-03-10T00:01:00.000Z',
        name: 'Repo review',
        agentState: {
          modelId: 'gpt-5-4',
        },
        chatHistory: [
          {
            exchange: {
              request_message: 'Review this repo',
              request_nodes: [
                {
                  ide_state_node: {
                    workspace_folders: [
                      {
                        folder_root: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    config.auggieSessionsDir = sharedDir;
    config.providerDefaultInstances = {
      ...config.providerDefaultInstances,
      auggie: 'native',
    };
    config.providerInstances = {
      ...config.providerInstances,
      auggie: {
        native: {
          id: 'native',
          providerName: 'auggie',
          commandConfig: config.providerCommands.auggie,
          auggieSessionsDir: sharedDir,
        },
        mirror: {
          id: 'mirror',
          providerName: 'auggie',
          commandConfig: {
            ...config.providerCommands.auggie,
            runtime: { ...config.providerCommands.auggie.runtime },
          },
          auggieSessionsDir: '~/.augment/sessions',
        },
      },
    };

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    const runtime = createRuntimeServer(config);
    const discovery = createDiscoveryController(runtime.context);
    try {
      discovery.start();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (runtime.context.registry.list({ provider: 'auggie' }).length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      const sessions = runtime.context.registry.list({ provider: 'auggie' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].providerInstanceId).toBe('native');
      expect(
        warnSpy.mock.calls.some(([message]) =>
          String(message).includes("share watch dir")
          && String(message).includes("'auggie'")
          && String(message).includes("'auggie@mirror'")),
      ).toBe(true);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      discovery.stop();
      warnSpy.mockRestore();
      await runtime.close();
      cleanup();
    }
  });

  it('GET /providers/:provider/models returns structured static fallback for CLI providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false },
          { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', default: false },
        ],
        warnings: [],
      });
    });
  });

  it('GET /providers/:provider/models returns dynamic Ollama catalog with cache metadata', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'deepseek-r1:14b' },
            { name: 'qwen2.5-coder:7b' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'qwen2.5-coder:7b' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await withRuntime({
      providerDefaultTargets: {
        ollama: { backend: 'local', instance: 'local' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {
          ollama: {
            local: {
              id: 'local',
              providerName: 'ollama',
              backend: 'local',
              transport: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'qwen2.5-coder:7b',
            },
          },
        },
        agent: {},
      },
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const first = await runtime.app.request('/providers/ollama/models');
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          {
            id: 'deepseek-r1:14b',
            label: 'deepseek-r1:14b',
            default: false,
            status: 'available',
          },
          {
            id: 'qwen2.5-coder:7b',
            label: 'qwen2.5-coder:7b',
            default: true,
            status: 'running',
          },
        ],
        warnings: [],
      });

      const second = await runtime.app.request('/providers/ollama/models');
      expect(second.status).toBe(200);
      expect((await second.json()).cache).toEqual({
        servedFromCache: true,
        cachedAt: expect.any(String),
        ttlSec: 60,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('GET /providers/:provider/models uses agent adapter model discovery when available', async () => {
    const bridgeFetch = vi.fn(async () => new Response(JSON.stringify({
      providers: [
        { name: 'openai', models: ['gpt-5.4', 'gpt-5.3-codex'] },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'agent', instance: 'bridge' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {},
        agent: {
          codex: {
            bridge: {
              id: 'bridge',
              providerName: 'codex',
              backend: 'agent',
              transport: 'agent_sdk_bridge',
              baseUrl: 'http://127.0.0.1:8082',
              model: 'gpt-5.4',
            },
          },
        },
      },
    }, { agentBackend: { fetch: bridgeFetch } }, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models?instance=agent/bridge');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'codex',
        backend: 'agent',
        instance: 'bridge',
        defaultModel: 'gpt-5.4',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true, status: 'available' },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false, status: 'available' },
        ],
        warnings: [],
      });
    });
  });

  it('GET /providers/:provider/models falls back to static catalog when dynamic discovery fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });

    await withRuntime({
      providerDefaultTargets: {
        ollama: { backend: 'local', instance: 'local' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {
          ollama: {
            local: {
              id: 'local',
              providerName: 'ollama',
              backend: 'local',
              transport: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'qwen2.5-coder:7b',
            },
          },
        },
        agent: {},
      },
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const response = await runtime.app.request('/providers/ollama/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'config',
        cache: null,
        models: [
          {
            id: 'qwen2.5-coder:7b',
            label: 'qwen2.5-coder:7b',
            default: true,
            status: 'configured',
          },
        ],
        warnings: [
          expect.stringContaining(
            'Dynamic model discovery failed for ollama/local/local: connection refused',
          ),
        ],
      });
    });
  });

  it('GET /providers/:provider/models returns 400 for unknown providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/missing/models');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Failed to inspect provider models: Error: Provider 'missing' is not configured",
        code: 'provider_not_configured',
      });
    });
  });

  it('GET /providers/:provider/models returns a stable resolution code for invalid instances', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models?instance=api/missing');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Failed to inspect provider models: Error: Unknown codex target 'api/missing'. Valid: cli/default",
        code: 'unknown_target',
      });
    });
  });

  it('createDiscoveryController falls back to default services when instance resolvers are absent', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config);

    try {
      expect(() => createDiscoveryController({
        ...runtime.context,
        resolveCursorNative: undefined,
        resolveKiroNative: undefined,
        resolveAuggieSessions: undefined,
        resolveOpencodeNative: undefined,
        wslDiscoveryStatus: undefined,
      })).not.toThrow();
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
