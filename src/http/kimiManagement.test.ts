import { withSelectedCliProviders } from '../../tests/support/selectedCliFixture.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { KimiNativeSessionService } from '../backends/cli/kimi/KimiNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import { syncNativeSessions } from '../backends/cli/discovery/nativeDiscovery.js';

describe('Kimi native session management', () => {
  let runtimeRootDir = '';
  let registry: SessionRegistry;
  let kimiNative: KimiNativeSessionService;
  let app: ReturnType<typeof createApp>;
  const attachedWorkers = new Map<string, { alive: boolean }>();

  const makeConfig = (): CliRuntimeConfig => withSelectedCliProviders(({
    host: '127.0.0.1',
    port: 3100,
    apiKey: '',
    nativeDiscoveryIntervalMs: 5000,
    externalSessionLiveWindowMs: 15000,
    maxSessions: 10,
    dataDir: join(runtimeRootDir, 'data'),
    sessionBaseDir: join(runtimeRootDir, 'sessions'),
    providerCommands: {
      kimi: { path: 'kimi', runner: 'auto', runtime: { mode: 'native' } },
    },
  }) as unknown as CliRuntimeConfig);

  beforeEach(() => {
    runtimeRootDir = mkdtempSync(join(tmpdir(), 'kimi-management-runtime-'));
    registry = new SessionRegistry();
    attachedWorkers.clear();
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: false, permissions: false })),
      get: vi.fn((id: string) => attachedWorkers.get(id)),
      spawn: vi.fn(),
      kill: vi.fn((id: string) => { attachedWorkers.delete(id); }),
      status: vi.fn(() => ({ active: 0 })),
    } as unknown as WorkerPool;
    kimiNative = {
      listSessions: vi.fn(),
      listAllSessions: vi.fn(),
      loadHistory: vi.fn(),
      deleteSession: vi.fn(),
    } as unknown as KimiNativeSessionService;
    app = createApp({
      config: makeConfig(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      kimiNative,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(runtimeRootDir, { recursive: true, force: true });
  });

  const discovered = (id: string) => registry.upsertDiscovered(id, {
    providerName: 'kimi',
    cwd: 'C:/repo',
    summary: 'Read hello.txt',
    messageCount: 2,
  })!;

  it('imports Kimi sessions the native scan finds and prunes ones Kimi no longer has', () => {
    syncNativeSessions(registry, 'kimi', [
      { providerSessionId: 'session_a', cwd: 'C:/repo', summary: 'A', messageCount: 1 },
      { providerSessionId: 'session_b', cwd: 'C:/repo', summary: 'B', messageCount: 3 },
    ]);
    expect(registry.list({ provider: 'kimi' }).map((session) => session.providerSessionId).sort())
      .toEqual(['session_a', 'session_b']);

    syncNativeSessions(registry, 'kimi', [
      { providerSessionId: 'session_b', cwd: 'C:/repo', summary: 'B', messageCount: 4 },
    ]);
    expect(registry.list({ provider: 'kimi' }).map((session) => session.providerSessionId)).toEqual(['session_b']);
  });

  it('loads the Kimi transcript through the generic history route', async () => {
    const session = discovered('session_a');
    vi.mocked(kimiNative.loadHistory).mockResolvedValue([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'world' },
    ]);

    const res = await app.request(`/sessions/${session.id}/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ role: string; text: string }>; transcript?: { parser?: string } };
    expect(body.messages).toEqual([{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'world' }]);
    expect(kimiNative.loadHistory).toHaveBeenCalledWith('session_a');
  });

  it('deletes the native Kimi session before removing it from the registry', async () => {
    const session = discovered('session_a');
    vi.mocked(kimiNative.deleteSession).mockResolvedValue(true);
    vi.mocked(kimiNative.listSessions).mockResolvedValue([]);

    const res = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nativeDeleted: true });
    expect(kimiNative.deleteSession).toHaveBeenCalledWith('session_a');
    expect(kimiNative.listSessions).toHaveBeenCalledWith('C:/repo', { startIfNeeded: false });
    expect(registry.get(session.id)).toBeUndefined();
  });

  it('retains the session when kimi cannot delete it and it is still in the store', async () => {
    const session = discovered('session_stuck');
    vi.mocked(kimiNative.deleteSession).mockRejectedValue(new Error('spawn kimi ENOENT'));
    vi.mocked(kimiNative.listSessions).mockResolvedValue([
      { providerSessionId: 'session_stuck', cwd: 'C:/repo', summary: 'Still here', messageCount: 2 },
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'retained', nativeDeleted: false });
    expect(registry.get(session.id)).toBeDefined();
  });

  it('finishes the delete when the session is already gone even though kimi failed', async () => {
    const session = discovered('session_gone');
    vi.mocked(kimiNative.deleteSession).mockRejectedValue(new Error('ACP stdio request timed out'));
    vi.mocked(kimiNative.listSessions).mockResolvedValue([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.request(`/sessions/${session.id}`, { method: 'DELETE' });

    expect(await res.json()).toMatchObject({ status: 'deleted', nativeDeleted: true });
    expect(registry.get(session.id)).toBeUndefined();
  });
});

describe('Kimi native session routes', () => {
  it('inspects and imports Kimi sessions through /kimi/sessions', async () => {
    const registry = new SessionRegistry();
    const kimiNative = {
      listAllSessions: vi.fn(async () => [
        { providerSessionId: 'session_a', cwd: 'C:/repo', summary: 'A', messageCount: 1 },
      ]),
      listSessions: vi.fn(async () => []),
    } as unknown as KimiNativeSessionService;
    const root = mkdtempSync(join(tmpdir(), 'kimi-routes-'));
    try {
      const app = createApp({
        config: withSelectedCliProviders(({
          host: '127.0.0.1', port: 3100, apiKey: '', nativeDiscoveryIntervalMs: 0,
          externalSessionLiveWindowMs: 15000, maxSessions: 10,
          dataDir: join(root, 'data'), sessionBaseDir: join(root, 'sessions'),
          providerCommands: { kimi: { path: 'kimi', runner: 'auto', runtime: { mode: 'native' } } },
        }) as unknown as CliRuntimeConfig),
        registry,
        pool: { status: vi.fn(() => ({ active: 0 })), get: vi.fn() } as unknown as WorkerPool,
        cursorNative: {} as CursorNativeSessionService,
        kiroNative: {} as KiroNativeSessionService,
        auggieSessions: {} as AuggieSessionService,
        opencodeNative: {} as OpencodeNativeSessionService,
        kimiNative,
      });

      const inspected = await (await app.request('/kimi/sessions')).json() as { count: number };
      expect(inspected.count).toBe(1);
      expect(registry.list({ provider: 'kimi' })).toHaveLength(0);

      const imported = await (await app.request('/kimi/sessions/discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: 'C:/repo' }),
      })).json() as { count: number };
      expect(imported.count).toBe(0);
      expect(kimiNative.listSessions).toHaveBeenCalledWith('C:/repo', { startIfNeeded: undefined });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
