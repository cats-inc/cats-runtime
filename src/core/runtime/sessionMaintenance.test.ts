import { describe, expect, it } from 'vitest';
import type { SessionInfo, SessionView } from '../types.js';
import {
  buildSessionMaintenance,
  cloneMaintenanceRequest,
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
      retryCleanupPath: '/sessions/session-1/workspace/cleanup',
    });
    expect(maintenance.flush).toEqual({
      status: 'pending',
      phase: 'pre_flush',
      hookCount: 1,
      reasonCodes: ['pre_flush_hooks_pending'],
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
      lastRequest: {
        action: 'reset',
        sessionId: 'session-1',
        requestedAt: '2026-03-23T00:09:30.000Z',
        workspaceMode: 'shared',
        isolationMode: 'worktree',
        runtimeCwd: '/sessions/worktrees/repo/session-1',
        sourceCwd: '/repo',
        worktreePath: '/sessions/worktrees/repo/session-1',
        reason: 'owner_requested_reset',
        worktreeDisposition: 'preserve',
        hookPayloads: [{
          kind: 'memory_flush',
          payload: {
            scope: 'summary',
          },
        }],
      },
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
    expect(maintenance.lastRequest).toEqual(expect.objectContaining({
      ...trackedMaintenance.lastRequest,
      hookPayloads: [
        expect.objectContaining({
          kind: 'memory_flush',
          payload: {
            scope: 'summary',
          },
          payloadStatus: 'stored',
          payloadBytes: expect.any(Number),
        }),
      ],
    }));
    expect(maintenance.resetBoundary).toEqual({
      status: 'cleared',
      lastResetAt: '2026-03-23T00:10:00.000Z',
      reasonCodes: [],
    });
    expect(maintenance.lastLifecycle).toEqual(trackedMaintenance.lastLifecycle);
    expect(maintenance.markers).toEqual(trackedMaintenance.markers);
  });

  it('surfaces persisted maintenance follow-through outcomes alongside pending hooks', () => {
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
      trackedMaintenance: {
        lastFollowThrough: {
          action: 'compact',
          phase: 'pre_compaction',
          sessionId: 'session-1',
          observedAt: '2026-03-24T04:00:00.000Z',
          outcome: 'completed',
          reason: 'external_compaction_completed',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              authorization: 'Bearer secret-token',
              summary: 'flush complete',
            },
          }],
        },
        markers: [],
      },
    });

    expect(maintenance.hooks.preCompaction.pending).toHaveLength(1);
    expect(maintenance.lastFollowThrough).toEqual(expect.objectContaining({
      action: 'compact',
      phase: 'pre_compaction',
      outcome: 'completed',
      reason: 'external_compaction_completed',
      hookPayloads: [
        expect.objectContaining({
          kind: 'memory_flush',
          payloadStatus: 'redacted',
          payloadWarnings: expect.arrayContaining(['sensitive_keys_redacted']),
          payload: expect.objectContaining({
            authorization: '[redacted]',
            summary: 'flush complete',
          }),
        }),
      ],
    }));
    expect(maintenance.flush).toEqual({
      status: 'idle',
      phase: 'pre_flush',
      hookCount: 1,
      reasonCodes: [],
    });
  });

  it('summarizes pre-flush follow-through state for delete and cleanup orchestration', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        status: 'closed',
        messageCount: 3,
        totalInputTokens: 300,
        totalOutputTokens: 100,
        workspaceIsolation: {
          mode: 'worktree',
          sourceCwd: '/repo',
          worktree: {
            id: 'repo-session-1',
            sourceRepoRoot: '/repo',
            worktreePath: '/sessions/worktrees/repo/session-1',
            preparedAt: '2026-03-23T00:00:00.000Z',
            lastCleanup: {
              policy: 'preserve',
              status: 'retained',
              observedAt: '2026-03-24T00:00:00.000Z',
              reasonCodes: ['worktree_preserved'],
              mergedPathCount: 0,
            },
          },
        },
      }),
      view: createView({
        attached: false,
        activity: 'inactive',
      }),
      trackedMaintenance: {
        lastRequest: {
          action: 'delete',
          sessionId: 'session-1',
          requestedAt: '2026-03-24T04:00:00.000Z',
          workspaceMode: 'shared',
          isolationMode: 'worktree',
          runtimeCwd: '/sessions/worktrees/repo/session-1',
          sourceCwd: '/repo',
          worktreePath: '/sessions/worktrees/repo/session-1',
          hookPayloads: [],
        },
        lastFollowThrough: {
          action: 'delete',
          phase: 'pre_flush',
          sessionId: 'session-1',
          observedAt: '2026-03-24T04:02:00.000Z',
          outcome: 'retry_requested',
          reason: 'memory_flush_needs_retry',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              scope: 'summary',
            },
          }],
        },
        markers: [],
      },
    });

    expect(maintenance.flush).toEqual(expect.objectContaining({
      status: 'retry_requested',
      phase: 'pre_flush',
      hookCount: 1,
      action: 'delete',
      lastRequestedAt: '2026-03-24T04:00:00.000Z',
      reasonCodes: ['follow_through_retry_requested'],
      lastFollowThrough: expect.objectContaining({
        action: 'delete',
        phase: 'pre_flush',
        outcome: 'retry_requested',
        reason: 'memory_flush_needs_retry',
      }),
    }));
  });

  it('keeps action-scoped pre-flush history even when newer unrelated maintenance records exist', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        status: 'closed',
        messageCount: 3,
        totalInputTokens: 300,
        totalOutputTokens: 100,
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
      trackedMaintenance: {
        lastRequest: {
          action: 'compact',
          sessionId: 'session-1',
          requestedAt: '2026-03-24T05:00:00.000Z',
          workspaceMode: 'shared',
          isolationMode: 'worktree',
          runtimeCwd: '/sessions/worktrees/repo/session-1',
          sourceCwd: '/repo',
          worktreePath: '/sessions/worktrees/repo/session-1',
          hookPayloads: [],
        },
        requestHistory: [
          {
            action: 'delete',
            sessionId: 'session-1',
            requestedAt: '2026-03-24T04:00:00.000Z',
            workspaceMode: 'shared',
            isolationMode: 'worktree',
            runtimeCwd: '/sessions/worktrees/repo/session-1',
            sourceCwd: '/repo',
            worktreePath: '/sessions/worktrees/repo/session-1',
            hookPayloads: [],
          },
          {
            action: 'compact',
            sessionId: 'session-1',
            requestedAt: '2026-03-24T05:00:00.000Z',
            workspaceMode: 'shared',
            isolationMode: 'worktree',
            runtimeCwd: '/sessions/worktrees/repo/session-1',
            sourceCwd: '/repo',
            worktreePath: '/sessions/worktrees/repo/session-1',
            hookPayloads: [],
          },
        ],
        lastFollowThrough: {
          action: 'compact',
          phase: 'pre_compaction',
          sessionId: 'session-1',
          observedAt: '2026-03-24T05:10:00.000Z',
          outcome: 'completed',
          reason: 'external_compaction_completed',
          hookPayloads: [],
        },
        followThroughHistory: [
          {
            action: 'delete',
            phase: 'pre_flush',
            sessionId: 'session-1',
            observedAt: '2026-03-24T04:02:00.000Z',
            outcome: 'acknowledged',
            reason: 'memory_flush_completed',
            hookPayloads: [],
          },
          {
            action: 'compact',
            phase: 'pre_compaction',
            sessionId: 'session-1',
            observedAt: '2026-03-24T05:10:00.000Z',
            outcome: 'completed',
            reason: 'external_compaction_completed',
            hookPayloads: [],
          },
        ],
        markers: [],
      },
    });

    expect(maintenance.flush).toEqual(expect.objectContaining({
      status: 'acknowledged',
      phase: 'pre_flush',
      hookCount: 1,
      action: 'delete',
      lastRequestedAt: '2026-03-24T04:00:00.000Z',
      reasonCodes: ['follow_through_acknowledged'],
      lastFollowThrough: expect.objectContaining({
        action: 'delete',
        phase: 'pre_flush',
        outcome: 'acknowledged',
      }),
    }));
    expect(maintenance.requestHistory).toHaveLength(2);
    expect(maintenance.followThroughHistory).toHaveLength(2);
  });

  it('prefers later pre-flush follow-through records when timestamps tie', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        status: 'closed',
        messageCount: 3,
        totalInputTokens: 300,
        totalOutputTokens: 100,
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
      trackedMaintenance: {
        lastRequest: {
          action: 'delete',
          sessionId: 'session-1',
          requestedAt: '2026-03-24T04:00:00.000Z',
          workspaceMode: 'shared',
          isolationMode: 'worktree',
          runtimeCwd: '/sessions/worktrees/repo/session-1',
          sourceCwd: '/repo',
          worktreePath: '/sessions/worktrees/repo/session-1',
          hookPayloads: [],
        },
        requestHistory: [
          {
            action: 'delete',
            sessionId: 'session-1',
            requestedAt: '2026-03-24T04:00:00.000Z',
            workspaceMode: 'shared',
            isolationMode: 'worktree',
            runtimeCwd: '/sessions/worktrees/repo/session-1',
            sourceCwd: '/repo',
            worktreePath: '/sessions/worktrees/repo/session-1',
            hookPayloads: [],
          },
        ],
        lastFollowThrough: {
          action: 'delete',
          phase: 'pre_flush',
          sessionId: 'session-1',
          observedAt: '2026-03-24T04:02:00.000Z',
          outcome: 'retry_requested',
          reason: 'memory_flush_needs_retry',
          hookPayloads: [],
        },
        followThroughHistory: [
          {
            action: 'delete',
            phase: 'pre_flush',
            sessionId: 'session-1',
            observedAt: '2026-03-24T04:02:00.000Z',
            outcome: 'acknowledged',
            reason: 'memory_flush_completed',
            hookPayloads: [],
          },
          {
            action: 'delete',
            phase: 'pre_flush',
            sessionId: 'session-1',
            observedAt: '2026-03-24T04:02:00.000Z',
            outcome: 'retry_requested',
            reason: 'memory_flush_needs_retry',
            hookPayloads: [],
          },
        ],
        markers: [],
      },
    });

    expect(maintenance.flush).toEqual(expect.objectContaining({
      status: 'retry_requested',
      phase: 'pre_flush',
      hookCount: 1,
      action: 'delete',
      reasonCodes: ['follow_through_retry_requested'],
      lastFollowThrough: expect.objectContaining({
        outcome: 'retry_requested',
        reason: 'memory_flush_needs_retry',
      }),
    }));
  });

  it('uses the last compaction baseline to evaluate only post-compaction live context', () => {
    const maintenance = buildSessionMaintenance({
      session: createSession({
        messageCount: 40,
        totalInputTokens: 9_000,
        totalOutputTokens: 5_000,
      }),
      view: createView({
        attached: false,
        activity: 'inactive',
      }),
      trackedMaintenance: {
        lastCompaction: {
          compactedAt: '2026-03-24T01:00:00.000Z',
          transcriptPath: '/sessions/history/session-1.jsonl',
          baselineMessageCount: 40,
          baselineTotalTokens: 14_000,
          compactedEntryCount: 28,
          retainedEntryCount: 4,
          repairedLineCount: 1,
          aggressivePassCount: 2,
          archivePath: '/sessions/compactions/session-1/2026-03-24T01-00-00-000Z.jsonl',
        },
        markers: [],
      },
    });

    expect(maintenance.compaction).toEqual(expect.objectContaining({
      status: 'not_ready',
      reasonCodes: ['below_compaction_threshold'],
      messageCount: 0,
      totalTokens: 0,
      lastCompaction: expect.objectContaining({
        transcriptPath: '/sessions/history/session-1.jsonl',
        aggressivePassCount: 2,
      }),
    }));
  });

  it('sanitizes persisted maintenance requests with reason truncation and payload redaction or truncation', () => {
    const request = cloneMaintenanceRequest({
      action: 'compact',
      sessionId: 'session-1',
      requestedAt: '2026-03-24T02:00:00.000Z',
      workspaceMode: 'shared',
      isolationMode: 'shared',
      runtimeCwd: '/repo',
      reason: 'x'.repeat(700),
      hookPayloads: [
        {
          kind: 'memory_flush',
          payload: {
            authorization: 'Bearer secret-token',
            summary: 'y'.repeat(700),
            nested: {
              tooDeep: {
                stillDeep: {
                  final: 'trim me',
                },
              },
            },
          },
        },
        {
          kind: 'large_payload',
          payload: {
            entries: Array.from({ length: 80 }, (_, index) => `entry-${index}-${'z'.repeat(120)}`),
          },
        },
      ],
    });

    expect(request.reason?.length).toBeLessThanOrEqual(512);
    expect(request.reasonTruncated).toBe(true);
    expect(request.hookPayloads[0]).toEqual(expect.objectContaining({
      payloadStatus: 'redacted_and_truncated',
      payloadWarnings: expect.arrayContaining(['sensitive_keys_redacted', 'string_truncated']),
      payload: expect.objectContaining({
        authorization: '[redacted]',
      }),
    }));
    expect(request.hookPayloads[1]).toEqual(expect.objectContaining({
      payloadStatus: 'truncated',
      payloadWarnings: expect.arrayContaining(['array_items_truncated']),
      payloadBytes: expect.any(Number),
    }));
    expect(request.hookPayloads[1]).toHaveProperty('payload');
  });
});
