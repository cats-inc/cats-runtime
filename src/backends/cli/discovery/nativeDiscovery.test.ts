import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../pool/SessionRegistry.js';
import { syncNativeSessions } from './nativeDiscovery.js';

describe('syncNativeSessions', () => {
  it('imports newly discovered native sessions into the registry', () => {
    const registry = new SessionRegistry();

    const result = syncNativeSessions(registry, 'cursor', [
      {
        providerSessionId: 'cursor-1',
        cwd: '/tmp/project-a',
        summary: 'First session',
        messageCount: 3,
      },
      {
        providerSessionId: 'cursor-2',
        cwd: '/tmp/project-b',
        summary: 'Second session',
        messageCount: 1,
      },
    ]);

    expect(result).toEqual({ newCount: 2, syncedCount: 2 });
    expect(registry.list({ provider: 'cursor' })).toHaveLength(2);
  });

  it('updates existing sessions without counting them as new', () => {
    const registry = new SessionRegistry();

    syncNativeSessions(registry, 'kiro', [
      {
        providerSessionId: 'kiro-1',
        cwd: '/tmp/project-a',
        summary: 'Old summary',
        messageCount: 1,
      },
    ]);

    const result = syncNativeSessions(registry, 'kiro', [
      {
        providerSessionId: 'kiro-1',
        cwd: '/tmp/project-a',
        summary: 'Updated summary',
        messageCount: 4,
        lastActivity: '2026-03-10T00:00:00Z',
      },
    ]);

    expect(result).toEqual({ newCount: 0, syncedCount: 1 });

    const session = registry.list({ provider: 'kiro' })[0];
    expect(session.summary).toBe('Updated summary');
    expect(session.messageCount).toBe(4);
    expect(session.lastActivity).toBe('2026-03-10T00:00:00Z');
  });

  it('prunes stale closed discovered native sessions that no longer exist', () => {
    const registry = new SessionRegistry();
    const stale = registry.upsertDiscovered('goose-stale', {
      providerName: 'goose',
      cwd: '/tmp/stale',
      summary: 'stale',
      messageCount: 1,
    });
    const resumed = registry.upsertDiscovered('goose-live', {
      providerName: 'goose',
      cwd: '/tmp/live',
      summary: 'live',
      messageCount: 1,
    });
    registry.updateStatus(resumed!.id, 'ready');

    const result = syncNativeSessions(registry, 'goose', [
      {
        providerSessionId: 'goose-fresh',
        cwd: '/tmp/fresh',
        summary: 'fresh',
        messageCount: 2,
      },
    ]);

    expect(result).toEqual({ newCount: 1, syncedCount: 1 });
    expect(registry.get(stale!.id)).toBeUndefined();
    expect(registry.get(resumed!.id)?.status).toBe('ready');
    expect(
      registry.list({ provider: 'goose' }).map((session) => session.providerSessionId).sort(),
    ).toEqual(['goose-fresh', 'goose-live']);
  });
});
