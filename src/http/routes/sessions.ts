import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Hono } from 'hono';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import {
  isProviderNotConfiguredError,
  isUnknownProviderInstanceError,
  type ProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type { SessionsIndex } from '../../backends/cli/discovery/types.js';
import type { PreparedFileDeletion } from '../../backends/cli/pool/SessionRegistry.js';
import type {
  SessionInfo,
  SessionInvocationContext,
  SessionReusePolicy,
  SessionStatus,
  WorkspaceMode,
} from '../../backends/cli/pool/types.js';
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
  getCursorNative,
  getGooseNative,
  getKiroNative,
  getOpencodeNative,
} from '../providerServices.js';
import { resolvePiResumeTarget } from '../../backends/cli/pi/resume.js';
import {
  getProviderDefaultTarget,
  listConfiguredProviders,
  resolveProviderTarget,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import { parseInvocationContext, parseOptionalString } from '../parsing.js';

export const sessionRoutes = new Hono();

const REUSE_POLICIES = new Set<SessionReusePolicy>([
  'create_new',
  'prefer_existing',
  'require_existing',
]);

type NativeCleanupResult = boolean | 'stale_config';

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

function resolveRequestedProviderTarget(
  ctx: AppContext,
  providerName: string,
  instanceId?: string,
): ProviderTargetDescriptor {
  return resolveProviderTarget(ctx.config, providerName, instanceId);
}

function parseReusePolicy(value: unknown): SessionReusePolicy | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim() as SessionReusePolicy;
  return REUSE_POLICIES.has(normalized) ? normalized : undefined;
}

function findReusableSession(
  ctx: AppContext,
  providerTarget: ProviderTargetDescriptor,
  providerName: string,
  sessionKey: string,
): SessionInfo | undefined {
  return ctx.registry.list({ provider: providerName }).find((session) =>
    session.sessionKey === sessionKey
      && session.providerBackend === providerTarget.backend
      && session.providerInstanceId === providerTarget.instanceId,
  );
}

function resolveCliProviderInstance(target: ProviderTargetDescriptor): ProviderInstanceConfig {
  if (!target.cliInstance) {
    throw new Error(
      `Provider '${target.providerName}' target '${target.backend}/${target.instanceId}' `
      + 'does not resolve to a CLI instance',
    );
  }

  return target.cliInstance;
}

function sessionMatchesInstanceFilter(
  ctx: AppContext,
  session: SessionInfo,
  requestedInstance: string,
): boolean {
  const defaultTarget = getProviderDefaultTarget(ctx.config, session.providerName);
  const actualBackend = session.providerBackend || defaultTarget?.backend || 'cli';
  const actualInstanceId = session.providerInstanceId
    || defaultTarget?.instance
    || 'default';

  try {
    const requestedTarget = resolveProviderTarget(
      ctx.config,
      session.providerName,
      requestedInstance,
    );
    return requestedTarget.backend === actualBackend
      && requestedTarget.instanceId === actualInstanceId;
  } catch {
    return false;
  }
}

function cloneManagedHistoryIfPresent(
  ctx: AppContext,
  sourceSession: SessionInfo,
  targetSession: SessionInfo,
): void {
  if (!sourceSession.sourcePath) {
    return;
  }
  if (!sourceSession.sourcePath.startsWith(ctx.config.sessionBaseDir)) {
    return;
  }
  if (!existsSync(sourceSession.sourcePath)) {
    return;
  }

  const historyDir = join(ctx.config.sessionBaseDir, 'history');
  mkdirSync(historyDir, { recursive: true });
  const targetPath = join(historyDir, `${targetSession.id}.jsonl`);
  copyFileSync(sourceSession.sourcePath, targetPath);
  ctx.registry.setSourcePath(targetSession.id, targetPath);
}

function tracksNativeSessionState(session: SessionInfo): boolean {
  return Boolean(
    session.providerBackend === 'cli'
    && session.providerSessionId
    && (session.providerName === 'cursor'
      || session.providerName === 'goose'
      || session.providerName === 'kiro'
      || session.providerName === 'opencode'),
  );
}

async function deleteNativeSessionState(
  ctx: AppContext,
  session: SessionInfo,
): Promise<NativeCleanupResult> {
  if (!session.providerSessionId) return true;

  try {
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

    if (session.providerName === 'goose') {
      const gooseNative = getGooseNative(ctx, session.providerInstanceId);
      return gooseNative.deleteSession(session.cwd, session.providerSessionId);
    }

    if (session.providerName === 'opencode') {
      const opencodeNative = getOpencodeNative(ctx, session.providerInstanceId);
      const deleted = await opencodeNative.deleteSession(session.cwd, session.providerSessionId);
      if (!deleted) return false;
      const remaining = await opencodeNative.getSession(session.cwd, session.providerSessionId);
      return remaining == null;
    }
  } catch (error) {
    if (isUnknownProviderInstanceError(error) || isProviderNotConfiguredError(error)) {
      console.warn(
        `[sessions] Skipping native cleanup for stale ${session.providerName} `
        + `session '${session.id}' targeting missing instance `
        + `'${session.providerInstanceId || 'default'}': `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
      return 'stale_config';
    }
    throw error;
  }

  return true;
}

function tracksProviderDiscoveryState(session: SessionInfo): boolean {
  return Boolean(
    session.providerBackend === 'cli'
    && session.providerSessionId
    && (session.providerName === 'auggie'
      || session.providerName === 'claude'
      || session.providerName === 'codex'
      || session.providerName === 'copilot'
      || session.providerName === 'gemini'
      || session.providerName === 'pi'
      || session.providerName === 'junie'),
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

function createNoopPreparedDeletion(): PreparedFileDeletion {
  return {
    hadFiles: false,
    ready: true,
    finalize: () => ({ fileDeleted: false }),
    rollback: () => {},
  };
}

function createFailedPreparedDeletion(hadFiles: boolean): PreparedFileDeletion {
  return {
    hadFiles,
    ready: false,
    finalize: () => ({ fileDeleted: false }),
    rollback: () => {},
  };
}

function combinePreparedDeletions(
  ...preparedDeletions: PreparedFileDeletion[]
): PreparedFileDeletion {
  return {
    hadFiles: preparedDeletions.some((prepared) => prepared.hadFiles),
    ready: preparedDeletions.every((prepared) => prepared.ready),
    finalize: () => {
      let fileDeleted = false;
      for (const prepared of preparedDeletions) {
        fileDeleted = prepared.finalize().fileDeleted || fileDeleted;
      }
      return { fileDeleted };
    },
    rollback: () => {
      for (const prepared of [...preparedDeletions].reverse()) {
        prepared.rollback();
      }
    },
  };
}

function prepareReplacementFileDeletion(
  filePath: string,
  nextContent: string,
): PreparedFileDeletion {
  if (!existsSync(filePath)) {
    return createNoopPreparedDeletion();
  }

  const stagedPath = join(
    dirname(filePath),
    `.cats-runtime-delete-${randomUUID()}-${basename(filePath)}.pending-delete`,
  );

  try {
    renameSync(filePath, stagedPath);
    writeFileSync(filePath, nextContent);
  } catch {
    try {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    } catch {
      // Best effort restore below.
    }

    try {
      if (existsSync(stagedPath) && !existsSync(filePath)) {
        renameSync(stagedPath, filePath);
      }
    } catch {
      // If restore also fails we surface ready=false and let the delete abort.
    }

    return createFailedPreparedDeletion(true);
  }

  let completed = false;

  return {
    hadFiles: true,
    ready: true,
    finalize: () => {
      if (completed) {
        return { fileDeleted: true };
      }

      completed = true;
      try {
        rmSync(stagedPath, { force: true });
      } catch {
        // Best effort only. The replacement file is already live at filePath.
      }
      return { fileDeleted: true };
    },
    rollback: () => {
      if (completed) return;

      completed = true;
      try {
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
        }
      } catch {
        // Continue attempting to restore the original file.
      }

      try {
        if (existsSync(stagedPath) && !existsSync(filePath)) {
          renameSync(stagedPath, filePath);
        }
      } catch {
        // Delete will still abort because the prepared deletion is not finalized.
      }
    },
  };
}

function prepareClaudeSessionIndexDeletion(session: SessionInfo): PreparedFileDeletion {
  if (session.providerName !== 'claude' || !session.providerSessionId) {
    return createNoopPreparedDeletion();
  }

  const sourcePath = session.providerSourcePath || session.sourcePath;
  if (!sourcePath) {
    return createNoopPreparedDeletion();
  }

  const indexPath = join(dirname(sourcePath), 'sessions-index.json');
  if (!existsSync(indexPath)) {
    return createNoopPreparedDeletion();
  }

  let index: SessionsIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SessionsIndex;
  } catch {
    // If Claude falls back to raw .jsonl scanning, deleting the transcript path is enough.
    return createNoopPreparedDeletion();
  }

  if (!Object.prototype.hasOwnProperty.call(index, session.providerSessionId)) {
    return createNoopPreparedDeletion();
  }

  const nextIndex = { ...index };
  delete nextIndex[session.providerSessionId];
  return prepareReplacementFileDeletion(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
}

function prepareJunieSessionIndexDeletion(session: SessionInfo): PreparedFileDeletion {
  if (session.providerName !== 'junie' || !session.providerSessionId) {
    return createNoopPreparedDeletion();
  }

  const sourcePath = session.providerSourcePath || session.sourcePath;
  if (!sourcePath) {
    return createNoopPreparedDeletion();
  }

  const indexPath = join(dirname(dirname(sourcePath)), 'index.jsonl');
  if (!existsSync(indexPath)) {
    return createNoopPreparedDeletion();
  }

  let removedEntry = false;
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    return createNoopPreparedDeletion();
  }

  const remainingLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as { sessionId?: string };
      if (entry.sessionId === session.providerSessionId) {
        removedEntry = true;
        continue;
      }
    } catch {
      // Preserve unknown lines verbatim rather than corrupting the index.
    }

    remainingLines.push(line);
  }

  if (!removedEntry) {
    return createNoopPreparedDeletion();
  }

  const nextContent = remainingLines.length > 0
    ? `${remainingLines.join('\n')}\n`
    : '';
  return prepareReplacementFileDeletion(indexPath, nextContent);
}

function prepareProviderDiscoveryDeletion(
  ctx: AppContext,
  session: SessionInfo,
): PreparedFileDeletion {
  return combinePreparedDeletions(
    ctx.registry.preparePathDeletion(collectProviderDiscoveryArtifactPaths(ctx, session)),
    prepareClaudeSessionIndexDeletion(session),
    prepareJunieSessionIndexDeletion(session),
  );
}

async function verifyProviderDiscoveryStateDeleted(
  _ctx: AppContext,
  session: SessionInfo,
): Promise<boolean> {
  if (!tracksProviderDiscoveryState(session) || !session.providerSessionId) {
    return true;
  }

  // File-backed providers are cleaned up by the prepared provider-discovery
  // deletion step, which stages transcript files away and rewrites provider
  // indexes for providers that need one. Re-scanning here would observe the
  // pre-finalize filesystem state and incorrectly roll back the delete.
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
    sessionKey?: string;
    reusePolicy?: SessionReusePolicy;
    instructions?: string;
    context?: SessionInvocationContext;
    outputDir?: string;
  }>();

  const providerName = body.provider ?? 'claude';
  const runtime = getRuntimeSessionManager(ctx);
  const configuredProviders = listConfiguredProviders(ctx.config);

  if (!configuredProviders.includes(providerName)) {
    return c.json({
      error: `Unknown provider '${providerName}'. Valid: ${configuredProviders.join(', ')}`,
    }, 400);
  }

  let providerTarget: ProviderTargetDescriptor;
  try {
    providerTarget = resolveRequestedProviderTarget(ctx, providerName, body.instance);
  } catch (err) {
    return c.json({ error: `${err}` }, 400);
  }

  const providerInstance = providerTarget.backend === 'cli'
    ? resolveCliProviderInstance(providerTarget)
    : undefined;

  const requestedSessionKey = parseOptionalString(body.sessionKey);
  const reusePolicy = parseReusePolicy(body.reusePolicy) || 'create_new';
  if (!requestedSessionKey && reusePolicy === 'require_existing') {
    return c.json({ error: 'sessionKey is required when reusePolicy=require_existing' }, 400);
  }

  const sessionKey = requestedSessionKey || randomUUID();
  const instructions = parseOptionalString(body.instructions);
  const context = parseInvocationContext(body.context);
  const outputDir = parseOptionalString(body.outputDir);

  if (reusePolicy !== 'create_new' && requestedSessionKey) {
    const existing = findReusableSession(ctx, providerTarget, providerName, requestedSessionKey);
    if (!existing) {
      if (reusePolicy === 'require_existing') {
        return c.json({
          error: `No existing ${providerName} session found for sessionKey '${requestedSessionKey}'`,
        }, 409);
      }
    } else {
      if (
        (body.cwd && existing.cwd !== body.cwd)
        || (body.model && existing.model && body.model !== existing.model)
      ) {
        return c.json({
          error: 'Existing sessionKey matches a session with different cwd/model. '
            + 'Use reusePolicy=create_new to force a new session.',
        }, 409);
      }

      ctx.registry.updateSessionMetadata(existing.id, {
        sessionKey,
        reusePolicy,
        instructions: instructions ?? existing.instructions,
        context: context ?? existing.context,
        outputDir: outputDir ?? existing.outputDir,
      });

      const existingHandle = runtime.get(existing.id);
      if (!existingHandle?.active) {
        if (existing.providerBackend === 'cli') {
          return c.json({
            error: 'Explicit sessionKey reuse currently supports api/local/agent sessions only. '
              + 'Use /sessions/:id/resume for CLI sessions.',
          }, 409);
        }

        try {
          runtime.spawn(existing.id, existing.providerName, {
            cwd: existing.cwd,
            workspaceMode: existing.workspaceMode,
            model: existing.model,
            permissionMode: existing.permissionMode,
            allowedTools: existing.allowedTools,
          }, existing.providerInstanceId, existing.providerBackend);
          ctx.registry.updateStatus(existing.id, 'ready');
        } catch (err) {
          return c.json({ error: `Failed to reuse session: ${err}` }, 500);
        }
      }

      return c.json(serializeSession(ctx, ctx.registry.get(existing.id) ?? existing));
    }
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

  if (providerName === 'cursor' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('cursor', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getCursorNative(ctx, providerInstance!.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'cursor',
        providerBackend: 'cli',
        providerInstanceId: providerInstance!.id,
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: body.model || native.model,
        group: body.group,
        sessionKey,
        reusePolicy,
        instructions,
        context,
        outputDir,
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
      }, providerInstance!.id, 'cli');
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getCursorNative(ctx, providerInstance!.id).deleteSession(
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

  if (providerName === 'opencode' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('opencode', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getOpencodeNative(ctx, providerInstance!.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'opencode',
        providerBackend: 'cli',
        providerInstanceId: providerInstance!.id,
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: body.model,
        group: body.group,
        sessionKey,
        reusePolicy,
        instructions,
        context,
        outputDir,
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
      }, providerInstance!.id, 'cli');
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getOpencodeNative(ctx, providerInstance!.id).deleteSession(
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

  const caps = runtime.getCapabilities(
    providerName,
    providerTarget.instanceId,
    providerTarget.backend,
  );

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
    providerBackend: providerTarget.backend,
    providerInstanceId: providerTarget.instanceId,
    cwd: resolved.cwd,
    workspaceMode: resolved.workspaceMode,
    permissionMode: resolved.permissionMode,
    allowedTools: body.allowedTools,
    model: body.model,
    group: body.group,
    sessionKey,
    reusePolicy,
    instructions,
    context,
    outputDir,
  });

  try {
    runtime.spawn(session.id, providerName, {
      cwd: resolved.cwd,
      workspaceMode: resolved.workspaceMode,
      model: body.model,
      permissionMode: resolved.permissionMode,
      allowedTools: body.allowedTools,
    }, providerTarget.instanceId, providerTarget.backend);
  } catch (err) {
    if (resolved.workspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
    }
    ctx.registry.remove(session.id);
    return c.json({ error: `Failed to spawn session: ${err}` }, 500);
  }

  if (providerTarget.backend !== 'cli') {
    ctx.registry.updateStatus(session.id, 'ready');
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

  if (session.providerName === 'cursor' && session.providerBackend === 'cli') {
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
  const preparedProviderDiscovery = prepareProviderDiscoveryDeletion(ctx, session);
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

  let nativeDeleted: NativeCleanupResult = false;
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

  const nativeCleanupSucceeded = !hasNativeSessionState
    || nativeDeleted === true
    || nativeDeleted === 'stale_config';
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
  ctx.registry.flush();
  return c.json({
    status: 'deleted',
    hadTranscript,
    fileDeleted: managedDeletion.fileDeleted || providerDeletion.fileDeleted,
    nativeDeleted: hasNativeSessionState ? nativeDeleted === true : false,
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

  const existing = runtime.get(id);
  if (existing?.active) {
    ctx.registry.updateStatus(id, 'ready');
    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (session.providerBackend !== 'cli') {
    try {
      runtime.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        permissionMode: session.permissionMode,
        allowedTools: session.allowedTools,
      }, session.providerInstanceId, session.providerBackend);
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (session.providerName === 'cursor') {
    if (!session.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

    try {
      runtime.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        resumeSessionId: session.providerSessionId,
        permissionMode: session.permissionMode,
        allowedTools: session.allowedTools,
      }, session.providerInstanceId, 'cli');
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
        permissionMode: session.permissionMode,
        allowedTools: session.allowedTools,
      }, session.providerInstanceId, 'cli');
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (session.providerName === 'pi') {
    const body = await c.req.json<{
      permissionMode?: 'skip' | 'whitelist' | 'default';
      allowedTools?: string[];
    }>().catch(() => ({}));

    let resumeTarget;
    try {
      resumeTarget = resolvePiResumeTarget(ctx.config, session);
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : String(err),
      }, 409);
    }

    let permissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
      .permissionMode ?? session.permissionMode ?? 'skip';
    if (session.workspaceMode === 'read_only') {
      permissionMode = 'default';
    }

    try {
      runtime.spawn(id, session.providerName, {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: session.model,
        resumeSourcePath: resumeTarget.runtimeSourcePath,
        permissionMode,
        allowedTools: (body as { allowedTools?: string[] }).allowedTools ?? session.allowedTools,
      }, session.providerInstanceId, 'cli');
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  if (!session.providerSessionId) {
    return c.json({ error: 'No provider session ID to resume' }, 400);
  }

  const caps = runtime.getCapabilities(
    session.providerName,
    session.providerInstanceId,
    session.providerBackend,
  );
  if (!caps.resume) {
    return c.json({ error: `Provider '${session.providerName}' does not support resume` }, 501);
  }

  const body = await c.req.json<{
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
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
      allowedTools: (body as { allowedTools?: string[] }).allowedTools ?? session.allowedTools,
    }, session.providerInstanceId, session.providerBackend);
    ctx.registry.updateStatus(id, session.providerBackend === 'cli' ? 'initializing' : 'ready');
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

  if (session.providerName === 'cursor' && session.providerBackend === 'cli') {
    return c.json({
      error: 'Cursor native session forking will be enabled after Cursor execution support lands.',
    }, 501);
  }

  if (session.providerBackend === 'cli' && !session.providerSessionId) {
    return c.json({ error: 'No provider session ID to fork from' }, 400);
  }

  const caps = runtime.getCapabilities(
    session.providerName,
    session.providerInstanceId,
    session.providerBackend,
  );
  if (!caps.fork) {
    return c.json({ error: `Provider '${session.providerName}' does not support fork` }, 501);
  }

  const body = await c.req.json<{
    group?: string;
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
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
    providerBackend: session.providerBackend,
    providerInstanceId: session.providerInstanceId,
    cwd: forkCwd,
    workspaceMode: forkWorkspaceMode,
    permissionMode: forkPermissionMode,
    allowedTools: (body as { allowedTools?: string[] }).allowedTools ?? session.allowedTools,
    model: session.model,
    group: (body as { group?: string }).group ?? session.group,
    sessionKey: randomUUID(),
    reusePolicy: 'create_new',
    instructions: session.instructions,
    context: session.context,
    outputDir: session.outputDir,
    artifacts: session.artifacts,
  });
  if (session.providerSessionId) {
    ctx.registry.setProviderSessionId(forked.id, session.providerSessionId);
  }
  if (session.providerState) {
    ctx.registry.setProviderState(forked.id, session.providerState);
  }
  cloneManagedHistoryIfPresent(ctx, session, forked);

  try {
    runtime.spawn(forked.id, session.providerName, {
      cwd: forkCwd,
      workspaceMode: forkWorkspaceMode,
      model: session.model,
      resumeSessionId: session.providerSessionId,
      forkSession: true,
      permissionMode: forkPermissionMode,
      allowedTools: (body as { allowedTools?: string[] }).allowedTools ?? session.allowedTools,
    }, session.providerInstanceId, session.providerBackend);
    if (session.providerBackend !== 'cli') {
      ctx.registry.updateStatus(forked.id, 'ready');
    }
  } catch (err) {
    if (forkWorkspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, forkId);
    }
    ctx.registry.remove(forked.id);
    return c.json({ error: `Failed to fork: ${err}` }, 500);
  }

  return c.json(serializeSession(ctx, forked), 201);
});
