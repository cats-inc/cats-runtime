import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { RuntimeWakeupService } from '../src/core/wakeup/RuntimeWakeupService.js';
import { createRuntimeApp, type AppContext } from '../src/http/app.js';
import { executeRetainedWorktreeCleanup } from '../src/http/routes/sessions.js';
import { SessionRegistry } from '../src/backends/cli/pool/SessionRegistry.js';
import { createRuntimeTestEnvWithAllCliProviders, createRuntimeTestPaths, ensureRuntimeTestDirs } from './support/runtimeTestPaths.js';

const fsFaults = vi.hoisted(() => ({
  lockedIndexStage: false,
  wakeupWritePath: undefined as string | undefined,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const blocked = (path: unknown) => fsFaults.lockedIndexStage && typeof path === 'string'
    && path.endsWith('-sessions-index.json.pending-delete');
  return {
    ...actual,
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      if (blocked(args[0])) throw new Error('synthetic staged index lock');
      return actual.rmSync(...args);
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (blocked(args[0])) throw new Error('synthetic staged index lock');
      return actual.renameSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (args[0] === fsFaults.wakeupWritePath) {
        throw new Error('synthetic wakeup persistence failure');
      }
      return actual.writeFileSync(...args);
    },
  };
});

describe('Runtime HTTP privacy hardening', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cats-http-privacy-')); });
  afterEach(() => {
    fsFaults.lockedIndexStage = false;
    fsFaults.wakeupWritePath = undefined;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function fixture(apiKey = '', persistent = false) {
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnvWithAllCliProviders(root, {
      CATS_RUNTIME_API_KEY: apiKey,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
      COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
      CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
      KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
      PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
    });
    const config = loadConfig(env);
    const registry = new SessionRegistry(persistent ? paths.dataDir : undefined, config.sessionBaseDir);
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined), isAttached: vi.fn(() => false),
      spawn: vi.fn(), kill: vi.fn(), killAll: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    };
    const context = {
      config, registry, pool, cursorNative: {}, gooseNative: {}, kiroNative: {},
      auggieSessions: {}, opencodeNative: {},
    } as unknown as AppContext;
    const app = createRuntimeApp(context);
    return { app, registry, config, context };
  }

  function pauseBrowserCleanup(context: AppContext) {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(context.browser!, 'clearRuntimeSessions').mockImplementationOnce(async () => {
      entered();
      await gate;
      return 0;
    });
    return { started, release };
  }

  it('omits complete queries from actual app access logs while preserving both authentication forms', async () => {
    const key = 'synthetic-valid-credential';
    const { app } = fixture(key);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const query = await app.request(`/sessions/missing/stream?token=${key}&prompt=synthetic-private-query`);
    const header = await app.request('/sessions/missing/stream?unrelated=synthetic-other-query', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const denied = await app.request('/sessions/missing/stream?token=synthetic-invalid-credential');
    expect(query.status).toBe(404);
    expect(header.status).toBe(404);
    expect(denied.status).toBe(403);
    const output = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain('GET /sessions/missing/stream');
    expect(output).toContain('403');
    expect(output).not.toMatch(/synthetic-|token=|prompt=|unrelated=|\?/);
  });

  it('retains the session on a final removal failure and deletes its compaction archive on retry', async () => {
    const { app, registry, config } = fixture();
    const session = registry.create({ id: 'delete-fixture', providerName: 'codex', cwd: root, workspaceMode: 'shared' });
    registry.updateStatus(session.id, 'closed');
    const archive = join(config.sessionBaseDir, 'compactions', session.id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'snapshot.jsonl'), 'synthetic private history');
    const internal = registry as unknown as { removeStagedArtifact(path: string): void };
    const spy = vi.spyOn(internal, 'removeStagedArtifact').mockImplementation(() => { throw new Error('fixture locked'); });
    const response = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'retained', fileDeleted: false,
      cleanup: { registryDropped: false, managedTranscriptDeleted: false },
      maintenance: { reasonCodes: ['cleanup_removal_failed'] },
      reason: expect.stringContaining('incomplete'),
    });
    expect(registry.get(session.id)).toBeDefined();
    expect(existsSync(join(archive, 'snapshot.jsonl'))).toBe(true);
    spy.mockRestore();
    const retried = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(await retried.json()).toMatchObject({ status: 'deleted', fileDeleted: true });
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(archive)).toBe(false);
  });

  it('deletes provider history in a sibling sharing the Runtime sessions path prefix', async () => {
    const { app, registry, config } = fixture();
    const session = registry.create({ id: 'sibling-provider', providerName: 'claude', cwd: root, workspaceMode: 'shared' });
    const sibling = `${config.sessionBaseDir}-provider`;
    mkdirSync(sibling);
    const native = join(sibling, 'native.jsonl');
    const unrelated = join(sibling, 'unrelated.jsonl');
    writeFileSync(native, 'synthetic provider history');
    writeFileSync(unrelated, 'retain another session');
    registry.setProviderSessionId(session.id, 'native');
    session.providerSourcePath = native;
    registry.updateStatus(session.id, 'closed');
    const response = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'deleted', fileDeleted: true,
      cleanup: { managedTranscriptDeleted: false, providerDiscoveryCleared: true, registryDropped: true },
    });
    expect(existsSync(native)).toBe(false);
    expect(readFileSync(unrelated, 'utf8')).toBe('retain another session');
  });

  it('retains malformed root-valued transcript metadata without staging the sessions directory', async () => {
    const { app, registry, config } = fixture();
    const session = registry.create({ id: 'root-provider', providerName: 'claude', cwd: root, workspaceMode: 'shared' });
    const sentinel = join(config.sessionBaseDir, 'unrelated.jsonl');
    writeFileSync(sentinel, 'retain all Runtime data');
    registry.setProviderSessionId(session.id, 'root-native');
    session.providerSourcePath = process.platform === 'win32'
      ? config.sessionBaseDir.toUpperCase() : join(config.sessionBaseDir, '.');
    registry.updateStatus(session.id, 'closed');
    const response = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'retained', fileDeleted: false, maintenance: { reasonCodes: ['cleanup_staging_failed'] },
    });
    expect(registry.get(session.id)).toBeDefined();
    expect(readFileSync(sentinel, 'utf8')).toBe('retain all Runtime data');
  });

  it('rejects overlapping DELETE across app contexts through finalization and pending-path persistence', async () => {
    const { app, registry, config, context } = fixture('', true);
    const otherApp = createRuntimeApp({ ...context }); // Same registry, distinct HTTP app/context.
    const session = registry.create({ id: 'concurrent-delete', providerName: 'codex', cwd: root, workspaceMode: 'shared' });
    registry.updateStatus(session.id, 'closed');
    const archive = join(config.sessionBaseDir, 'compactions', session.id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'snapshot.jsonl'), 'retained history');
    const internal = registry as unknown as { removeStagedArtifact(path: string): void };
    vi.spyOn(internal, 'removeStagedArtifact').mockImplementation(() => {
      mkdirSync(archive);
      throw new Error('fixture removal and restoration fail');
    });
    const paused = pauseBrowserCleanup(context);
    const first = app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    await paused.started;
    try {
      expect(existsSync(archive)).toBe(false); // First request already staged the archive.
      const second = await otherApp.request(`/sessions/${session.id}`, { method: 'DELETE' });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: 'session_delete_busy' });
      await expect(executeRetainedWorktreeCleanup(context, session)).rejects.toMatchObject({ code: 'session_delete_busy' });
      expect(registry.get(session.id)).toBe(session);
    } finally {
      paused.release();
    }
    expect(await (await first).json()).toMatchObject({ status: 'retained', fileDeleted: false });
    const pending = registry.getPendingFileDeletionPaths(session.id);
    expect(pending).toHaveLength(1);
    const saved = JSON.parse(readFileSync(join(createRuntimeTestPaths(root).dataDir, 'sessions.json'), 'utf8'));
    expect(saved.find((record: { id: string }) => record.id === session.id).pendingFileDeletionPaths).toEqual(pending);
    const retry = await otherApp.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(retry.status).toBe(200); // Lock is released, persistent guard remains authoritative.
    expect(await retry.json()).toMatchObject({ status: 'retained', maintenance: { reasonCodes: ['cleanup_pending_removal'] } });
    registry.flush();
  });

  it('rolls staged files back and returns conflict if the registry entry disappears during async cleanup', async () => {
    const { app, registry, config, context } = fixture();
    const session = registry.create({ id: 'stale-delete', providerName: 'codex', cwd: root, workspaceMode: 'shared' });
    registry.updateStatus(session.id, 'closed');
    const archive = join(config.sessionBaseDir, 'compactions', session.id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'snapshot.jsonl'), 'preserve stale history');
    const paused = pauseBrowserCleanup(context);
    const first = app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    await paused.started;
    try {
      expect(registry.unregister(session.id)).toBe(true); // Simulate an independent registry owner.
    } finally {
      paused.release();
    }
    const response = await first;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'session_delete_conflict' });
    expect(readFileSync(join(archive, 'snapshot.jsonl'), 'utf8')).toBe('preserve stale history');
    expect(context.runtime!.getTrackedState(session.id)?.maintenance.lastLifecycle?.status).not.toBe('completed');
    expect((await app.request(`/sessions/${session.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('does not claim completed deletion when unregister refuses a late pending-removal guard', async () => {
    const { app, registry, config, context } = fixture('', true);
    const session = registry.create({ id: 'late-guard', providerName: 'codex', cwd: root, workspaceMode: 'shared' });
    registry.updateStatus(session.id, 'closed');
    const originalUnregister = registry.unregister.bind(registry);
    const pending = join(config.sessionBaseDir, '.cats-runtime-delete-late.pending-delete');
    const spy = vi.spyOn(registry, 'unregister').mockImplementation((id) => {
      writeFileSync(pending, 'late unresolved history');
      registry.retainPendingFileDeletions(id, [pending]);
      return originalUnregister(id);
    });
    const response = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'session_delete_conflict' });
    expect(registry.get(session.id)).toBeDefined();
    expect(context.runtime!.getTrackedState(session.id)?.maintenance.lastLifecycle?.status).not.toBe('completed');
    spy.mockRestore();
    const retry = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(await retry.json()).toMatchObject({ status: 'retained', cleanup: { registryDropped: false } });
    registry.flush();
  });

  it('restores real wakeup state after a failed write and persists its removal on DELETE retry', async () => {
    const { app, registry, config, context } = fixture('', true);
    const session = registry.create({ id: 'wakeup-failure', providerName: 'codex', cwd: root, workspaceMode: 'shared' });
    registry.updateStatus(session.id, 'closed');
    registry.flush();
    const archive = join(config.sessionBaseDir, 'compactions', session.id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'snapshot.jsonl'), 'synthetic history');
    const persistPath = join(createRuntimeTestPaths(root).dataDir, 'wakeups.json');
    const wakeSession = vi.fn(async (sessionId: string) => ({ sessionId, outcome: 'resumed' as const }));
    const wakeup = new RuntimeWakeupService({ persistPath, wakeSession });
    context.wakeup = wakeup;
    const request = wakeup.create({
      reason: 'Synthetic request for deletion', target: { kind: 'session', sessionId: session.id },
      scheduleAt: '2030-01-01T00:00:00Z',
    }).request;
    const unrelated = wakeup.create({
      reason: 'Keep unrelated wakeup', target: { kind: 'session', sessionId: 'unrelated' },
      scheduleAt: '2030-01-01T00:00:00Z',
    }).request;
    const before = readFileSync(persistPath, 'utf8');
    const clearSession = vi.spyOn(wakeup, 'clearSession');
    fsFaults.wakeupWritePath = persistPath;
    const drop = vi.spyOn(context.runtime!, 'dropSession');
    const failed = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: expect.stringContaining('synthetic wakeup persistence failure') });
    expect(registry.get(session.id)).toBe(session);
    expect(drop).not.toHaveBeenCalled();
    expect(wakeup.get(request.id)).toEqual(request);
    expect(wakeup.get(unrelated.id)).toEqual(unrelated);
    expect(readFileSync(persistPath, 'utf8')).toBe(before);
    expect(context.runtime!.getTrackedState(session.id)?.maintenance.lastLifecycle?.status).not.toBe('completed');
    fsFaults.wakeupWritePath = undefined;
    const retry = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      status: 'deleted', cleanup: { wakeupsCleared: true, registryDropped: true },
    });
    expect(clearSession).toHaveBeenCalledTimes(2);
    expect(drop).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(archive)).toBe(false);
    expect(wakeup.list()).toEqual([unrelated]);
    expect(JSON.parse(readFileSync(persistPath, 'utf8'))).toEqual([unrelated]);
    expect(new RuntimeWakeupService({ persistPath, wakeSession }).list()).toEqual([unrelated]);
    expect(wakeSession).not.toHaveBeenCalled();
    registry.flush();
  });

  it('preserves the rewritten provider index when its old staged copy cannot be removed or renamed', async () => {
    const { app, registry } = fixture('', true);
    const session = registry.create({ id: 'index-failure', providerName: 'claude', cwd: root, workspaceMode: 'shared' });
    const providerDir = join(root, 'index-provider');
    mkdirSync(providerDir);
    const source = join(providerDir, 'index-native.jsonl');
    const indexPath = join(providerDir, 'sessions-index.json');
    writeFileSync(source, 'synthetic provider history');
    const keep = { cwd: root, summary: 'unrelated retained session' };
    writeFileSync(indexPath, JSON.stringify({ 'index-native': { cwd: root }, 'keep-native': keep }));
    registry.setProviderSessionId(session.id, 'index-native');
    session.providerSourcePath = source;
    registry.updateStatus(session.id, 'closed');
    fsFaults.lockedIndexStage = true;
    const response = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'retained', fileDeleted: false });
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toEqual({ 'keep-native': keep });
    expect(existsSync(source)).toBe(false);
    const pending = registry.getPendingFileDeletionPaths(session.id);
    expect(pending).toHaveLength(1);
    expect(JSON.parse(readFileSync(pending[0], 'utf8'))).toHaveProperty('index-native');
    expect(registry.get(session.id)).toBeDefined();
    fsFaults.lockedIndexStage = false;
    registry.flush();
  });

  it('cannot report successful DELETE after an unrestored staged file survives a Runtime restart', async () => {
    const { app, registry, config } = fixture('', true);
    const session = registry.create({ id: 'compound-fixture', providerName: 'codex', cwd: root, workspaceMode: 'shared' });
    registry.updateStatus(session.id, 'closed');
    const archive = join(config.sessionBaseDir, 'compactions', session.id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'snapshot.jsonl'), 'retained history');
    const internal = registry as unknown as { removeStagedArtifact(path: string): void };
    const spy = vi.spyOn(internal, 'removeStagedArtifact').mockImplementation(() => {
      mkdirSync(archive); // Force restoration to fail after the staged removal fails.
      throw new Error('fixture removal failed');
    });
    const failed = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(await failed.json()).toMatchObject({ status: 'retained', fileDeleted: false });
    spy.mockRestore();
    const pending = registry.getPendingFileDeletionPaths(session.id);
    expect(pending).toHaveLength(1);
    const restarted = fixture('', true);
    const retried = await restarted.app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(await retried.json()).toMatchObject({
      status: 'retained', fileDeleted: false, cleanup: { registryDropped: false },
      maintenance: { reasonCodes: ['cleanup_pending_removal'] },
    });
    expect(existsSync(join(pending[0], 'snapshot.jsonl'))).toBe(true);
    expect(restarted.registry.get(session.id)).toBeDefined();
    registry.flush();
    restarted.registry.flush();
  });

  it.each([false, true])('settles provider stages before guard persistence fails (provider removal fails: %s)', async (providerFailure) => {
    const { app, registry, config } = fixture('', true);
    const session = registry.create({ id: 'persist-failure', providerName: 'claude', cwd: root, workspaceMode: 'shared' });
    const providerDir = join(root, 'provider-project');
    const providerSource = join(providerDir, 'native-fixture.jsonl');
    mkdirSync(providerDir);
    writeFileSync(providerSource, 'provider history');
    registry.setProviderSessionId(session.id, 'native-fixture');
    session.providerSourcePath = providerSource;
    registry.updateStatus(session.id, 'closed');
    registry.flush();
    const data = createRuntimeTestPaths(root).dataDir;
    const registryPath = join(data, 'sessions.json');
    const before = readFileSync(registryPath, 'utf8');
    const archive = join(config.sessionBaseDir, 'compactions', session.id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'snapshot.jsonl'), 'retained history');
    const internal = registry as unknown as {
      removeStagedArtifact(path: string): void;
      replacePersistenceSnapshot(temporary: string, target: string): void;
    };
    const originalRemove = internal.removeStagedArtifact.bind(internal);
    let providerFinalized = false;
    vi.spyOn(internal, 'removeStagedArtifact').mockImplementation((path) => {
      if (path.includes(`${session.id}.pending-delete`)) {
        expect(existsSync(providerSource)).toBe(false); // Both sides have been staged.
        mkdirSync(archive);
        throw new Error('fixture managed removal failed');
      }
      providerFinalized = true;
      if (providerFailure) {
        writeFileSync(providerSource, 'competing provider write');
        throw new Error('fixture provider removal failed');
      }
      originalRemove(path);
    });
    vi.spyOn(internal, 'replacePersistenceSnapshot').mockImplementation(() => {
      throw new Error('fixture replacement blocked');
    });
    const response = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('only in memory and may not survive restart');
    expect(providerFinalized).toBe(true);
    expect(readFileSync(registryPath, 'utf8')).toBe(before);
    expect(readdirSync(data).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const pending = registry.getPendingFileDeletionPaths(session.id);
    expect(pending).toHaveLength(providerFailure ? 2 : 1);
    for (const path of pending) expect(body.error).toContain(path);
    expect(existsSync(join(pending[0], 'snapshot.jsonl'))).toBe(true);
    if (providerFailure) {
      expect(readFileSync(pending[1], 'utf8')).toBe('provider history');
    } else {
      expect(existsSync(providerSource)).toBe(false);
      expect(readdirSync(providerDir)).toEqual([]); // No untracked provider stage remains.
    }
    expect(registry.unregister(session.id)).toBe(false);
    vi.restoreAllMocks();
    registry.flush();
  });
});
