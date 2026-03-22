import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionRegistry } from './SessionRegistry.js';

describe('SessionRegistry', () => {
  let registry: SessionRegistry;
  let tempDir: string;

  beforeEach(() => {
    registry = new SessionRegistry();
    tempDir = mkdtempSync(join(tmpdir(), 'session-registry-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
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

  it('persists runtime-managed skill state across reloads', () => {
    const persistDir = mkdtempSync(join(tmpdir(), 'session-registry-skills-test-'));

    try {
      registry = new SessionRegistry(persistDir);
      const session = registry.create({
        providerName: 'claude',
        cwd: '/repo',
        skills: {
          profileId: 'companion',
          requestedSkills: ['companion'],
          resolvedSkills: [{
            id: 'companion',
            title: 'Companion',
            status: 'resolved',
            deliveryMode: 'instructions',
            source: 'runtime_catalog',
            skillPath: 'skills/companion/SKILL.md',
          }],
          strict: false,
          warnings: [],
          appliedSkillIds: ['companion'],
          updatedAt: '2026-03-22T00:00:00.000Z',
        },
      });
      registry.flush();

      const reloaded = new SessionRegistry(persistDir);
      expect(reloaded.get(session.id)?.skills).toEqual({
        profileId: 'companion',
        requestedSkills: ['companion'],
        resolvedSkills: [{
          id: 'companion',
          title: 'Companion',
          status: 'resolved',
          deliveryMode: 'instructions',
          source: 'runtime_catalog',
          skillPath: 'skills/companion/SKILL.md',
        }],
        strict: false,
        warnings: [],
        appliedSkillIds: ['companion'],
        updatedAt: '2026-03-22T00:00:00.000Z',
      });
    } finally {
      rmSync(persistDir, { recursive: true, force: true });
    }
  });

  it('persists provider state metadata across reloads', () => {
    const persistDir = mkdtempSync(join(tmpdir(), 'session-registry-state-test-'));

    try {
      registry = new SessionRegistry(persistDir);
      const session = registry.create({ providerName: 'gemini', cwd: '/repo' });
      registry.setProviderState(session.id, {
        geminiCachedContent: {
          name: 'cachedContents/test-cache',
          key: 'cache-key',
          model: 'gemini-3-flash-preview',
          prefixMessageCount: 2,
          expiresAt: '2026-03-16T03:00:00Z',
        },
      });
      registry.flush();

      const reloaded = new SessionRegistry(persistDir);
      expect(reloaded.get(session.id)?.providerState).toEqual({
        geminiCachedContent: {
          name: 'cachedContents/test-cache',
          key: 'cache-key',
          model: 'gemini-3-flash-preview',
          prefixMessageCount: 2,
          expiresAt: '2026-03-16T03:00:00Z',
        },
      });
    } finally {
      rmSync(persistDir, { recursive: true, force: true });
    }
  });

  it('removes a session', () => {
    const s = registry.create({ providerName: 'claude', cwd: '/a' });
    const result = registry.remove(s.id);
    expect(result.deleted).toBe(true);
    expect(registry.get(s.id)).toBeUndefined();
  });

  it('does not partially delete runtime transcripts when one path cannot be removed', () => {
    registry = new SessionRegistry(undefined, tempDir);
    const session = registry.create({ providerName: 'claude', cwd: '/repo' });
    const artifactDir = join(tempDir, 'artifacts');
    mkdirSync(artifactDir, { recursive: true });

    const goodTranscript = join(artifactDir, `${session.id}.jsonl`);
    const badTranscript = join(artifactDir, `${session.id}-blocked.jsonl`);
    writeFileSync(goodTranscript, '{"ok":true}\n');
    writeFileSync(badTranscript, '{"blocked":true}\n');

    registry.setSourcePath(session.id, goodTranscript);
    registry.get(session.id)!.providerSourcePath = badTranscript;

    const registryWithPrivateAccess = registry as SessionRegistry & {
      stageTranscriptArtifact: (path: string) => unknown;
    };
    const originalStage = registryWithPrivateAccess.stageTranscriptArtifact.bind(registryWithPrivateAccess);
    const stageSpy = vi.spyOn(registryWithPrivateAccess, 'stageTranscriptArtifact');
    stageSpy.mockImplementation((path: string) => {
      if (path === badTranscript) {
        throw new Error('blocked');
      }

      return originalStage(path);
    });

    try {
      const result = registry.deleteTranscripts(session.id);

      expect(result.fileDeleted).toBe(false);
      expect(existsSync(goodTranscript)).toBe(true);
      expect(existsSync(badTranscript)).toBe(true);
      expect(registry.get(session.id)).toBeDefined();
    } finally {
      stageSpy.mockRestore();
    }
  });

  it('prunes closed discovered sessions that are no longer present for a provider target', () => {
    registry = new SessionRegistry(undefined, undefined, { pi: 'native' });

    const stale = registry.upsertDiscovered('pi-stale', {
      providerName: 'pi',
      providerInstanceId: 'native',
      cwd: '/tmp/stale',
      sourcePath: '/tmp/stale.jsonl',
    });
    const retained = registry.upsertDiscovered('pi-keep', {
      providerName: 'pi',
      providerInstanceId: 'native',
      cwd: '/tmp/keep',
      sourcePath: '/tmp/keep.jsonl',
    });
    const otherInstance = registry.upsertDiscovered('pi-other', {
      providerName: 'pi',
      providerInstanceId: 'lab',
      cwd: '/tmp/other',
      sourcePath: '/tmp/other.jsonl',
    });
    const resumed = registry.upsertDiscovered('pi-live', {
      providerName: 'pi',
      providerInstanceId: 'native',
      cwd: '/tmp/live',
      sourcePath: '/tmp/live.jsonl',
    });
    registry.updateStatus(resumed!.id, 'ready');

    const removed = registry.pruneMissingDiscovered(
      'pi',
      ['pi-keep'],
      'cli',
      'native',
    );

    expect(removed).toBe(1);
    expect(registry.get(stale!.id)).toBeUndefined();
    expect(registry.get(retained!.id)).toBeDefined();
    expect(registry.get(otherInstance!.id)).toBeDefined();
    expect(registry.get(resumed!.id)?.status).toBe('ready');
  });

  it('reattaches Pi providerSourcePath after runtime-managed history takes over', () => {
    registry = new SessionRegistry(undefined, '/tmp/cats-runtime/sessions');

    const session = registry.create({
      providerName: 'pi',
      cwd: '/repo',
    });
    registry.setSourcePath(session.id, '/tmp/cats-runtime/sessions/history/pi-runtime.jsonl');
    registry.clearProviderResumeState(session.id, { clearProviderSourcePath: true });

    const merged = registry.upsertDiscovered('pi-new', {
      providerName: 'pi',
      cwd: '/repo',
      sourcePath: '/home/tester/.pi/agent/sessions/repo/session.jsonl',
    });

    expect(merged?.id).toBe(session.id);
    expect(registry.get(session.id)?.providerSourcePath).toBe(
      '/home/tester/.pi/agent/sessions/repo/session.jsonl',
    );
    expect(registry.get(session.id)?.sourcePath).toBe(
      '/tmp/cats-runtime/sessions/history/pi-runtime.jsonl',
    );
  });

  it('normalizes legacy default instance ids to the configured default instance on load', () => {
    const persistDir = mkdtempSync(join(tmpdir(), 'session-registry-load-test-'));
    const persistPath = join(persistDir, 'sessions.json');
    writeFileSync(persistPath, JSON.stringify([
      {
        id: 'legacy-default',
        providerSessionId: 'claude-session-1',
        providerName: 'claude',
        providerInstanceId: 'default',
        status: 'closed',
        origin: 'discovered',
        cwd: '/repo',
        workspaceMode: 'shared',
        summary: 'push',
        messageCount: 111,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: '2026-03-15T21:09:25.906Z',
        updatedAt: '2026-03-15T21:34:35.096Z',
        lastActivity: '2026-03-15T21:34:32.934Z',
      },
      {
        id: 'native-default',
        providerSessionId: 'claude-session-1',
        providerName: 'claude',
        providerInstanceId: 'native',
        status: 'closed',
        origin: 'discovered',
        cwd: '/repo',
        workspaceMode: 'shared',
        summary: 'push',
        messageCount: 111,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: '2026-03-15T21:34:54.407Z',
        updatedAt: '2026-03-15T21:35:30.586Z',
        lastActivity: '2026-03-15T21:34:32.934Z',
      },
    ], null, 2));

    try {
      registry = new SessionRegistry(
        persistDir,
        undefined,
        { claude: 'native' },
      );

      const sessions = registry.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        providerName: 'claude',
        providerInstanceId: 'native',
        providerSessionId: 'claude-session-1',
        createdAt: '2026-03-15T21:09:25.906Z',
        updatedAt: '2026-03-15T21:35:30.586Z',
      });
    } finally {
      rmSync(persistDir, { recursive: true, force: true });
    }
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

    it('treats legacy default and configured default instance ids as the same discovered session', () => {
      const persistDir = mkdtempSync(join(tmpdir(), 'session-registry-alias-test-'));
      const persistPath = join(persistDir, 'sessions.json');
      writeFileSync(persistPath, JSON.stringify([
        {
          id: 'legacy-default',
          providerSessionId: 'claude-session-1',
          providerName: 'claude',
          providerInstanceId: 'default',
          status: 'closed',
          origin: 'discovered',
          cwd: '/repo',
          workspaceMode: 'shared',
          summary: 'push',
          messageCount: 111,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          createdAt: '2026-03-15T21:09:25.906Z',
          updatedAt: '2026-03-15T21:34:35.096Z',
          lastActivity: '2026-03-15T21:34:32.934Z',
        },
      ], null, 2));

      try {
        registry = new SessionRegistry(
          persistDir,
          undefined,
          { claude: 'native' },
        );

        const updated = registry.upsertDiscovered('claude-session-1', {
          providerName: 'claude',
          providerInstanceId: 'native',
          cwd: '/repo',
          messageCount: 112,
        });

        expect(updated).not.toBeNull();
        expect(registry.list()).toHaveLength(1);
        expect(updated).toMatchObject({
          id: 'legacy-default',
          providerInstanceId: 'native',
          providerSessionId: 'claude-session-1',
          messageCount: 112,
        });
      } finally {
        rmSync(persistDir, { recursive: true, force: true });
      }
    });

    it('merges into runtime session whose providerSessionId is not yet set', () => {
      // Simulate: runtime session created (providerSessionId still null),
      // then discovery finds the same provider session before the first
      // message completes.
      const runtime = registry.create({
        providerName: 'kiro',
        cwd: '/workspace',
      });
      registry.updateStatus(runtime.id, 'ready');

      const result = registry.upsertDiscovered('kiro-native-abc', {
        providerName: 'kiro',
        cwd: '/workspace',
        messageCount: 1,
        summary: 'discovered summary',
      });

      // Should merge into the existing runtime session, not create a new one
      expect(result).not.toBeNull();
      expect(result!.id).toBe(runtime.id);
      expect(result!.origin).toBe('runtime');
      expect(result!.providerSessionId).toBe('kiro-native-abc');
      expect(result!.messageCount).toBe(1);
      expect(registry.list()).toHaveLength(1);
    });

    it('does not merge into a closed runtime session', () => {
      const runtime = registry.create({
        providerName: 'copilot',
        cwd: '/workspace',
      });
      registry.updateStatus(runtime.id, 'closed');

      const result = registry.upsertDiscovered('copilot-xyz', {
        providerName: 'copilot',
        cwd: '/workspace',
      });

      // Closed runtime session should not be matched — new discovered session created
      expect(result).not.toBeNull();
      expect(result!.id).not.toBe(runtime.id);
      expect(result!.origin).toBe('discovered');
      expect(registry.list()).toHaveLength(2);
    });

    it('does not merge when provider name differs', () => {
      registry.create({
        providerName: 'kiro',
        cwd: '/workspace',
      });

      const result = registry.upsertDiscovered('copilot-xyz', {
        providerName: 'copilot',
        cwd: '/workspace',
      });

      expect(result!.origin).toBe('discovered');
      expect(registry.list()).toHaveLength(2);
    });

    it('does not merge when cwd differs', () => {
      registry.create({
        providerName: 'kiro',
        cwd: '/workspace-a',
      });

      const result = registry.upsertDiscovered('kiro-abc', {
        providerName: 'kiro',
        cwd: '/workspace-b',
      });

      expect(result!.origin).toBe('discovered');
      expect(registry.list()).toHaveLength(2);
    });

    it('defers ambiguous discovery until a runtime session reports its provider session ID', () => {
      const first = registry.create({
        providerName: 'copilot',
        cwd: '/workspace',
      });
      const second = registry.create({
        providerName: 'copilot',
        cwd: '/workspace',
      });

      const result = registry.upsertDiscovered('copilot-ambiguous', {
        providerName: 'copilot',
        cwd: '/workspace',
        messageCount: 1,
        summary: 'pending discovery',
      });

      // Ambiguous runtime candidates should not create a duplicate or
      // merge into an arbitrary session.
      expect(result).toBeNull();
      expect(registry.list()).toHaveLength(2);
      expect(registry.get(first.id)?.providerSessionId).toBeUndefined();
      expect(registry.get(second.id)?.providerSessionId).toBeUndefined();

      // Once the correct runtime session reports its provider session ID,
      // the pending discovery metadata is merged exactly.
      registry.setProviderSessionId(second.id, 'copilot-ambiguous');
      const merged = registry.get(second.id)!;
      expect(merged.providerSessionId).toBe('copilot-ambiguous');
      expect(merged.messageCount).toBe(1);
      expect(merged.summary).toBe('pending discovery');
      expect(registry.list()).toHaveLength(2);
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
