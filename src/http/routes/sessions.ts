import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import type {
  SessionInfo,
  SessionStatus,
  WorkspaceMode,
} from '../../backends/cli/pool/types.js';
import { KNOWN_PROVIDERS } from '../../backends/cli/providers/types.js';
import {
  resolveWorkspace,
  cleanupIsolatedWorkspace,
  copyIsolatedWorkspace,
} from '../../backends/cli/pool/workspace.js';
import {
  toSessionView,
  toSessionViews,
} from '../../backends/cli/pool/sessionView.js';

export const sessionRoutes = new Hono();
const SESSION_PROVIDERS = KNOWN_PROVIDERS;

function serializeSession(ctx: AppContext, session: SessionInfo) {
  return toSessionView(session, {
    attached: Boolean(ctx.pool.get(session.id)?.alive),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
}

function serializeSessions(
  ctx: AppContext,
  sessions: SessionInfo[],
) {
  return toSessionViews(sessions, {
    isAttached: (session) => Boolean(ctx.pool.get(session.id)?.alive),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
}

function tracksNativeSessionState(session: SessionInfo): boolean {
  return Boolean(
    session.providerSessionId
    && (session.providerName === 'cursor'
      || session.providerName === 'kiro'
      || session.providerName === 'opencode'),
  );
}

async function deleteNativeSessionState(
  ctx: AppContext,
  session: SessionInfo,
): Promise<boolean> {
  if (!session.providerSessionId) return true;

  if (session.providerName === 'cursor') {
    const deleted = await ctx.cursorNative.deleteSession(session.cwd, session.providerSessionId);
    if (!deleted) return false;
    const remaining = await ctx.cursorNative.listSessions(
      session.cwd,
      { startIfNeeded: false },
    );
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'kiro') {
    const deleted = await ctx.kiroNative.deleteSession(session.cwd, session.providerSessionId);
    if (!deleted) return false;
    const remaining = await ctx.kiroNative.listSessions(
      session.cwd,
      { startIfNeeded: false },
    );
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'opencode') {
    const deleted = await ctx.opencodeNative.deleteSession(session.cwd, session.providerSessionId);
    if (!deleted) return false;
    const remaining = await ctx.opencodeNative.getSession(session.cwd, session.providerSessionId);
    return remaining == null;
  }

  return true;
}

/** POST /sessions — create a new runtime-owned session */
sessionRoutes.post('/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{
    provider?: string;
    cwd?: string;
    model?: string;
    group?: string;
    workspaceMode?: WorkspaceMode;
    managed?: boolean;
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
  }>();

  const providerName = body.provider ?? 'claude';

  if (!(SESSION_PROVIDERS as readonly string[]).includes(providerName)) {
    return c.json({
      error: `Unknown provider '${providerName}'. Valid: ${SESSION_PROVIDERS.join(', ')}`,
    }, 400);
  }

  const sessionId = randomUUID();

  let resolved;
  try {
    resolved = resolveWorkspace({
      sessionId,
      sessionBaseDir: ctx.config.sessionBaseDir,
      cwd: body.cwd || undefined,
      workspaceMode: body.workspaceMode,
      permissionMode: body.permissionMode,
    });
  } catch (err) {
    return c.json({ error: `${err}` }, 400);
  }

  if (providerName === 'cursor') {
    const caps = ctx.pool.getCapabilities('cursor');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await ctx.cursorNative.createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'cursor',
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model || native.model,
        group: body.group,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      ctx.pool.spawn(session.id, providerName, {
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model || native.model,
        resumeSessionId: native.providerSessionId,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      });
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await ctx.cursorNative.deleteSession(resolved.cwd, nativeProviderSessionId);
        } catch {
          // Best effort rollback only.
        }
      }
      if (resolved.workspaceMode === 'isolated') {
        cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
      }
      return c.json({ error: `Failed to create Cursor session: ${err}` }, 500);
    }
  }

  if (providerName === 'opencode') {
    const caps = ctx.pool.getCapabilities('opencode');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await ctx.opencodeNative.createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'opencode',
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model,
        group: body.group,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      ctx.pool.spawn(session.id, providerName, {
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model,
        resumeSessionId: native.providerSessionId,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      });
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await ctx.opencodeNative.deleteSession(resolved.cwd, nativeProviderSessionId);
        } catch {
          // Best effort rollback only.
        }
      }
      if (resolved.workspaceMode === 'isolated') {
        cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
      }
      return c.json({ error: `Failed to create OpenCode session: ${err}` }, 500);
    }
  }

  const caps = ctx.pool.getCapabilities(providerName);

  if (!caps.permissions && resolved.workspaceMode === 'read_only') {
    return c.json({
      error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
    }, 400);
  }

  const warnings: string[] = [];
  if (!caps.permissions && body.permissionMode && body.permissionMode !== 'skip') {
    warnings.push(`Provider '${providerName}' runs in full-auto mode; permissionMode '${body.permissionMode}' is ignored`);
  }

  const session = ctx.registry.create({
    id: sessionId,
    providerName,
    cwd: resolved.cwd,
    workspaceMode: resolved.workspaceMode,
    model: body.model,
    group: body.group,
  });

  try {
    ctx.pool.spawn(session.id, providerName, {
      cwd: resolved.cwd,
      workspaceMode: resolved.workspaceMode,
      model: body.model,
      permissionMode: resolved.permissionMode,
      allowedTools: body.allowedTools,
    });
  } catch (err) {
    if (resolved.workspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
    }
    ctx.registry.remove(session.id);
    return c.json({ error: `Failed to spawn session: ${err}` }, 500);
  }

  return c.json({ ...serializeSession(ctx, session), ...(warnings.length ? { warnings } : {}) }, 201);
});

/** GET /sessions — list sessions */
sessionRoutes.get('/sessions', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;

  const status = c.req.query('status') as SessionStatus | undefined;
  const provider = c.req.query('provider');
  const group = c.req.query('group');

  const sessions = ctx.registry.list({ status, provider, group });
  return c.json({ sessions: serializeSessions(ctx, sessions), count: sessions.length });
});

/** GET /sessions/:id — get session details */
sessionRoutes.get('/sessions/:id', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const session = ctx.registry.get(c.req.param('id'));

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json(serializeSession(ctx, session));
});

/** POST /sessions/:id/close — stop worker, keep session in registry */
sessionRoutes.post('/sessions/:id/close', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.attached && view.activity === 'interactive') {
      return c.json({
      error: 'This session appears to be active outside cats-runtime and can only be observed right now.',
    }, 409);
  }

  if (session.providerName === 'cursor') {
    const worker = ctx.pool.get(id);
    if (worker?.alive) {
      ctx.registry.updateStatus(id, 'closing');
      ctx.pool.kill(id);
      return c.json({ status: 'closing' });
    }
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ status: 'closed' });
  }

  const worker = ctx.pool.get(id);
  if (!worker?.alive) {
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ status: 'closed' });
  }

  ctx.registry.updateStatus(id, 'closing');
  ctx.pool.kill(id);
  return c.json({ status: 'closing' });
});

/** DELETE /sessions/:id — permanently remove session and delete .jsonl */
sessionRoutes.delete('/sessions/:id', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.controls.canDelete) {
    return c.json({
      error: 'This session is still active outside cats-runtime or is already closing. Wait before deleting it.',
    }, 409);
  }

  const preparedTranscripts = ctx.registry.prepareManagedTranscriptDeletion(id);
  const hasNativeSessionState = tracksNativeSessionState(session);
  const hadTranscript = preparedTranscripts.hadFiles || hasNativeSessionState;

  if (!preparedTranscripts.ready) {
    return c.json({
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session files are locked or in use. Nothing was removed.',
    });
  }

  let nativeDeleted = false;
  try {
    if (hasNativeSessionState) {
      nativeDeleted = await deleteNativeSessionState(ctx, session);
    }
  } catch (err) {
    preparedTranscripts.rollback();
    return c.json({ error: `Failed to delete native ${session.providerName} session: ${err}` }, 500);
  }

  const nativeCleanupSucceeded = !hasNativeSessionState || nativeDeleted;
  if (!nativeCleanupSucceeded) {
    preparedTranscripts.rollback();
    return c.json({
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session cleanup could not be verified. Nothing was removed.',
    });
  }

  const worker = ctx.pool.get(id);
  if (worker) {
    ctx.pool.kill(id);
  }

  const { fileDeleted } = preparedTranscripts.finalize();
  let workspaceCleaned = false;
  if (session.workspaceMode === 'isolated') {
    workspaceCleaned = cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, id);
  }
  ctx.registry.unregister(id);
  return c.json({
    status: 'deleted',
    hadTranscript,
    fileDeleted,
    nativeDeleted: hasNativeSessionState ? nativeDeleted : false,
    workspaceCleaned,
  });
});

/** POST /sessions/:id/resume — resume a discovered/inactive session */
sessionRoutes.post('/sessions/:id/resume', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.attached && view.activity === 'interactive') {
    return c.json({
      error: 'This session appears to be active outside cats-runtime already. Observe it or wait for it to go idle before resuming.',
    }, 409);
  }

  if (session.providerName === 'cursor') {
    if (!session.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

      const existing = ctx.pool.get(id);
    if (existing?.alive) {
      ctx.registry.updateStatus(id, 'ready');
      return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
    }

    try {
      ctx.pool.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        resumeSessionId: session.providerSessionId,
        permissionMode: 'skip',
      });
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (session.providerName === 'kiro') {
    if (!session.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

    const existing = ctx.pool.get(id);
    if (existing?.alive) {
      ctx.registry.updateStatus(id, 'ready');
      return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
    }

    try {
      const canResume = await ctx.kiroNative.canResumeSession(session.cwd, session.providerSessionId);
      if (!canResume) {
        return c.json({
          error: 'Kiro can only resume the latest session in a workspace. '
            + 'This discovered session is no longer the newest one in its directory.',
        }, 409);
      }

      ctx.pool.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        resumeSessionId: session.providerSessionId,
        permissionMode: 'skip',
      });
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (!session.providerSessionId) {
    return c.json({ error: 'No provider session ID to resume' }, 400);
  }

  const caps = ctx.pool.getCapabilities(session.providerName);
  if (!caps.resume) {
    return c.json({ error: `Provider '${session.providerName}' does not support resume` }, 501);
  }

  const body = await c.req.json<{
    permissionMode?: 'skip' | 'whitelist' | 'default';
  }>().catch(() => ({}));

  // Derive permissionMode from workspaceMode
  let permissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
    .permissionMode ?? 'skip';
  if (session.workspaceMode === 'read_only') {
    permissionMode = 'default';
  }

  try {
    ctx.pool.spawn(id, session.providerName, {
      cwd: session.cwd,
      workspaceMode: session.workspaceMode,
      model: session.model,
      resumeSessionId: session.providerSessionId,
      permissionMode,
    });
    ctx.registry.updateStatus(id, 'initializing');
  } catch (err) {
    return c.json({ error: `Failed to resume: ${err}` }, 500);
  }

  return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
});

/** POST /sessions/:id/fork — fork a runtime-owned session */
sessionRoutes.post('/sessions/:id/fork', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (session.providerName === 'cursor') {
    return c.json({
      error: 'Cursor native session forking will be enabled after Cursor execution support lands.',
    }, 501);
  }

  if (!session.providerSessionId) {
    return c.json({ error: 'No provider session ID to fork from' }, 400);
  }

  const caps = ctx.pool.getCapabilities(session.providerName);
  if (!caps.fork) {
    return c.json({ error: `Provider '${session.providerName}' does not support fork` }, 501);
  }

  const body = await c.req.json<{
    group?: string;
    permissionMode?: 'skip' | 'whitelist' | 'default';
  }>().catch(() => ({}));

  const forkId = randomUUID();
  let forkCwd = session.cwd;
  let forkWorkspaceMode = session.workspaceMode;
  let forkPermissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
    .permissionMode ?? 'skip';

  // If parent was isolated, create new sandbox and copy parent's files
  if (session.workspaceMode === 'isolated') {
    const resolved = resolveWorkspace({
      sessionId: forkId,
      sessionBaseDir: ctx.config.sessionBaseDir,
      workspaceMode: 'isolated',
    });
    copyIsolatedWorkspace(ctx.config.sessionBaseDir, id, forkId);
    forkCwd = resolved.cwd;
    forkWorkspaceMode = resolved.workspaceMode;
    forkPermissionMode = resolved.permissionMode;
  } else if (session.workspaceMode === 'read_only') {
    forkPermissionMode = 'default';
  }

  const forked = ctx.registry.create({
    id: forkId,
    providerName: session.providerName,
    cwd: forkCwd,
    workspaceMode: forkWorkspaceMode,
    model: session.model,
    group: (body as { group?: string }).group ?? session.group,
  });

  try {
    ctx.pool.spawn(forked.id, session.providerName, {
      cwd: forkCwd,
      workspaceMode: forkWorkspaceMode,
      model: session.model,
      resumeSessionId: session.providerSessionId,
      forkSession: true,
      permissionMode: forkPermissionMode,
    });
  } catch (err) {
    if (forkWorkspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, forkId);
    }
    ctx.registry.remove(forked.id);
    return c.json({ error: `Failed to fork: ${err}` }, 500);
  }

  return c.json(serializeSession(ctx, forked), 201);
});
