import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { resolvePiResumeTarget } from '../backends/cli/pi/resume.js';
import { resolveRuntimeSkillManifest } from '../core/skills/catalog.js';

function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('Pi session management', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let piSessionsDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let app: ReturnType<typeof createApp>;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3100,
      apiKey: '',
      sessionBaseDir,
      piPath: 'pi',
      piSessionsDir,
      providerCommands: {
        pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: {
        pi: 'default',
      },
      providerInstances: {
        pi: {
          default: {
            id: 'default',
            providerName: 'pi',
            commandConfig: {
              path: 'pi',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
            piSessionsDir,
          },
        },
      },
    } as unknown as CliRuntimeConfig;
  }

  function createTestApp(): ReturnType<typeof createApp> {
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
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-pi-management-'));
    sessionBaseDir = join(rootDir, 'sessions');
    piSessionsDir = join(rootDir, 'pi-sessions');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(piSessionsDir, { recursive: true });

    registry = new SessionRegistry();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: false, permissions: false })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;

    app = createTestApp();
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('resumes discovered Pi sessions via their discovered session file path', async () => {
    const sourcePath = join(piSessionsDir, 'workspace', 'session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(sourcePath, '');

    const session = registry.upsertDiscovered('pi-123', {
      providerName: 'pi',
      cwd: 'C:/repo',
      sourcePath,
      messageCount: 1,
    });
    const expectedResumePath = resolvePiResumeTarget(
      makeConfig(),
      session!,
      process.platform,
    ).runtimeSourcePath;

    const res = await app.request(`/sessions/${session!.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session!.id,
      'pi',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSourcePath: expectedResumePath,
      }),
      undefined,
    );
  });

  it('rejects Pi resume when discovery has not attached a session file path yet', async () => {
    const session = registry.upsertDiscovered('pi-123', {
      providerName: 'pi',
      cwd: 'C:/repo',
      messageCount: 1,
    });

    const res = await app.request(`/sessions/${session!.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringContaining('Pi resume requires a discovered session file path'),
    });
  });

  it('retries a Pi turn once with a fresh worker when the saved session is unknown', async () => {
    const sourcePath = join(piSessionsDir, 'workspace', 'session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(sourcePath, '');

    const session = registry.upsertDiscovered('pi-stale', {
      providerName: 'pi',
      cwd: 'C:/repo',
      sourcePath,
      messageCount: 1,
    });
    registry.updateStatus(session!.id, 'ready');

    const staleWorker = {
      alive: true,
      busy: false,
      streamMessage: async function* () {
        throw new Error(
          'Process exited with code 1 before responding. stderr: unknown session pi-stale',
        );
      },
    };
    const freshWorker = {
      alive: true,
      busy: false,
      streamMessage: async function* () {
        yield { type: 'text', text: 'Recovered reply' };
        yield { type: 'result' };
      },
    };

    let currentWorker: typeof staleWorker | typeof freshWorker | undefined = staleWorker;
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: false, permissions: false })),
      get: vi.fn(() => currentWorker as never),
      spawn: vi.fn(() => {
        currentWorker = freshWorker;
        return freshWorker as never;
      }),
      kill: vi.fn(() => {
        currentWorker = undefined;
      }),
      status: vi.fn(() => ({ active: currentWorker ? 1 : 0, busy: 0, idle: 1, providers: { pi: 1 } })),
    } as unknown as WorkerPool;
    app = createTestApp();

    const response = await app.request(`/sessions/${session!.id}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(response.status).toBe(200);
    expect(parseNdjson(await response.text())).toEqual([
      { type: 'text', text: 'Recovered reply' },
      { type: 'result' },
    ]);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session!.id,
      'pi',
      expect.objectContaining({
        cwd: 'C:/repo',
      }),
      undefined,
    );
    expect((vi.mocked(pool.spawn).mock.calls[0] || [])[2]).not.toHaveProperty('resumeSourcePath');

    const stored = registry.get(session!.id)!;
    expect(stored.providerSessionId).toBeUndefined();
    expect(stored.providerSourcePath).toBeUndefined();
    expect(stored.sourcePath).toContain(join(sessionBaseDir, 'history'));

    const historyResponse = await app.request(`/sessions/${session!.id}/history`);
    expect(historyResponse.status).toBe(200);
    const historyBody = await historyResponse.json();
    expect(historyBody).toMatchObject({
      transcript: {
        ownership: 'runtime',
        source: 'jsonl',
        parser: 'generic_jsonl',
      },
      artifacts: [],
      messages: [
        { role: 'user', text: 'hello', timestamp: expect.any(String) },
        { role: 'assistant', text: 'Recovered reply', timestamp: expect.any(String) },
      ],
    });
    expect(historyBody.inspection).toMatchObject({
      state: 'idle',
      lastRun: {
        status: 'succeeded',
        inputPreview: 'hello',
      },
    });
  });

  it('parses Pi-native transcript history and surfaces transcript metadata', async () => {
    const sourcePath = join(piSessionsDir, 'workspace', 'session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(sourcePath, [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-23T00:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Review the patch.' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-23T00:00:02.000Z',
        stopReason: 'stop',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'checking diff' },
            { type: 'text', text: 'The patch looks good.' },
          ],
          usage: {
            input: 12,
            output: 4,
          },
        },
      }),
      '',
    ].join('\n'));

    const session = registry.upsertDiscovered('pi-native-history', {
      providerName: 'pi',
      cwd: 'C:/repo',
      sourcePath,
      messageCount: 2,
    });

    const response = await app.request(`/sessions/${session!.id}/history`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transcript: {
        ownership: 'provider',
        source: 'jsonl',
        parser: 'pi_native',
      },
      messages: [
        {
          role: 'user',
          text: 'Review the patch.',
          timestamp: '2026-03-23T00:00:00.000Z',
        },
        {
          role: 'assistant',
          text: 'The patch looks good.',
          timestamp: '2026-03-23T00:00:02.000Z',
        },
      ],
      inspection: {
        state: 'closed',
        wake: null,
      },
    });
  });

  it('respawns a live Pi worker when runtime skill delivery changes and a resume source is available', async () => {
    const sourcePath = join(piSessionsDir, 'workspace', 'session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(sourcePath, '');

    const oldSkills = resolveRuntimeSkillManifest({
      requestedSkills: ['companion'],
    }, {
      sessionId: 'pi-live',
      providerName: 'pi',
      providerBackend: 'cli',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      sessionBaseDir,
    });
    const expectedNewSkills = resolveRuntimeSkillManifest({
      requestedSkills: ['delivery-auditor'],
    }, {
      sessionId: 'pi-live',
      providerName: 'pi',
      providerBackend: 'cli',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      sessionBaseDir,
    });

    const session = registry.create({
      id: 'pi-live',
      providerName: 'pi',
      providerBackend: 'cli',
      providerInstanceId: 'default',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      skills: oldSkills,
    });
    session.providerSourcePath = sourcePath;
    registry.updateStatus(session.id, 'ready');

    const staleWorker = {
      alive: true,
      busy: false,
      streamMessage: async function* () {
        throw new Error('stale worker should have been replaced before the turn started');
      },
    };
    const freshWorker = {
      alive: true,
      busy: false,
      streamMessage: async function* () {
        yield { type: 'text', text: 'Respawned reply' };
        yield { type: 'result' };
      },
    };

    let currentWorker: typeof staleWorker | typeof freshWorker | undefined = staleWorker;
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: false, permissions: false })),
      get: vi.fn(() => currentWorker as never),
      spawn: vi.fn(() => {
        currentWorker = freshWorker;
        return freshWorker as never;
      }),
      kill: vi.fn(() => {
        currentWorker = undefined;
      }),
      status: vi.fn(() => ({ active: currentWorker ? 1 : 0, busy: 0, idle: 1, providers: { pi: 1 } })),
    } as unknown as WorkerPool;
    app = createTestApp();

    const expectedResumePath = resolvePiResumeTarget(
      makeConfig(),
      registry.get(session.id)!,
      process.platform,
    ).runtimeSourcePath;

    const response = await app.request(`/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        message: 'hello',
        skills: {
          requestedSkills: ['delivery-auditor'],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(parseNdjson(await response.text())).toEqual([
      { type: 'text', text: 'Respawned reply' },
      { type: 'result' },
    ]);
    expect(vi.mocked(pool.kill)).toHaveBeenCalledWith(session.id);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session.id,
      'pi',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSourcePath: expectedResumePath,
        instructionsFile: expectedNewSkills?.delivery.instructions?.filePath,
      }),
      undefined,
    );
    expect(registry.get(session.id)?.skills?.requestedSkills).toEqual(['delivery-auditor']);
  });
});
