import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { SessionSkillState } from '../core/types.js';
import { resolveRuntimeSkillManifest } from '../core/skills/catalog.js';

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

  function buildStoredSkillState(): SessionSkillState {
    return {
      requestedSkills: ['companion'],
      requestedSkillRefs: [{
        id: 'companion',
        slug: 'companion',
        requestedAs: 'companion',
      }],
      resolvedSkills: [{
        id: 'companion',
        slug: 'companion',
        title: 'Companion',
        description: 'Companion skill',
        status: 'resolved',
        source: 'runtime_catalog',
        sourcePath: 'skills/companion',
        entryFile: 'skills/companion/SKILL.md',
        fingerprint: 'companion-fingerprint',
      }],
      strict: false,
      delivery: {
        provider: 'codex',
        backend: 'cli',
        preferredMode: 'filesystem',
        mode: 'filesystem',
        status: 'applied',
        warnings: [],
        filesystem: {
          rootPath: join(rootDir, 'repo', '.agents', 'skills'),
          entryPaths: [join(rootDir, 'repo', '.agents', 'skills', 'companion', 'SKILL.md')],
        },
      },
      warnings: [],
      appliedSkillIds: ['companion'],
      updatedAt: '2026-03-23T00:00:00.000Z',
    };
  }

  function buildPiStoredSkillState(sessionId = 'pi-parent', cwd = join(rootDir, 'repo')) {
    return resolveRuntimeSkillManifest({
      requestedSkills: ['delivery-auditor'],
    }, {
      sessionId,
      providerName: 'pi',
      providerBackend: 'cli',
      cwd,
      workspaceMode: 'shared',
      sessionBaseDir,
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
    expect(body).toEqual(expect.objectContaining({
      hydration: expect.objectContaining({
        trigger: 'create',
        workspace: expect.objectContaining({
          runtimeCwd: body.cwd,
          sourceOfTruth: 'runtime_cwd',
        }),
        skills: expect.objectContaining({
          provider: 'codex',
          mode: 'filesystem',
        }),
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

  it('accepts structured requested skill refs and exposes applied skill state in observe inspection', async () => {
    const app = createTestApp();

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
        skills: {
          profileId: 'companion',
          requestedSkills: [{
            slug: 'companion',
          }],
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      id: string;
      skills: {
        requestedSkills: string[];
        requestedSkillRefs?: Array<{ id: string; slug: string }>;
      };
    };
    expect(body.skills).toEqual(expect.objectContaining({
      requestedSkills: ['companion'],
      requestedSkillRefs: [{
        id: 'companion',
        slug: 'companion',
        requestedAs: 'companion',
      }],
    }));

    const observeResponse = await app.request(`/sessions/${body.id}/observe`);
    expect(observeResponse.status).toBe(200);
    await expect(observeResponse.json()).resolves.toEqual(expect.objectContaining({
      session: expect.objectContaining({
        skills: expect.objectContaining({
          requestedSkillRefs: [expect.objectContaining({
            id: 'companion',
            slug: 'companion',
          })],
        }),
        inspection: expect.objectContaining({
          skills: expect.objectContaining({
            appliedSkillIds: ['companion'],
            resolvedSkills: [expect.objectContaining({
              id: 'companion',
              slug: 'companion',
            })],
          }),
        }),
      }),
    }));
  });

  it('persists companion hydration metadata into the session hydration contract', async () => {
    const app = createTestApp();
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

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
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

    expect(response.status).toBe(201);
    const body = await response.json() as {
      id: string;
      hydration: {
        metadata?: {
          companionSession?: {
            boxId?: string;
            channelContext?: { channelId?: string };
          };
        };
      };
    };

    expect(body.hydration.metadata?.companionSession).toEqual(expect.objectContaining({
      boxId: 'companion-box-1',
      channelContext: expect.objectContaining({
        channelId: 'channel-1',
      }),
    }));

    const historyResponse = await app.request(`/sessions/${body.id}/history`);
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

  it('uses skills:null to explicitly clear persisted skill state for messages and forks', async () => {
    const app = createTestApp();

    const session = registry.create({
      providerName: 'codex',
      providerBackend: 'cli',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'repo'),
      workspaceMode: 'shared',
      skills: buildStoredSkillState(),
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
        skills: null,
      }),
    });

    expect(messageResponse.status).toBe(200);
    expect(await messageResponse.text()).toContain('"type":"result"');
    expect(registry.get(session.id)?.skills).toBeUndefined();

    registry.setProviderSessionId(session.id, 'thread-parent');
    registry.updateStatus(session.id, 'closed');
    registry.updateSessionMetadata(session.id, {
      skills: buildStoredSkillState(),
    });

    const forkResponse = await app.request(`/sessions/${session.id}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skills: null,
      }),
    });

    expect(forkResponse.status).toBe(201);
    const forkBody = await forkResponse.json() as { skills?: unknown };
    expect(forkBody.skills).toBeUndefined();
  });

  it('rehydrates persisted Pi skills when forking into a Codex isolated workspace', async () => {
    const app = createTestApp();
    const parentSkills = buildPiStoredSkillState();

    const session = registry.create({
      providerName: 'pi',
      providerBackend: 'cli',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'repo'),
      workspaceMode: 'shared',
      skills: parentSkills,
    });
    registry.updateStatus(session.id, 'ready');

    const response = await app.request(`/sessions/${session.id}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        workspaceMode: 'isolated',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      cwd: string;
      skills: {
        requestedSkills: string[];
        delivery: {
          provider: string;
          backend: string;
          mode: string;
          filesystem?: { rootPath: string };
        };
      };
      hydration: {
        trigger: string;
        workspace: {
          runtimeCwd: string;
          sourceCwd?: string;
          sourceOfTruth: string;
        };
        skills: {
          source: string;
          provider: string;
          backend: string;
          mode: string;
        };
      };
    };

    expect(body.skills).toEqual(expect.objectContaining({
      requestedSkills: ['delivery-auditor'],
      delivery: expect.objectContaining({
        provider: 'codex',
        backend: 'cli',
        mode: 'filesystem',
      }),
    }));
    expect(body.skills.delivery.filesystem?.rootPath).toBe(join(body.cwd, '.agents', 'skills'));
    expect(body.hydration).toEqual(expect.objectContaining({
      trigger: 'fork',
      workspace: expect.objectContaining({
        runtimeCwd: body.cwd,
        sourceCwd: join(rootDir, 'repo'),
        sourceOfTruth: 'source_workspace',
      }),
      skills: expect.objectContaining({
        source: 'session_state',
        provider: 'codex',
        backend: 'cli',
        mode: 'filesystem',
      }),
    }));
  });
});
