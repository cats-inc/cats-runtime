import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRegistry } from './SessionRegistry.js';

describe('SessionRegistry', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  it('creates a session with correct defaults', () => {
    const session = registry.create({
      providerName: 'claude',
      cwd: '/tmp/test',
    });
    expect(session.id).toBeDefined();
    expect(session.providerName).toBe('claude');
    expect(session.status).toBe('initializing');
    expect(session.origin).toBe('runtime');
    expect(session.messageCount).toBe(0);
  });

  it('retrieves a session by id', () => {
    const created = registry.create({ providerName: 'claude', cwd: '/tmp' });
    const fetched = registry.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns undefined for missing session', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all sessions', () => {
    registry.create({ providerName: 'claude', cwd: '/a' });
    registry.create({ providerName: 'claude', cwd: '/b' });
    expect(registry.list()).toHaveLength(2);
  });

  it('filters by status', () => {
    const s1 = registry.create({ providerName: 'claude', cwd: '/a' });
    registry.create({ providerName: 'claude', cwd: '/b' });
    registry.updateStatus(s1.id, 'ready');
    expect(registry.list({ status: 'ready' })).toHaveLength(1);
    expect(registry.list({ status: 'initializing' })).toHaveLength(1);
  });

  it('filters by provider', () => {
    registry.create({ providerName: 'claude', cwd: '/a' });
    registry.create({ providerName: 'gemini', cwd: '/b' });
    expect(registry.list({ provider: 'claude' })).toHaveLength(1);
  });

  it('filters by group', () => {
    registry.create({ providerName: 'claude', cwd: '/a', group: 'project-a' });
    registry.create({ providerName: 'claude', cwd: '/b', group: 'project-b' });
    expect(registry.list({ group: 'project-a' })).toHaveLength(1);
  });

  it('lists both created and discovered sessions', () => {
    registry.create({ providerName: 'claude', cwd: '/a' });
    registry.upsertDiscovered('ext-123', { providerName: 'claude', cwd: '/b' });
    expect(registry.list()).toHaveLength(2);
  });

  it('updates status', () => {
    const s = registry.create({ providerName: 'claude', cwd: '/a' });
    expect(registry.updateStatus(s.id, 'ready')).toBe(true);
    expect(registry.get(s.id)?.status).toBe('ready');
  });

  it('records messages and tokens', () => {
    const s = registry.create({ providerName: 'claude', cwd: '/a' });
    registry.recordMessage(s.id, 100, 50);
    registry.recordMessage(s.id, 200, 100);
    const updated = registry.get(s.id)!;
    expect(updated.messageCount).toBe(2);
    expect(updated.totalInputTokens).toBe(300);
    expect(updated.totalOutputTokens).toBe(150);
  });

  it('sets provider session id', () => {
    const s = registry.create({ providerName: 'claude', cwd: '/a' });
    registry.setProviderSessionId(s.id, 'claude-xyz');
    expect(registry.get(s.id)?.providerSessionId).toBe('claude-xyz');
  });

  it('removes a session', () => {
    const s = registry.create({ providerName: 'claude', cwd: '/a' });
    const result = registry.remove(s.id);
    expect(result.deleted).toBe(true);
    expect(registry.get(s.id)).toBeUndefined();
  });

  describe('upsertDiscovered', () => {
    it('creates a new discovered session', () => {
      const session = registry.upsertDiscovered('ext-abc', {
        providerName: 'claude',
        cwd: '/external',
        messageCount: 5,
      });
      expect(session).not.toBeNull();
      expect(session!.status).toBe('closed');
      expect(session!.origin).toBe('discovered');
      expect(session!.providerSessionId).toBe('ext-abc');
      expect(session!.messageCount).toBe(5);
    });

    it('updates existing discovered session', () => {
      registry.upsertDiscovered('ext-abc', {
        providerName: 'claude',
        cwd: '/external',
        messageCount: 5,
      });
      const updated = registry.upsertDiscovered('ext-abc', {
        providerName: 'claude',
        cwd: '/external',
        messageCount: 10,
      });
      expect(updated).not.toBeNull();
      expect(updated!.messageCount).toBe(10);
      // Should not create duplicates
      expect(registry.list()).toHaveLength(1);
    });

    it('allows rediscovery after remove (best-effort delete)', () => {
      const session = registry.upsertDiscovered('ext-rediscover', {
        providerName: 'claude',
        cwd: '/external',
        messageCount: 3,
      });
      expect(session).not.toBeNull();

      registry.remove(session!.id);
      expect(registry.list()).toHaveLength(0);

      // If the transcript file still exists, scanner can rediscover it
      const rediscovered = registry.upsertDiscovered('ext-rediscover', {
        providerName: 'claude',
        cwd: '/external',
        messageCount: 3,
      });
      expect(rediscovered).not.toBeNull();
      expect(rediscovered!.providerSessionId).toBe('ext-rediscover');
      expect(registry.list()).toHaveLength(1);
    });

  });
});
