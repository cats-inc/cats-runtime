import { Context, Hono } from 'hono';
import type {
  WorkspaceSubstrateActorRole,
  WorkspaceSubstrateHints,
  WorkspaceSubstrateOperation,
  WorkspaceSubstrateProfileId,
  WorkspaceSubstrateRequest,
} from '../../core/types.js';
import { getWorkspaceSubstrateService, type AppContext } from '../app.js';
import { parseOptionalString, parseRecord, parseStringArray } from '../parsing.js';

interface RuntimeRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

const PROFILE_IDS: WorkspaceSubstrateProfileId[] = [
  'minimal',
  'standard',
  'a2a-enabled',
];

const ACTOR_ROLES: WorkspaceSubstrateActorRole[] = [
  'boss_cat',
  'specialist_cat',
  'system',
  'owner',
  'product_host',
  'operator',
];

const ENABLED_AGENTS = ['claude', 'codex'] as const;

export const workspaceSubstrateRoutes = new Hono<RuntimeRouteEnv>();

workspaceSubstrateRoutes.get('/workspace/substrate/profiles', (c) => {
  const ctx = c.get('ctx');
  return c.json(getWorkspaceSubstrateService(ctx).listProfiles());
});

function parseProfile(value: unknown): WorkspaceSubstrateProfileId | undefined {
  return PROFILE_IDS.includes(value as WorkspaceSubstrateProfileId)
    ? value as WorkspaceSubstrateProfileId
    : undefined;
}

function parseEnabledAgents(value: unknown): Array<'claude' | 'codex'> | undefined {
  const enabledAgents = parseStringArray(value)
    ?.filter((agent): agent is 'claude' | 'codex' =>
      ENABLED_AGENTS.includes(agent as (typeof ENABLED_AGENTS)[number]));
  return enabledAgents && enabledAgents.length > 0 ? enabledAgents : undefined;
}

function parseHints(value: unknown): WorkspaceSubstrateHints | undefined {
  const record = parseRecord(value);
  if (!record) {
    return undefined;
  }

  const hints: WorkspaceSubstrateHints = {
    projectType: record.projectType === 'monorepo' || record.projectType === 'single-project'
      ? record.projectType
      : undefined,
    purpose: parseOptionalString(record.purpose),
    background: parseOptionalString(record.background),
    technologyLabels: parseStringArray(record.technologyLabels),
    documentationStyle: parseOptionalString(record.documentationStyle),
  };

  return Object.values(hints).some((entry) => entry !== undefined) ? hints : undefined;
}

function parseAuthorization(
  rawBody: Record<string, unknown>,
): WorkspaceSubstrateRequest['authorization'] {
  const authorizationRecord = parseRecord(rawBody.authorization);
  const actorRoleValue = authorizationRecord?.actorRole ?? rawBody.actorRole;
  const actorRole = ACTOR_ROLES.includes(actorRoleValue as WorkspaceSubstrateActorRole)
    ? actorRoleValue as WorkspaceSubstrateActorRole
    : undefined;
  const approved = authorizationRecord?.approved === true || rawBody.approved === true;

  if (!actorRole && !approved) {
    return undefined;
  }

  return {
    actorRole,
    approved,
  };
}

function parseWorkspaceSubstrateRequest(
  operation: WorkspaceSubstrateOperation,
  rawBody: Record<string, unknown>,
): { request?: WorkspaceSubstrateRequest; error?: string } {
  const workspacePath = parseOptionalString(rawBody.workspacePath);
  if (!workspacePath) {
    return {
      error: 'workspacePath is required.',
    };
  }

  return {
    request: {
      operation,
      workspacePath,
      profile: parseProfile(rawBody.profile),
      enabledAgents: parseEnabledAgents(rawBody.enabledAgents),
      includeA2A: typeof rawBody.includeA2A === 'boolean' ? rawBody.includeA2A : undefined,
      apply: rawBody.apply === true,
      hints: parseHints(rawBody.hints),
      authorization: parseAuthorization(rawBody),
    },
  };
}

async function handleWorkspaceSubstrateOperation(
  c: Context<RuntimeRouteEnv>,
  operation: WorkspaceSubstrateOperation,
) {
  const ctx = c.get('ctx');
  const rawBody = await c.req.json<Record<string, unknown>>().catch(
    () => ({} as Record<string, unknown>),
  );
  const { request, error } = parseWorkspaceSubstrateRequest(operation, rawBody);

  if (!request) {
    return c.json({
      error,
      operation,
    }, 400);
  }

  try {
    const result = await getWorkspaceSubstrateService(ctx).execute(request);
    return c.json(result);
  } catch (routeError) {
    return c.json({
      error: routeError instanceof Error ? routeError.message : String(routeError),
      operation,
      workspacePath: request.workspacePath,
    }, 500);
  }
}

workspaceSubstrateRoutes.post('/workspace/substrate/audit', (c) =>
  handleWorkspaceSubstrateOperation(c, 'audit-workspace'));
workspaceSubstrateRoutes.post('/workspace/substrate/init', (c) =>
  handleWorkspaceSubstrateOperation(c, 'init-workspace'));
workspaceSubstrateRoutes.post('/workspace/substrate/update', (c) =>
  handleWorkspaceSubstrateOperation(c, 'update-workspace'));
