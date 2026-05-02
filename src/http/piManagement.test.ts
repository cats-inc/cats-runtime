import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { resolvePiResumeTarget } from '../backends/cli/pi/resume.js';
import { resolveRuntimeSkillManifest } from '../core/skills/catalog.js';
import { parseCoreNdjson as parseNdjson } from '../../tests/streamEventTestUtils.js';

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
        sources: [
          {
            ownership: 'provider',
            source: 'jsonl',
            parser: 'pi_native',
            path: sourcePath,
            messageCount: 2,
          },
        ],
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

  it('dedupes Pi streaming assistant text when turn_end and agent_end repeat the same final reply', async () => {
    const sourcePath = join(piSessionsDir, 'workspace', 'streaming-session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(sourcePath, [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-23T00:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Summarize the diff.' }],
        },
      }),
      JSON.stringify({
        type: 'message_update',
        timestamp: '2026-03-23T00:00:01.000Z',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'Looks ',
        },
      }),
      JSON.stringify({
        type: 'message_update',
        timestamp: '2026-03-23T00:00:01.500Z',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'good.',
        },
      }),
      JSON.stringify({
        type: 'turn_end',
        timestamp: '2026-03-23T00:00:02.000Z',
        message: {
          stopReason: 'stop',
        },
      }),
      JSON.stringify({
        type: 'agent_end',
        timestamp: '2026-03-23T00:00:02.000Z',
        messages: [{
          role: 'assistant',
          content: [{ type: 'text', text: 'Looks good.' }],
        }],
      }),
      '',
    ].join('\n'));

    const session = registry.upsertDiscovered('pi-streaming-history', {
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
          text: 'Summarize the diff.',
          timestamp: '2026-03-23T00:00:00.000Z',
        },
        {
          role: 'assistant',
          text: 'Looks good.',
          timestamp: '2026-03-23T00:00:01.000Z',
        },
      ],
    });
  });

  it('surfaces both Pi-native and runtime-managed transcript sources when fallback history exists', async () => {
    const providerSourcePath = join(piSessionsDir, 'workspace', 'provider-session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(providerSourcePath, [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-23T00:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Inspect the build output.' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-23T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'The build passed cleanly.' }],
        },
      }),
      '',
    ].join('\n'));

    const session = registry.create({
      id: 'pi-history-mixed',
      providerName: 'pi',
      providerBackend: 'cli',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
    });
    const runtimeSourcePath = join(sessionBaseDir, 'history', `${session.id}.jsonl`);
    mkdirSync(join(sessionBaseDir, 'history'), { recursive: true });
    writeFileSync(runtimeSourcePath, [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-23T00:00:03.000Z',
        message: {
          content: [{ type: 'text', text: 'Fallback runtime note.' }],
        },
      }),
      '',
    ].join('\n'));
    registry.setSourcePath(session.id, runtimeSourcePath);
    session.providerSourcePath = providerSourcePath;
    registry.updateStatus(session.id, 'closed');

    const response = await app.request(`/sessions/${session.id}/history`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transcript: {
        ownership: 'provider',
        source: 'jsonl',
        parser: 'pi_native',
        sources: [
          {
            ownership: 'provider',
            source: 'jsonl',
            parser: 'pi_native',
            path: providerSourcePath,
            messageCount: 2,
          },
          {
            ownership: 'runtime',
            source: 'jsonl',
            parser: 'generic_jsonl',
            path: runtimeSourcePath,
            messageCount: 1,
          },
        ],
      },
      messages: [
        {
          role: 'user',
          text: 'Inspect the build output.',
          timestamp: '2026-03-23T00:00:00.000Z',
        },
        {
          role: 'assistant',
          text: 'The build passed cleanly.',
          timestamp: '2026-03-23T00:00:01.000Z',
        },
        {
          role: 'assistant',
          text: 'Fallback runtime note.',
          timestamp: '2026-03-23T00:00:03.000Z',
        },
      ],
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
      'default',
    );
    expect(registry.get(session.id)?.skills?.requestedSkills).toEqual(['delivery-auditor']);
  });

  it('rehydrates a missing Pi instructions file before resume', async () => {
    const sourcePath = join(piSessionsDir, 'workspace', 'session.jsonl');
    mkdirSync(join(piSessionsDir, 'workspace'), { recursive: true });
    writeFileSync(sourcePath, '');

    const skills = resolveRuntimeSkillManifest({
      requestedSkills: ['delivery-auditor'],
    }, {
      sessionId: 'pi-resume',
      providerName: 'pi',
      providerBackend: 'cli',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      sessionBaseDir,
    });
    const missingInstructionsFile = skills?.delivery.instructions?.filePath;
    if (missingInstructionsFile) {
      rmSync(missingInstructionsFile, { force: true });
    }

    const session = registry.create({
      id: 'pi-resume',
      providerName: 'pi',
      providerBackend: 'cli',
      providerInstanceId: 'default',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      skills,
    });
    session.providerSourcePath = sourcePath;
    registry.updateStatus(session.id, 'closed');

    const response = await app.request(`/sessions/${session.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const responseBody = await response.json() as {
      hydration: {
        trigger: string;
        skills?: {
          source: string;
          provider: string;
          mode: string;
        };
      };
      skills?: {
        delivery?: {
          instructions?: {
            filePath?: string;
          };
        };
      };
    };
    const regeneratedInstructionsFile = responseBody.skills?.delivery?.instructions?.filePath;
    expect(regeneratedInstructionsFile).toBeTruthy();
    expect(existsSync(regeneratedInstructionsFile!)).toBe(true);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session.id,
      'pi',
      expect.objectContaining({
        instructionsFile: regeneratedInstructionsFile,
      }),
      'default',
    );
    expect(responseBody.hydration).toEqual(expect.objectContaining({
      trigger: 'resume',
      skills: expect.objectContaining({
        source: 'session_state',
        provider: 'pi',
        mode: 'instructions',
      }),
    }));
  });
});
