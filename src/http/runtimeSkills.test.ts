import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';

describe('runtime-managed skills HTTP contract', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let piSessionsDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3100,
      apiKey: '',
      sessionBaseDir,
      codexPath: 'codex',
      piPath: 'pi',
      providerCommands: {
        codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
        pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: {
        codex: 'default',
        pi: 'default',
      },
      providerInstances: {
        codex: {
          default: {
            id: 'default',
            providerName: 'codex',
            commandConfig: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
          },
        },
        pi: {
          default: {
            id: 'default',
            providerName: 'pi',
            commandConfig: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
            piSessionsDir,
          },
        },
      },
      maxSessions: 10,
    } as unknown as CliRuntimeConfig;
  }

  function createTestApp() {
    return createApp({
      config: makeConfig(),
      registry,
      pool,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-http-skills-'));
    sessionBaseDir = join(rootDir, 'sessions');
    piSessionsDir = join(rootDir, 'pi-sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(piSessionsDir, { recursive: true });
    mkdirSync(join(rootDir, 'repo'), { recursive: true });

    registry = new SessionRegistry();
    pool = {
      getCapabilities: vi.fn((provider: string) => {
        if (provider === 'pi') {
          return { resume: true, fork: false, permissions: false };
        }
        return { resume: true, fork: true, permissions: true };
      }),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates a Codex session with filesystem-delivered runtime skills and exposes them in history', async () => {
    const app = createTestApp();

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
        skills: {
          requestedSkills: ['companion', 'repo-maintainer'],
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      id: string;
      cwd: string;
      skills: {
        appliedSkillIds: string[];
        delivery: {
          mode: string;
          filesystem?: { rootPath: string };
        };
      };
    };
    expect(body.skills).toEqual(expect.objectContaining({
      appliedSkillIds: ['companion', 'repo-maintainer'],
      delivery: expect.objectContaining({
        mode: 'filesystem',
      }),
    }));
    expect(body.skills.delivery.filesystem?.rootPath).toBe(join(body.cwd, '.agents', 'skills'));

    const historyResponse = await app.request(`/sessions/${body.id}/history`);
    expect(historyResponse.status).toBe(200);
    await expect(historyResponse.json()).resolves.toEqual(expect.objectContaining({
      messages: [],
      skills: expect.objectContaining({
        appliedSkillIds: ['companion', 'repo-maintainer'],
        delivery: expect.objectContaining({
          mode: 'filesystem',
        }),
      }),
    }));
  });

  it('creates a Pi session with an instruction-file skill delivery contract', async () => {
    const app = createTestApp();

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'pi',
        cwd: join(rootDir, 'repo'),
        workspaceMode: 'shared',
        skills: {
          requestedSkills: ['delivery-auditor'],
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      skills: {
        delivery: {
          mode: string;
          instructions?: { filePath?: string };
        };
      };
    };
    expect(body.skills.delivery.mode).toBe('instructions');
    const instructionsFile = body.skills.delivery.instructions?.filePath;
    expect(instructionsFile).toBeTruthy();
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      expect.any(String),
      'pi',
      expect.objectContaining({
        instructionsFile,
      }),
      undefined,
    );
  });

  it('rejects unknown skills during session creation', async () => {
    const app = createTestApp();

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
        skills: {
          requestedSkills: ['missing-skill'],
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown runtime skill 'missing-skill'.",
    });
  });

  it('rejects malformed skill payloads and treats empty requestedSkills as a no-op', async () => {
    const app = createTestApp();

    const createResponse = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
        skills: 'bad-payload',
      }),
    });

    expect(createResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toEqual({
      error: 'skills must be an object with requestedSkills.',
    });

    const emptyCreateResponse = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
        skills: {
          requestedSkills: [],
        },
      }),
    });

    expect(emptyCreateResponse.status).toBe(201);
    const emptyCreateBody = await emptyCreateResponse.json() as { skills?: unknown };
    expect(emptyCreateBody.skills).toBeUndefined();

    const session = registry.create({
      providerName: 'codex',
      providerBackend: 'cli',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'repo'),
    });
    registry.updateStatus(session.id, 'ready');

    const messageWorker = {
      alive: true,
      busy: false,
      streamMessage: async function* () {
        yield { type: 'result' as const };
      },
    };
    vi.mocked(pool.get).mockReturnValue(messageWorker as never);

    const messageResponse = await app.request(`/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        message: 'hello',
        skills: {
          requestedSkills: [],
        },
      }),
    });

    expect(messageResponse.status).toBe(200);
    expect(await messageResponse.text()).toContain('"type":"result"');
    expect(registry.get(session.id)?.skills).toBeUndefined();
  });
});
