import { describe, expect, it } from 'vitest';
import {
  normalizeSessionOrigin,
  sessionWorkspaceKey,
  sessionActivity,
  sessionControlMode,
  sessionControls,
  sessionOwnership,
  sessionResumeStrategy,
  toSessionView,
} from './sessionView.js';
import type { SessionInfo } from './types.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-1',
    providerName: 'claude',
    status: 'closed',
    origin: 'runtime',
    cwd: '/tmp/project',
    workspaceMode: 'shared',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-10T00:00:00Z',
    updatedAt: '2026-03-10T00:00:00Z',
    ...overrides,
  };
}

describe('sessionView helpers', () => {
  it('normalizes legacy managed sessions from the managed flag', () => {
    expect(normalizeSessionOrigin({
      origin: undefined,
      managed: true,
      sourcePath: undefined,
      providerSourcePath: undefined,
    })).toBe('runtime');
  });

  it('infers discovered origin from provider transcript paths outside runtime storage', () => {
    expect(normalizeSessionOrigin({
      origin: undefined,
      managed: undefined,
      sourcePath: '/Users/me/.claude/projects/foo/session.jsonl',
      providerSourcePath: '/Users/me/.claude/projects/foo/session.jsonl',
    }, '/tmp/cats-runtime/sessions')).toBe('discovered');
  });

  it('maps status to explicit activity buckets', () => {
    expect(sessionActivity('ready')).toBe('interactive');
    expect(sessionActivity('closing')).toBe('tearing_down');
    expect(sessionActivity('closed')).toBe('inactive');
  });

  it('builds a case-insensitive workspace key for Windows paths', () => {
    expect(sessionWorkspaceKey('C:\\Users\\sammy\\Source\\Repo')).toBe(
      'c:/users/sammy/source/repo',
    );
    expect(sessionWorkspaceKey('/Users/sammy/Source/Repo')).toBe(
      '/Users/sammy/Source/Repo',
    );
  });

  it('describes provider ownership and resume semantics separately', () => {
    expect(sessionOwnership('claude')).toBe('persistent_process');
    expect(sessionOwnership('auggie')).toBe('logical_session');
    expect(sessionOwnership('cursor')).toBe('logical_session');
    expect(sessionOwnership('kiro')).toBe('workspace_latest');
    expect(sessionResumeStrategy('codex')).toBe('provider_session');
    expect(sessionResumeStrategy('auggie')).toBe('provider_session');
    expect(sessionResumeStrategy('cursor')).toBe('provider_session');
    expect(sessionResumeStrategy('kiro')).toBe('latest_in_workspace');
  });

  it('exposes resume_only control mode for closed resumable sessions', () => {
    const session = makeSession({
      providerName: 'cursor',
      origin: 'discovered',
      providerSessionId: 'cursor-123',
    });

    expect(sessionControlMode(session)).toBe('resume_only');
    expect(sessionControls(session)).toEqual({
      canSend: false,
      canResume: true,
      canClose: false,
      canDelete: true,
      canRefresh: true,
    });
  });

  it('exposes resume_only control mode for discovered Codex sessions with a thread ID', () => {
    const session = makeSession({
      providerName: 'codex',
      origin: 'discovered',
      providerSessionId: 'thread-123',
    });

    expect(sessionControlMode(session)).toBe('resume_only');
    expect(sessionControls(session)).toEqual({
      canSend: false,
      canResume: true,
      canClose: false,
      canDelete: true,
      canRefresh: true,
    });
  });

  it('serializes interactive runtime sessions with actionable controls', () => {
    const view = toSessionView(makeSession({
      providerName: 'antigravity',
      status: 'ready',
      providerSessionId: 'agy-1',
    }), { attached: true });

    expect(view.activity).toBe('interactive');
    expect(view.controlMode).toBe('full');
    expect(view.attached).toBe(true);
    expect(view.ownership).toBe('logical_session');
    expect(view.workspaceKey).toBe('/tmp/project');
    expect(view.controls).toEqual({
      canSend: true,
      canResume: false,
      canClose: true,
      canDelete: true,
      canRefresh: false,
    });
  });

  it('treats recently updated discovered sessions as external live observe-only', () => {
    const session = makeSession({
      providerName: 'claude',
      origin: 'discovered',
      lastActivity: '2026-03-10T00:00:10Z',
      status: 'closed',
      providerSessionId: 'claude-123',
    });

    const view = toSessionView(session, {
      now: Date.parse('2026-03-10T00:00:20Z'),
      externalSessionLiveWindowMs: 15000,
      attached: false,
    });

    expect(view.activity).toBe('interactive');
    expect(view.controlMode).toBe('observe_only');
    expect(view.controls).toEqual({
      canSend: false,
      canResume: false,
      canClose: false,
      canDelete: false,
      canRefresh: true,
    });
  });

  it('marks torn-down attached sessions as non-deletable but still runtime-controlled', () => {
    const view = toSessionView(makeSession({
      status: 'closing',
      providerSessionId: 'claude-123',
    }), { attached: true });

    expect(view.activity).toBe('tearing_down');
    expect(view.controlMode).toBe('full');
    expect(view.controls).toEqual({
      canSend: false,
      canResume: false,
      canClose: false,
      canDelete: false,
      canRefresh: true,
    });
  });
});
