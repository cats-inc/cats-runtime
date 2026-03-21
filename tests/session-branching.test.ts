import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeApp } from '../src/http/app.js';
import { SessionRegistry } from '../src/backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../src/backends/cli/pool/WorkerPool.js';

function createTestConfig() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-branch-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: join(root, 'providers.missing.yaml'),
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    GEMINI_SESSIONS_DIR: join(root, '.gemini', 'tmp'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  };

  for (const dir of [
    env.CATS_RUNTIME_SESSION_BASE_DIR,
    env.CATS_RUNTIME_DATA_DIR,
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.GEMINI_SESSIONS_DIR,
    env.PI_SESSIONS_DIR,
    join(root, '.junie', 'sessions'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  return {
    root,
    config: loadConfig(env),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createMockPool(): WorkerPool {
  return {
    getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
    get: vi.fn(() => undefined),
    isAttached: vi.fn(() => false),
    spawn: vi.fn(() => undefined),
    kill: vi.fn(),
    killAll: vi.fn(),
    status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
  } as unknown as WorkerPool;
}

describe('session branching route', () => {
  it('preserves native_fork lineage for compatible branches', async () => {
    const { config, cleanup } = createTestConfig();
    const registry = new SessionRegistry();
    const pool = createMockPool();
    const app = createRuntimeApp({
      config,
      registry,
      pool,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
    } as never);

    try {
      const parent = registry.create({
        id: 'parent-native',
        providerName: 'codex',
        cwd: join(config.sessionBaseDir, 'repo'),
        workspaceMode: 'shared',
        model: 'gpt-5.4',
        instructions: 'Parent instructions',
      });
      registry.setProviderSessionId(parent.id, 'thread-parent');
      registry.updateStatus(parent.id, 'closed');

      const response = await app.request(`/sessions/${parent.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      const body = await response.json() as {
        id: string;
        lineage: { branchMode: string; parentSessionId: string; chain: Array<{ sessionId: string }> };
      };
      expect(response.status).toBe(201);
      expect(body.lineage).toMatchObject({
        branchMode: 'native_fork',
        parentSessionId: 'parent-native',
      });
      expect(body.lineage.chain).toEqual([
        { sessionId: 'parent-native', provider: 'codex' },
        { sessionId: body.id, provider: 'codex' },
      ]);
      expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
        body.id,
        'codex',
        expect.objectContaining({
          resumeSessionId: 'thread-parent',
          forkSession: true,
          model: 'gpt-5.4',
        }),
        undefined,
      );
    } finally {
      cleanup();
    }
  });

  it('falls back to context_transplant for incompatible child targets and records lineage', async () => {
    const { config, cleanup } = createTestConfig();
    const registry = new SessionRegistry();
    const pool = createMockPool();
    const app = createRuntimeApp({
      config,
      registry,
      pool,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
    } as never);

    try {
      const parent = registry.create({
        id: 'parent-transplant',
        providerName: 'codex',
        cwd: join(config.sessionBaseDir, 'repo'),
        workspaceMode: 'shared',
        model: 'gpt-5.4',
        instructions: 'Parent instructions',
        context: { labels: ['parent-label'] },
      });
      registry.updateSessionMetadata(parent.id, { summary: 'Parent summary' });
      registry.setProviderSessionId(parent.id, 'thread-parent');
      registry.updateStatus(parent.id, 'closed');

      const response = await app.request(`/sessions/${parent.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'auto',
          provider: 'gemini',
          instructions: 'Child instructions',
          context: {
            labels: ['child-label'],
          },
          transplant: {
            summary: 'Handoff summary',
            labels: ['handoff-label'],
          },
        }),
      });

      const body = await response.json() as {
        id: string;
        providerName: string;
        lineage: { branchMode: string; parentSessionId: string };
        warnings?: string[];
      };

      expect(response.status).toBe(201);
      expect(body.providerName).toBe('gemini');
      expect(body.lineage).toMatchObject({
        branchMode: 'context_transplant',
        parentSessionId: 'parent-transplant',
      });
      expect(body.warnings?.[0]).toContain('provider override requires context_transplant');

      const child = registry.get(body.id);
      expect(child?.providerSessionId).toBeUndefined();
      expect(child?.instructions).toContain('Child instructions');
      expect(child?.instructions).toContain('Context transplant bundle');
      expect(child?.instructions).toContain('Handoff summary');
      expect(child?.context?.labels).toEqual([
        'parent-label',
        'child-label',
        'handoff-label',
      ]);
      expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
        body.id,
        'gemini',
        expect.not.objectContaining({
          forkSession: true,
          resumeSessionId: 'thread-parent',
        }),
        undefined,
      );
    } finally {
      cleanup();
    }
  });
});
