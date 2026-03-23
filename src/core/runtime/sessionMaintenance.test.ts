import { describe, expect, it } from 'vitest';
import type { SessionInfo, SessionView } from '../types.js';
import {
  buildSessionMaintenance,
  type RuntimeTrackedSessionMaintenanceState,
} from './sessionMaintenance.js';

function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    providerName: 'claude',
    status: 'ready',
    origin: 'runtime',
    cwd: '/repo',
    workspaceMode: 'shared',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    ...overrides,
  };
}

function createView(overrides: Partial<Pick<SessionView, 'attached' | 'activity'>> = {}) {
  return {
    attached: true,
    activity: 'interactive' as const,
    ...overrides,
  };
}

describe('buildSessionMaintenance', () => {
  it('marks active high-volume sessions as compaction recommended with a pending pre-compaction hook', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        messageCount: 32,
        totalInputTokens: 8_000,
        totalOutputTokens: 6_500,
      }),
      view: createView(),
    });

    expect(maintenance.status).toBe('clean');
    expect(maintenance.compaction).toEqual({
      status: 'recommended',
      reasonCodes: ['message_count_threshold', 'token_threshold', 'session_active'],
      messageCount: 32,
      totalTokens: 14_500,
    });
    expect(maintenance.hooks.preCompaction).toEqual({
      available: true,
      pending: [
        expect.objectContaining({
          id: 'memory_flush',
          phase: 'pre_compaction',
          status: 'pending',
        }),
      ],
    });
  });

  it('marks inactive high-volume sessions as attention when compaction is ready now', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        status: 'closed',
        messageCount: 32,
        totalInputTokens: 8_000,
        totalOutputTokens: 6_500,
      }),
      view: createView({
        attached: false,
        activity: 'inactive',
      }),
    });

    expect(maintenance.status).toBe('attention');
    expect(maintenance.compaction).toEqual({
      status: 'ready',
      reasonCodes: ['message_count_threshold', 'token_threshold', 'session_inactive'],
      messageCount: 32,
      totalTokens: 14_500,
    });
  });

  it('marks closed isolated sessions as cleanup-ready when only workspace cleanup remains', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        status: 'closed',
        workspaceMode: 'isolated',
      }),
      view: createView({
        attached: false,
        activity: 'inactive',
      }),
    });

    expect(maintenance.status).toBe('cleanup_ready');
    expect(maintenance.cleanup).toEqual({
      status: 'ready',
      reasonCodes: ['isolated_workspace_retained'],
    });
  });

  it('surfaces a pre-flush hook when a closed worktree session still has retained workspace state', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        status: 'closed',
        workspaceMode: 'shared',
        cwd: '/sessions/worktrees/repo/session-1',
        workspaceIsolation: {
          mode: 'worktree',
          sourceCwd: '/repo',
          worktree: {
            id: 'repo-session-1',
            sourceRepoRoot: '/repo',
            worktreePath: '/sessions/worktrees/repo/session-1',
            preparedAt: '2026-03-23T00:00:00.000Z',
          },
        },
      }),
      view: createView({
        attached: false,
        activity: 'inactive',
      }),
    });

    expect(maintenance.status).toBe('cleanup_ready');
    expect(maintenance.cleanup).toEqual({
      status: 'ready',
      reasonCodes: ['worktree_retained'],
    });
    expect(maintenance.hooks.preFlush).toEqual({
      available: true,
      pending: [
        expect.objectContaining({
          id: 'memory_flush',
          phase: 'pre_flush',
          status: 'pending',
        }),
      ],
    });
  });

  it('surfaces reset boundary and retained lifecycle markers from tracked maintenance state', () => {
    const trackedMaintenance: RuntimeTrackedSessionMaintenanceState = {
      lastResetAt: '2026-03-23T00:10:00.000Z',
      lastLifecycle: {
        action: 'delete',
        boundary: 'permanent_delete',
        status: 'retained',
        observedAt: '2026-03-23T00:11:00.000Z',
        reasonCodes: ['cleanup_verification_failed'],
        cleanup: {
          workerDetached: true,
        },
      },
      markers: [
        {
          code: 'reset_completed',
          observedAt: '2026-03-23T00:10:00.000Z',
          status: 'completed',
        },
      ],
    };

    const maintenance = buildSessionMaintenance({
      session: createSession({
        messageCount: 4,
        totalInputTokens: 400,
        totalOutputTokens: 200,
      }),
      view: createView({
        attached: false,
        activity: 'inactive',
      }),
      trackedMaintenance,
    });

    expect(maintenance.status).toBe('attention');
    expect(maintenance.resetBoundary).toEqual({
      status: 'cleared',
      lastResetAt: '2026-03-23T00:10:00.000Z',
      reasonCodes: [],
    });
    expect(maintenance.lastLifecycle).toEqual(trackedMaintenance.lastLifecycle);
    expect(maintenance.markers).toEqual(trackedMaintenance.markers);
  });
});
