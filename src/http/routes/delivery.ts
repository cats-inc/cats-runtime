import { Context, Hono } from 'hono';
import type {
  AgentRuntimeService,
  RuntimeDeliveryAction,
  RuntimeDeliveryRequest,
  SessionArtifact,
  WorkspaceSubstrateActorRole,
} from '../../core/types.js';
import { getRuntimeDeliveryService, type AppContext } from '../app.js';
import { parseOptionalString, parseStringArray } from '../parsing.js';

interface RuntimeRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

const ACTOR_ROLES: WorkspaceSubstrateActorRole[] = [
  'boss_cat',
  'specialist_cat',
  'system',
  'owner',
  'product_host',
  'operator',
];

export const deliveryRoutes = new Hono<RuntimeRouteEnv>();

function parseArtifacts(value: unknown): SessionArtifact[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const artifacts: SessionArtifact[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = parseOptionalString(record.id);
    if (!id) {
      continue;
    }

    artifacts.push({
      id,
      kind: parseOptionalString(record.kind),
      label: parseOptionalString(record.label),
      path: parseOptionalString(record.path),
      uri: parseOptionalString(record.uri),
      mediaType: parseOptionalString(record.mediaType),
      createdAt: parseOptionalString(record.createdAt),
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    });
  }

  return artifacts.length > 0 ? artifacts : undefined;
}

function parseServices(value: unknown): AgentRuntimeService[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const services: AgentRuntimeService[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = parseOptionalString(record.id);
    if (!id) {
      continue;
    }

    services.push({
      id,
      name: parseOptionalString(record.name) || id,
      url: parseOptionalString(record.url),
      status: parseOptionalString(record.status),
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    });
  }

  return services.length > 0 ? services : undefined;
}

function parseDeliveryRequest(
  action: RuntimeDeliveryAction,
  rawBody: Record<string, unknown>,
): RuntimeDeliveryRequest {
  const actorRole = ACTOR_ROLES.includes(rawBody.actorRole as WorkspaceSubstrateActorRole)
    ? rawBody.actorRole as WorkspaceSubstrateActorRole
    : undefined;
  const includeSessionArtifacts = typeof rawBody.includeSessionArtifacts === 'boolean'
    ? rawBody.includeSessionArtifacts
    : undefined;
  const includeSessionServices = typeof rawBody.includeSessionServices === 'boolean'
    ? rawBody.includeSessionServices
    : undefined;

  return {
    action,
    workspacePath: parseOptionalString(rawBody.workspacePath),
    sessionId: parseOptionalString(rawBody.sessionId),
    artifactIds: parseStringArray(rawBody.artifactIds),
    artifacts: parseArtifacts(rawBody.artifacts),
    services: parseServices(rawBody.services),
    apply: rawBody.apply === true,
    authorization: actorRole || rawBody.approved === true
      ? {
          actorRole,
          approved: rawBody.approved === true,
        }
      : undefined,
    publication: rawBody.publication && typeof rawBody.publication === 'object' && !Array.isArray(rawBody.publication)
      ? {
          directory: parseOptionalString((rawBody.publication as Record<string, unknown>).directory),
          manifestFileName: parseOptionalString((rawBody.publication as Record<string, unknown>).manifestFileName),
          publicBaseUrl: parseOptionalString((rawBody.publication as Record<string, unknown>).publicBaseUrl),
        }
      : undefined,
    repo: rawBody.repo && typeof rawBody.repo === 'object' && !Array.isArray(rawBody.repo)
      ? {
          message: parseOptionalString((rawBody.repo as Record<string, unknown>).message),
          stageAll: typeof (rawBody.repo as Record<string, unknown>).stageAll === 'boolean'
            ? (rawBody.repo as Record<string, unknown>).stageAll as boolean
            : undefined,
          allowEmpty: typeof (rawBody.repo as Record<string, unknown>).allowEmpty === 'boolean'
            ? (rawBody.repo as Record<string, unknown>).allowEmpty as boolean
            : undefined,
          remote: parseOptionalString((rawBody.repo as Record<string, unknown>).remote),
          branch: parseOptionalString((rawBody.repo as Record<string, unknown>).branch),
          setUpstream: typeof (rawBody.repo as Record<string, unknown>).setUpstream === 'boolean'
            ? (rawBody.repo as Record<string, unknown>).setUpstream as boolean
            : undefined,
          forceWithLease: typeof (rawBody.repo as Record<string, unknown>).forceWithLease === 'boolean'
            ? (rawBody.repo as Record<string, unknown>).forceWithLease as boolean
            : undefined,
        }
      : undefined,
    preview: includeSessionArtifacts !== undefined || includeSessionServices !== undefined
      ? {
          includeSessionArtifacts,
          includeSessionServices,
        }
      : undefined,
    context: rawBody.context && typeof rawBody.context === 'object' && !Array.isArray(rawBody.context)
      ? rawBody.context as Record<string, unknown>
      : undefined,
  };
}

async function handleDeliveryAction(
  c: Context<RuntimeRouteEnv>,
  action: RuntimeDeliveryAction,
) {
  const ctx = c.get('ctx');
  const rawBody = await c.req.json<Record<string, unknown>>().catch(
    () => ({} as Record<string, unknown>),
  );

  try {
    const result = await getRuntimeDeliveryService(ctx).execute(parseDeliveryRequest(action, rawBody));
    return c.json(result);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
      action,
    }, 500);
  }
}

deliveryRoutes.post('/delivery/audit', (c) =>
  handleDeliveryAction(c, 'audit-delivery-target'));
deliveryRoutes.post('/delivery/artifacts/publish', (c) =>
  handleDeliveryAction(c, 'publish-artifacts'));
deliveryRoutes.post('/delivery/repo/status', (c) =>
  handleDeliveryAction(c, 'inspect-repo-status'));
deliveryRoutes.post('/delivery/repo/commit', (c) =>
  handleDeliveryAction(c, 'create-commit'));
deliveryRoutes.post('/delivery/repo/push', (c) =>
  handleDeliveryAction(c, 'push-branch'));
