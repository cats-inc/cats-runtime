import { WorkspaceSubstrateService } from '../core/runtime/WorkspaceSubstrateService.js';
import { RUNTIME_VERSION } from '../startup.js';
import {
  getRuntimeDeliveryService,
  getRuntimeSessionManager,
  type AppContext,
} from '../http/app.js';
import { buildMcpObserveSessionPayload, buildMcpSessionSummary } from './readModels.js';
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

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpToolError(-32602, `${label} must be an object`);
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
    status: readOptionalString(args, 'status') as typeof ctx.registry.list extends (filters?: infer F) => unknown
      ? F extends { status?: infer S } ? S : never
      : never,
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
  _ctx: AppContext,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const service = new WorkspaceSubstrateService();
  const workspacePath = readRequiredString(args, 'workspacePath');
  const result = await service.execute({
    operation: 'audit-workspace',
    workspacePath,
    ...(readOptionalString(args, 'profile') ? { profile: readOptionalString(args, 'profile') as 'minimal' | 'standard' | 'a2a-enabled' } : {}),
    ...(readOptionalStringArray(args, 'enabledAgents')
      ? {
          enabledAgents: readOptionalStringArray(args, 'enabledAgents') as Array<'claude' | 'gemini' | 'codex'>,
        }
      : {}),
    ...(readOptionalBoolean(args, 'includeA2A') !== undefined
      ? { includeA2A: readOptionalBoolean(args, 'includeA2A') }
      : {}),
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
          status: { type: 'string' },
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
      name: 'audit_workspace',
      title: 'Audit Workspace',
      description: 'Preview workspace substrate readiness without applying changes.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string' },
          profile: { type: 'string' },
          enabledAgents: {
            type: 'array',
            items: { type: 'string' },
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
