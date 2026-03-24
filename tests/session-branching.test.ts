import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeApp } from '../src/http/app.js';
import { SessionRegistry } from '../src/backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../src/backends/cli/pool/WorkerPool.js';
import type { ProviderCapabilities } from '../src/core/types.js';

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

function createMockPool(
  capabilityResolver: (
    providerName: string,
    _instanceId?: string,
  ) => ProviderCapabilities = () => ({ resume: true, fork: true, permissions: true }),
): WorkerPool {
  return {
    getCapabilities: vi.fn(capabilityResolver),
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
        branching: {
          capabilities: {
            nativeFork: { available: boolean };
          };
        };
        branch: {
          requestedMode: string;
          resolvedMode: string;
          target: { provider: string; backend: string; instance: string };
          fallbackApplied: boolean;
          capabilityTruth: {
            nativeFork: { available: boolean };
          };
          transplant: { provided: boolean; source: string };
        };
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
      expect(body.branching.capabilities.nativeFork.available).toBe(true);
      expect(body.branch).toMatchObject({
        requestedMode: 'auto',
        resolvedMode: 'native_fork',
        fallbackApplied: false,
        target: {
          provider: 'codex',
          backend: 'cli',
          instance: 'default',
        },
        capabilityTruth: {
          nativeFork: {
            available: true,
          },
        },
        transplant: {
          provided: false,
          source: 'none',
        },
      });
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

  it('records large fork snapshot metadata and warnings for isolated child workspaces', async () => {
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
      const repoDir = join(config.sessionBaseDir, 'large-parent');
      mkdirSync(repoDir, { recursive: true });
      for (let index = 0; index < 2000; index += 1) {
        writeFileSync(join(repoDir, `file-${index}.txt`), `${index}\n`, 'utf8');
      }

      const parent = registry.create({
        id: 'parent-large-snapshot',
        providerName: 'codex',
        cwd: repoDir,
        workspaceMode: 'shared',
        model: 'gpt-5.4',
      });
      registry.setProviderSessionId(parent.id, 'thread-parent-large');
      registry.updateStatus(parent.id, 'closed');

      const response = await app.request(`/sessions/${parent.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceMode: 'isolated',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as {
        warnings?: string[];
        hydration?: {
          metadata?: {
            workspaceSnapshot?: {
              copiedFileCount: number;
              status: string;
              warningCodes?: string[];
              plan?: {
                strategy: string;
                boundedSyncAvailable: boolean;
                readiness: string;
                nextAction: string;
                thresholds: {
                  fileWarningCount: number;
                };
              };
            };
          };
        };
      };
      expect(body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('Fork workspace snapshot copied a large workspace'),
      ]));
      expect(body.hydration?.metadata?.workspaceSnapshot).toEqual(expect.objectContaining({
        copiedFileCount: 2000,
        status: 'large',
        warningCodes: ['large_file_count'],
        plan: expect.objectContaining({
          strategy: 'one_shot_snapshot',
          boundedSyncAvailable: false,
          readiness: 'follow_up_required',
          nextAction: 'prefer_shared_or_worktree',
          thresholds: expect.objectContaining({
            fileWarningCount: 2000,
          }),
        }),
      }));
    } finally {
      cleanup();
    }
  }, 15000);

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
        branching: {
          transplant: { summary?: string; labels?: string[] };
        };
        branch: {
          requestedMode: string;
          resolvedMode: string;
          fallbackApplied: boolean;
          fallbackReason?: string;
          target: { provider: string; backend: string; instance: string };
          transplant: {
            provided: boolean;
            source: string;
            summaryPresent: boolean;
            labels: string[];
          };
        };
        warnings?: string[];
      };

      expect(response.status).toBe(201);
      expect(body.providerName).toBe('gemini');
      expect(body.lineage).toMatchObject({
        branchMode: 'context_transplant',
        parentSessionId: 'parent-transplant',
      });
      expect(body.warnings?.[0]).toContain('provider override requires context_transplant');
      expect(body.branch).toMatchObject({
        requestedMode: 'auto',
        resolvedMode: 'context_transplant',
        fallbackApplied: true,
        fallbackReason: 'provider override requires context_transplant',
        target: {
          provider: 'gemini',
          backend: 'cli',
          instance: 'default',
        },
        transplant: {
          provided: true,
          source: 'merged',
          summaryPresent: true,
          labels: ['parent-label', 'handoff-label'],
        },
      });
      expect(body.branching.transplant?.summary).toBe('Handoff summary');

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

  it('returns machine-readable branch failure details when native fork is incompatible', async () => {
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
        id: 'parent-native-failure',
        providerName: 'codex',
        cwd: join(config.sessionBaseDir, 'repo'),
        workspaceMode: 'shared',
        model: 'gpt-5.4',
      });
      registry.setProviderSessionId(parent.id, 'thread-parent');
      registry.updateStatus(parent.id, 'closed');

      const response = await app.request(`/sessions/${parent.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'native_fork',
          provider: 'gemini',
        }),
      });

      const body = await response.json() as {
        error: string;
        branch: {
          requestedMode: string;
          resolvedMode?: string;
          error?: { kind: string };
          target: { provider: string; backend: string; instance: string };
          capabilityTruth: {
            nativeFork: {
              supported: boolean;
              compatible: boolean;
              available: boolean;
              errorKind?: string;
              reason?: string;
            };
          };
        };
      };

      expect(response.status).toBe(409);
      expect(body.error).toContain('provider override requires context_transplant');
      expect(body.branch).toMatchObject({
        requestedMode: 'native_fork',
        target: {
          provider: 'gemini',
          backend: 'cli',
          instance: 'default',
        },
        capabilityTruth: {
          nativeFork: {
            supported: true,
            compatible: false,
            available: false,
            errorKind: 'target_incompatible',
            reason: 'provider override requires context_transplant',
          },
        },
      });
      expect(body.branch.error?.kind).toBe('target_incompatible');
      expect(body.branch.resolvedMode).toBeUndefined();
      expect(vi.mocked(pool.spawn)).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('keeps GET /sessions cheap by default and only resolves branch capabilities on opt-in', async () => {
    const { config, cleanup } = createTestConfig();
    const registry = new SessionRegistry();
    const pool = createMockPool((providerName) => ({
      resume: true,
      fork: providerName === 'codex',
      permissions: true,
    }));
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
      const session = registry.create({
        id: 'list-session',
        providerName: 'codex',
        cwd: join(config.sessionBaseDir, 'repo'),
        workspaceMode: 'shared',
        model: 'gpt-5.4',
      });
      registry.updateStatus(session.id, 'closed');

      const listResponse = await app.request('/sessions');
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {
        sessions: Array<{ id: string; branching: { capabilities?: unknown } }>;
      };
      expect(listBody.sessions).toEqual([
        expect.objectContaining({
          id: 'list-session',
          branching: {},
        }),
      ]);
      expect(vi.mocked(pool.getCapabilities)).not.toHaveBeenCalled();

      const aliasResponse = await app.request('/sessions?branching=true');
      expect(aliasResponse.status).toBe(200);
      const aliasBody = await aliasResponse.json() as {
        sessions: Array<{ id: string; branching: { capabilities?: unknown } }>;
      };
      expect(aliasBody.sessions).toEqual([
        expect.objectContaining({
          id: 'list-session',
          branching: {},
        }),
      ]);
      expect(vi.mocked(pool.getCapabilities)).not.toHaveBeenCalled();

      const fullResponse = await app.request('/sessions?branching=full');
      expect(fullResponse.status).toBe(200);
      const fullBody = await fullResponse.json() as {
        sessions: Array<{
          id: string;
          branching: {
            capabilities?: {
              nativeFork: { available: boolean };
            };
          };
        }>;
      };
      expect(fullBody.sessions).toMatchObject([
        {
          id: 'list-session',
          branching: {
            capabilities: {
              nativeFork: {
                available: false,
              },
            },
          },
        },
      ]);
      expect(vi.mocked(pool.getCapabilities)).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it('inspects branch lineage across children and descendants', async () => {
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
      const root = registry.create({
        id: 'root-session',
        providerName: 'codex',
        cwd: join(config.sessionBaseDir, 'repo'),
        workspaceMode: 'shared',
        model: 'gpt-5.4',
      });
      registry.updateStatus(root.id, 'closed');

      const childResponse = await app.request(`/sessions/${root.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'context_transplant',
          transplant: {
            summary: 'child handoff',
          },
        }),
      });
      const childBody = await childResponse.json() as { id: string };
      expect(childResponse.status).toBe(201);

      const grandchildResponse = await app.request(`/sessions/${childBody.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'context_transplant',
          provider: 'gemini',
          transplant: {
            summary: 'grandchild handoff',
          },
        }),
      });
      const grandchildBody = await grandchildResponse.json() as { id: string };
      expect(grandchildResponse.status).toBe(201);

      const response = await app.request(`/sessions/${root.id}/lineage`);
      const body = await response.json() as {
        session: {
          id: string;
          branching: {
            capabilities: {
              nativeFork: { available: boolean };
            };
          };
        };
        rootSessionId: string;
        parentSessionId: string | null;
        ancestors: Array<{ sessionId: string; provider: string; presentInRegistry: boolean }>;
        children: Array<{ id: string; relativeDepth: number }>;
        descendants: Array<{ id: string; relativeDepth: number }>;
      };

      expect(response.status).toBe(200);
      expect(body.session.id).toBe('root-session');
      expect(body.session.branching.capabilities.nativeFork.available).toBe(false);
      expect(body.rootSessionId).toBe('root-session');
      expect(body.parentSessionId).toBeNull();
      expect(body.ancestors).toEqual([]);
      expect(body.children).toEqual([
        expect.objectContaining({
          id: childBody.id,
          relativeDepth: 1,
        }),
      ]);
      expect(body.descendants).toEqual([
        expect.objectContaining({
          id: childBody.id,
          relativeDepth: 1,
        }),
        expect.objectContaining({
          id: grandchildBody.id,
          relativeDepth: 2,
        }),
      ]);
    } finally {
      cleanup();
    }
  });
});
