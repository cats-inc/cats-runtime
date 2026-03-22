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
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { StreamEvent, TurnInput } from '../core/types.js';

function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function makeConfig(sessionBaseDir: string): CliRuntimeConfig {
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
    sessionBaseDir,
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
  };
}

function makeApp(
  sessionBaseDir: string,
  streamMessage: (turnInput: TurnInput) => AsyncGenerator<StreamEvent>,
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
    config: makeConfig(sessionBaseDir),
    registry,
    pool,
    cursorNative: {} as CursorNativeSessionService,
    kiroNative: {} as KiroNativeSessionService,
    auggieSessions: {} as AuggieSessionService,
    opencodeNative: {} as OpencodeNativeSessionService,
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
      expect(await historyResponse.json()).toEqual({
        artifacts: [],
        messages: [
          { role: 'user', text: 'hello', timestamp: expect.any(String) },
          { role: 'assistant', text: 'Partial reply before failure.', timestamp: expect.any(String) },
        ],
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
      expect(await historyResponse.json()).toEqual({
        artifacts: [],
        messages: [
          { role: 'user', text: 'hello', timestamp: expect.any(String) },
          { role: 'assistant', text: 'Partial reply before throw.', timestamp: expect.any(String) },
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('merges runtime-managed skill instructions into the turn input and session metadata', async () => {
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
      expect(receivedInputs[0].instructions).toContain('Base room instruction.');
      expect(receivedInputs[0].instructions).toContain('You are a companion');
      expect(receivedInputs[0].skills).toEqual(expect.objectContaining({
        profileId: 'companion',
        requestedSkills: ['companion'],
        appliedSkillIds: ['companion'],
      }));

      expect(registry.get(session.id)?.instructions).toBe('Base room instruction.');
      expect(registry.get(session.id)?.skills).toEqual(expect.objectContaining({
        profileId: 'companion',
        requestedSkills: ['companion'],
        appliedSkillIds: ['companion'],
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
