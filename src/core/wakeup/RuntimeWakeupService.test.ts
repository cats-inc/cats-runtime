import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeWakeupConflictError,
  RuntimeWakeupService,
} from './RuntimeWakeupService.js';

describe('RuntimeWakeupService', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  function createPersistPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cats-runtime-wakeup-service-'));
    cleanupPaths.push(dir);
    return join(dir, 'wakeups.json');
  }

  it('coalesces matching scheduled wakeups and rejects duplicate requests without a coalesce key', () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    const service = new RuntimeWakeupService({
      persistPath: createPersistPath(),
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession: vi.fn(async (sessionId) => ({
        sessionId,
        outcome: 'resumed',
      })),
    });

    const first = service.create({
      reason: 'Wake the room.',
      target: { kind: 'session', sessionId: 'session-1' },
      scheduleAt: '2026-03-23T00:05:00.000Z',
      coalesceKey: 'room-1',
      metadata: { source: 'draft' },
    });
    now = new Date('2026-03-23T00:00:30.000Z');
    const second = service.create({
      reason: 'Wake sooner.',
      target: { kind: 'session', sessionId: 'session-1' },
      scheduleAt: '2026-03-23T00:02:00.000Z',
      coalesceKey: 'room-1',
      metadata: { priority: 'high' },
    });

    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    expect(second.request.reason).toBe('Wake sooner.');
    expect(second.request.scheduleAt).toBe('2026-03-23T00:02:00.000Z');
    expect(second.request.coalescedCount).toBe(1);
    expect(second.request.metadata).toEqual({
      source: 'draft',
      priority: 'high',
    });

    service.create({
      reason: 'Same wakeup',
      target: { kind: 'session', sessionId: 'session-2' },
      scheduleAt: '2026-03-23T00:10:00.000Z',
    });
    expect(() => service.create({
      reason: 'Same wakeup',
      target: { kind: 'session', sessionId: 'session-2' },
      scheduleAt: '2026-03-23T00:10:00.000Z',
    })).toThrowError(RuntimeWakeupConflictError);
  });

  it('reloads persisted wakeups and triggers due requests after restart', async () => {
    const persistPath = createPersistPath();
    let now = new Date('2026-03-23T00:00:00.000Z');
    const original = new RuntimeWakeupService({
      persistPath,
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession: vi.fn(async (sessionId) => ({
        sessionId,
        outcome: 'resumed',
      })),
    });

    const created = original.create({
      reason: 'Restart-safe wake.',
      target: { kind: 'session', sessionId: 'session-1' },
      scheduleAt: '2026-03-22T23:59:00.000Z',
    });
    original.close();

    const wakeSession = vi.fn(async (sessionId: string) => ({
      sessionId,
      outcome: 'resumed' as const,
    }));
    const reloaded = new RuntimeWakeupService({
      persistPath,
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession,
    });

    const triggered = await reloaded.runDueWakeups();
    expect(wakeSession).toHaveBeenCalledTimes(1);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({
      id: created.request.id,
      status: 'triggered',
      lastExecution: {
        source: 'timer',
        sessionId: 'session-1',
        outcome: 'resumed',
      },
    });
  });

  it('limits the number of due wakeups processed per timer tick', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    const wakeSession = vi.fn(async (sessionId: string) => ({
      sessionId,
      outcome: 'resumed' as const,
    }));
    const service = new RuntimeWakeupService({
      persistPath: createPersistPath(),
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession,
      maxDuePerTick: 2,
    });

    for (const sessionId of ['session-1', 'session-2', 'session-3']) {
      service.create({
        reason: `Wake ${sessionId}`,
        target: { kind: 'session', sessionId },
        scheduleAt: '2026-03-22T23:59:00.000Z',
      });
    }

    const processed = await service.runDueWakeups();
    expect(processed).toHaveLength(2);
    expect(wakeSession).toHaveBeenCalledTimes(2);
    expect(service.list({ status: 'scheduled' })).toHaveLength(1);
  });

  it('prunes older terminal wakeups while retaining recent history within bounded limits', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    const service = new RuntimeWakeupService({
      persistPath: createPersistPath(),
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession: vi.fn(async (sessionId: string) => ({
        sessionId,
        outcome: 'resumed' as const,
      })),
      maxTerminalRequests: 2,
      maxTerminalRequestsPerSession: 1,
    });

    for (const sessionId of ['session-1', 'session-1', 'session-2']) {
      const created = service.create({
        reason: `Wake ${sessionId}`,
        target: { kind: 'session', sessionId },
        scheduleAt: now.toISOString(),
      });
      await service.trigger(created.request.id, 'manual');
      now = new Date(now.getTime() + 1_000);
    }

    const terminal = service.list().filter((request) =>
      request.status === 'triggered',
    );

    expect(terminal).toHaveLength(2);
    expect(terminal.map((request) => request.target.sessionId)).toEqual([
      'session-1',
      'session-2',
    ]);
    expect(service.getSessionWakeState('session-1')?.lastRequest?.reason).toBe('Wake session-1');
  });

  it('reschedules recurring cron wakeups after automatic and manual triggers', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    const wakeSession = vi.fn(async (sessionId: string) => ({
      sessionId,
      outcome: 'resumed' as const,
    }));
    const service = new RuntimeWakeupService({
      persistPath: createPersistPath(),
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession,
    });

    const created = service.create({
      reason: 'Recurring wake.',
      target: { kind: 'session', sessionId: 'session-1' },
      recurrence: {
        kind: 'cron',
        expression: '*/5 * * * *',
        timezone: 'UTC',
      },
    });

    expect(created.request.scheduleAt).toBe('2026-03-23T00:05:00.000Z');
    now = new Date('2026-03-23T00:05:00.000Z');
    const timerTriggered = await service.runDueWakeups();
    expect(timerTriggered).toHaveLength(1);
    expect(timerTriggered[0]).toMatchObject({
      id: created.request.id,
      status: 'scheduled',
      scheduleAt: '2026-03-23T00:10:00.000Z',
      lastExecution: {
        source: 'timer',
        outcome: 'resumed',
      },
    });

    now = new Date('2026-03-23T00:07:30.000Z');
    const manualTriggered = await service.trigger(created.request.id, 'manual');
    expect(manualTriggered).toMatchObject({
      id: created.request.id,
      status: 'scheduled',
      scheduleAt: '2026-03-23T00:10:00.000Z',
      lastExecution: {
        source: 'manual',
        outcome: 'resumed',
      },
    });
    expect(wakeSession).toHaveBeenCalledTimes(2);
  });

  it('builds aggregate diagnostics summaries for runtime-wide wakeup state', async () => {
    const now = new Date('2026-03-23T00:00:00.000Z');
    const service = new RuntimeWakeupService({
      persistPath: createPersistPath(),
      now: () => new Date(now),
      sessionExists: () => true,
      wakeSession: vi.fn(async (sessionId: string) => {
        if (sessionId === 'session-failed') {
          throw new Error('wake failed');
        }

        return {
          sessionId,
          outcome: 'resumed' as const,
        };
      }),
    });

    service.create({
      reason: 'Future wake.',
      target: { kind: 'session', sessionId: 'session-future' },
      scheduleAt: '2026-03-23T00:10:00.000Z',
    });
    service.create({
      reason: 'Due wake.',
      target: { kind: 'session', sessionId: 'session-due' },
      scheduleAt: '2026-03-22T23:59:00.000Z',
    });
    service.create({
      reason: 'Recurring wake.',
      target: { kind: 'session', sessionId: 'session-recurring' },
      recurrence: {
        kind: 'cron',
        expression: '*/5 * * * *',
        timezone: 'UTC',
      },
    });
    const cancelled = service.create({
      reason: 'Cancelled wake.',
      target: { kind: 'session', sessionId: 'session-cancelled' },
      scheduleAt: '2026-03-23T00:02:00.000Z',
    });
    service.cancel(cancelled.request.id);
    const failed = service.create({
      reason: 'Failing wake.',
      target: { kind: 'session', sessionId: 'session-failed' },
      scheduleAt: '2026-03-23T00:00:00.000Z',
    });
    await service.trigger(failed.request.id, 'manual');

    service.start();
    const snapshot = service.buildDiagnosticsSnapshot();
    service.close();

    expect(snapshot).toEqual({
      summary: {
        status: 'degraded',
        summary: '1 wakeup request(s) have failed and need attention.',
        totalRequests: 5,
        openRequests: 3,
        scheduled: 3,
        due: 1,
        triggering: 0,
        recurring: 1,
        terminal: 2,
        triggered: 0,
        cancelled: 1,
        failed: 1,
        sessionsWithPending: 3,
        nextScheduledAt: '2026-03-22T23:59:00.000Z',
      },
      timer: {
        active: true,
        processing: false,
        tickIntervalMs: 1000,
        maxDuePerTick: 8,
      },
      retention: {
        maxTerminalRequests: 256,
        maxTerminalRequestsPerSession: 16,
      },
      samples: {
        due: [
          expect.objectContaining({
            id: expect.any(String),
            sessionId: 'session-due',
            status: 'scheduled',
            scheduleAt: '2026-03-22T23:59:00.000Z',
            recurring: false,
          }),
        ],
        failed: [
          expect.objectContaining({
            id: failed.request.id,
            sessionId: 'session-failed',
            status: 'failed',
            scheduleAt: '2026-03-23T00:00:00.000Z',
            recurring: false,
            lastError: 'wake failed',
          }),
        ],
      },
    });
  });
});
