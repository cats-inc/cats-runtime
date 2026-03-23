import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { RuntimeWakeupService } from '../core/wakeup/RuntimeWakeupService.js';

describe('wakeup HTTP contract', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let wakeup: RuntimeWakeupService;
  let wakeSession: ReturnType<typeof vi.fn>;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3100,
      apiKey: '',
      sessionBaseDir,
      dataDir,
      auggiePath: 'auggie',
      claudePath: 'claude',
      codexPath: 'codex',
      copilotPath: 'copilot',
      cursorPath: 'cursor-agent',
      geminiPath: 'gemini',
      kiroPath: 'kiro-cli',
      opencodePath: 'opencode',
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
      nativeDiscoveryIntervalMs: 0,
      externalSessionLiveWindowMs: 0,
      maxSessions: 10,
      providerCommands: {
        auggie: { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } },
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
        codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
        copilot: { path: 'copilot', runner: 'auto', runtime: { mode: 'native' } },
        cursor: { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'native' } },
        gemini: { path: 'gemini', runner: 'auto', runtime: { mode: 'native' } },
        kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
        opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
      },
    } as unknown as CliRuntimeConfig;
  }

  function createTestApp() {
    return createApp({
      config: makeConfig(),
      registry,
      pool,
      wakeup,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog: {} as never,
      compatibility: {} as never,
      startup: {
        contractVersion: 1,
        diagnosticsVersion: 1,
        mode: 'standalone',
        phase: 'ready',
        readySignal: 'http',
        startedAt: '2026-03-23T00:00:00.000Z',
        pid: 123,
        lastEvent: undefined,
      } as never,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-wakeup-http-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    registry = new SessionRegistry();
    registry.create({
      id: 'session-1',
      providerName: 'claude',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: join(rootDir, 'repo'),
    });

    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
    wakeSession = vi.fn(async (sessionId: string) => ({
      sessionId,
      outcome: 'resumed' as const,
    }));
    wakeup = new RuntimeWakeupService({
      persistPath: join(dataDir, 'wakeups.json'),
      sessionExists: (sessionId) => registry.get(sessionId) !== undefined,
      wakeSession,
    });
  });

  afterEach(() => {
    wakeup.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates, cancels, and manually triggers wakeups while surfacing additive session/history/observe metadata', async () => {
    const app = createTestApp();

    const createResponse = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Wake the chat.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:05:00.000Z',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      request: { id: string; status: string };
      coalesced: boolean;
    };
    expect(created.coalesced).toBe(false);
    expect(created.request.status).toBe('scheduled');

    const inspectResponse = await app.request(`/wakeups/${created.request.id}`);
    expect(inspectResponse.status).toBe(200);
    await expect(inspectResponse.json()).resolves.toEqual({
      request: expect.objectContaining({
        id: created.request.id,
        reason: 'Wake the chat.',
        status: 'scheduled',
      }),
    });

    const cancelResponse = await app.request(`/wakeups/${created.request.id}/cancel`, {
      method: 'POST',
    });
    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toEqual({
      request: expect.objectContaining({
        id: created.request.id,
        status: 'cancelled',
      }),
    });

    const secondResponse = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Wake it now.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:06:00.000Z',
        metadata: {
          source: 'chat-open',
        },
      }),
    });
    const second = await secondResponse.json() as {
      request: { id: string };
    };

    const triggerResponse = await app.request(`/wakeups/${second.request.id}/trigger`, {
      method: 'POST',
    });
    expect(triggerResponse.status).toBe(200);
    await expect(triggerResponse.json()).resolves.toEqual({
      request: expect.objectContaining({
        id: second.request.id,
        status: 'triggered',
        lastExecution: expect.objectContaining({
          source: 'manual',
          sessionId: 'session-1',
          outcome: 'resumed',
        }),
      }),
    });
    expect(wakeSession).toHaveBeenCalledTimes(1);

    const sessionResponse = await app.request('/sessions/session-1');
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual(expect.objectContaining({
      id: 'session-1',
      wakeup: expect.objectContaining({
        pending: false,
        pendingRequestCount: 0,
        lastRequest: expect.objectContaining({
          id: second.request.id,
          status: 'triggered',
        }),
      }),
    }));

    const historyResponse = await app.request('/sessions/session-1/history');
    expect(historyResponse.status).toBe(200);
    await expect(historyResponse.json()).resolves.toEqual(expect.objectContaining({
      messages: [],
      wakeup: expect.objectContaining({
        pending: false,
        lastRequest: expect.objectContaining({
          id: second.request.id,
          status: 'triggered',
        }),
      }),
    }));

    const observeResponse = await app.request('/sessions/session-1/observe');
    expect(observeResponse.status).toBe(200);
    await expect(observeResponse.json()).resolves.toEqual(expect.objectContaining({
      session: expect.objectContaining({
        id: 'session-1',
        wakeup: expect.objectContaining({
          pending: false,
          lastRequest: expect.objectContaining({
            id: second.request.id,
            status: 'triggered',
          }),
        }),
      }),
    }));
  });

  it('coalesces explicit duplicate wakeups and rejects unkeyed duplicates', async () => {
    const app = createTestApp();

    const first = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Wake room.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:05:00.000Z',
        coalesceKey: 'room-1',
      }),
    });
    const firstBody = await first.json() as {
      request: { id: string };
      coalesced: boolean;
    };

    const second = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Wake room sooner.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:04:00.000Z',
        coalesceKey: 'room-1',
      }),
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({
      request: expect.objectContaining({
        id: firstBody.request.id,
        reason: 'Wake room sooner.',
        scheduleAt: '2026-03-23T00:04:00.000Z',
        coalescedCount: 1,
      }),
      coalesced: true,
    });

    const duplicate = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Duplicate wake.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:10:00.000Z',
      }),
    });
    expect(duplicate.status).toBe(201);

    const rejected = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Duplicate wake.',
        target: {
          kind: 'session',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:10:00.000Z',
      }),
    });
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toEqual({
      error: 'A matching scheduled wakeup already exists. Use coalesceKey to merge duplicate wakeups.',
    });
  });

  it('rejects unsupported wakeup targets instead of silently coercing them', async () => {
    const app = createTestApp();

    const response = await app.request('/wakeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Wake something invalid.',
        target: {
          kind: 'room',
          sessionId: 'session-1',
        },
        scheduleAt: '2026-03-23T00:10:00.000Z',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'target.kind must be \'session\'.',
    });
  });

  it('returns 404 when inspecting an unknown wakeup request id', async () => {
    const app = createTestApp();

    const response = await app.request('/wakeups/missing-request');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Wakeup request 'missing-request' was not found.",
    });
  });
});
