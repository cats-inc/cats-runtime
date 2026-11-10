import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp, getRuntimeSessionManager, type AppContext } from './app.js';
import { loadConfig } from '../backends/cli/config.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { toSessionView } from '../backends/cli/pool/sessionView.js';
import { ensureSessionAwake } from '../core/runtime/sessionWakeup.js';
import { buildSessionSelfBranchCapabilityTruth } from '../core/runtime/sessionBranching.js';
import { providerSessionSpawnOptions } from '../core/runtime/providerSessionPersistence.js';
import { createRuntimeTestEnv } from '../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../tests/tempCleanup.js';

describe('provider session persistence HTTP and lifecycle', () => {
  let root: string;
  let context: AppContext;
  let registry: SessionRegistry;
  let pool: WorkerPool;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cats-session-persistence-'));
    mkdirSync(join(root, 'workspace'));
    const config = loadConfig(createRuntimeTestEnv(root), { providerYaml:
      'providers: { codex: { instances: { native: { path: codex } } }, claude: { instances: { native: { path: claude } } } }' });
    registry = new SessionRegistry(join(root, 'data'), config.sessionBaseDir,
      config.providerDefaultInstances, config.providerDefaultTargets);
    pool = {
      getCapabilities: vi.fn(provider => ({ resume: true, fork: true, permissions: true,
        ...(provider === 'codex' ? { providerSessionPersistence: ['persistent', 'ephemeral'] } : {}) })),
      get: vi.fn(() => undefined), isAttached: vi.fn(() => false),
      spawn: vi.fn(), kill: vi.fn(), killAll: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
    context = { config, registry, pool, cursorNative: {}, gooseNative: {}, kiroNative: {},
      auggieSessions: {}, opencodeNative: {} } as AppContext;
  });

  afterEach(() => {
    registry.flush();
    cleanupTempDirWithRetries(root);
  });

  const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });

  async function create(extra: Record<string, unknown> = {}) {
    const app = createRuntimeApp(context);
    const response = await app.request('/sessions', post({ provider: 'codex',
      cwd: join(root, 'workspace'), workspaceMode: 'read_only', ...extra }));
    const body = await response.json() as Record<string, any>;
    return { app, response, body };
  }

  it('admits and persists policy and label, but keeps legacy records persistent', async () => {
    const { response, body } = await create({ providerSessionPersistence: 'ephemeral', sessionLabel: 'Catlas fixture' });
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ providerSessionPersistence: 'ephemeral', sessionLabel: 'Catlas fixture' });
    expect(vi.mocked(pool.spawn).mock.calls[0]?.[2]).toMatchObject({ providerSessionPersistence: 'ephemeral' });
    registry.flush();
    const loaded = new SessionRegistry(join(root, 'data'), context.config.sessionBaseDir).get(body.id)!;
    expect(loaded).toMatchObject({ providerSessionPersistence: 'ephemeral', status: 'closed' });
    expect(() => providerSessionSpawnOptions(loaded, { cwd: loaded.cwd })).toThrow('cannot be resumed');
    const legacy = { ...loaded, providerSessionPersistence: undefined, providerSessionId: 'native-old' };
    expect(toSessionView(legacy).controls.canResume).toBe(true);
    expect(providerSessionSpawnOptions(legacy, { cwd: legacy.cwd, resumeSessionId: 'native-old' }))
      .toMatchObject({ resumeSessionId: 'native-old' });
  });

  it.each([
    { provider: 'claude', providerSessionPersistence: 'ephemeral' },
    { providerSessionPersistence: 'unknown' },
    { providerSessionPersistence: null },
    { sessionLabel: 'bad\nlabel' },
  ])('rejects unsupported or malformed admission before creating a session: %j', async extra => {
    const { response } = await create(extra);
    expect(response.status).toBe(400);
    expect(pool.spawn).not.toHaveBeenCalled();
    expect(registry.list()).toHaveLength(0);
  });

  it('blocks all inactive ephemeral execution paths and advertises no branching', async () => {
    const { app, body } = await create({ providerSessionPersistence: 'ephemeral' });
    const session = registry.get(body.id)!;
    registry.setProviderSessionId(session.id, 'job-native');
    registry.updateStatus(session.id, 'closed');
    vi.mocked(pool.spawn).mockClear();
    for (const route of ['resume', 'fork', 'messages']) {
      const response = await app.request(`/sessions/${session.id}/${route}`, post({ message: 'never send' }));
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: 'provider_session_not_resumable' });
    }
    const runtime = getRuntimeSessionManager(context);
    await expect(ensureSessionAwake({ config: context.config, registry, runtime, sessionId: session.id }))
      .rejects.toThrow('cannot be resumed');
    await expect(runtime.replace(session.id, 'codex', { cwd: session.cwd })).rejects.toThrow('cannot be resumed');
    expect(() => runtime.spawn(session.id, 'codex', { cwd: session.cwd })).toThrow('cannot be resumed');
    expect(pool.spawn).not.toHaveBeenCalled();
    expect(toSessionView(session)).toMatchObject({ resumeStrategy: 'none', controls: { canResume: false, canSend: false } });
    expect(buildSessionSelfBranchCapabilityTruth(session, { fork: true })).toMatchObject({
      nativeFork: { available: false }, contextTransplant: { supported: false },
    });
  });

  it('keeps live ephemeral sends available, but forbids MCP replacement before killing the worker', async () => {
    const { body } = await create({ providerSessionPersistence: 'ephemeral' });
    registry.updateStatus(body.id, 'ready');
    expect(toSessionView(registry.get(body.id)!, { attached: true }).controls)
      .toMatchObject({ canSend: true, canResume: false });
    await expect(getRuntimeSessionManager(context).replace(body.id, 'codex', { cwd: join(root, 'workspace') }))
      .rejects.toThrow('cannot be resumed');
    expect(pool.kill).not.toHaveBeenCalled();
  });

  it('does not allow changing persistent policy on resume', async () => {
    const { app, body } = await create();
    expect(body.providerSessionPersistence).toBe('persistent');
    const response = await app.request(`/sessions/${body.id}/resume`, post({ providerSessionPersistence: 'ephemeral' }));
    expect(response.status).toBe(400);
    expect(registry.get(body.id)?.providerSessionPersistence).toBe('persistent');
  });

  it('refuses peer routing before building or dispatching an ephemeral job', async () => {
    const { app, body } = await create({ providerSessionPersistence: 'ephemeral' });
    registry.updateStatus(body.id, 'ready');
    const decide = vi.fn();
    const buildRequest = vi.fn();
    context.peerRouting = { decide } as never;
    context.peerExecutionClient = { buildRequest } as never;
    const response = await app.request(`/sessions/${body.id}/messages`, post({ message: 'fixture',
      routing: { mode: 'peer', peerId: 'fixture-peer' } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'provider_session_persistence_unsupported' });
    expect(decide).not.toHaveBeenCalled();
    expect(buildRequest).not.toHaveBeenCalled();
  });

  it.each(['persistent', 'ephemeral'] as const)('rejects a changed persistence choice during %s sessionKey reuse', async persistence => {
    const { body } = await create({ sessionKey: 'same-key', providerSessionPersistence: persistence });
    registry.updateStatus(body.id, 'ready');
    vi.mocked(pool.get).mockReturnValue({ alive: true, busy: false } as never);
    vi.mocked(pool.isAttached).mockReturnValue(true);
    vi.mocked(pool.spawn).mockClear();
    const { response, body: conflict } = await create({ sessionKey: 'same-key', reusePolicy: 'prefer_existing',
      providerSessionPersistence: persistence === 'persistent' ? 'ephemeral' : 'persistent' });
    expect(response.status).toBe(409);
    expect(conflict).toMatchObject({ error: 'providerSessionPersistence cannot change when reusing a session.' });
    expect(registry.list()).toHaveLength(1);
    expect(pool.spawn).not.toHaveBeenCalled();
    expect(registry.get(body.id)?.providerSessionPersistence).toBe(persistence);
  });
});
