import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeApp } from '../src/http/app.js';
import { SessionRegistry } from '../src/backends/cli/pool/SessionRegistry.js';
import { createRuntimeTestEnvWithAllCliProviders, createRuntimeTestPaths, ensureRuntimeTestDirs } from './support/runtimeTestPaths.js';

describe('Runtime HTTP privacy hardening', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cats-http-privacy-')); });
  afterEach(() => {
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
    const app = createRuntimeApp({
      config, registry, pool, cursorNative: {}, gooseNative: {}, kiroNative: {},
      auggieSessions: {}, opencodeNative: {},
    } as never);
    return { app, registry, config };
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
