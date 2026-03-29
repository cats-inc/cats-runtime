import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import { createRuntimeApp } from './app.js';
import { createRuntimeStartupState } from '../startup.js';
import { getRuntimeResolvedPaths } from '../core/config.js';
import { RuntimeManagementService } from '../core/management/RuntimeManagementService.js';
import { StubManagementAdapter } from '../core/management/adapters/stub/StubAdapter.js';
import { RuntimeWakeupService } from '../core/wakeup/RuntimeWakeupService.js';
import { PeerRegistry } from '../core/peers/PeerRegistry.js';
import { createDisabledPeerDiscoverySnapshot } from '../core/peers/PeerDiscoveryController.js';
import { PeerExecutionAdmissionService } from '../core/peers/PeerExecutionAdmissionService.js';
import { PeerExecutionReplayService } from '../core/peers/PeerExecutionReplayService.js';
import {
  ProviderEvolutionProbeService,
  PROVIDER_EVOLUTION_PROBE_PROFILES,
} from '../core/compatibility/providerEvolutionProbe.js';
import type { PeerAdvertisement } from '../core/peers/types.js';
import type { StreamEvent, TurnInput } from '../core/types.js';
import type { RuntimeMode } from '../backends/cli/config.js';
import { stripAdditiveContentBlocks } from '../../tests/streamEventTestUtils.js';

function writeCompatibilityEvidenceArtifact(
  root: string,
  provider: string,
  artifactId: string,
  overrides: Partial<{
    instanceId: string;
    classification: 'degraded' | 'unsupported_version' | 'unrecognized_protocol' | 'probe_failed';
    summary: string;
    capturedAt: string;
    parserId: string;
    profileId: string;
    runtimeMode: RuntimeMode;
  }> = {},
): string {
  const providerDir = join(root, provider);
  mkdirSync(providerDir, { recursive: true });
  const artifactPath = join(providerDir, `${artifactId}.json`);
  writeFileSync(artifactPath, `${JSON.stringify({
    schemaVersion: 3,
    id: artifactId,
    capturedAt: overrides.capturedAt || '2026-03-27T00:00:00.000Z',
    classification: overrides.classification || 'probe_failed',
    summary: overrides.summary || 'Compatibility probe failed while checking the provider.',
    target: {
      provider,
      instanceId: overrides.instanceId || 'default',
    },
    profile: {
      id: overrides.profileId || `${provider}-cli-best-fit`,
      label: `${provider} best fit`,
      protocolFamily: provider,
      parserId: overrides.parserId || `${provider}-json`,
      confidence: 'fallback',
    },
    fingerprint: {
      provider,
      instanceId: overrides.instanceId || 'default',
      command: provider,
      runner: 'auto',
      runtime: { mode: overrides.runtimeMode || 'native' },
      version: {
        detected: true,
        source: 'command',
      },
      features: [],
      checkedAt: overrides.capturedAt || '2026-03-27T00:00:00.000Z',
    },
    warnings: [],
    setup: {
      status: 'ready',
      summary: 'ready',
      install: null,
      auth: null,
      remediation: [],
    },
    probes: {},
    checks: [],
  }, null, 2)}\n`, 'utf8');
  return artifactPath;
}

function createPeerAdvertisement(
  peerId: string,
  observedAt: string,
  ttlMs: number,
): PeerAdvertisement {
  return {
    identity: {
      peerId,
      displayName: peerId,
      runtimeVersion: '0.1.0-test',
      advertisedUrl: `http://${peerId}.local:3110`,
    },
    observedAt,
    ttlMs,
    capabilities: {
      providers: ['codex'],
      targets: [{
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
        default: true,
      }],
      targetLimit: 16,
      truncated: false,
    },
    load: {
      activeSessions: 0,
      busyWorkers: 0,
      idleWorkers: 1,
      providerWorkers: {},
      capacityState: 'idle',
    },
    trust: {
      state: 'unknown',
      reason: 'unverified',
    },
  };
}

describe('runtime MCP facade', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let workers: Map<string, {
    alive: boolean;
    busy: boolean;
    streamMessage: (turn: string | TurnInput) => AsyncGenerator<StreamEvent>;
  }>;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3110,
      apiKey: '',
      dataDir,
      sessionBaseDir,
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
      providerCommands: {
        auggie: { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } },
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
        codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
        copilot: { path: 'copilot', runner: 'auto', runtime: { mode: 'native' } },
        cursor: { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'native' } },
        gemini: { path: 'gemini', runner: 'auto', runtime: { mode: 'native' } },
        goose: { path: 'goose', runner: 'auto', runtime: { mode: 'native' } },
        junie: { path: 'junie', runner: 'auto', runtime: { mode: 'native' } },
        kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
        opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
        pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: {
        claude: 'default',
      },
      providerInstances: {
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
          },
        },
      },
      externalSessionLiveWindowMs: 0,
      maxSessions: 10,
    } as unknown as CliRuntimeConfig;
  }

  function runGit(cwd: string, args: string[]): string {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }

    return result.stdout.trim();
  }

  function createGitWorkspace(repoName: string): string {
    const repoDir = join(rootDir, repoName);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'tracked.txt'), 'initial\n', 'utf8');

    runGit(repoDir, ['init']);
    runGit(repoDir, ['config', 'user.email', 'cats-runtime@example.test']);
    runGit(repoDir, ['config', 'user.name', 'Cats Runtime Test']);
    runGit(repoDir, ['add', '.']);
    runGit(repoDir, ['commit', '-m', 'initial']);

    return repoDir;
  }

  function createTestApp(options?: {
    configureManagement?: (management: RuntimeManagementService) => void;
  }) {
    const startup = createRuntimeStartupState();
    const peerNow = Date.parse('2026-03-25T00:00:05.000Z');
    const bootstrapService = {
      getSetupState: vi.fn(async () => ({
        status: 'pending',
        lastScanAt: null,
        lastManualScanAt: null,
        appliedAt: null,
        appliedConfigPath: null,
        error: null,
      })),
      getLatestScan: vi.fn(async () => null),
      getLatestManualScan: vi.fn(async () => null),
      getProviderUniverse: vi.fn(() => [
        {
          provider: 'claude',
          familyLabel: 'Claude',
          binaryName: 'claude',
        },
      ]),
      scan: vi.fn(async () => ({
        scannedAt: '2026-03-27T00:00:00.000Z',
        scanType: 'manual',
        providers: [],
      })),
      applyConfig: vi.fn(async (_providers: string[]) => ({
        configPath: join(rootDir, 'config', 'providers.yaml'),
      })),
    };
    const completeBootstrap = vi.fn(() => {
      startup.bootstrapRequired = false;
    });
    const wakeup = new RuntimeWakeupService({
      persistPath: join(dataDir, 'wakeups.json'),
      sessionExists: (sessionId) => registry.get(sessionId) !== undefined,
      wakeSession: vi.fn(async (sessionId: string) => ({
        sessionId,
        outcome: 'resumed' as const,
      })),
    });
    const management = new RuntimeManagementService({
      config: {
        version: 1,
        adapters: {
          review: { default: 'github', instances: {} },
          deployment: { default: 'zeabur', instances: {} },
        },
      },
    });
    management.registerAdapter(new StubManagementAdapter('github', ['review'], [
      'audit_review_target', 'open_pull_request', 'inspect_pull_request', 'wait_review_checks',
    ]));
    management.registerAdapter(new StubManagementAdapter('zeabur', ['deployment'], [
      'audit_deployment_target', 'create_deployment', 'inspect_deployment', 'read_deployment_logs',
    ]));
    options?.configureManagement?.(management);
    const peerRegistry = new PeerRegistry({
      stalePeerTtlMs: 5_000,
      now: () => peerNow,
    });
    peerRegistry.upsert(
      createPeerAdvertisement('peer-live', '2026-03-25T00:00:03.000Z', 5_000),
      { sourceId: 'lan:live', sourceKind: 'lan' },
    );
    peerRegistry.upsert(
      createPeerAdvertisement('peer-stale', '2026-03-25T00:00:00.000Z', 1_000),
      { sourceId: 'lan:stale', sourceKind: 'lan' },
    );
    const peerExecutionAdmission = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 2,
        maxInboundExecutions: 4,
        maxInboundExecutionsPerPeer: 2,
        limitOverrides: [],
      },
      now: () => peerNow,
    });
    const peerExecutionReplay = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 60_000,
        replayNonceTtlMs: 120_000,
        maxReplayNoncesPerCaller: 16,
        limitOverrides: [],
      },
      now: () => peerNow,
    });
    peerExecutionAdmission.recordAuthFailure('peer:lab');
    peerExecutionReplay.validate('peer:peer-live', peerNow, 'nonce-1');
    const codexDayDir = join(rootDir, '.codex', 'sessions', '2026', '03', '27');
    mkdirSync(codexDayDir, { recursive: true });
    writeFileSync(
      join(codexDayDir, 'rollout-2026-03-27T00-00-00-codex-native-1.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'codex-native-1',
            cwd: join(rootDir, 'codex-workspace'),
            model_provider: 'openai',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:05.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Inspect the project status',
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );
    const cursorNativeSessions = [
      {
        providerSessionId: 'cursor-native-1',
        cwd: join(rootDir, 'cursor-workspace'),
        summary: 'Cursor native session',
        messageCount: 4,
        lastActivity: '2026-03-27T00:00:00.000Z',
        model: 'cursor-sonnet',
      },
    ];
    const kiroNativeSessions = [
      {
        providerSessionId: 'kiro-native-1',
        cwd: join(rootDir, 'kiro-workspace'),
        summary: 'Kiro native session',
        messageCount: 2,
        lastActivity: '2026-03-27T00:01:00.000Z',
        model: 'kiro-default',
      },
    ];
    const auggieNativeSessions = [
      {
        providerSessionId: 'auggie-native-1',
        cwd: join(rootDir, 'auggie-workspace'),
        summary: 'Auggie native session',
        sourcePath: join(rootDir, '.augment', 'sessions', 'auggie-native-1.json'),
        messageCount: 5,
        lastActivity: '2026-03-27T00:02:00.000Z',
        model: 'auggie-pro',
      },
    ];
    const opencodeNativeSessions = [
      {
        providerSessionId: 'opencode-native-1',
        cwd: join(rootDir, 'opencode-workspace'),
        summary: 'OpenCode native session',
        messageCount: 3,
        lastActivity: '2026-03-27T00:03:00.000Z',
        model: 'opencode-default',
      },
    ];
    const cursorNative = {
      listSessions: vi.fn(async (cwd: string) =>
        cursorNativeSessions.filter((session) => session.cwd === cwd)),
      listAllSessions: vi.fn(async () => cursorNativeSessions),
    };
    const kiroNative = {
      listSessions: vi.fn(async (cwd: string) =>
        kiroNativeSessions.filter((session) => session.cwd === cwd)),
      listAllSessions: vi.fn(async () => kiroNativeSessions),
    };
    const auggieSessions = {
      listSessions: vi.fn(async (cwd: string) =>
        auggieNativeSessions.filter((session) => session.cwd === cwd)),
      listAllSessions: vi.fn(async () => auggieNativeSessions),
    };
    const opencodeNative = {
      listSessions: vi.fn(async (cwd: string) =>
        opencodeNativeSessions.filter((session) => session.cwd === cwd)),
      listAllSessions: vi.fn(async () => opencodeNativeSessions),
    };
    const providerModelCatalog = {
      inspectSummary: vi.fn(() => ({
        source: 'config',
        defaultModel: null,
        defaultModelStatus: 'unknown',
        modelCount: 0,
        warnings: [],
        statusCounts: {
          available: 0,
          unavailable: 0,
          unknown: 0,
        },
      })),
      getCatalog: vi.fn(async () => ({
        source: 'config',
        models: [],
      })),
      getImmediateCatalog: vi.fn(() => ({
        source: 'config',
        models: [],
      })),
      getAdvancedCatalog: vi.fn(async () => ({
        source: 'config',
        resolution: {
          strategy: 'provider_default',
        },
        models: [],
      })),
    };

    const workerStream = async function* (turn: string | TurnInput): AsyncGenerator<StreamEvent> {
      const input = typeof turn === 'string' ? turn : turn.message;
      yield { type: 'text', text: `reply: ${input}` };
      yield { type: 'result', summary: `completed: ${input}` };
    };

    workers.set('session-1', {
      alive: true,
      busy: false,
      streamMessage: workerStream,
    });

    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn((sessionId: string) => workers.get(sessionId)),
      spawn: vi.fn((sessionId: string) => {
        const worker = {
          alive: true,
          busy: false,
          streamMessage: workerStream,
        };
        workers.set(sessionId, worker);
        return worker;
      }),
      kill: vi.fn((sessionId: string) => {
        workers.delete(sessionId);
      }),
      killAll: vi.fn(() => {
        workers.clear();
      }),
      status: vi.fn(() => ({ active: workers.size, busy: 0, idle: workers.size, providers: { claude: workers.size } })),
    } as unknown as WorkerPool;

    return createRuntimeApp({
      config: makeConfig(),
      startup,
      registry,
      pool,
      cursorNative: cursorNative as never,
      gooseNative: {} as never,
      kiroNative: kiroNative as never,
      auggieSessions: auggieSessions as never,
      opencodeNative: opencodeNative as never,
      providerModelCatalog: providerModelCatalog as never,
      management,
      wakeup,
      peerRegistry,
      peerCapabilities: {
        getLocalPeerId: () => 'local-peer',
      } as never,
      peerDiscovery: {
        snapshot: () => ({
          ...createDisabledPeerDiscoverySnapshot('local-peer', peerRegistry.summary(peerNow)),
          enabled: true,
          status: 'running',
          stalePeerTtlMs: 5_000,
          pruneIntervalMs: 1_000,
          advertiseIntervalMs: 2_000,
          summary: 'Peer discovery is running with 1 live peer(s).',
        }),
      } as never,
      peerExecutionAdmission,
      peerExecutionReplay,
      bootstrapService: bootstrapService as never,
      completeBootstrap,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-mcp-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    registry = new SessionRegistry();
    registry.create({
      id: 'session-1',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    registry.updateStatus('session-1', 'ready');
    workers = new Map();
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('implements initialize and tools/list over POST /mcp', async () => {
    const app = createTestApp();

    const initializeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    expect(initializeResponse.status).toBe(200);
    await expect(initializeResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'cats-runtime-mcp',
          version: expect.any(String),
        },
        capabilities: {
          tools: {},
        },
      },
    });

    const listResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as {
      result: {
        tools: Array<{ name: string }>;
      };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      'runtime_summary',
      'runtime_diagnostics',
      'list_sessions',
      'read_session',
      'session_history',
      'session_lineage',
      'health_diagnostics',
      'pool_status',
      'management_diagnostics',
      'resume_management_operation',
      'discovery_status',
      'list_peers',
      'read_peer',
      'peer_diagnostics',
      'list_codex_sessions',
      'discover_codex_sessions',
      'list_cursor_sessions',
      'discover_cursor_sessions',
      'list_kiro_sessions',
      'discover_kiro_sessions',
      'list_auggie_sessions',
      'discover_auggie_sessions',
      'list_opencode_sessions',
      'discover_opencode_sessions',
      'providers_config',
      'provider_tools',
      'provider_models',
      'providers_models',
      'provider_advanced_models',
      'provider_diagnostics',
      'reprobe_provider_diagnostics',
      'list_provider_evolution_artifacts',
      'list_compatibility_evidence_artifacts',
      'read_provider_evolution_artifact',
      'review_provider_evolution_artifact',
      'read_compatibility_evidence_artifact',
      'generate_setup_diagnostic_report',
      'list_setup_diagnostic_reports',
      'read_latest_setup_diagnostic_report',
      'read_setup_diagnostic_report',
      'setup_state',
      'run_setup_scan',
      'apply_setup_config',
      'observe_session',
      'list_wakeups',
      'read_wakeup',
      'create_wakeup',
      'cancel_wakeup',
      'trigger_wakeup',
      'list_runtime_skills',
      'create_session',
      'send_message',
      'close_session',
      'cancel_session',
      'resume_session',
      'reset_session',
      'fork_session',
      'delete_session',
      'cleanup_session_workspace',
      'compact_session',
      'report_session_maintenance_follow_through',
      'report_compaction_follow_through',
      'list_browser_drivers',
      'list_browser_sessions',
      'read_browser_session',
      'browser_summary',
      'create_browser_session',
      'create_browser_page',
      'navigate_browser_page',
      'close_browser_page',
      'close_browser_session',
      'cleanup_browser_sessions',
      'audit_workspace',
      'init_workspace',
      'audit_delivery_target',
      'commit_changes',
      'publish_artifacts',
      'inspect_repo_status',
      'push_branch',
      'audit_review_target',
      'open_pull_request',
      'inspect_pull_request',
      'wait_review_checks',
      'audit_deployment_target',
      'create_deployment',
      'inspect_deployment',
      'read_deployment_logs',
    ]);

    const createSessionTool = listed.result.tools.find((tool) => tool.name === 'create_session') as {
      inputSchema?: { properties?: Record<string, { enum?: string[] }> };
    } | undefined;
    expect(createSessionTool?.inputSchema?.properties?.workspaceIsolation?.enum).toEqual([
      'shared',
      'isolated',
      'worktree',
    ]);
  });

  it('returns runtime and session inspection data through tools/call', async () => {
    const app = createTestApp();

    const runtimeSummaryResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'runtime_summary',
          arguments: {},
        },
      }),
    });
    expect(runtimeSummaryResponse.status).toBe(200);
    const runtimeSummary = await runtimeSummaryResponse.json() as {
      result: {
        structuredContent: {
          sessions: { total: number };
          diagnostics: { mcpPath: string };
        };
      };
    };
    expect(runtimeSummary.result.structuredContent.sessions.total).toBe(1);
    expect(runtimeSummary.result.structuredContent.diagnostics.mcpPath).toBe('/mcp');

    const runtimeDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.1,
        method: 'tools/call',
        params: {
          name: 'runtime_diagnostics',
          arguments: {},
        },
      }),
    });
    expect(runtimeDiagnosticsResponse.status).toBe(200);
    const runtimeDiagnostics = await runtimeDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          diagnosticsPath: string;
          runtime: {
            startup: {
              phase: string;
            };
          };
        };
      };
    };
    expect(runtimeDiagnostics.result.structuredContent.diagnosticsPath).toBe('/diagnostics/runtime');
    expect(runtimeDiagnostics.result.structuredContent.runtime.startup.phase).toEqual(
      expect.any(String),
    );

    const healthDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.2,
        method: 'tools/call',
        params: {
          name: 'health_diagnostics',
          arguments: {
            probe: 'light',
            forceRefresh: true,
          },
        },
      }),
    });
    expect(healthDiagnosticsResponse.status).toBe(200);
    const healthDiagnostics = await healthDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          diagnosticsPath: string;
          status: string;
          providers: {
            probe: string;
          };
        };
      };
    };
    expect(healthDiagnostics.result.structuredContent.diagnosticsPath).toBe(
      '/diagnostics/health?probe=light&force=1',
    );
    expect(healthDiagnostics.result.structuredContent.status).toEqual(expect.any(String));
    expect(healthDiagnostics.result.structuredContent.providers.probe).toBe('light');

    const providersConfigResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.3,
        method: 'tools/call',
        params: {
          name: 'providers_config',
          arguments: {},
        },
      }),
    });
    expect(providersConfigResponse.status).toBe(200);
    const providersConfig = await providersConfigResponse.json() as {
      result: {
        structuredContent: {
          configPath: string;
          providers: Record<string, {
            defaultInstance: string;
            instances: Array<{
              id: string;
              target: string;
            }>;
          }>;
        };
      };
    };
    expect(providersConfig.result.structuredContent.configPath).toBe('/providers/config');
    expect(providersConfig.result.structuredContent.providers.claude).toEqual(
      expect.objectContaining({
        defaultInstance: 'default',
        instances: expect.arrayContaining([
          expect.objectContaining({
            id: 'default',
            target: 'cli/default',
          }),
        ]),
      }),
    );

    const providerToolsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.4,
        method: 'tools/call',
        params: {
          name: 'provider_tools',
          arguments: {
            provider: 'claude',
            instance: 'default',
          },
        },
      }),
    });
    expect(providerToolsResponse.status).toBe(200);
    const providerTools = await providerToolsResponse.json() as {
      result: {
        structuredContent: {
          provider: string;
          backend: string;
          instance: string;
          toolsPath: string;
          source: string;
          summary: string;
        };
      };
    };
    expect(providerTools.result.structuredContent.toolsPath).toBe(
      '/providers/claude/tools?instance=default',
    );
    expect(providerTools.result.structuredContent).toEqual(expect.objectContaining({
      provider: 'claude',
      backend: 'cli',
      instance: 'default',
      source: 'provider_native',
      summary: expect.stringContaining('provider-native tools'),
    }));

    const providerModelsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.5,
        method: 'tools/call',
        params: {
          name: 'provider_models',
          arguments: {
            provider: 'claude',
            instance: 'default',
            forceRefresh: true,
          },
        },
      }),
    });
    expect(providerModelsResponse.status).toBe(200);
    const providerModels = await providerModelsResponse.json() as {
      result: {
        structuredContent: {
          source: string;
          models: unknown[];
          modelsPath: string;
        };
      };
    };
    expect(providerModels.result.structuredContent.modelsPath).toBe(
      '/providers/claude/models?instance=default&refresh=1',
    );
    expect(providerModels.result.structuredContent).toEqual(expect.objectContaining({
      source: 'config',
      models: [],
    }));

    const providersModelsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.6,
        method: 'tools/call',
        params: {
          name: 'providers_models',
          arguments: {
            forceRefresh: true,
          },
        },
      }),
    });
    expect(providersModelsResponse.status).toBe(200);
    const providersModels = await providersModelsResponse.json() as {
      result: {
        structuredContent: {
          modelsPath: string;
          providers: Record<string, {
            source: string;
            models: unknown[];
          }>;
        };
      };
    };
    expect(providersModels.result.structuredContent.modelsPath).toBe(
      '/providers/models?refresh=1',
    );
    expect(providersModels.result.structuredContent.providers).toEqual(expect.objectContaining({
      claude: {
        source: 'config',
        models: [],
      },
    }));

    const providerAdvancedModelsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.7,
        method: 'tools/call',
        params: {
          name: 'provider_advanced_models',
          arguments: {
            provider: 'claude',
            instance: 'default',
            forceRefresh: true,
          },
        },
      }),
    });
    expect(providerAdvancedModelsResponse.status).toBe(200);
    const providerAdvancedModels = await providerAdvancedModelsResponse.json() as {
      result: {
        structuredContent: {
          source: string;
          models: unknown[];
          modelsPath: string;
          resolution: {
            strategy: string;
          };
        };
      };
    };
    expect(providerAdvancedModels.result.structuredContent.modelsPath).toBe(
      '/providers/claude/models/advanced?instance=default&refresh=1',
    );
    expect(providerAdvancedModels.result.structuredContent).toEqual(expect.objectContaining({
      source: 'config',
      models: [],
      resolution: {
        strategy: 'provider_default',
      },
    }));

    const providerDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'provider_diagnostics',
          arguments: {
            probe: 'live',
            provider: 'claude',
            backend: 'cli',
            instance: 'default',
            defaultOnly: true,
            forceRefresh: true,
          },
        },
      }),
    });
    expect(providerDiagnosticsResponse.status).toBe(200);
    const providerDiagnostics = await providerDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          probe: string;
          providersPath: string;
          query: {
            hasFilters: boolean;
            filters: Record<string, string | boolean>;
          };
          summary: { targets: number };
          providers: Array<{
            provider: string;
            backend: string;
            instance: string;
            defaultTarget: boolean;
          }>;
        };
      };
    };
    expect(providerDiagnostics.result.structuredContent.probe).toBe('live');
    expect(providerDiagnostics.result.structuredContent.query).toEqual({
      hasFilters: true,
      filters: {
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        defaultOnly: true,
      },
    });
    expect(providerDiagnostics.result.structuredContent.providersPath).toBe(
      '/diagnostics/providers?probe=live&provider=claude&backend=cli&instance=default&defaultOnly=true&force=1',
    );
    expect(providerDiagnostics.result.structuredContent.summary.targets).toBe(1);
    expect(providerDiagnostics.result.structuredContent.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        defaultTarget: true,
      }),
    ]);
    vi.mocked(pool.getCapabilities).mockClear();

    const reprobeDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 30.5,
        method: 'tools/call',
        params: {
          name: 'reprobe_provider_diagnostics',
          arguments: {
            provider: 'claude',
            backend: 'cli',
            instance: 'default',
            probe: 'live',
          },
        },
      }),
    });
    expect(reprobeDiagnosticsResponse.status).toBe(200);
    const reprobeDiagnostics = await reprobeDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          probe: string;
          reprobePath: string;
          reprobe: {
            forceRefresh: boolean;
          };
          query: {
            hasFilters: boolean;
            filters: Record<string, string | boolean>;
          };
          providers: Array<{
            provider: string;
            backend: string;
            instance: string;
            compatibility: {
              probe: {
                mode: string;
              };
            };
          }>;
        };
      };
    };
    expect(reprobeDiagnostics.result.structuredContent.probe).toBe('live');
    expect(reprobeDiagnostics.result.structuredContent.reprobePath).toBe(
      '/diagnostics/providers/reprobe',
    );
    expect(reprobeDiagnostics.result.structuredContent.reprobe).toEqual({
      forceRefresh: true,
    });
    expect(reprobeDiagnostics.result.structuredContent.query).toEqual({
      hasFilters: true,
      filters: {
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
      },
    });
    expect(reprobeDiagnostics.result.structuredContent.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        compatibility: expect.objectContaining({
          probe: expect.objectContaining({
            mode: 'live',
          }),
        }),
      }),
    ]);

    const probeService = new ProviderEvolutionProbeService({
      rootDir: join(
        getRuntimeResolvedPaths(makeConfig()).compatibilityEvidenceDir,
        'provider-evolution',
      ),
    });
    const artifact = await probeService.run({
      target: {
        provider: 'claude',
        instance: 'default',
        parserId: 'claude-stream-json',
        probeProfile: 'manual_text',
        transport: 'cli',
        version: '1.2.3',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        return {
          status: 'completed',
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    const listEvolutionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'list_provider_evolution_artifacts',
          arguments: {
            provider: 'claude',
            classification: ['baseline'],
            limit: 1,
          },
        },
      }),
    });
    expect(listEvolutionResponse.status).toBe(200);
    const listedEvolution = await listEvolutionResponse.json() as {
      result: {
        structuredContent: {
          artifactsPath: string;
          query: {
            provider: string;
            reviewClassifications: string[];
            limit: number;
          };
          artifacts: Array<{
            artifactId: string;
            provider: string;
            parserId: string;
          }>;
        };
      };
    };
    expect(listedEvolution.result.structuredContent.artifactsPath).toBe(
      '/diagnostics/providers/evolution?provider=claude&classification=baseline&limit=1',
    );
    expect(listedEvolution.result.structuredContent.query).toEqual({
      provider: 'claude',
      reviewClassifications: ['baseline'],
      limit: 1,
    });
    expect(listedEvolution.result.structuredContent.artifacts).toEqual([
      expect.objectContaining({
        artifactId: artifact.artifact.id,
        provider: 'claude',
        parserId: 'claude-stream-json',
      }),
    ]);

    const readEvolutionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 33,
        method: 'tools/call',
        params: {
          name: 'read_provider_evolution_artifact',
          arguments: {
            artifactId: artifact.artifact.id,
            provider: 'claude',
          },
        },
      }),
    });
    expect(readEvolutionResponse.status).toBe(200);
    const readEvolution = await readEvolutionResponse.json() as {
      result: {
        structuredContent: {
          artifactPath: string;
          relativePath: string;
          artifact: {
            id: string;
            provider: string;
          };
        };
      };
    };
    expect(readEvolution.result.structuredContent.artifactPath).toBe(
      `/diagnostics/providers/evolution/${artifact.artifact.id}?provider=claude`,
    );
    expect(readEvolution.result.structuredContent.relativePath).toContain('claude/');
    expect(readEvolution.result.structuredContent.artifact).toEqual(expect.objectContaining({
      id: artifact.artifact.id,
      provider: 'claude',
    }));

    const reviewEvolutionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 33.5,
        method: 'tools/call',
        params: {
          name: 'review_provider_evolution_artifact',
          arguments: {
            artifactId: artifact.artifact.id,
            provider: 'claude',
            classifications: ['regression', 'schema_change'],
            summary: 'Manual MCP review flagged a regression with schema changes.',
            highlights: [
              'Removed event types: future.event',
              'Schema changes observed for tool_result.',
            ],
            references: [
              {
                kind: 'issue',
                url: 'https://docs.example.com/issues/claude-cli-regression',
              },
            ],
          },
        },
      }),
    });
    expect(reviewEvolutionResponse.status).toBe(200);
    const reviewedEvolution = await reviewEvolutionResponse.json() as {
      result: {
        structuredContent: {
          updated: boolean;
          reviewPath: string;
          artifact: {
            artifactId: string;
            review: {
              classifications: string[];
              summary: string;
              highlights: string[];
            };
            reviewContext: {
              references: Array<{
                kind: string;
                url: string;
              }>;
            };
          };
        };
      };
    };
    expect(reviewedEvolution.result.structuredContent.updated).toBe(true);
    expect(reviewedEvolution.result.structuredContent.reviewPath).toBe(
      `/diagnostics/providers/evolution/${artifact.artifact.id}/review`,
    );
    expect(reviewedEvolution.result.structuredContent.artifact).toEqual(
      expect.objectContaining({
        artifactId: artifact.artifact.id,
        review: {
          classifications: ['regression', 'schema_change'],
          summary: 'Manual MCP review flagged a regression with schema changes.',
          highlights: [
            'Removed event types: future.event',
            'Schema changes observed for tool_result.',
          ],
        },
        reviewContext: {
          references: [
            {
              kind: 'issue',
              url: 'https://docs.example.com/issues/claude-cli-regression',
            },
          ],
        },
      }),
    );

    writeCompatibilityEvidenceArtifact(
      getRuntimeResolvedPaths(makeConfig()).compatibilityEvidenceDir,
      'claude',
      'compat-artifact-mcp',
      {
        classification: 'degraded',
        parserId: 'claude-stream-json',
        profileId: 'claude-cli-best-fit',
        runtimeMode: 'docker',
      },
    );

    const listCompatibilityResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 34,
        method: 'tools/call',
        params: {
          name: 'list_compatibility_evidence_artifacts',
          arguments: {
            provider: 'claude',
            classification: ['degraded'],
            runtimeMode: 'docker',
            limit: 1,
          },
        },
      }),
    });
    expect(listCompatibilityResponse.status).toBe(200);
    const listedCompatibility = await listCompatibilityResponse.json() as {
      result: {
        structuredContent: {
          artifactsPath: string;
          query: {
            provider: string;
            classifications: string[];
            runtimeMode: string;
            limit: number;
          };
          artifacts: Array<{
            artifactId: string;
            provider: string;
            parserId: string;
            runtimeMode: string;
          }>;
        };
      };
    };
    expect(listedCompatibility.result.structuredContent.artifactsPath).toBe(
      '/diagnostics/providers/evidence?provider=claude&runtimeMode=docker&classification=degraded&limit=1',
    );
    expect(listedCompatibility.result.structuredContent.query).toEqual({
      provider: 'claude',
      classifications: ['degraded'],
      runtimeMode: 'docker',
      limit: 1,
    });
    expect(listedCompatibility.result.structuredContent.artifacts).toEqual([
      expect.objectContaining({
        artifactId: 'compat-artifact-mcp',
        provider: 'claude',
        parserId: 'claude-stream-json',
        runtimeMode: 'docker',
      }),
    ]);

    const readCompatibilityResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35,
        method: 'tools/call',
        params: {
          name: 'read_compatibility_evidence_artifact',
          arguments: {
            artifactId: 'compat-artifact-mcp',
            provider: 'claude',
          },
        },
      }),
    });
    expect(readCompatibilityResponse.status).toBe(200);
    const readCompatibility = await readCompatibilityResponse.json() as {
      result: {
        structuredContent: {
          artifactPath: string;
          relativePath: string;
          artifact: {
            id: string;
            target: {
              provider: string;
            };
          };
        };
      };
    };
    expect(readCompatibility.result.structuredContent.artifactPath).toBe(
      '/diagnostics/providers/evidence/compat-artifact-mcp?provider=claude',
    );
    expect(readCompatibility.result.structuredContent.relativePath).toContain('claude/');
    expect(readCompatibility.result.structuredContent.artifact).toEqual(expect.objectContaining({
      id: 'compat-artifact-mcp',
      target: expect.objectContaining({
        provider: 'claude',
      }),
    }));

    const generateSetupReportResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.5,
        method: 'tools/call',
        params: {
          name: 'generate_setup_diagnostic_report',
          arguments: {},
        },
      }),
    });
    expect(generateSetupReportResponse.status).toBe(200);
    const generatedSetupReport = await generateSetupReportResponse.json() as {
      result: {
        structuredContent: {
          reportPath: string;
          status: string;
          report: {
            artifactId: string;
            summary: {
              headline: string;
            };
          };
        };
      };
    };
    expect(generatedSetupReport.result.structuredContent.reportPath).toBe('/diagnostics/setup-report');
    expect(generatedSetupReport.result.structuredContent.status).toBe('generated');
    expect(generatedSetupReport.result.structuredContent.report.artifactId).toEqual(expect.any(String));
    expect(generatedSetupReport.result.structuredContent.report.summary.headline).toEqual(expect.any(String));

    const setupReportArtifactId = generatedSetupReport.result.structuredContent.report.artifactId;

    const listSetupReportsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.6,
        method: 'tools/call',
        params: {
          name: 'list_setup_diagnostic_reports',
          arguments: {
            limit: 1,
          },
        },
      }),
    });
    expect(listSetupReportsResponse.status).toBe(200);
    const listedSetupReports = await listSetupReportsResponse.json() as {
      result: {
        structuredContent: {
          reportsPath: string;
          artifacts: Array<{
            artifactId: string;
          }>;
        };
      };
    };
    expect(listedSetupReports.result.structuredContent.reportsPath).toBe(
      '/diagnostics/setup-report?limit=1',
    );
    expect(listedSetupReports.result.structuredContent.artifacts).toEqual([
      expect.objectContaining({
        artifactId: setupReportArtifactId,
      }),
    ]);

    const latestSetupReportResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.7,
        method: 'tools/call',
        params: {
          name: 'read_latest_setup_diagnostic_report',
          arguments: {},
        },
      }),
    });
    expect(latestSetupReportResponse.status).toBe(200);
    const latestSetupReport = await latestSetupReportResponse.json() as {
      result: {
        structuredContent: {
          reportPath: string;
          report: {
            artifactId: string;
          };
        };
      };
    };
    expect(latestSetupReport.result.structuredContent.reportPath).toBe(
      '/diagnostics/setup-report/latest',
    );
    expect(latestSetupReport.result.structuredContent.report.artifactId).toBe(setupReportArtifactId);

    const readSetupReportResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.8,
        method: 'tools/call',
        params: {
          name: 'read_setup_diagnostic_report',
          arguments: {
            artifactId: setupReportArtifactId,
          },
        },
      }),
    });
    expect(readSetupReportResponse.status).toBe(200);
    const readSetupReport = await readSetupReportResponse.json() as {
      result: {
        structuredContent: {
          reportPath: string;
          report: {
            artifactId: string;
          };
        };
      };
    };
    expect(readSetupReport.result.structuredContent.reportPath).toBe(
      `/diagnostics/setup-report/${encodeURIComponent(setupReportArtifactId)}`,
    );
    expect(readSetupReport.result.structuredContent.report.artifactId).toBe(setupReportArtifactId);

    const setupStateResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.9,
        method: 'tools/call',
        params: {
          name: 'setup_state',
          arguments: {},
        },
      }),
    });
    expect(setupStateResponse.status).toBe(200);
    const setupState = await setupStateResponse.json() as {
      result: {
        structuredContent: {
          setupStatePath: string;
          bootstrapRequired: boolean;
          repair: {
            status: string;
            actions: Array<{
              kind: string;
            }>;
          };
        };
      };
    };
    expect(setupState.result.structuredContent.setupStatePath).toBe('/setup-state');
    expect(setupState.result.structuredContent.bootstrapRequired).toBe(false);
    expect(setupState.result.structuredContent.repair).toEqual(expect.objectContaining({
      status: 'scan_required',
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: 'run_manual_scan' }),
        expect.objectContaining({ kind: 'generate_setup_report' }),
      ]),
    }));

    const runSetupScanResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.95,
        method: 'tools/call',
        params: {
          name: 'run_setup_scan',
          arguments: {
            manual: true,
          },
        },
      }),
    });
    expect(runSetupScanResponse.status).toBe(200);
    const runSetupScan = await runSetupScanResponse.json() as {
      result: {
        structuredContent: {
          setupScanPath: string;
          status: string;
          scan: {
            scanType: string;
          };
        };
      };
    };
    expect(runSetupScan.result.structuredContent.setupScanPath).toBe('/setup-scan');
    expect(runSetupScan.result.structuredContent.status).toBe('completed');
    expect(runSetupScan.result.structuredContent.scan.scanType).toBe('manual');

    const applySetupConfigResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 35.96,
        method: 'tools/call',
        params: {
          name: 'apply_setup_config',
          arguments: {
            providers: ['claude'],
          },
        },
      }),
    });
    expect(applySetupConfigResponse.status).toBe(200);
    const appliedSetupConfig = await applySetupConfigResponse.json() as {
      result: {
        structuredContent: {
          setupApplyPath: string;
          status: string;
          bootstrapRequired: boolean;
          configPath: string;
        };
      };
    };
    expect(appliedSetupConfig.result.structuredContent.setupApplyPath).toBe('/setup-apply');
    expect(appliedSetupConfig.result.structuredContent.status).toBe('applied');
    expect(appliedSetupConfig.result.structuredContent.bootstrapRequired).toBe(false);
    expect(appliedSetupConfig.result.structuredContent.configPath).toContain('providers.yaml');

    vi.mocked(pool.getCapabilities).mockClear();

    const listSessionsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'list_sessions',
          arguments: {},
        },
      }),
    });
    expect(listSessionsResponse.status).toBe(200);
    const listedSessions = await listSessionsResponse.json() as {
      result: {
        structuredContent: {
          sessions: Array<{
            id: string;
            providerTarget: {
              provider: string;
              backend: string;
              instance: string;
              target: string;
              resolved: boolean;
            };
          }>;
        };
      };
    };
    expect(listedSessions.result.structuredContent.sessions).toEqual([
      expect.objectContaining({
        id: 'session-1',
        providerTarget: expect.objectContaining({
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          target: 'cli/default',
          resolved: true,
        }),
      }),
    ]);
    expect(pool.getCapabilities).not.toHaveBeenCalled();

    const readSessionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.5,
        method: 'tools/call',
        params: {
          name: 'read_session',
          arguments: {
            sessionId: 'session-1',
          },
        },
      }),
    });
    expect(readSessionResponse.status).toBe(200);
    const readSession = await readSessionResponse.json() as {
      result: {
        structuredContent: {
          sessionPath: string;
          observePath: string;
          historyPath: string;
          session: {
            id: string;
            providerTarget: {
              provider: string;
              backend: string;
              instance: string;
              target: string;
              resolved: boolean;
            };
          };
        };
      };
    };
    expect(readSession.result.structuredContent.sessionPath).toBe('/sessions/session-1');
    expect(readSession.result.structuredContent.observePath).toBe('/sessions/session-1/observe');
    expect(readSession.result.structuredContent.historyPath).toBe('/sessions/session-1/history');
    expect(readSession.result.structuredContent.session).toEqual(expect.objectContaining({
      id: 'session-1',
      providerTarget: expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        target: 'cli/default',
        resolved: true,
      }),
    }));

    const sessionHistoryResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.6,
        method: 'tools/call',
        params: {
          name: 'session_history',
          arguments: {
            sessionId: 'session-1',
          },
        },
      }),
    });
    expect(sessionHistoryResponse.status).toBe(200);
    const sessionHistory = await sessionHistoryResponse.json() as {
      result: {
        structuredContent: {
          sessionPath: string;
          observePath: string;
          historyPath: string;
          history: {
            messages: unknown[];
            transcript: {
              ownership: string;
              source: string;
              parser: string;
            };
            providerTarget: {
              provider: string;
              backend: string;
              instance: string;
              target: string;
              resolved: boolean;
            };
          };
        };
      };
    };
    expect(sessionHistory.result.structuredContent.sessionPath).toBe('/sessions/session-1');
    expect(sessionHistory.result.structuredContent.observePath).toBe('/sessions/session-1/observe');
    expect(sessionHistory.result.structuredContent.historyPath).toBe('/sessions/session-1/history');
    expect(sessionHistory.result.structuredContent.history.messages).toEqual([]);
    expect(sessionHistory.result.structuredContent.history.transcript).toEqual({
      ownership: 'none',
      source: 'none',
      parser: 'none',
    });
    expect(sessionHistory.result.structuredContent.history.providerTarget).toEqual(
      expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        target: 'cli/default',
        resolved: true,
      }),
    );

    const sessionLineageResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.7,
        method: 'tools/call',
        params: {
          name: 'session_lineage',
          arguments: {
            sessionId: 'session-1',
          },
        },
      }),
    });
    expect(sessionLineageResponse.status).toBe(200);
    const sessionLineage = await sessionLineageResponse.json() as {
      result: {
        structuredContent: {
          sessionPath: string;
          observePath: string;
          historyPath: string;
          lineagePath: string;
          lineage: {
            rootSessionId: string;
            parentSessionId: string | null;
            ancestors: unknown[];
            children: unknown[];
            descendants: unknown[];
            session: {
              id: string;
              providerTarget: {
                provider: string;
                backend: string;
                instance: string;
                target: string;
                resolved: boolean;
              };
            };
          };
        };
      };
    };
    expect(sessionLineage.result.structuredContent.sessionPath).toBe('/sessions/session-1');
    expect(sessionLineage.result.structuredContent.observePath).toBe('/sessions/session-1/observe');
    expect(sessionLineage.result.structuredContent.historyPath).toBe('/sessions/session-1/history');
    expect(sessionLineage.result.structuredContent.lineagePath).toBe('/sessions/session-1/lineage');
    expect(sessionLineage.result.structuredContent.lineage).toEqual(expect.objectContaining({
      rootSessionId: 'session-1',
      parentSessionId: null,
      ancestors: [],
      children: [],
      descendants: [],
      session: expect.objectContaining({
        id: 'session-1',
        providerTarget: expect.objectContaining({
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          target: 'cli/default',
          resolved: true,
        }),
      }),
    }));

    const observeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'observe_session',
          arguments: {
            sessionId: 'session-1',
          },
        },
      }),
    });
    expect(observeResponse.status).toBe(200);
    const observe = await observeResponse.json() as {
      result: {
        structuredContent: {
          session: {
            id: string;
            providerTarget: {
              provider: string;
              backend: string;
              instance: string;
              target: string;
              resolved: boolean;
            };
            inspection: {
              state: string;
            };
          };
          observePath: string;
        };
      };
    };
    expect(observe.result.structuredContent.session.id).toBe('session-1');
    expect(observe.result.structuredContent.session.providerTarget).toEqual(
      expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        target: 'cli/default',
        resolved: true,
      }),
    );
    expect(observe.result.structuredContent.session.inspection.state).toBe('idle');
    expect(observe.result.structuredContent.observePath).toBe('/sessions/session-1/observe');
    expect(pool.getCapabilities).toHaveBeenCalledWith('claude', 'default');
  });

  it('exposes discovery and peer inspection data through tools/call', async () => {
    const app = createTestApp();

    const discoveryStatusResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.3,
        method: 'tools/call',
        params: {
          name: 'discovery_status',
          arguments: {},
        },
      }),
    });
    expect(discoveryStatusResponse.status).toBe(200);
    const discoveryStatus = await discoveryStatusResponse.json() as {
      result: {
        structuredContent: {
          discoveryStatusPath: string;
          peersPath: string;
          peerDiagnosticsPath: string;
          lan: {
            status: string;
            registry: {
              total: number;
              alive: number;
            };
          };
        };
      };
    };
    expect(discoveryStatus.result.structuredContent.discoveryStatusPath).toBe('/discovery/status');
    expect(discoveryStatus.result.structuredContent.peersPath).toBe('/peers');
    expect(discoveryStatus.result.structuredContent.peerDiagnosticsPath).toBe('/diagnostics/peers');
    expect(discoveryStatus.result.structuredContent.lan.status).toBe('running');
    expect(discoveryStatus.result.structuredContent.lan.registry).toEqual(expect.objectContaining({
      total: 2,
      alive: 1,
    }));

    const listPeersResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.4,
        method: 'tools/call',
        params: {
          name: 'list_peers',
          arguments: {
            includeStale: true,
          },
        },
      }),
    });
    expect(listPeersResponse.status).toBe(200);
    const listPeers = await listPeersResponse.json() as {
      result: {
        structuredContent: {
          peersPath: string;
          query: {
            includeStale: boolean;
          };
          peers: Array<{
            identity: {
              peerId: string;
            };
          }>;
        };
      };
    };
    expect(listPeers.result.structuredContent.peersPath).toBe('/peers?includeStale=true');
    expect(listPeers.result.structuredContent.query.includeStale).toBe(true);
    expect(listPeers.result.structuredContent.peers.map((peer) => peer.identity.peerId)).toEqual([
      'peer-live',
      'peer-stale',
    ]);

    const readPeerResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.5,
        method: 'tools/call',
        params: {
          name: 'read_peer',
          arguments: {
            peerId: 'peer-live',
          },
        },
      }),
    });
    expect(readPeerResponse.status).toBe(200);
    const readPeer = await readPeerResponse.json() as {
      result: {
        structuredContent: {
          peerPath: string;
          peersPath: string;
          peer: {
            identity: {
              peerId: string;
            };
          };
        };
      };
    };
    expect(readPeer.result.structuredContent.peerPath).toBe('/peers/peer-live');
    expect(readPeer.result.structuredContent.peersPath).toBe('/peers');
    expect(readPeer.result.structuredContent.peer.identity.peerId).toBe('peer-live');

    const peerDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3.6,
        method: 'tools/call',
        params: {
          name: 'peer_diagnostics',
          arguments: {
            includeStale: true,
          },
        },
      }),
    });
    expect(peerDiagnosticsResponse.status).toBe(200);
    const peerDiagnostics = await peerDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          peerDiagnosticsPath: string;
          summary: {
            total: number;
            alive: number;
            stale: number;
          };
          peers: Array<unknown>;
        };
      };
    };
    expect(peerDiagnostics.result.structuredContent.peerDiagnosticsPath).toBe(
      '/diagnostics/peers?includeStale=true',
    );
    expect(peerDiagnostics.result.structuredContent.summary).toEqual(expect.objectContaining({
      total: 2,
      alive: 1,
      stale: 1,
    }));
    expect(peerDiagnostics.result.structuredContent.peers).toHaveLength(2);
  });

  it('exposes pool and management diagnostics through MCP without introducing new read contracts', async () => {
    let completedOperationId = '';
    let pollingOperationId = '';
    const app = createTestApp({
      configureManagement: (management) => {
        const completed = management.operations.create();
        management.operations.complete(completed.operationId, {
          _requestContext: {
            domain: 'review',
            action: 'wait_review_checks',
            adapter: 'github',
          },
        });
        completedOperationId = completed.operationId;

        const polling = management.operations.create(15_000);
        management.operations.update(polling.operationId, 'polling', {
          _requestContext: {
            domain: 'deployment',
            action: 'create_deployment',
            adapter: 'zeabur',
          },
        });
        pollingOperationId = polling.operationId;
      },
    });

    const poolStatusResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.55,
        method: 'tools/call',
        params: {
          name: 'pool_status',
          arguments: {},
        },
      }),
    });
    expect(poolStatusResponse.status).toBe(200);
    const poolStatus = await poolStatusResponse.json() as {
      result: {
        structuredContent: {
          poolStatusPath: string;
          active: number;
          idle: number;
          busy: number;
          providers: Record<string, number>;
        };
      };
    };
    expect(poolStatus.result.structuredContent).toEqual(expect.objectContaining({
      poolStatusPath: '/pool/status',
      active: 1,
      idle: 1,
      busy: 0,
      providers: {
        claude: 1,
      },
    }));

    const managementDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.56,
        method: 'tools/call',
        params: {
          name: 'management_diagnostics',
          arguments: {
            domain: 'review',
            workspacePath: '/tmp/repo',
          },
        },
      }),
    });
    expect(managementDiagnosticsResponse.status).toBe(200);
    const managementDiagnostics = await managementDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          diagnosticsPath: string;
          adapters: Array<{
            adapter: string;
            domain: string;
            transport: string;
            availability: {
              status: string;
            };
          }>;
          operations: {
            summary: {
              total: number;
              polling: number;
              completed: number;
              failed: number;
            };
            recent: Array<{
              operationId: string;
              status: string;
              domain?: string;
              action?: string;
              adapter?: string;
            }>;
          };
        };
      };
    };
    expect(managementDiagnostics.result.structuredContent.diagnosticsPath).toBe(
      '/management/diagnostics?domain=review&workspacePath=%2Ftmp%2Frepo',
    );
    expect(managementDiagnostics.result.structuredContent.adapters).toEqual([
      expect.objectContaining({
        adapter: 'github',
        domain: 'review',
        transport: 'cli',
        availability: expect.objectContaining({
          status: 'ok',
        }),
      }),
    ]);
    expect(managementDiagnostics.result.structuredContent.operations.summary).toEqual(
      expect.objectContaining({
        total: 2,
        polling: 1,
        completed: 1,
        failed: 0,
      }),
    );
    expect(managementDiagnostics.result.structuredContent.operations.recent).toHaveLength(2);
    expect(managementDiagnostics.result.structuredContent.operations.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: pollingOperationId,
        status: 'polling',
        domain: 'deployment',
        action: 'create_deployment',
        adapter: 'zeabur',
      }),
      expect.objectContaining({
        operationId: completedOperationId,
        status: 'completed',
        domain: 'review',
        action: 'wait_review_checks',
        adapter: 'github',
      }),
    ]));
  });

  it('resumes management operations through MCP without inventing a second operation contract', async () => {
    let operationId = '';
    const app = createTestApp({
      configureManagement: (management) => {
        const op = management.operations.create();
        management.operations.complete(op.operationId, { checks: 'passed' });
        operationId = op.operationId;
      },
    });

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.57,
        method: 'tools/call',
        params: {
          name: 'resume_management_operation',
          arguments: {
            operationId,
            timeoutMs: 5_000,
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const resumed = await response.json() as {
      result: {
        structuredContent: {
          state: string;
          outputs: {
            checks: string;
          };
          operation: {
            operationId: string;
            status: string;
          };
          operationResumePath: string;
          managementDiagnosticsPath: string;
        };
      };
    };
    expect(resumed.result.structuredContent.state).toBe('completed');
    expect(resumed.result.structuredContent.outputs.checks).toBe('passed');
    expect(resumed.result.structuredContent.operation).toEqual(expect.objectContaining({
      operationId,
      status: 'completed',
    }));
    expect(resumed.result.structuredContent.operationResumePath).toBe(
      `/management/operations/${operationId}/resume`,
    );
    expect(resumed.result.structuredContent.managementDiagnosticsPath).toBe(
      '/management/diagnostics',
    );
  });

  it('exposes native session inspection and discovery tools for supported CLI providers', async () => {
    const app = createTestApp();

    const listCodexResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.575,
        method: 'tools/call',
        params: {
          name: 'list_codex_sessions',
          arguments: {
            cwd: join(rootDir, 'codex-workspace'),
          },
        },
      }),
    });
    expect(listCodexResponse.status).toBe(200);
    const listCodex = await listCodexResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerSessionId: string;
          }>;
        };
      };
    };
    expect(listCodex.result.structuredContent.count).toBe(1);
    expect(listCodex.result.structuredContent.sessions[0]?.providerSessionId).toBe(
      'codex-native-1',
    );

    const discoverCodexResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.576,
        method: 'tools/call',
        params: {
          name: 'discover_codex_sessions',
          arguments: {
            cwd: join(rootDir, 'codex-workspace'),
            group: 'native-imports',
          },
        },
      }),
    });
    expect(discoverCodexResponse.status).toBe(200);
    const discoverCodex = await discoverCodexResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerName: string;
            group?: string;
          }>;
        };
      };
    };
    expect(discoverCodex.result.structuredContent.count).toBe(1);
    expect(discoverCodex.result.structuredContent.sessions[0]).toEqual(expect.objectContaining({
      providerName: 'codex',
      group: 'native-imports',
    }));

    const listCursorResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.58,
        method: 'tools/call',
        params: {
          name: 'list_cursor_sessions',
          arguments: {
            cwd: join(rootDir, 'cursor-workspace'),
          },
        },
      }),
    });
    expect(listCursorResponse.status).toBe(200);
    const listCursor = await listCursorResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessionsPath: string;
          sessions: Array<{
            providerSessionId: string;
          }>;
        };
      };
    };
    expect(listCursor.result.structuredContent.count).toBe(1);
    expect(listCursor.result.structuredContent.sessionsPath).toBe(
      `/cursor/sessions?cwd=${encodeURIComponent(join(rootDir, 'cursor-workspace'))}`,
    );
    expect(listCursor.result.structuredContent.sessions[0]?.providerSessionId).toBe(
      'cursor-native-1',
    );

    const discoverCursorResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.59,
        method: 'tools/call',
        params: {
          name: 'discover_cursor_sessions',
          arguments: {
            cwd: join(rootDir, 'cursor-workspace'),
            group: 'native-imports',
            startIfNeeded: true,
          },
        },
      }),
    });
    expect(discoverCursorResponse.status).toBe(200);
    const discoverCursor = await discoverCursorResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          count: number;
          discoverPath: string;
          sessions: Array<{
            providerName: string;
            group?: string;
          }>;
        };
      };
    };
    expect(discoverCursor.result.structuredContent.responseStatus).toBe(200);
    expect(discoverCursor.result.structuredContent.count).toBe(1);
    expect(discoverCursor.result.structuredContent.discoverPath).toBe('/cursor/sessions/discover');
    expect(discoverCursor.result.structuredContent.sessions[0]).toEqual(expect.objectContaining({
      providerName: 'cursor',
      group: 'native-imports',
    }));

    const listKiroResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.6,
        method: 'tools/call',
        params: {
          name: 'list_kiro_sessions',
          arguments: {},
        },
      }),
    });
    expect(listKiroResponse.status).toBe(200);
    const listKiro = await listKiroResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerSessionId: string;
          }>;
        };
      };
    };
    expect(listKiro.result.structuredContent.count).toBe(1);
    expect(listKiro.result.structuredContent.sessions[0]?.providerSessionId).toBe('kiro-native-1');

    const discoverKiroResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.61,
        method: 'tools/call',
        params: {
          name: 'discover_kiro_sessions',
          arguments: {
            startIfNeeded: true,
          },
        },
      }),
    });
    expect(discoverKiroResponse.status).toBe(200);
    const discoverKiro = await discoverKiroResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerName: string;
          }>;
        };
      };
    };
    expect(discoverKiro.result.structuredContent.count).toBe(1);
    expect(discoverKiro.result.structuredContent.sessions[0]?.providerName).toBe('kiro');

    const listAuggieResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.62,
        method: 'tools/call',
        params: {
          name: 'list_auggie_sessions',
          arguments: {},
        },
      }),
    });
    expect(listAuggieResponse.status).toBe(200);
    const listAuggie = await listAuggieResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerSessionId: string;
          }>;
        };
      };
    };
    expect(listAuggie.result.structuredContent.count).toBe(1);
    expect(listAuggie.result.structuredContent.sessions[0]?.providerSessionId).toBe(
      'auggie-native-1',
    );

    const discoverAuggieResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.63,
        method: 'tools/call',
        params: {
          name: 'discover_auggie_sessions',
          arguments: {
            group: 'native-imports',
          },
        },
      }),
    });
    expect(discoverAuggieResponse.status).toBe(200);
    const discoverAuggie = await discoverAuggieResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerName: string;
            group?: string;
          }>;
        };
      };
    };
    expect(discoverAuggie.result.structuredContent.count).toBe(1);
    expect(discoverAuggie.result.structuredContent.sessions[0]).toEqual(expect.objectContaining({
      providerName: 'auggie',
      group: 'native-imports',
    }));

    const listOpencodeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.64,
        method: 'tools/call',
        params: {
          name: 'list_opencode_sessions',
          arguments: {},
        },
      }),
    });
    expect(listOpencodeResponse.status).toBe(200);
    const listOpencode = await listOpencodeResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerSessionId: string;
          }>;
        };
      };
    };
    expect(listOpencode.result.structuredContent.count).toBe(1);
    expect(listOpencode.result.structuredContent.sessions[0]?.providerSessionId).toBe(
      'opencode-native-1',
    );

    const discoverOpencodeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.65,
        method: 'tools/call',
        params: {
          name: 'discover_opencode_sessions',
          arguments: {
            group: 'native-imports',
          },
        },
      }),
    });
    expect(discoverOpencodeResponse.status).toBe(200);
    const discoverOpencode = await discoverOpencodeResponse.json() as {
      result: {
        structuredContent: {
          count: number;
          sessions: Array<{
            providerName: string;
            group?: string;
          }>;
        };
      };
    };
    expect(discoverOpencode.result.structuredContent.count).toBe(1);
    expect(discoverOpencode.result.structuredContent.sessions[0]).toEqual(expect.objectContaining({
      providerName: 'opencode',
      group: 'native-imports',
    }));
  });

  it('exposes wakeup inspection tools aligned with the existing wakeup read routes', async () => {
    const app = createTestApp();

    const createResponse = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Wake the session later.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-27T01:00:00.000Z',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      request: {
        id: string;
      };
    };

    const listWakeupsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.8,
        method: 'tools/call',
        params: {
          name: 'list_wakeups',
          arguments: {
            status: 'scheduled',
            sessionId: 'session-1',
          },
        },
      }),
    });
    expect(listWakeupsResponse.status).toBe(200);
    const listWakeups = await listWakeupsResponse.json() as {
      result: {
        structuredContent: {
          wakeupsPath: string;
          wakeups: Array<{
            id: string;
            reason: string;
            status: string;
            target: {
              kind: string;
              sessionId: string;
            };
          }>;
        };
      };
    };
    expect(listWakeups.result.structuredContent.wakeupsPath).toBe(
      '/wakeups?status=scheduled&sessionId=session-1',
    );
    expect(listWakeups.result.structuredContent.wakeups).toEqual([
      expect.objectContaining({
        id: created.request.id,
        reason: 'Wake the session later.',
        status: 'scheduled',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
      }),
    ]);

    const readWakeupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31.9,
        method: 'tools/call',
        params: {
          name: 'read_wakeup',
          arguments: {
            wakeupId: created.request.id,
          },
        },
      }),
    });
    expect(readWakeupResponse.status).toBe(200);
    const readWakeup = await readWakeupResponse.json() as {
      result: {
        structuredContent: {
          wakeupPath: string;
          wakeupsPath: string;
          request: {
            id: string;
            reason: string;
            status: string;
          };
        };
      };
    };
    expect(readWakeup.result.structuredContent.wakeupPath).toBe(`/wakeups/${created.request.id}`);
    expect(readWakeup.result.structuredContent.wakeupsPath).toBe('/wakeups');
    expect(readWakeup.result.structuredContent.request).toEqual(expect.objectContaining({
      id: created.request.id,
      reason: 'Wake the session later.',
      status: 'scheduled',
    }));
  });

  it('exposes wakeup mutation tools aligned with the existing wakeup routes', async () => {
    const app = createTestApp();

    const createWakeupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'create_wakeup',
          arguments: {
            reason: 'Wake the session from MCP.',
            target: {
              kind: 'session',
              sessionId: 'session-1',
            },
            scheduleAt: '2026-03-27T01:10:00.000Z',
          },
        },
      }),
    });
    expect(createWakeupResponse.status).toBe(200);
    const createdWakeup = await createWakeupResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          coalesced: boolean;
          wakeupPath: string;
          wakeupsPath: string;
          sessionPath: string;
          observePath: string;
          historyPath: string;
          request: {
            id: string;
            status: string;
            reason: string;
          };
        };
      };
    };
    expect(createdWakeup.result.structuredContent.responseStatus).toBe(201);
    expect(createdWakeup.result.structuredContent.coalesced).toBe(false);
    expect(createdWakeup.result.structuredContent.wakeupsPath).toBe('/wakeups');
    expect(createdWakeup.result.structuredContent.wakeupPath).toBe(
      `/wakeups/${createdWakeup.result.structuredContent.request.id}`,
    );
    expect(createdWakeup.result.structuredContent.sessionPath).toBe('/sessions/session-1');
    expect(createdWakeup.result.structuredContent.observePath).toBe('/sessions/session-1/observe');
    expect(createdWakeup.result.structuredContent.historyPath).toBe('/sessions/session-1/history');
    expect(createdWakeup.result.structuredContent.request).toEqual(expect.objectContaining({
      reason: 'Wake the session from MCP.',
      status: 'scheduled',
    }));

    const cancelWakeupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32.1,
        method: 'tools/call',
        params: {
          name: 'cancel_wakeup',
          arguments: {
            wakeupId: createdWakeup.result.structuredContent.request.id,
          },
        },
      }),
    });
    expect(cancelWakeupResponse.status).toBe(200);
    const cancelledWakeup = await cancelWakeupResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          wakeupPath: string;
          request: {
            id: string;
            status: string;
          };
        };
      };
    };
    expect(cancelledWakeup.result.structuredContent.responseStatus).toBe(200);
    expect(cancelledWakeup.result.structuredContent.wakeupPath).toBe(
      `/wakeups/${createdWakeup.result.structuredContent.request.id}/cancel`,
    );
    expect(cancelledWakeup.result.structuredContent.request).toEqual(expect.objectContaining({
      id: createdWakeup.result.structuredContent.request.id,
      status: 'cancelled',
    }));

    const directCreateResponse = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Trigger from MCP.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-27T01:20:00.000Z',
      }),
    });
    expect(directCreateResponse.status).toBe(201);
    const directCreate = await directCreateResponse.json() as {
      request: {
        id: string;
      };
    };

    const triggerWakeupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32.2,
        method: 'tools/call',
        params: {
          name: 'trigger_wakeup',
          arguments: {
            wakeupId: directCreate.request.id,
          },
        },
      }),
    });
    expect(triggerWakeupResponse.status).toBe(200);
    const triggeredWakeup = await triggerWakeupResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          wakeupPath: string;
          request: {
            id: string;
            status: string;
            lastExecution: {
              source: string;
              sessionId: string;
              outcome: string;
            };
          };
        };
      };
    };
    expect(triggeredWakeup.result.structuredContent.responseStatus).toBe(200);
    expect(triggeredWakeup.result.structuredContent.wakeupPath).toBe(
      `/wakeups/${directCreate.request.id}/trigger`,
    );
    expect(triggeredWakeup.result.structuredContent.request).toEqual(expect.objectContaining({
      id: directCreate.request.id,
      status: 'triggered',
      lastExecution: expect.objectContaining({
        source: 'manual',
        sessionId: 'session-1',
        outcome: 'resumed',
      }),
    }));
  });

  it('exposes the runtime skill catalog through MCP with the same lightweight filters as HTTP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            family: ['chat'],
            slug: ['companion'],
            role: ['companion_core'],
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      result: {
        structuredContent: {
          contract: {
            version: number;
          };
          query: {
            hasFilters: boolean;
            filters: Record<string, string[]>;
          };
          count: number;
          catalogPath: string;
          skills: Array<{
            id: string;
            library: {
              family: string;
              slug: string;
              role: string;
            };
          }>;
        };
      };
    };
    expect(payload.result.structuredContent.contract.version).toBe(1);
    expect(payload.result.structuredContent.query).toEqual({
      hasFilters: true,
      filters: {
        family: ['chat'],
        slug: ['companion'],
        role: ['companion_core'],
      },
    });
    expect(payload.result.structuredContent.count).toBe(1);
    expect(payload.result.structuredContent.catalogPath).toBe(
      '/skills/catalog?family=chat&slug=companion&role=companion_core',
    );
    expect(payload.result.structuredContent.skills).toEqual([
      expect.objectContaining({
        id: 'companion',
        library: expect.objectContaining({
          family: 'chat',
          slug: 'companion',
          role: 'companion_core',
        }),
      }),
    ]);
  });

  it('rejects invalid runtime skill catalog filters through MCP with params errors', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            family: ['invalid'],
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: -32602,
        message: 'family must be a valid runtime skill family',
      },
    });
  });

  it('passes runtime skill catalog pagination arguments through MCP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            limit: 1,
            offset: 0,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      result: {
        structuredContent: {
          count: number;
          catalogPath: string;
          pagination: {
            offset: number;
            limit: number | null;
            returned: number;
            hasMore: boolean;
          };
          skills: Array<{ id: string }>;
        };
      };
    };
    expect(payload.result.structuredContent.catalogPath).toBe('/skills/catalog?offset=0&limit=1');
    expect(payload.result.structuredContent.pagination).toEqual({
      offset: 0,
      limit: 1,
      returned: 1,
      hasMore: true,
    });
    expect(payload.result.structuredContent.skills).toHaveLength(1);
    expect(payload.result.structuredContent.count).toBeGreaterThan(
      payload.result.structuredContent.skills.length,
    );
  });

  it('passes runtime skill catalog sorting arguments through MCP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            sortBy: 'id',
            sortDirection: 'desc',
            limit: 3,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      result: {
        structuredContent: {
          catalogPath: string;
          query: {
            sort?: {
              by: string;
              direction: string;
            };
          };
          skills: Array<{ id: string }>;
        };
      };
    };
    expect(payload.result.structuredContent.catalogPath).toBe(
      '/skills/catalog?sortBy=id&sortDirection=desc&limit=3',
    );
    expect(payload.result.structuredContent.query.sort).toEqual({
      by: 'id',
      direction: 'desc',
    });
    expect(payload.result.structuredContent.skills.map((skill) => skill.id)).toEqual(
      [...payload.result.structuredContent.skills.map((skill) => skill.id)]
        .sort((left, right) => right.localeCompare(left)),
    );
  });

  it('rejects runtime skill sort directions without a sort field through MCP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            sortDirection: 'desc',
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 23,
      error: {
        code: -32602,
        message: 'sortDirection requires sortBy',
      },
    });
  });

  it('exposes runtime-owned browser summary and cleanup through MCP', async () => {
    const app = createTestApp();

    const createdResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'MCP Browser Session',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      session: { id: string };
    };
    await app.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:4173',
        binding: {
          kind: 'manual_url',
        },
      }),
    });
    await app.request(`/browser/sessions/${created.session.id}/close`, {
      method: 'POST',
    });

    const summaryResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'browser_summary',
          arguments: {
            olderThanMs: 0,
          },
        },
      }),
    });
    expect(summaryResponse.status).toBe(200);
    const summaryPayload = await summaryResponse.json() as {
      result: {
        structuredContent: {
          summaryPath: string;
          sessions: { closed: number };
          cleanupCandidates: { sessionIds: string[] };
        };
      };
    };
    expect(summaryPayload.result.structuredContent.summaryPath).toBe(
      '/browser/summary?olderThanMs=0',
    );
    expect(summaryPayload.result.structuredContent.sessions.closed).toBe(1);
    expect(summaryPayload.result.structuredContent.cleanupCandidates.sessionIds).toEqual([
      created.session.id,
    ]);

    const cleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'cleanup_browser_sessions',
          arguments: {
            olderThanMs: 0,
          },
        },
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {
        content: [
          {
            type: 'text',
            text: 'Removed 1 browser session(s) during cleanup.',
          },
        ],
        structuredContent: {
          action: 'cleanup_browser_sessions',
          cleanupPath: '/browser/sessions/cleanup',
          filters: {
            olderThanMs: 0,
            status: 'closed',
          },
          matchedSessionCount: 1,
          matchedPageCount: 1,
          removedSessionCount: 1,
          removedPageCount: 1,
          removedSessionIds: [created.session.id],
          remainingSessionCount: 0,
          remainingClosedSessionCount: 0,
        },
      },
    });
  });

  it('cleans up idle ready browser sessions through MCP without touching sessions that still have open pages', async () => {
    const app = createTestApp();

    const keepResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Keep Browser',
      }),
    });
    const keepSession = await keepResponse.json() as {
      session: { id: string };
    };
    await app.request(`/browser/sessions/${keepSession.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:4173',
        binding: {
          kind: 'manual_url',
        },
      }),
    });

    const idleSessionResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Idle Browser',
      }),
    });
    const idleSession = await idleSessionResponse.json() as {
      session: { id: string };
    };
    const idlePageResponse = await app.request(`/browser/sessions/${idleSession.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '/tmp/report.html',
        binding: {
          kind: 'manual_url',
        },
      }),
    });
    const idlePage = await idlePageResponse.json() as {
      page: { id: string };
    };
    await app.request(`/browser/sessions/${idleSession.session.id}/pages/${idlePage.page.id}/close`, {
      method: 'POST',
    });

    const summaryResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'browser_summary',
          arguments: {
            status: 'ready',
            olderThanMs: 0,
          },
        },
      }),
    });
    expect(summaryResponse.status).toBe(200);
    const summaryPayload = await summaryResponse.json() as {
      result: {
        structuredContent: {
          cleanupCandidates: { sessionIds: string[] };
        };
      };
    };
    expect(summaryPayload.result.structuredContent.cleanupCandidates.sessionIds).toEqual([
      idleSession.session.id,
    ]);

    const cleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'cleanup_browser_sessions',
          arguments: {
            status: 'ready',
            olderThanMs: 0,
          },
        },
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 11,
      result: {
        content: [
          {
            type: 'text',
            text: 'Removed 1 browser session(s) during cleanup.',
          },
        ],
        structuredContent: {
          action: 'cleanup_browser_sessions',
          cleanupPath: '/browser/sessions/cleanup',
          filters: {
            olderThanMs: 0,
            status: 'ready',
          },
          matchedSessionCount: 1,
          matchedPageCount: 1,
          removedSessionCount: 1,
          removedPageCount: 1,
          removedSessionIds: [idleSession.session.id],
          remainingSessionCount: 1,
          remainingClosedSessionCount: 0,
        },
      },
    });
  });

  it('exposes workspace and delivery audit tools without making MCP the only runtime API', async () => {
    const app = createTestApp();
    const workspacePath = join(rootDir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });

    const workspaceAuditResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'audit_workspace',
          arguments: {
            workspacePath,
          },
        },
      }),
    });
    expect(workspaceAuditResponse.status).toBe(200);
    const workspaceAudit = await workspaceAuditResponse.json() as {
      result: {
        structuredContent: {
          operation: string;
          contract: { mode: string };
        };
      };
    };
    expect(workspaceAudit.result.structuredContent.operation).toBe('audit-workspace');
    expect(workspaceAudit.result.structuredContent.contract.mode).toBe('preview');

    const deliveryAuditResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'audit_delivery_target',
          arguments: {
            workspacePath,
            includeSessionArtifacts: true,
          },
        },
      }),
    });
    expect(deliveryAuditResponse.status).toBe(200);
    const deliveryAudit = await deliveryAuditResponse.json() as {
      result: {
        structuredContent: {
          action: string;
          contract: { mode: string };
        };
      };
    };
    expect(deliveryAudit.result.structuredContent.action).toBe('audit-delivery-target');
    expect(deliveryAudit.result.structuredContent.contract.mode).toBe('preview');
  });

  it('exposes delivery follow-through tools over MCP without inventing a second delivery contract', async () => {
    const app = createTestApp();
    const repoDir = createGitWorkspace('workspace-delivery-mcp');
    const remoteDir = join(rootDir, 'workspace-delivery-mcp-remote.git');
    runGit(rootDir, ['init', '--bare', remoteDir]);
    runGit(repoDir, ['remote', 'add', 'origin', remoteDir]);
    const branch = runGit(repoDir, ['branch', '--show-current']);
    writeFileSync(join(repoDir, 'report.html'), '<html><body>report</body></html>\n', 'utf8');

    const repoStatusResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9.1,
        method: 'tools/call',
        params: {
          name: 'inspect_repo_status',
          arguments: {
            workspacePath: repoDir,
          },
        },
      }),
    });
    expect(repoStatusResponse.status).toBe(200);
    const repoStatus = await repoStatusResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          state: string;
          repoStatusPath: string;
          repo: {
            repository: boolean;
            defaultRemote?: string;
            branch?: string;
          };
        };
      };
    };
    expect(repoStatus.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'inspect-repo-status',
      state: 'ready',
      repoStatusPath: '/delivery/repo/status',
      repo: expect.objectContaining({
        repository: true,
        defaultRemote: 'origin',
        branch,
      }),
    }));

    const publishResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9.2,
        method: 'tools/call',
        params: {
          name: 'publish_artifacts',
          arguments: {
            workspacePath: repoDir,
            apply: true,
            actorRole: 'boss_cat',
            artifacts: [
              {
                id: 'report',
                label: 'Report',
                path: 'report.html',
                mediaType: 'text/html',
              },
            ],
            publication: {
              directory: 'dist',
              publicBaseUrl: 'https://example.test/artifacts',
            },
          },
        },
      }),
    });
    expect(publishResponse.status).toBe(200);
    const published = await publishResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          state: string;
          publishPath: string;
          artifacts: Array<{
            id: string;
            copied: boolean;
          }>;
          metadata: {
            publication: {
              directory: string;
              manifestPath: string;
            };
          };
        };
      };
    };
    expect(published.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'publish-artifacts',
      state: 'completed',
      publishPath: '/delivery/artifacts/publish',
      metadata: expect.objectContaining({
        publication: expect.objectContaining({
          directory: join(repoDir, 'dist'),
          manifestPath: join(repoDir, 'dist', 'delivery-manifest.json'),
        }),
      }),
    }));
    expect(published.result.structuredContent.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'report',
        copied: true,
      }),
    ]));

    const pushResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9.3,
        method: 'tools/call',
        params: {
          name: 'push_branch',
          arguments: {
            workspacePath: repoDir,
            apply: true,
            actorRole: 'boss_cat',
            repo: {
              remote: 'origin',
              branch,
              setUpstream: true,
            },
          },
        },
      }),
    });
    expect(pushResponse.status).toBe(200);
    const pushed = await pushResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          state: string;
          pushPath: string;
          metadata: {
            push: {
              remote: string;
              branch: string;
              setUpstream: boolean;
            };
          };
        };
      };
    };
    expect(pushed.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'push-branch',
      state: 'completed',
      pushPath: '/delivery/repo/push',
      metadata: expect.objectContaining({
        push: expect.objectContaining({
          remote: 'origin',
          branch,
          setUpstream: true,
        }),
      }),
    }));
    expect(runGit(repoDir, ['ls-remote', '--heads', 'origin', branch])).toContain(branch);
  }, 10_000);

  it('exposes mutation tools aligned with existing session, workspace, and delivery contracts', async () => {
    const app = createTestApp();
    const workspacePath = join(rootDir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });

    const createResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'create_session',
          arguments: {
            provider: 'claude',
            cwd: workspacePath,
            workspaceIsolation: 'shared',
          },
        },
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          session: { id: string; providerName: string };
          messagePath: string;
        };
      };
    };
    expect(created.result.structuredContent.responseStatus).toBe(201);
    expect(created.result.structuredContent.session.providerName).toBe('claude');
    expect(created.result.structuredContent.session.workspaceIsolation).toEqual(
      expect.objectContaining({
        mode: 'shared',
      }),
    );
    expect(created.result.structuredContent.messagePath).toBe(
      `/sessions/${created.result.structuredContent.session.id}/messages`,
    );

    const createdSessionId = created.result.structuredContent.session.id;
    const sendResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: {
            sessionId: createdSessionId,
            message: 'hello from mcp',
          },
        },
      }),
    });
    expect(sendResponse.status).toBe(200);
    const sent = await sendResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          sessionId: string;
          events: Array<{ type: string; text?: string; summary?: string }>;
        };
      };
    };
    expect(sent.result.structuredContent.responseStatus).toBe(200);
    expect(sent.result.structuredContent.sessionId).toBe(createdSessionId);
    expect(stripAdditiveContentBlocks(sent.result.structuredContent.events)).toEqual([
      { type: 'text', text: 'reply: hello from mcp' },
      { type: 'result', summary: 'completed: hello from mcp' },
    ]);

    const forkResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'fork_session',
          arguments: {
            sessionId: createdSessionId,
            mode: 'context_transplant',
          },
        },
      }),
    });
    expect(forkResponse.status).toBe(200);
    const forked = await forkResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          session: { id: string };
        };
      };
    };
    expect(forked.result.structuredContent.responseStatus).toBe(201);
    expect(forked.result.structuredContent.session.id).not.toBe(createdSessionId);

    const closeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'close_session',
          arguments: {
            sessionId: createdSessionId,
            maintenance: {
              reason: 'prepare_for_reset',
            },
          },
        },
      }),
    });
    expect(closeResponse.status).toBe(200);
    const closed = await closeResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          closePath: string;
          status: string;
        };
      };
    };
    expect(closed.result.structuredContent.responseStatus).toBe(200);
    expect(closed.result.structuredContent.action).toBe('close');
    expect(closed.result.structuredContent.closePath).toBe(
      `/sessions/${createdSessionId}/close`,
    );
    expect(closed.result.structuredContent.status).toBe('closed');

    const seedDiscoveredCodexResponse = await app.request('/codex/sessions/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd: join(rootDir, 'codex-workspace'),
        group: 'resume-target',
      }),
    });
    expect(seedDiscoveredCodexResponse.status).toBe(200);
    const seededCodex = await seedDiscoveredCodexResponse.json() as {
      sessions: Array<{
        id: string;
      }>;
    };
    const discoveredCodexSessionId = seededCodex.sessions[0]?.id;
    expect(discoveredCodexSessionId).toEqual(expect.any(String));

    const resumeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13.1,
        method: 'tools/call',
        params: {
          name: 'resume_session',
          arguments: {
            sessionId: discoveredCodexSessionId,
          },
        },
      }),
    });
    expect(resumeResponse.status).toBe(200);
    const resumed = await resumeResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          resumePath: string;
          session: {
            id: string;
            status: string;
          };
        };
      };
    };
    expect(resumed.result.structuredContent.responseStatus).toBe(200);
    expect(resumed.result.structuredContent.resumePath).toBe(
      `/sessions/${discoveredCodexSessionId}/resume`,
    );
    expect(resumed.result.structuredContent.session).toEqual(expect.objectContaining({
      id: discoveredCodexSessionId,
      providerName: 'codex',
      status: expect.any(String),
    }));

    const cancelResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13.2,
        method: 'tools/call',
        params: {
          name: 'cancel_session',
          arguments: {
            sessionId: discoveredCodexSessionId,
          },
        },
      }),
    });
    expect(cancelResponse.status).toBe(200);
    const cancelled = await cancelResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          cancelPath: string;
          status: string;
        };
      };
    };
    expect(cancelled.result.structuredContent.responseStatus).toBe(200);
    expect(cancelled.result.structuredContent.action).toBe('cancel');
    expect(cancelled.result.structuredContent.cancelPath).toBe(
      `/sessions/${discoveredCodexSessionId}/cancel`,
    );
    expect(cancelled.result.structuredContent.status).toBe('ready');

    const repoDir = createGitWorkspace('workspace-cleanup-retry');
    const createWorktreeResponse = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'claude',
        cwd: repoDir,
        workspaceIsolation: 'worktree',
      }),
    });
    expect(createWorktreeResponse.status).toBe(201);
    const createdWorktree = await createWorktreeResponse.json() as {
      id: string;
      cwd: string;
    };
    writeFileSync(join(createdWorktree.cwd, 'tracked.txt'), 'retain for mcp cleanup\n', 'utf8');

    const resetResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'reset_session',
          arguments: {
            sessionId: createdWorktree.id,
            worktreeCleanupPolicy: 'preserve',
          },
        },
      }),
    });
    expect(resetResponse.status).toBe(200);
    const reset = await resetResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          resetPath: string;
          retryCleanupPath?: string;
          session: {
            cwd: string;
          };
        };
      };
    };
    expect(reset.result.structuredContent.responseStatus).toBe(200);
    expect(reset.result.structuredContent.action).toBe('reset');
    expect(reset.result.structuredContent.status).toBe('retained');
    expect(reset.result.structuredContent.resetPath).toBe(
      `/sessions/${createdWorktree.id}/reset`,
    );
    expect(reset.result.structuredContent.retryCleanupPath).toBe(
      `/sessions/${createdWorktree.id}/workspace/cleanup`,
    );
    expect(reset.result.structuredContent.session.cwd).toBe(createdWorktree.cwd);

    const blockedCleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'cleanup_session_workspace',
          arguments: {
            sessionId: createdWorktree.id,
            requireAcknowledgedHooks: true,
            worktreeCleanupPolicy: 'discard',
            maintenance: {
              reason: 'operator_retry_cleanup',
            },
          },
        },
      }),
    });
    expect(blockedCleanupResponse.status).toBe(200);
    await expect(blockedCleanupResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 15,
      error: {
        code: -32000,
        message: "This session still has pending pre_flush hooks for action 'cleanup_workspace'.",
        data: expect.objectContaining({
          httpStatus: 409,
        }),
      },
    });

    const cleanupFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'report_session_maintenance_follow_through',
          arguments: {
            sessionId: createdWorktree.id,
            action: 'cleanup_workspace',
            phase: 'pre_flush',
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
            },
          },
        },
      }),
    });
    expect(cleanupFollowThroughResponse.status).toBe(200);
    await expect(cleanupFollowThroughResponse.json()).resolves.toEqual(expect.objectContaining({
      result: expect.objectContaining({
        structuredContent: expect.objectContaining({
          action: 'cleanup_workspace',
          phase: 'pre_flush',
          outcome: 'acknowledged',
        }),
      }),
    }));

    const cleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'cleanup_session_workspace',
          arguments: {
            sessionId: createdWorktree.id,
            requireAcknowledgedHooks: true,
            worktreeCleanupPolicy: 'discard',
            maintenance: {
              reason: 'operator_retry_cleanup',
            },
          },
        },
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    const cleaned = await cleanupResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          cleanupPath: string;
          settledLifecycle?: {
            action: string;
            status: string;
            cleanup: {
              providerResumeCleared: boolean;
              providerStateCleared: boolean;
            };
          };
          cleanup: {
            workspaceCleaned: boolean;
            worktreeCleanupPolicy: string;
          };
          session: {
            cwd: string;
            hydration?: unknown;
            inspection: {
              maintenance: {
                lastLifecycle?: {
                  status: string;
                  cleanup: {
                    providerResumeCleared: boolean;
                    providerStateCleared: boolean;
                  };
                };
              };
            };
          };
        };
      };
    };
    expect(cleaned.result.structuredContent.responseStatus).toBe(200);
    expect(cleaned.result.structuredContent.action).toBe('cleanup_workspace');
    expect(cleaned.result.structuredContent.status).toBe('completed');
    expect(cleaned.result.structuredContent.cleanupPath).toBe(
      `/sessions/${createdWorktree.id}/workspace/cleanup`,
    );
    expect(cleaned.result.structuredContent.cleanup).toEqual(expect.objectContaining({
      workspaceCleaned: true,
      worktreeCleanupPolicy: 'discard',
    }));
    expect(cleaned.result.structuredContent.settledLifecycle).toEqual(expect.objectContaining({
      action: 'reset',
      status: 'completed',
      cleanup: expect.objectContaining({
        providerResumeCleared: true,
        providerStateCleared: true,
      }),
    }));
    expect(cleaned.result.structuredContent.session.cwd).toBe(repoDir);
    expect(cleaned.result.structuredContent.session.hydration).toBeUndefined();
    expect(
      cleaned.result.structuredContent.session.inspection.maintenance.lastLifecycle,
    ).toEqual(expect.objectContaining({
      status: 'completed',
      cleanup: expect.objectContaining({
        providerResumeCleared: true,
        providerStateCleared: true,
      }),
    }));

    const resetFollowThroughSession = registry.create({
      id: 'session-maintenance-mcp',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace-maintenance'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    resetFollowThroughSession.messageCount = 4;
    resetFollowThroughSession.totalInputTokens = 400;
    resetFollowThroughSession.totalOutputTokens = 200;
    registry.updateStatus(resetFollowThroughSession.id, 'closed');

    const maintenanceFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 150,
        method: 'tools/call',
        params: {
          name: 'report_session_maintenance_follow_through',
          arguments: {
            sessionId: resetFollowThroughSession.id,
            action: 'reset',
            phase: 'pre_reset',
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
            },
          },
        },
      }),
    });
    expect(maintenanceFollowThroughResponse.status).toBe(200);
    const maintenanceFollowThrough = await maintenanceFollowThroughResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          phase: string;
          outcome: string;
          followThroughPath: string;
          maintenance: {
            lastFollowThrough: {
              action: string;
              phase: string;
              outcome: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(maintenanceFollowThrough.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'reset',
      phase: 'pre_reset',
      outcome: 'acknowledged',
      followThroughPath: `/sessions/${resetFollowThroughSession.id}/maintenance/follow-through`,
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          action: 'reset',
          phase: 'pre_reset',
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
        }),
      }),
    }));

    const deleteToolSession = registry.create({
      id: 'session-delete-mcp',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace-delete'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    deleteToolSession.messageCount = 4;
    deleteToolSession.totalInputTokens = 400;
    deleteToolSession.totalOutputTokens = 200;
    registry.updateStatus(deleteToolSession.id, 'closed');

    const blockedDeleteResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 152,
        method: 'tools/call',
        params: {
          name: 'delete_session',
          arguments: {
            sessionId: deleteToolSession.id,
            requireAcknowledgedHooks: true,
            maintenance: {
              reason: 'owner_requested_delete',
            },
          },
        },
      }),
    });
    expect(blockedDeleteResponse.status).toBe(200);
    await expect(blockedDeleteResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 152,
      error: {
        code: -32000,
        message: "This session still has pending pre_flush hooks for action 'delete'.",
        data: expect.objectContaining({
          httpStatus: 409,
        }),
      },
    });
    expect(registry.get(deleteToolSession.id)).toBeTruthy();

    const deleteFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 153,
        method: 'tools/call',
        params: {
          name: 'report_session_maintenance_follow_through',
          arguments: {
            sessionId: deleteToolSession.id,
            action: 'delete',
            phase: 'pre_flush',
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
            },
          },
        },
      }),
    });
    expect(deleteFollowThroughResponse.status).toBe(200);

    const deleteResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 154,
        method: 'tools/call',
        params: {
          name: 'delete_session',
          arguments: {
            sessionId: deleteToolSession.id,
            requireAcknowledgedHooks: true,
          },
        },
      }),
    });
    expect(deleteResponse.status).toBe(200);
    const deleted = await deleteResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          deletePath: string;
          cleanup: {
            registryDropped: boolean;
          };
          maintenance: {
            action: string;
            status: string;
          };
        };
      };
    };
    expect(deleted.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'delete',
      status: 'deleted',
      deletePath: `/sessions/${deleteToolSession.id}`,
      cleanup: expect.objectContaining({
        registryDropped: true,
      }),
      maintenance: expect.objectContaining({
        action: 'delete',
        status: 'completed',
      }),
    }));
    expect(registry.get(deleteToolSession.id)).toBeUndefined();

    const compactionSession = registry.create({
      id: 'session-compact-mcp',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace-compact'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    compactionSession.messageCount = 40;
    compactionSession.totalInputTokens = 9_000;
    compactionSession.totalOutputTokens = 5_000;
    registry.updateStatus(compactionSession.id, 'closed');

    const compactResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 151,
        method: 'tools/call',
        params: {
          name: 'compact_session',
          arguments: {
            sessionId: compactionSession.id,
            maintenance: {
              reason: 'owner_requested_compaction',
            },
          },
        },
      }),
    });
    expect(compactResponse.status).toBe(200);
    const compacted = await compactResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          hookStatus: string;
          compactPath: string;
          runtimeCompactionExecuted: boolean;
          maintenance: {
            lastRequest: {
              action: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(compacted.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'compact',
      status: 'pending_hooks',
      hookStatus: 'pending',
      compactPath: `/sessions/${compactionSession.id}/compact`,
      runtimeCompactionExecuted: false,
      maintenance: expect.objectContaining({
        lastRequest: expect.objectContaining({
          action: 'compact',
          reason: 'owner_requested_compaction',
        }),
      }),
    }));

    const compactionFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 152,
        method: 'tools/call',
        params: {
          name: 'report_compaction_follow_through',
          arguments: {
            sessionId: compactionSession.id,
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
              hookPayloads: [{
                kind: 'memory_flush',
                payload: {
                  flushed: true,
                },
              }],
            },
          },
        },
      }),
    });
    expect(compactionFollowThroughResponse.status).toBe(200);
    const compactionFollowThrough = await compactionFollowThroughResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          outcome: string;
          status: string;
          hookStatus: string;
          followThroughPath: string;
          maintenance: {
            lastFollowThrough: {
              outcome: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(compactionFollowThrough.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'compact',
      outcome: 'acknowledged',
      status: 'ready_for_external_compaction',
      hookStatus: 'acknowledged',
      followThroughPath: `/sessions/${compactionSession.id}/compact/follow-through`,
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
        }),
      }),
    }));

    const readyCompactionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 153,
        method: 'tools/call',
        params: {
          name: 'compact_session',
          arguments: {
            sessionId: compactionSession.id,
          },
        },
      }),
    });
    expect(readyCompactionResponse.status).toBe(200);
    const readyCompaction = await readyCompactionResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          hookStatus: string;
          compactPath: string;
          maintenance: {
            lastFollowThrough: {
              outcome: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(readyCompaction.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'compact',
      status: 'ready_for_external_compaction',
      hookStatus: 'acknowledged',
      compactPath: `/sessions/${compactionSession.id}/compact`,
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
        }),
      }),
    }));

    const initWorkspaceResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 18,
        method: 'tools/call',
        params: {
          name: 'init_workspace',
          arguments: {
            workspacePath,
          },
        },
      }),
    });
    expect(initWorkspaceResponse.status).toBe(200);
    const initWorkspace = await initWorkspaceResponse.json() as {
      result: {
        structuredContent: {
          operation: string;
        };
      };
    };
    expect(initWorkspace.result.structuredContent.operation).toBe('init-workspace');

    const commitResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'commit_changes',
          arguments: {
            workspacePath,
            repo: {
              message: 'feat: mcp test',
            },
          },
        },
      }),
    });
    expect(commitResponse.status).toBe(200);
    const commit = await commitResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
        };
      };
    };
    expect(commit.result.structuredContent.responseStatus).toBe(200);
    expect(commit.result.structuredContent.action).toBe('create-commit');
  }, 10_000);

  it('exposes browser substrate tools over MCP without depending on a separate browser service', async () => {
    const app = createTestApp();

    const listDriversResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'list_browser_drivers',
          arguments: {},
        },
      }),
    });
    expect(listDriversResponse.status).toBe(200);
    const listedDrivers = await listDriversResponse.json() as {
      result: {
        structuredContent: {
          drivers: Array<{ id: string }>;
        };
      };
    };
    expect(listedDrivers.result.structuredContent.drivers).toEqual([
      expect.objectContaining({
        id: 'manual',
      }),
    ]);

    const createBrowserSessionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'create_browser_session',
          arguments: {
            runtimeSessionId: 'session-1',
            label: 'MCP Browser Session',
          },
        },
      }),
    });
    expect(createBrowserSessionResponse.status).toBe(200);
    const browserSessionResult = await createBrowserSessionResponse.json() as {
      result: {
        structuredContent: {
          session: { id: string; runtimeSessionId: string };
          createBrowserPagePath: string;
        };
      };
    };
    expect(browserSessionResult.result.structuredContent.session.runtimeSessionId).toBe('session-1');

    const browserSessionId = browserSessionResult.result.structuredContent.session.id;
    const createBrowserPageResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'create_browser_page',
          arguments: {
            browserSessionId,
            url: 'http://127.0.0.1:3000',
            label: 'MCP Preview',
          },
        },
      }),
    });
    expect(createBrowserPageResponse.status).toBe(200);
    const browserPageResult = await createBrowserPageResponse.json() as {
      result: {
        structuredContent: {
          page: { id: string; previewSurface: { kind: string; url?: string } };
        };
      };
    };
    expect(browserPageResult.result.structuredContent.page.previewSurface).toEqual(
      expect.objectContaining({
        kind: 'browser_page',
        url: 'http://127.0.0.1:3000',
      }),
    );
    const browserPageId = browserPageResult.result.structuredContent.page.id;

    const navigateBrowserPageResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 18,
        method: 'tools/call',
        params: {
          name: 'navigate_browser_page',
          arguments: {
            browserSessionId,
            browserPageId,
            url: 'http://127.0.0.1:4173',
            label: 'Attached Preview',
          },
        },
      }),
    });
    expect(navigateBrowserPageResponse.status).toBe(200);
    const navigatedPage = await navigateBrowserPageResponse.json() as {
      result: {
        structuredContent: {
          page: { id: string; label?: string; previewSurface: { kind: string; url?: string } };
          session: { inspection: { openPageCount: number; closedPageCount: number } };
        };
      };
    };
    expect(navigatedPage.result.structuredContent.page).toEqual(expect.objectContaining({
      id: browserPageId,
      label: 'Attached Preview',
      previewSurface: expect.objectContaining({
        kind: 'browser_page',
        url: 'http://127.0.0.1:4173',
      }),
    }));
    expect(navigatedPage.result.structuredContent.session.inspection).toEqual(
      expect.objectContaining({
        openPageCount: 1,
        closedPageCount: 0,
      }),
    );

    const listBrowserSessionsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: {
          name: 'list_browser_sessions',
          arguments: {
            runtimeSessionId: 'session-1',
          },
        },
      }),
    });
    expect(listBrowserSessionsResponse.status).toBe(200);
    const listedSessions = await listBrowserSessionsResponse.json() as {
      result: {
        structuredContent: {
          sessions: Array<{ id: string; inspection: { openPageCount: number } }>;
        };
      };
    };
    expect(listedSessions.result.structuredContent.sessions).toEqual([
      expect.objectContaining({
        id: browserSessionId,
        inspection: expect.objectContaining({
          openPageCount: 1,
        }),
      }),
    ]);

    const readBrowserSessionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 19.5,
        method: 'tools/call',
        params: {
          name: 'read_browser_session',
          arguments: {
            browserSessionId,
          },
        },
      }),
    });
    expect(readBrowserSessionResponse.status).toBe(200);
    const readBrowserSession = await readBrowserSessionResponse.json() as {
      result: {
        structuredContent: {
          browserSessionPath: string;
          createBrowserPagePath: string;
          closeBrowserSessionPath: string;
          session: {
            id: string;
            runtimeSessionId?: string;
            inspection: {
              openPageCount: number;
              closedPageCount: number;
            };
          };
        };
      };
    };
    expect(readBrowserSession.result.structuredContent.browserSessionPath).toBe(
      `/browser/sessions/${browserSessionId}`,
    );
    expect(readBrowserSession.result.structuredContent.createBrowserPagePath).toBe(
      `/browser/sessions/${browserSessionId}/pages`,
    );
    expect(readBrowserSession.result.structuredContent.closeBrowserSessionPath).toBe(
      `/browser/sessions/${browserSessionId}/close`,
    );
    expect(readBrowserSession.result.structuredContent.session).toEqual(expect.objectContaining({
      id: browserSessionId,
      runtimeSessionId: 'session-1',
      inspection: expect.objectContaining({
        openPageCount: 1,
        closedPageCount: 0,
      }),
    }));

    const closeBrowserPageResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'close_browser_page',
          arguments: {
            browserSessionId,
            browserPageId,
          },
        },
      }),
    });
    expect(closeBrowserPageResponse.status).toBe(200);
    const closedPage = await closeBrowserPageResponse.json() as {
      result: {
        structuredContent: {
          page: { status: string; previewSurface: { status: string } };
          session: { status: string; inspection: { openPageCount: number; closedPageCount: number } };
        };
      };
    };
    expect(closedPage.result.structuredContent.page).toEqual(expect.objectContaining({
      status: 'closed',
      previewSurface: expect.objectContaining({
        status: 'blocked',
      }),
    }));
    expect(closedPage.result.structuredContent.session).toEqual(expect.objectContaining({
      status: 'ready',
      inspection: expect.objectContaining({
        openPageCount: 0,
        closedPageCount: 1,
      }),
    }));

    const closeBrowserSessionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'close_browser_session',
          arguments: {
            browserSessionId,
          },
        },
      }),
    });
    expect(closeBrowserSessionResponse.status).toBe(200);
    const closed = await closeBrowserSessionResponse.json() as {
      result: {
        structuredContent: {
          session: { status: string };
        };
      };
    };
    expect(closed.result.structuredContent.session.status).toBe('closed');
  });

  it('rejects invalid list_sessions status filters with a machine-readable params error', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'list_sessions',
          arguments: {
            status: 'sleeping',
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 20,
      error: {
        code: -32602,
        message: 'status must be a valid session status',
      },
    });
  });

  it('rejects invalid audit_workspace enum values before reaching the substrate service', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'audit_workspace',
          arguments: {
            workspacePath: join(rootDir, 'workspace'),
            profile: 'banana',
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 21,
      error: {
        code: -32602,
        message: 'profile must be a valid workspace substrate profile',
      },
    });
  });
});
