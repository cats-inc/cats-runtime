import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { ProviderModelCatalogService } from '../core/models/providerModelCatalog.js';
import type { StreamEvent, TurnInput } from '../core/types.js';
import { createRuntimeStartupState } from '../startup.js';
import { parseCoreNdjson as parseNdjson } from '../../tests/streamEventTestUtils.js';

function makeConfig(
  sessionBaseDir: string,
  metering?: CliRuntimeConfig['metering'],
  dashboardShowSessionDetails = false,
): CliRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3100,
    apiKey: '',
    auggieMaxTurns: 10,
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
    opencodeServerStartupTimeoutMs: 10000,
    auggieSessionsDir: '~/.augment/sessions',
    claudeProjectsDir: '',
    codexSessionsDir: '',
    copilotSessionsDir: '',
    cursorChatsDir: '~/.cursor/chats',
    cursorRuntime: {
      mode: 'wsl',
      distro: 'Ubuntu',
    },
    geminiSessionsDir: '',
    kiroDbPath: '~/.local/share/kiro-cli/data.sqlite3',
    kiroRuntime: {
      mode: 'wsl',
      distro: 'Ubuntu',
    },
    nativeDiscoveryIntervalMs: 5000,
    externalSessionLiveWindowMs: 15000,
    maxSessions: 10,
    spawnRetries: 1,
    spawnTimeoutMs: 30000,
    sessionBaseDir,
    metering,
    dashboardShowSessionDetails,
    providerCommands: {
      auggie: { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } },
      claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
      copilot: { path: 'copilot', runner: 'auto', runtime: { mode: 'native' } },
      cursor: { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'wsl', distro: 'Ubuntu' } },
      gemini: { path: 'gemini', runner: 'auto', runtime: { mode: 'native' } },
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'wsl', distro: 'Ubuntu' } },
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
    },
  } as unknown as CliRuntimeConfig;
}

function makeApp(
  sessionBaseDir: string,
  streamMessage: (turnInput: TurnInput) => AsyncGenerator<StreamEvent>,
  metering?: CliRuntimeConfig['metering'],
  dashboardShowSessionDetails = false,
) {
  const registry = new SessionRegistry();
  const worker = {
    alive: true,
    busy: false,
    streamMessage,
  };
  const pool = {
    getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
    get: vi.fn(() => worker),
    spawn: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    status: vi.fn(() => ({
      active: 1,
      busy: 0,
      idle: 1,
      providers: { claude: 1 },
    })),
  } as unknown as WorkerPool;

  const app = createApp({
    config: makeConfig(sessionBaseDir, metering, dashboardShowSessionDetails),
    startup: createRuntimeStartupState(),
    registry,
    pool,
    cursorNative: {} as CursorNativeSessionService,
    gooseNative: {} as GooseNativeSessionService,
    kiroNative: {} as KiroNativeSessionService,
    auggieSessions: {} as AuggieSessionService,
    opencodeNative: {} as OpencodeNativeSessionService,
    providerModelCatalog: {} as ProviderModelCatalogService,
  });

  const session = registry.create({
    id: 'session-1',
    providerName: 'claude',
    cwd: join(sessionBaseDir, 'repo'),
  });
  registry.updateStatus(session.id, 'ready');

  return { app, registry, session, worker };
}

describe('message route transcript persistence', () => {
  it('persists the latest user input preview into session metadata and session list payloads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, registry, session } = makeApp(sessionBaseDir, async function* () {
        yield { type: 'text', text: 'Stored.' };
        yield { type: 'result' };
      });
      const message = [
        'Investigate why the dashboard sidebar title is stale after sending a message.',
        'Include the persistence boundary in the explanation.',
      ].join('\n\n');

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'text', text: 'Stored.' },
        { type: 'result' },
      ]);

      expect(registry.get(session.id)?.lastInputPreview).toBe(
        'Investigate why the dashboard sidebar title is stale after sending a message. Include the persistence boundary in the explanation.',
      );

      const sessionsResponse = await app.request('/sessions');
      expect(sessionsResponse.status).toBe(200);
      await expect(sessionsResponse.json()).resolves.toEqual(expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({
            id: session.id,
            lastInputPreview: 'Investigate why the dashboard sidebar title is stale after sending a message. Include the persistence boundary in the explanation.',
          }),
        ]),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flushes assistant text when a worker emits an error event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, session } = makeApp(sessionBaseDir, async function* () {
        yield { type: 'text', text: 'Partial reply before failure.' };
        yield { type: 'error', text: 'Synthetic provider error' };
      });

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'text', text: 'Partial reply before failure.' },
        { type: 'error', text: 'Synthetic provider error' },
      ]);

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      const historyBody = await historyResponse.json();
      expect(historyBody).toMatchObject({
        artifacts: [],
        messages: [
          { role: 'user', text: 'hello', timestamp: expect.any(String) },
          { role: 'assistant', text: 'Partial reply before failure.', timestamp: expect.any(String) },
        ],
      });
      expect(historyBody.inspection).toMatchObject({
        state: 'idle',
        lastRun: {
          status: 'failed',
          error: 'Synthetic provider error',
          inputPreview: 'hello',
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flushes assistant text when the worker stream throws after yielding text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, session } = makeApp(sessionBaseDir, async function* () {
        yield { type: 'text', text: 'Partial reply before throw.' };
        throw new Error('Synthetic thrown failure');
      });

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'text', text: 'Partial reply before throw.' },
        { type: 'error', text: 'Error: Synthetic thrown failure' },
      ]);

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      const historyBody = await historyResponse.json();
      expect(historyBody).toMatchObject({
        artifacts: [],
        messages: [
          { role: 'user', text: 'hello', timestamp: expect.any(String) },
          { role: 'assistant', text: 'Partial reply before throw.', timestamp: expect.any(String) },
        ],
      });
      expect(historyBody.inspection).toMatchObject({
        state: 'idle',
        lastRun: {
          status: 'failed',
          error: 'Error: Synthetic thrown failure',
          inputPreview: 'hello',
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists runtime-managed skill metadata into the turn input and session metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    const receivedInputs: TurnInput[] = [];

    try {
      const { app, registry, session } = makeApp(
        sessionBaseDir,
        async function* (turnInput: TurnInput) {
          receivedInputs.push(structuredClone(turnInput));
          yield { type: 'text', text: 'Warm reply.' };
          yield { type: 'result' };
        },
      );

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello',
          instructions: 'Base room instruction.',
          skills: {
            profileId: 'companion',
            requestedSkills: ['companion'],
            context: {
              catId: 'cat-1',
              roomMode: 'direct_cat_chat',
              transport: 'web',
              labels: ['participant:cat'],
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'text', text: 'Warm reply.' },
        { type: 'result' },
      ]);

      expect(receivedInputs).toHaveLength(1);
      expect(receivedInputs[0].sessionInstructions).toBeUndefined();
      expect(receivedInputs[0].instructions).toBe('Base room instruction.');
      expect(receivedInputs[0].skills).toEqual(expect.objectContaining({
        profileId: 'companion',
        requestedSkills: ['companion'],
        context: {
          catId: 'cat-1',
          roomMode: 'direct_cat_chat',
          transport: 'web',
          labels: ['participant:cat'],
        },
        delivery: expect.objectContaining({
          mode: 'instructions',
          status: 'applied',
        }),
        appliedSkillIds: ['companion'],
      }));

      expect(registry.get(session.id)?.instructions).toBe('Base room instruction.');
      expect(registry.get(session.id)?.skills).toEqual(expect.objectContaining({
        profileId: 'companion',
        requestedSkills: ['companion'],
        context: {
          catId: 'cat-1',
          roomMode: 'direct_cat_chat',
          transport: 'web',
          labels: ['participant:cat'],
        },
        delivery: expect.objectContaining({
          mode: 'instructions',
          status: 'applied',
        }),
        appliedSkillIds: ['companion'],
      }));

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      await expect(historyResponse.json()).resolves.toEqual(expect.objectContaining({
        skills: expect.objectContaining({
          requestedSkills: ['companion'],
          delivery: expect.objectContaining({
            mode: 'instructions',
            status: 'applied',
          }),
        }),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns composed effective session instructions in history when dashboard display is enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, session } = makeApp(
        sessionBaseDir,
        async function* () {
          yield { type: 'result' };
        },
        undefined,
        true,
      );

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello',
          instructions: 'Base room instruction.',
          skills: {
            profileId: 'companion',
            requestedSkills: ['companion'],
            context: {
              catId: 'cat-1',
              roomMode: 'direct_cat_chat',
              transport: 'web',
              labels: ['participant:cat'],
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'result' },
      ]);

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      const historyBody = await historyResponse.json();
      expect(historyBody).toEqual(expect.objectContaining({
        sessionDetailsEnabled: true,
        instructions: expect.stringContaining(
          'The following runtime-managed skills are attached to this session.',
        ),
      }));
      expect(historyBody.instructions).toContain('Runtime Skill: Companion (companion)');
      expect(historyBody.instructions).toContain('Base room instruction.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns explicit null instructions in history when dashboard display is enabled but the session has none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, session } = makeApp(
        sessionBaseDir,
        async function* () {
          yield { type: 'result' };
        },
        undefined,
        true,
      );

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      const historyBody = await historyResponse.json();
      expect(historyBody).toEqual(expect.objectContaining({
        sessionDetailsEnabled: true,
        instructions: null,
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('omits instructions from history when dashboard session details are disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, session } = makeApp(
        sessionBaseDir,
        async function* () {
          yield { type: 'result' };
        },
      );

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      const historyBody = await historyResponse.json();
      expect(historyBody).toEqual(expect.objectContaining({
        sessionDetailsEnabled: false,
      }));
      expect('instructions' in historyBody).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists additive strategy metadata into turn input, session inspection, and history metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    const receivedInputs: TurnInput[] = [];

    try {
      const { app, registry, session } = makeApp(
        sessionBaseDir,
        async function* (turnInput: TurnInput) {
          receivedInputs.push(structuredClone(turnInput));
          yield { type: 'text', text: 'Strategy metadata stored.' };
          yield { type: 'result' };
        },
      );

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello',
          requestedStrategy: 'react',
          acceptanceCriteria: 'Return a concise answer.',
          strategyContext: {
            maxSteps: 3,
            timeoutMs: 1200,
          },
          correlation: {
            traceId: 'trace-message-route-1',
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'text', text: 'Strategy metadata stored.' },
        { type: 'result' },
      ]);

      expect(receivedInputs).toHaveLength(1);
      expect(receivedInputs[0]).toEqual(expect.objectContaining({
        message: 'hello',
        requestedStrategy: 'react',
        acceptanceCriteria: 'Return a concise answer.',
        strategyContext: {
          maxSteps: 3,
          timeoutMs: 1200,
        },
        correlation: {
          traceId: 'trace-message-route-1',
        },
      }));

      expect(registry.get(session.id)).toMatchObject({
        strategy: {
          request: {
            requestedStrategy: 'react',
            acceptanceCriteria: 'Return a concise answer.',
            strategyContext: {
              maxSteps: 3,
              timeoutMs: 1200,
            },
            correlation: {
              traceId: 'trace-message-route-1',
            },
          },
        },
      });

      const sessionResponse = await app.request(`/sessions/${session.id}`);
      expect(sessionResponse.status).toBe(200);
      await expect(sessionResponse.json()).resolves.toEqual(expect.objectContaining({
        requestedStrategy: 'react',
        acceptanceCriteria: 'Return a concise answer.',
        strategyContext: {
          maxSteps: 3,
          timeoutMs: 1200,
        },
        correlation: {
          traceId: 'trace-message-route-1',
        },
        inspection: expect.objectContaining({
          strategy: expect.objectContaining({
            requestedStrategy: 'react',
            acceptanceCriteria: 'Return a concise answer.',
            strategyContext: {
              maxSteps: 3,
              timeoutMs: 1200,
            },
            correlation: {
              traceId: 'trace-message-route-1',
            },
            state: expect.objectContaining({
              request: expect.objectContaining({
                requestedStrategy: 'react',
              }),
            }),
          }),
        }),
      }));

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      await expect(historyResponse.json()).resolves.toEqual(expect.objectContaining({
        requestedStrategy: 'react',
        acceptanceCriteria: 'Return a concise answer.',
        strategyContext: {
          maxSteps: 3,
          timeoutMs: 1200,
        },
        correlation: {
          traceId: 'trace-message-route-1',
        },
        inspection: expect.objectContaining({
          strategy: expect.objectContaining({
            requestedStrategy: 'react',
            acceptanceCriteria: 'Return a concise answer.',
            strategyContext: {
              maxSteps: 3,
              timeoutMs: 1200,
            },
            correlation: {
              traceId: 'trace-message-route-1',
            },
          }),
        }),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves previous session instructions separately from new turn instructions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    const receivedInputs: TurnInput[] = [];

    try {
      const { app, registry, session } = makeApp(
        sessionBaseDir,
        async function* (turnInput: TurnInput) {
          receivedInputs.push(structuredClone(turnInput));
          yield { type: 'result' };
        },
      );
      registry.updateSessionMetadata(session.id, {
        instructions: 'Session default instruction.',
      });

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello',
          instructions: 'Turn override instruction.',
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'result' },
      ]);
      expect(receivedInputs).toHaveLength(1);
      expect(receivedInputs[0]).toEqual(expect.objectContaining({
        message: 'hello',
        sessionInstructions: 'Session default instruction.',
        instructions: 'Turn override instruction.',
      }));
      expect(registry.get(session.id)?.instructions).toBe('Turn override instruction.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hydrates companion metadata into session state during skill mutations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    const receivedInputs: TurnInput[] = [];
    const companionSession = {
      catId: 'cat-1',
      boxId: 'companion-box-1',
      hydratedAt: '2026-03-23T12:00:00.000Z',
      requestedSkills: ['companion'],
      sourceIds: ['source-1'],
      derivedIds: [],
      memoryIds: [],
      responseProfile: {
        expressionMode: 'animalistic',
        outputMode: 'text',
        voiceProfileId: null,
        notes: 'Keep replies warm.',
        updatedAt: '2026-03-23T11:59:00.000Z',
      },
      sources: [],
      derived: [],
      memory: [],
      ownerNotes: ['Keep replies warm.'],
      constraints: ['channel:Companion lane'],
      channelContext: {
        channelId: 'channel-1',
        roomMode: 'direct_cat_chat',
        transport: 'web',
      },
    };

    try {
      const { app, registry, session } = makeApp(
        sessionBaseDir,
        async function* (turnInput: TurnInput) {
          receivedInputs.push(structuredClone(turnInput));
          yield { type: 'result' };
        },
      );

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello companion',
          context: {
            source: 'interactive',
            metadata: {
              companionSession,
            },
          },
          skills: {
            profileId: 'companion',
            requestedSkills: ['companion'],
            context: {
              catId: 'cat-1',
              roomMode: 'direct_cat_chat',
              transport: 'web',
              metadata: {
                companionSession,
              },
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        { type: 'result' },
      ]);
      expect(receivedInputs).toHaveLength(1);
      expect(receivedInputs[0].context?.metadata).toEqual(expect.objectContaining({
        companionSession: expect.objectContaining({
          boxId: 'companion-box-1',
        }),
      }));

      expect(registry.get(session.id)?.hydration).toEqual(expect.objectContaining({
        trigger: 'message',
        metadata: expect.objectContaining({
          companionSession: expect.objectContaining({
            boxId: 'companion-box-1',
            channelContext: expect.objectContaining({
              channelId: 'channel-1',
            }),
          }),
        }),
      }));

      const historyResponse = await app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      await expect(historyResponse.json()).resolves.toEqual(expect.objectContaining({
        hydration: expect.objectContaining({
          metadata: expect.objectContaining({
            companionSession: expect.objectContaining({
              boxId: 'companion-box-1',
            }),
          }),
        }),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits a guardrail warning progress event before execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, registry, session } = makeApp(
        sessionBaseDir,
        async function* () {
          yield { type: 'result' };
        },
        {
          sessionTotalTokensWarn: 10,
          rateLimitCooldownMs: 60000,
        },
      );
      registry.recordMessage(session.id, 7, 5);
      registry.updateStatus(session.id, 'ready');

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'hello again' }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'guardrail',
            guardrail: expect.objectContaining({
              outcome: 'warned',
              scope: 'session',
            }),
          }),
        }),
        { type: 'result' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks execution when the session exceeds the hard token limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    const streamMessage = vi.fn(async function* () {
      yield { type: 'result' };
    });

    try {
      const { app, registry, session } = makeApp(
        sessionBaseDir,
        streamMessage,
        {
          sessionTotalTokensBlock: 10,
          rateLimitCooldownMs: 60000,
        },
      );
      registry.recordMessage(session.id, 6, 5);
      registry.updateStatus(session.id, 'ready');

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'blocked turn' }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: expect.stringContaining('hard limit'),
        code: 'guardrail_blocked',
        guardrail: expect.objectContaining({
          outcome: 'blocked',
          scope: 'session',
          metric: 'total_tokens',
        }),
      });
      expect(streamMessage).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records cooldown incidents and exposes them through diagnostics/runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    const streamMessage = vi.fn(async function* () {
      yield { type: 'error', text: '429 Too Many Requests. Retry after 2s.' };
    });

    try {
      const { app, session } = makeApp(
        sessionBaseDir,
        streamMessage,
        {
          rateLimitCooldownMs: 5000,
        },
      );

      const firstResponse = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'first try' }),
      });

      expect(firstResponse.status).toBe(200);
      expect(parseNdjson(await firstResponse.text())).toEqual([
        expect.objectContaining({
          type: 'error',
          metadata: expect.objectContaining({
            incident: expect.objectContaining({
              classification: 'rate_limited',
            }),
            guardrail: expect.objectContaining({
              outcome: 'cooldown',
            }),
          }),
        }),
      ]);

      const diagnosticsResponse = await app.request('/diagnostics/runtime');
      expect(diagnosticsResponse.status).toBe(200);
      expect(await diagnosticsResponse.json()).toEqual(expect.objectContaining({
        metering: expect.objectContaining({
          summary: expect.objectContaining({
            status: 'degraded',
            incidents: 1,
            activeCooldowns: 1,
          }),
          incidents: expect.objectContaining({
            recent: [
              expect.objectContaining({
                classification: 'rate_limited',
              }),
            ],
          }),
        }),
      }));

      const secondResponse = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'second try' }),
      });

      expect(secondResponse.status).toBe(429);
      expect(await secondResponse.json()).toEqual({
        error: expect.stringContaining('cooled down'),
        code: 'guardrail_cooldown',
        guardrail: expect.objectContaining({
          outcome: 'cooldown',
          scope: 'provider_instance',
        }),
      });
      expect(streamMessage).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves provider refusal metadata and incident hints in streamed error output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-message-route-'));
    const sessionBaseDir = join(root, 'sessions');
    mkdirSync(sessionBaseDir, { recursive: true });

    try {
      const { app, session } = makeApp(sessionBaseDir, async function* () {
        yield {
          type: 'error',
          text: "Gemini has no capacity available for model 'gemini-3.1-pro-preview'.",
          metadata: {
            providerRefusal: {
              category: 'capacity_exhausted',
              message: "Gemini has no capacity available for model 'gemini-3.1-pro-preview'.",
              statusCode: 429,
              retryable: true,
              source: 'stderr',
              evidenceSummary: 'MODEL_CAPACITY_EXHAUSTED',
            },
            incidentHint: {
              classification: 'rate_limited',
              statusCode: 429,
              evidenceSummary: 'MODEL_CAPACITY_EXHAUSTED',
              metadata: {
                refusalCategory: 'capacity_exhausted',
              },
            },
          },
        };
      }, {
        rateLimitCooldownMs: 5000,
      });

      const response = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        expect.objectContaining({
          type: 'error',
          text: "Gemini has no capacity available for model 'gemini-3.1-pro-preview'.",
          metadata: expect.objectContaining({
            providerRefusal: expect.objectContaining({
              category: 'capacity_exhausted',
              statusCode: 429,
            }),
            incidentHint: expect.objectContaining({
              classification: 'rate_limited',
              statusCode: 429,
            }),
            incident: expect.objectContaining({
              classification: 'rate_limited',
            }),
            guardrail: expect.objectContaining({
              outcome: 'cooldown',
            }),
          }),
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
