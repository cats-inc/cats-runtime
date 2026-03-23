import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { createRuntimeStartupState } from '../startup.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import { ProviderCompatibilityService } from '../core/compatibility/ProviderCompatibilityService.js';
import type { ProviderInstallCheckRunner } from '../core/provider-install/ProviderInstallCheckRunner.js';

describe('provider diagnostics HTTP contract', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3110,
      apiKey: '',
      dataDir,
      sessionBaseDir,
      auggieMaxTurns: 10,
      auggiePath: 'auggie',
      claudePath: 'claude',
      codexPath: 'codex',
      copilotPath: 'copilot',
      cursorPath: 'cursor-agent',
      geminiPath: 'gemini',
      goosePath: 'goose',
      juniePath: 'junie',
      kiroPath: 'kiro-cli',
      opencodePath: 'opencode',
      piPath: 'pi',
      opencodeServerHost: '127.0.0.1',
      opencodeServerPort: 4097,
      opencodeServerStartupTimeoutMs: 10_000,
      auggieSessionsDir: join(rootDir, '.augment', 'sessions'),
      claudeProjectsDir: join(rootDir, '.claude', 'projects'),
      codexSessionsDir: join(rootDir, '.codex', 'sessions'),
      copilotSessionsDir: join(rootDir, '.copilot', 'session-state'),
      cursorChatsDir: join(rootDir, '.cursor', 'chats'),
      cursorRuntime: { mode: 'native' },
      geminiSessionsDir: join(rootDir, '.gemini', 'tmp'),
      kiroDbPath: join(rootDir, '.kiro', 'data.sqlite3'),
      kiroRuntime: { mode: 'native' },
      piSessionsDir: join(rootDir, '.pi', 'sessions'),
      nativeDiscoveryIntervalMs: 0,
      externalSessionLiveWindowMs: 0,
      maxSessions: 10,
      spawnRetries: 1,
      spawnTimeoutMs: 30_000,
      providerCommands: {
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: {
        claude: 'default',
      },
      providerInstances: {
        auggie: {},
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
        codex: {},
        copilot: {},
        cursor: {},
        gemini: {},
        goose: {},
        junie: {},
        kiro: {},
        opencode: {},
        pi: {},
      },
    } as unknown as CliRuntimeConfig;
  }

  function createInstallCheckRunner(): ProviderInstallCheckRunner {
    return {
      lookupCommand: vi.fn(async (command: string) => ({
        available: true,
        resolvedPath: `/runtime/bin/${command}`,
        timedOut: false,
      })),
      checkPath: vi.fn(async () => ({
        exists: false,
        timedOut: false,
      })),
      checkNpmPackage: vi.fn(async () => ({
        exists: false,
        timedOut: false,
      })),
      checkShellRcEntry: vi.fn(async () => ({
        exists: false,
        timedOut: false,
      })),
      getNpmPrefix: vi.fn(async () => ({
        value: undefined,
        timedOut: false,
      })),
    };
  }

  function createTestApp() {
    const compatibility = new ProviderCompatibilityService(makeConfig(), {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'claude 1.2.3\n',
              stderr: '',
              timedOut: false,
              durationMs: 3,
            };
          }

          return {
            exitCode: 0,
            stdout: 'Usage: claude --input-format --output-format --include-partial-messages --resume\n',
            stderr: '',
            timedOut: false,
            durationMs: 3,
          };
        }),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:02:00.000Z'),
    });

    return createApp({
      config: makeConfig(),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      compatibility,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog: {} as never,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-diagnostics-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(rootDir, '.claude', 'projects'), { recursive: true });
    registry = new SessionRegistry();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns machine-readable reprobe and compatibility cache metadata', async () => {
    const app = createTestApp();

    const diagnosticsResponse = await app.request('/diagnostics/providers?probe=live&force=1');
    expect(diagnosticsResponse.status).toBe(200);
    const diagnostics = await diagnosticsResponse.json() as {
      providers: Array<{
        provider: string;
        availability: {
          probe: string;
          attentionCodes: string[];
        };
        compatibility: {
          attentionCodes: string[];
          probe: {
            mode: string;
            supportsLive: boolean;
            liveValidated: boolean;
          };
          cache: {
            stale: boolean;
            ttlMs: number;
          };
        };
        reprobe: {
          forceSupported: boolean;
          liveSupported: boolean;
        };
      }>;
    };

    expect(diagnostics.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        availability: expect.objectContaining({
          probe: 'live',
          attentionCodes: [],
        }),
        compatibility: expect.objectContaining({
          attentionCodes: [],
          probe: {
            mode: 'live',
            supportsLive: true,
            liveValidated: true,
          },
          cache: expect.objectContaining({
            stale: false,
            ttlMs: 300_000,
          }),
        }),
        reprobe: {
          forceSupported: true,
          liveSupported: true,
        },
      }),
    ]);

    const configResponse = await app.request('/providers/config');
    expect(configResponse.status).toBe(200);
    const configBody = await configResponse.json() as {
      providers: {
        claude: {
          instances: Array<{
            compatibility: {
              probe: { mode: string; liveValidated: boolean };
              cache: { stale: boolean };
              attentionCodes: string[];
            } | null;
          }>;
        };
      };
    };

    expect(configBody.providers.claude.instances[0]?.compatibility).toEqual(expect.objectContaining({
      probe: expect.objectContaining({
        mode: 'live',
        liveValidated: true,
      }),
      cache: expect.objectContaining({
        stale: false,
      }),
      attentionCodes: [],
    }));
  });
});
