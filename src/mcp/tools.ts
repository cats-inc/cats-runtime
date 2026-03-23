import type { SessionStatus } from '../backends/cli/pool/types.js';
import { RUNTIME_VERSION } from '../startup.js';
import {
  getRuntimeBrowserService,
  getRuntimeDeliveryService,
  getRuntimeSessionManager,
  getWorkspaceSubstrateService,
  type AppContext,
} from '../http/app.js';
import { buildMcpObserveSessionPayload, buildMcpSessionSummary } from './readModels.js';
import { requestRuntimeJson, requestRuntimeNdjson } from './runtimeRequests.js';
import type {
  McpToolCallResult,
  McpToolDefinition,
  McpToolHandler,
} from './types.js';

class McpToolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

const SESSION_STATUSES: SessionStatus[] = [
  'initializing',
  'ready',
  'busy',
  'closed',
  'closing',
];
const WORKSPACE_MODES = ['isolated', 'shared', 'read_only'] as const;
const WORKSPACE_ISOLATION_MODES = ['shared', 'isolated', 'worktree'] as const;
const PERMISSION_MODES = ['skip', 'whitelist', 'default'] as const;
const REUSE_POLICIES = ['create_new', 'prefer_existing', 'require_existing'] as const;
const FORK_MODES = ['auto', 'native_fork', 'context_transplant'] as const;
const SUBSTRATE_PROFILES = ['minimal', 'standard', 'a2a-enabled'] as const;
const ENABLED_AGENTS = ['claude', 'gemini', 'codex'] as const;
const BROWSER_BINDING_KINDS = ['manual_url', 'session_service', 'session_artifact'] as const;
const ACTOR_ROLES = [
  'boss_cat',
  'specialist_cat',
  'system',
  'owner',
  'product_host',
  'operator',
] as const;

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpToolError(-32602, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalSessionStatus(
  record: Record<string, unknown>,
  key: string,
): SessionStatus | undefined {
  return readOptionalEnumString(record, key, SESSION_STATUSES, `${key} must be a valid session status`);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);
  if (!value) {
    throw new McpToolError(-32602, `${key} is required`);
  }
  return value;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? record[key] as boolean : undefined;
}

function readOptionalObject(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return asRecord(record[key]);
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? items : undefined;
}

function readOptionalEnumString<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errorMessage?: string,
): T | undefined {
  const value = readOptionalString(record, key);
  if (!value) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new McpToolError(-32602, errorMessage ?? `${key} must be one of: ${allowed.join(', ')}`);
}

function readOptionalEnumStringArray<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errorMessage?: string,
): T[] | undefined {
  const values = readOptionalStringArray(record, key);
  if (!values) {
    return undefined;
  }
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new McpToolError(
        -32602,
        errorMessage ?? `${key} values must be one of: ${allowed.join(', ')}`,
      );
    }
  }
  return values as T[];
}

function readRouteErrorMessage(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const message = typeof record?.error === 'string'
    ? record.error
    : typeof record?.message === 'string'
      ? record.message
      : undefined;
  return message || fallback;
}

function throwRouteError(
  operation: string,
  status: number,
  body: unknown,
): never {
  throw new McpToolError(
    -32000,
    readRouteErrorMessage(body, `${operation} failed with status ${status}`),
    {
      operation,
      httpStatus: status,
      body,
    },
  );
}

function ensureRouteSuccess(
  operation: string,
  status: number,
  body: unknown,
): void {
  if (status >= 200 && status < 300) {
    return;
  }
  throwRouteError(operation, status, body);
}

function buildSessionPaths(sessionId: string) {
  return {
    sessionPath: `/sessions/${sessionId}`,
    observePath: `/sessions/${sessionId}/observe`,
    historyPath: `/sessions/${sessionId}/history`,
    messagePath: `/sessions/${sessionId}/messages`,
  };
}

function buildBrowserSessionPaths(browserSessionId: string) {
  return {
    browserSessionPath: `/browser/sessions/${browserSessionId}`,
    createBrowserPagePath: `/browser/sessions/${browserSessionId}/pages`,
    closeBrowserSessionPath: `/browser/sessions/${browserSessionId}/close`,
  };
}

function runtimeSummary(ctx: AppContext): McpToolCallResult {
  const sessions = ctx.registry.list();
  const byStatus: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  for (const session of sessions) {
    byStatus[session.status] = (byStatus[session.status] ?? 0) + 1;
    byProvider[session.providerName] = (byProvider[session.providerName] ?? 0) + 1;
  }

  const poolStatus = ctx.pool.status();
  const runtime = getRuntimeSessionManager(ctx);
  const attached = sessions.filter((session) => runtime.isAttached(session.id)).length;

  const structuredContent = {
    service: 'cats-runtime',
    version: RUNTIME_VERSION,
    startup: {
      mode: ctx.startup.mode,
      phase: ctx.startup.phase,
      ready: ctx.startup.ready,
      readySignal: ctx.startup.readySignal,
      readinessPath: ctx.startup.readinessPath,
      address: ctx.startup.address,
    },
    sessions: {
      total: sessions.length,
      attached,
      byStatus,
      byProvider,
    },
    pool: poolStatus,
    diagnostics: {
      healthPath: '/health',
      runtimePath: '/diagnostics/runtime',
      providersPath: '/diagnostics/providers',
      mcpPath: '/mcp',
    },
  };

  return {
    summary: `Runtime ${ctx.startup.phase}; ${sessions.length} session(s) tracked.`,
    structuredContent,
  };
}

async function listSessions(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessions = ctx.registry.list({
    provider: readOptionalString(args, 'provider'),
    status: readOptionalSessionStatus(args, 'status'),
  });
  const includeInspection = readOptionalBoolean(args, 'includeInspection') === true;

  return {
    summary: `Returned ${sessions.length} session(s).`,
    structuredContent: {
      sessions: sessions.map((session) =>
        buildMcpSessionSummary(ctx, session, { includeInspection }),
      ),
    },
  };
}

async function observeSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const session = ctx.registry.get(sessionId);
  if (!session) {
    throw new McpToolError(-32602, `Unknown session '${sessionId}'`);
  }

  return {
    summary: `Observation snapshot for session ${sessionId}.`,
    structuredContent: buildMcpObserveSessionPayload(ctx, session),
  };
}

async function auditWorkspace(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const service = getWorkspaceSubstrateService(ctx);
  const workspacePath = readRequiredString(args, 'workspacePath');
  const profile = readOptionalEnumString(
    args,
    'profile',
    SUBSTRATE_PROFILES,
    'profile must be a valid workspace substrate profile',
  );
  const enabledAgents = readOptionalEnumStringArray(
    args,
    'enabledAgents',
    ENABLED_AGENTS,
    'enabledAgents must be one of: claude, gemini, codex',
  );
  const includeA2A = readOptionalBoolean(args, 'includeA2A');
  const result = await service.execute({
    operation: 'audit-workspace',
    workspacePath,
    ...(profile ? { profile } : {}),
    ...(enabledAgents ? { enabledAgents } : {}),
    ...(includeA2A !== undefined ? { includeA2A } : {}),
  });

  return {
    summary: `Workspace audit ${result.status} for ${workspacePath}.`,
    structuredContent: result,
  };
}

async function auditDeliveryTarget(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const workspacePath = readOptionalString(args, 'workspacePath');
  const sessionId = readOptionalString(args, 'sessionId');
  if (!workspacePath && !sessionId) {
    throw new McpToolError(-32602, 'workspacePath or sessionId is required');
  }

  const result = await getRuntimeDeliveryService(ctx).execute({
    action: 'audit-delivery-target',
    workspacePath,
    sessionId,
    artifactIds: readOptionalStringArray(args, 'artifactIds'),
    preview: (
      readOptionalBoolean(args, 'includeSessionArtifacts') !== undefined
      || readOptionalBoolean(args, 'includeSessionServices') !== undefined
    )
      ? {
          includeSessionArtifacts: readOptionalBoolean(args, 'includeSessionArtifacts'),
          includeSessionServices: readOptionalBoolean(args, 'includeSessionServices'),
        }
      : undefined,
  });

  return {
    summary: `Delivery audit ${result.state} for ${sessionId || workspacePath}.`,
    structuredContent: result,
  };
}

async function createSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = await requestRuntimeJson(ctx, '/sessions', {
    body: args,
  });
  ensureRouteSuccess('create_session', result.status, result.body);

  const session = ensureObject(result.body, 'create_session result');
  const sessionId = readRequiredString(session, 'id');
  const reused = result.status === 200;
  return {
    summary: reused
      ? `Reused session ${sessionId}.`
      : `Created session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      reused,
      session,
      ...buildSessionPaths(sessionId),
    },
  };
}

async function sendMessage(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  readRequiredString(args, 'message');
  const { sessionId: _sessionId, ...body } = args;
  const result = await requestRuntimeNdjson(
    ctx,
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    { body },
  );
  ensureRouteSuccess('send_message', result.status, result.body);

  const session = ctx.registry.get(sessionId);
  return {
    summary: `Completed message turn for session ${sessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      sessionId,
      events: result.events,
      ...(session
        ? { session: buildMcpSessionSummary(ctx, session, { includeInspection: true }) }
        : {}),
      ...buildSessionPaths(sessionId),
    },
  };
}

async function forkSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const sessionId = readRequiredString(args, 'sessionId');
  const { sessionId: _sessionId, ...body } = args;
  const result = await requestRuntimeJson(
    ctx,
    `/sessions/${encodeURIComponent(sessionId)}/fork`,
    { body },
  );
  ensureRouteSuccess('fork_session', result.status, result.body);

  const forked = ensureObject(result.body, 'fork_session result');
  const forkedId = readRequiredString(forked, 'id');
  return {
    summary: `Forked session ${sessionId} into ${forkedId}.`,
    structuredContent: {
      responseStatus: result.status,
      session: forked,
      ...buildSessionPaths(forkedId),
    },
  };
}

async function listBrowserDrivers(
  ctx: AppContext,
  _args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const drivers = getRuntimeBrowserService(ctx).listDrivers();
  return {
    summary: `Returned ${drivers.length} browser driver(s).`,
    structuredContent: {
      drivers,
      driversPath: '/browser/drivers',
    },
  };
}

async function listBrowserSessions(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const driverId = readOptionalString(args, 'driverId');
  const runtimeSessionId = readOptionalString(args, 'runtimeSessionId');
  const sessions = getRuntimeBrowserService(ctx).listSessions({
    ...(driverId ? { driverId } : {}),
    ...(runtimeSessionId ? { runtimeSessionId } : {}),
  });
  return {
    summary: `Returned ${sessions.length} browser session(s).`,
    structuredContent: {
      sessions,
      sessionsPath: '/browser/sessions',
    },
  };
}

async function createBrowserSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = await requestRuntimeJson(ctx, '/browser/sessions', {
    body: args,
  });
  ensureRouteSuccess('create_browser_session', result.status, result.body);

  const payload = ensureObject(result.body, 'create_browser_session result');
  const session = ensureObject(payload.session, 'create_browser_session result.session');
  const browserSessionId = readRequiredString(session, 'id');
  return {
    summary: `Created browser session ${browserSessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      session,
      ...buildBrowserSessionPaths(browserSessionId),
    },
  };
}

async function createBrowserPage(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const browserSessionId = readRequiredString(args, 'browserSessionId');
  const { browserSessionId: _browserSessionId, ...body } = args;
  const result = await requestRuntimeJson(
    ctx,
    `/browser/sessions/${encodeURIComponent(browserSessionId)}/pages`,
    { body },
  );
  ensureRouteSuccess('create_browser_page', result.status, result.body);

  const payload = ensureObject(result.body, 'create_browser_page result');
  return {
    summary: `Created browser page for session ${browserSessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      ...buildBrowserSessionPaths(browserSessionId),
    },
  };
}

async function closeBrowserSession(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const browserSessionId = readRequiredString(args, 'browserSessionId');
  const result = await requestRuntimeJson(
    ctx,
    `/browser/sessions/${encodeURIComponent(browserSessionId)}/close`,
  );
  ensureRouteSuccess('close_browser_session', result.status, result.body);

  const payload = ensureObject(result.body, 'close_browser_session result');
  return {
    summary: `Closed browser session ${browserSessionId}.`,
    structuredContent: {
      responseStatus: result.status,
      ...payload,
      ...buildBrowserSessionPaths(browserSessionId),
    },
  };
}

async function initWorkspace(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const service = getWorkspaceSubstrateService(ctx);
  const result = await service.execute({
    operation: 'init-workspace',
    workspacePath: readRequiredString(args, 'workspacePath'),
    profile: readOptionalEnumString(
      args,
      'profile',
      SUBSTRATE_PROFILES,
      'profile must be a valid workspace substrate profile',
    ),
    enabledAgents: readOptionalEnumStringArray(
      args,
      'enabledAgents',
      ENABLED_AGENTS,
      'enabledAgents must be one of: claude, gemini, codex',
    ),
    ...(readOptionalBoolean(args, 'includeA2A') !== undefined
      ? { includeA2A: readOptionalBoolean(args, 'includeA2A') }
      : {}),
    ...(readOptionalBoolean(args, 'apply') !== undefined
      ? { apply: readOptionalBoolean(args, 'apply') }
      : {}),
    ...(readOptionalObject(args, 'hints') ? { hints: readOptionalObject(args, 'hints') } : {}),
    ...(readOptionalEnumString(
      args,
      'actorRole',
      ACTOR_ROLES,
      'actorRole must be a valid workspace actor role',
    ) || readOptionalBoolean(args, 'approved') !== undefined
      ? {
          authorization: {
            actorRole: readOptionalEnumString(
              args,
              'actorRole',
              ACTOR_ROLES,
              'actorRole must be a valid workspace actor role',
            ),
            approved: readOptionalBoolean(args, 'approved'),
          },
        }
      : {}),
  });

  return {
    summary: `Workspace init ${result.status} for ${result.workspacePath}.`,
    structuredContent: result,
  };
}

async function commitChanges(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = await requestRuntimeJson(ctx, '/delivery/repo/commit', {
    body: args,
  });
  ensureRouteSuccess('commit_changes', result.status, result.body);

  const deliveryResult = ensureObject(result.body, 'commit_changes result');
  return {
    summary: `Commit action ${readOptionalString(deliveryResult, 'state') || 'completed'}.`,
    structuredContent: {
      responseStatus: result.status,
      ...deliveryResult,
    },
  };
}

const TOOL_HANDLERS: McpToolHandler[] = [
  {
    definition: {
      name: 'runtime_summary',
      title: 'Runtime Summary',
      description: 'Return startup, pool, and tracked-session summary for cats-runtime.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    execute: async (ctx) => runtimeSummary(ctx),
  },
  {
    definition: {
      name: 'list_sessions',
      title: 'List Sessions',
      description: 'Return tracked runtime sessions, optionally filtered by provider or status.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          status: { type: 'string', enum: SESSION_STATUSES },
          includeInspection: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    execute: listSessions,
  },
  {
    definition: {
      name: 'observe_session',
      title: 'Observe Session',
      description: 'Return the same machine-readable session/run inspection snapshot exposed by the observe route.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: observeSession,
  },
  {
    definition: {
      name: 'create_session',
      title: 'Create Session',
      description: 'Create or reuse a runtime session using the same contract as POST /sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          instance: { type: 'string' },
          cwd: { type: 'string' },
          model: { type: 'string' },
          group: { type: 'string' },
          workspaceMode: { type: 'string', enum: WORKSPACE_MODES },
          workspaceIsolation: { type: 'string', enum: WORKSPACE_ISOLATION_MODES },
          permissionMode: { type: 'string', enum: PERMISSION_MODES },
          allowedTools: { type: 'array', items: { type: 'string' } },
          sessionKey: { type: 'string' },
          reusePolicy: { type: 'string', enum: REUSE_POLICIES },
          instructions: { type: 'string' },
          skills: { type: 'object' },
          context: { type: 'object' },
          outputDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    execute: createSession,
  },
  {
    definition: {
      name: 'send_message',
      title: 'Send Message',
      description: 'Run one message turn against a runtime session and return normalized events.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          message: { type: 'string' },
          instructions: { type: 'string' },
          skills: { type: 'object' },
          context: { type: 'object' },
          outputDir: { type: 'string' },
        },
        required: ['sessionId', 'message'],
        additionalProperties: false,
      },
    },
    execute: sendMessage,
  },
  {
    definition: {
      name: 'fork_session',
      title: 'Fork Session',
      description: 'Fork an existing runtime session using the same contract as POST /sessions/{id}/fork.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          mode: { type: 'string', enum: FORK_MODES },
          provider: { type: 'string' },
          instance: { type: 'string' },
          model: { type: 'string' },
          cwd: { type: 'string' },
          workspaceMode: { type: 'string', enum: WORKSPACE_MODES },
          workspaceIsolation: { type: 'string', enum: WORKSPACE_ISOLATION_MODES },
          permissionMode: { type: 'string', enum: PERMISSION_MODES },
          allowedTools: { type: 'array', items: { type: 'string' } },
          group: { type: 'string' },
          instructions: { type: 'string' },
          skills: { type: 'object' },
          context: { type: 'object' },
          outputDir: { type: 'string' },
          transplant: { type: 'object' },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    execute: forkSession,
  },
  {
    definition: {
      name: 'list_browser_drivers',
      title: 'List Browser Drivers',
      description: 'Return runtime-owned browser drivers and capability descriptors.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    execute: listBrowserDrivers,
  },
  {
    definition: {
      name: 'list_browser_sessions',
      title: 'List Browser Sessions',
      description: 'Return runtime-owned browser sessions, optionally filtered by driver or runtime session.',
      inputSchema: {
        type: 'object',
        properties: {
          driverId: { type: 'string' },
          runtimeSessionId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    execute: listBrowserSessions,
  },
  {
    definition: {
      name: 'create_browser_session',
      title: 'Create Browser Session',
      description: 'Create a runtime-owned browser session bound optionally to a runtime session.',
      inputSchema: {
        type: 'object',
        properties: {
          driverId: { type: 'string' },
          runtimeSessionId: { type: 'string' },
          label: { type: 'string' },
          metadata: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
    execute: createBrowserSession,
  },
  {
    definition: {
      name: 'create_browser_page',
      title: 'Create Browser Page',
      description: 'Create a browser page using a manual URL/path or runtime preview binding.',
      inputSchema: {
        type: 'object',
        properties: {
          browserSessionId: { type: 'string' },
          label: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          path: { type: 'string' },
          mediaType: { type: 'string' },
          binding: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: BROWSER_BINDING_KINDS },
              runtimeSessionId: { type: 'string' },
              serviceId: { type: 'string' },
              artifactId: { type: 'string' },
            },
            additionalProperties: false,
          },
          metadata: { type: 'object' },
        },
        required: ['browserSessionId'],
        additionalProperties: false,
      },
    },
    execute: createBrowserPage,
  },
  {
    definition: {
      name: 'close_browser_session',
      title: 'Close Browser Session',
      description: 'Close a runtime-owned browser session and mark all pages closed.',
      inputSchema: {
        type: 'object',
        properties: {
          browserSessionId: { type: 'string' },
        },
        required: ['browserSessionId'],
        additionalProperties: false,
      },
    },
    execute: closeBrowserSession,
  },
  {
    definition: {
      name: 'audit_workspace',
      title: 'Audit Workspace',
      description: 'Preview workspace substrate readiness without applying changes.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          profile: { type: 'string', enum: SUBSTRATE_PROFILES },
          enabledAgents: {
            type: 'array',
            items: { type: 'string', enum: ENABLED_AGENTS },
          },
          includeA2A: { type: 'boolean' },
        },
        required: ['workspacePath'],
        additionalProperties: false,
      },
    },
    execute: auditWorkspace,
  },
  {
    definition: {
      name: 'init_workspace',
      title: 'Init Workspace',
      description: 'Preview or apply runtime-owned workspace substrate initialization.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          profile: { type: 'string', enum: SUBSTRATE_PROFILES },
          enabledAgents: {
            type: 'array',
            items: { type: 'string', enum: ENABLED_AGENTS },
          },
          includeA2A: { type: 'boolean' },
          apply: { type: 'boolean' },
          actorRole: { type: 'string', enum: ACTOR_ROLES },
          approved: { type: 'boolean' },
          hints: { type: 'object' },
        },
        required: ['workspacePath'],
        additionalProperties: false,
      },
    },
    execute: initWorkspace,
  },
  {
    definition: {
      name: 'audit_delivery_target',
      title: 'Audit Delivery Target',
      description: 'Inspect runtime delivery readiness for a workspace or session.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          sessionId: { type: 'string' },
          artifactIds: {
            type: 'array',
            items: { type: 'string' },
          },
          includeSessionArtifacts: { type: 'boolean' },
          includeSessionServices: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    execute: auditDeliveryTarget,
  },
  {
    definition: {
      name: 'commit_changes',
      title: 'Commit Changes',
      description: 'Preview or apply Git commit creation using the runtime delivery contract.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          sessionId: { type: 'string' },
          apply: { type: 'boolean' },
          actorRole: { type: 'string', enum: ACTOR_ROLES },
          approved: { type: 'boolean' },
          repo: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              stageAll: { type: 'boolean' },
              allowEmpty: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    execute: commitChanges,
  },
];

export function listMcpTools(): McpToolDefinition[] {
  return TOOL_HANDLERS.map((tool) => tool.definition);
}

export async function callMcpTool(
  ctx: AppContext,
  name: string,
  args: unknown,
): Promise<McpToolCallResult> {
  const handler = TOOL_HANDLERS.find((tool) => tool.definition.name === name);
  if (!handler) {
    throw new McpToolError(-32602, `Unknown tool '${name}'`);
  }

  return handler.execute(ctx, ensureObject(args ?? {}, 'tool arguments'));
}

export { McpToolError };
