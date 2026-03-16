import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { Hono } from 'hono';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import {
  getProviderDefaultInstanceId,
  resolveProviderInstance,
  type ProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type {
  SessionInfo,
  SessionStatus,
  WorkspaceMode,
} from '../../backends/cli/pool/types.js';
import { SessionScanner } from '../../backends/cli/discovery/SessionScanner.js';
import { CodexSessionScanner } from '../../backends/cli/discovery/CodexSessionScanner.js';
import { CopilotSessionScanner } from '../../backends/cli/discovery/CopilotSessionScanner.js';
import { GeminiSessionScanner } from '../../backends/cli/discovery/GeminiSessionScanner.js';
import { KNOWN_PROVIDERS } from '../../backends/cli/providers/types.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import {
  resolveWorkspace,
  cleanupIsolatedWorkspace,
  copyIsolatedWorkspace,
} from '../../backends/cli/pool/workspace.js';
import {
  toSessionView,
  toSessionViews,
} from '../../backends/cli/pool/sessionView.js';
import {
  getAuggieSessions,
  getClaudeProjectsDir,
  getCodexSessionsDir,
  getCopilotSessionsDir,
  getCursorNative,
  getGeminiSessionsDir,
  getKiroNative,
  getOpencodeNative,
} from '../providerServices.js';

export const sessionRoutes = new Hono();
const SESSION_PROVIDERS = KNOWN_PROVIDERS;

function serializeSession(ctx: AppContext, session: SessionInfo) {
  return toSessionView(session, {
    attached: getRuntimeSessionManager(ctx).isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
}

function serializeSessions(
  ctx: AppContext,
  sessions: SessionInfo[],
) {
  return toSessionViews(sessions, {
    isAttached: (session) => getRuntimeSessionManager(ctx).isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
}

function resolveRequestedProviderInstance(
  ctx: AppContext,
  providerName: string,
  instanceId?: string,
): ProviderInstanceConfig {
  return resolveProviderInstance(
    ctx.config,
    providerName as typeof SESSION_PROVIDERS[number],
    instanceId,
  );
}

function sessionMatchesInstanceFilter(
  ctx: AppContext,
  session: SessionInfo,
  requestedInstance: string,
): boolean {
  const providerName = session.providerName as ProviderName;
  const actualInstanceId = session.providerInstanceId
    || getProviderDefaultInstanceId(ctx.config, providerName);

  if (requestedInstance === 'default') {
    const defaultInstanceId = getProviderDefaultInstanceId(ctx.config, providerName);
    return actualInstanceId === defaultInstanceId || actualInstanceId === 'default';
  }

  return actualInstanceId === requestedInstance;
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
    const cursorNative = getCursorNative(ctx, session.providerInstanceId);
    const deleted = await cursorNative.deleteSession(session.cwd, session.providerSessionId);
    if (!deleted) return false;
    const remaining = await cursorNative.listSessions(
      session.cwd,
      { startIfNeeded: false },
    );
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'kiro') {
    const kiroNative = getKiroNative(ctx, session.providerInstanceId);
    const deleted = await kiroNative.deleteSession(session.cwd, session.providerSessionId);
    if (!deleted) return false;
    const remaining = await kiroNative.listSessions(
      session.cwd,
      { startIfNeeded: false },
    );
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'opencode') {
    const opencodeNative = getOpencodeNative(ctx, session.providerInstanceId);
    const deleted = await opencodeNative.deleteSession(session.cwd, session.providerSessionId);
    if (!deleted) return false;
    const remaining = await opencodeNative.getSession(session.cwd, session.providerSessionId);
    return remaining == null;
  }

  return true;
}

function tracksProviderDiscoveryState(session: SessionInfo): boolean {
  return Boolean(
    session.providerSessionId
    && (session.providerName === 'auggie'
      || session.providerName === 'claude'
      || session.providerName === 'codex'
      || session.providerName === 'copilot'
      || session.providerName === 'gemini'),
  );
}

function collectProviderDiscoveryArtifactPaths(ctx: AppContext, session: SessionInfo): string[] {
  if (!tracksProviderDiscoveryState(session)) {
    return [];
  }

  const artifactPaths = new Set<string>();
  for (const sourcePath of [session.providerSourcePath, session.sourcePath]) {
    if (!sourcePath) continue;
    if (sourcePath.startsWith(ctx.config.sessionBaseDir)) continue;

    if (session.providerName === 'copilot' && basename(sourcePath) === 'workspace.yaml') {
      artifactPaths.add(sourcePath);
      artifactPaths.add(join(dirname(sourcePath), 'events.jsonl'));
      continue;
    }

    artifactPaths.add(sourcePath);
  }

  return Array.from(artifactPaths);
}

async function verifyProviderDiscoveryStateDeleted(
  ctx: AppContext,
  session: SessionInfo,
): Promise<boolean> {
  if (!tracksProviderDiscoveryState(session) || !session.providerSessionId) {
    return true;
  }

  if (session.providerName === 'auggie') {
    const remaining = await getAuggieSessions(
      ctx,
      session.providerInstanceId,
    ).getSession(session.providerSessionId);
    return remaining == null;
  }

  if (session.providerName === 'claude') {
    const remaining = await new SessionScanner(
      getClaudeProjectsDir(ctx, session.providerInstanceId),
    ).scan();
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'codex') {
    const remaining = await new CodexSessionScanner(
      getCodexSessionsDir(ctx, session.providerInstanceId),
    ).scan();
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'copilot') {
    const remaining = await new CopilotSessionScanner(
      getCopilotSessionsDir(ctx, session.providerInstanceId),
    ).scan();
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  if (session.providerName === 'gemini') {
    const remaining = await new GeminiSessionScanner(
      getGeminiSessionsDir(ctx, session.providerInstanceId),
    ).scan();
    return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
  }

  return true;
}

/** POST /sessions — create a new runtime-owned session */
sessionRoutes.post('/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{
    provider?: string;
    instance?: string;
    cwd?: string;
    model?: string;
    group?: string;
    workspaceMode?: WorkspaceMode;
    managed?: boolean;
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
  }>();

  const providerName = body.provider ?? 'claude';
  const runtime = getRuntimeSessionManager(ctx);

  if (!(SESSION_PROVIDERS as readonly string[]).includes(providerName)) {
    return c.json({
      error: `Unknown provider '${providerName}'. Valid: ${SESSION_PROVIDERS.join(', ')}`,
    }, 400);
  }

  let providerInstance: ProviderInstanceConfig;
  try {
    providerInstance = resolveRequestedProviderInstance(ctx, providerName, body.instance);
  } catch (err) {
    return c.json({ error: `${err}` }, 400);
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
    const caps = runtime.getCapabilities('cursor', providerInstance.id);
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getCursorNative(ctx, providerInstance.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'cursor',
        providerInstanceId: providerInstance.id,
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model || native.model,
        group: body.group,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      runtime.spawn(session.id, providerName, {
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model || native.model,
        resumeSessionId: native.providerSessionId,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      }, providerInstance.id);
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getCursorNative(ctx, providerInstance.id).deleteSession(
            resolved.cwd,
            nativeProviderSessionId,
          );
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
    const caps = runtime.getCapabilities('opencode', providerInstance.id);
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getOpencodeNative(ctx, providerInstance.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'opencode',
        providerInstanceId: providerInstance.id,
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model,
        group: body.group,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      runtime.spawn(session.id, providerName, {
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model,
        resumeSessionId: native.providerSessionId,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      }, providerInstance.id);
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getOpencodeNative(ctx, providerInstance.id).deleteSession(
            resolved.cwd,
            nativeProviderSessionId,
          );
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

  const caps = runtime.getCapabilities(providerName, providerInstance.id);

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
    providerInstanceId: providerInstance.id,
    cwd: resolved.cwd,
    workspaceMode: resolved.workspaceMode,
    model: body.model,
    group: body.group,
  });

  try {
    runtime.spawn(session.id, providerName, {
      cwd: resolved.cwd,
      workspaceMode: resolved.workspaceMode,
      model: body.model,
      permissionMode: resolved.permissionMode,
      allowedTools: body.allowedTools,
    }, providerInstance.id);
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
  const instance = c.req.query('instance');
  const group = c.req.query('group');

  let sessions = ctx.registry.list({ status, provider, group });
  if (instance) {
    sessions = sessions.filter(
      (session) => sessionMatchesInstanceFilter(ctx, session, instance),
    );
  }
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
  const runtime = getRuntimeSessionManager(ctx);
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
    const worker = runtime.get(id);
    if (worker?.active) {
      ctx.registry.updateStatus(id, 'closing');
      runtime.kill(id);
      return c.json({ status: 'closing' });
    }
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ status: 'closed' });
  }

  const worker = runtime.get(id);
  if (!worker?.active) {
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ status: 'closed' });
  }

  ctx.registry.updateStatus(id, 'closing');
  runtime.kill(id);
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

  const preparedManagedTranscripts = ctx.registry.prepareManagedTranscriptDeletion(id);
  const preparedProviderDiscovery = ctx.registry.preparePathDeletion(
    collectProviderDiscoveryArtifactPaths(ctx, session),
  );
  const hasNativeSessionState = tracksNativeSessionState(session);
  const hasProviderDiscoveryState = tracksProviderDiscoveryState(session);
  const hadTranscript = preparedManagedTranscripts.hadFiles
    || preparedProviderDiscovery.hadFiles
    || hasNativeSessionState
    || hasProviderDiscoveryState;

  if (!preparedManagedTranscripts.ready || !preparedProviderDiscovery.ready) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
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
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({ error: `Failed to delete native ${session.providerName} session: ${err}` }, 500);
  }

  let providerDiscoveryDeleted = false;
  try {
    if (hasProviderDiscoveryState) {
      providerDiscoveryDeleted = await verifyProviderDiscoveryStateDeleted(ctx, session);
    }
  } catch (err) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({
      error: `Failed to verify ${session.providerName} discovery cleanup: ${err}`,
    }, 500);
  }

  const nativeCleanupSucceeded = !hasNativeSessionState || nativeDeleted;
  const providerDiscoveryCleanupSucceeded = !hasProviderDiscoveryState || providerDiscoveryDeleted;
  if (!nativeCleanupSucceeded || !providerDiscoveryCleanupSucceeded) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session cleanup could not be verified. Nothing was removed.',
    });
  }

  const worker = getRuntimeSessionManager(ctx).get(id);
  if (worker) {
    getRuntimeSessionManager(ctx).kill(id);
  }

  const managedDeletion = preparedManagedTranscripts.finalize();
  const providerDeletion = preparedProviderDiscovery.finalize();
  let workspaceCleaned = false;
  if (session.workspaceMode === 'isolated') {
    workspaceCleaned = cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, id);
  }
  ctx.registry.unregister(id);
  return c.json({
    status: 'deleted',
    hadTranscript,
    fileDeleted: managedDeletion.fileDeleted || providerDeletion.fileDeleted,
    nativeDeleted: hasNativeSessionState ? nativeDeleted : false,
    workspaceCleaned,
  });
});

/** POST /sessions/:id/resume — resume a discovered/inactive session */
sessionRoutes.post('/sessions/:id/resume', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const runtime = getRuntimeSessionManager(ctx);

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

      const existing = runtime.get(id);
    if (existing?.active) {
      ctx.registry.updateStatus(id, 'ready');
      return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
    }

    try {
      runtime.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        resumeSessionId: session.providerSessionId,
        permissionMode: 'skip',
      }, session.providerInstanceId);
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

    const existing = runtime.get(id);
    if (existing?.active) {
      ctx.registry.updateStatus(id, 'ready');
      return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
    }

    try {
      const canResume = await getKiroNative(
        ctx,
        session.providerInstanceId,
      ).canResumeSession(session.cwd, session.providerSessionId);
      if (!canResume) {
        return c.json({
          error: 'Kiro can only resume the latest session in a workspace. '
            + 'This discovered session is no longer the newest one in its directory.',
        }, 409);
      }

      runtime.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        resumeSessionId: session.providerSessionId,
        permissionMode: 'skip',
      }, session.providerInstanceId);
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (!session.providerSessionId) {
    return c.json({ error: 'No provider session ID to resume' }, 400);
  }

  const caps = runtime.getCapabilities(session.providerName, session.providerInstanceId);
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
    runtime.spawn(id, session.providerName, {
      cwd: session.cwd,
      workspaceMode: session.workspaceMode,
      model: session.model,
      resumeSessionId: session.providerSessionId,
      permissionMode,
    }, session.providerInstanceId);
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
  const runtime = getRuntimeSessionManager(ctx);

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

  const caps = runtime.getCapabilities(session.providerName, session.providerInstanceId);
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
    providerInstanceId: session.providerInstanceId,
    cwd: forkCwd,
    workspaceMode: forkWorkspaceMode,
    model: session.model,
    group: (body as { group?: string }).group ?? session.group,
  });

  try {
    runtime.spawn(forked.id, session.providerName, {
      cwd: forkCwd,
      workspaceMode: forkWorkspaceMode,
      model: session.model,
      resumeSessionId: session.providerSessionId,
      forkSession: true,
      permissionMode: forkPermissionMode,
    }, session.providerInstanceId);
  } catch (err) {
    if (forkWorkspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, forkId);
    }
    ctx.registry.remove(forked.id);
    return c.json({ error: `Failed to fork: ${err}` }, 500);
  }

  return c.json(serializeSession(ctx, forked), 201);
});
