import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  RuntimeManagementAction,
  RuntimeManagementDomain,
  RuntimeManagementActorClass,
} from '../../core/management/types.js';
import { diagnoseManagementAdapters } from '../../core/management/diagnostics.js';
import { getRuntimeManagementService, type AppContext } from '../app.js';
import { parseOptionalString } from '../parsing.js';

interface RuntimeRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

const VALID_ACTOR_CLASSES: RuntimeManagementActorClass[] = [
  'system',
  'owner',
  'operator',
  'service',
];

export const managementRoutes = new Hono<RuntimeRouteEnv>();

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

managementRoutes.post('/management/review/audit', (c) =>
  handleManagementAction(c, 'review', 'audit_review_target'));

managementRoutes.post('/management/review/open-pr', (c) =>
  handleManagementAction(c, 'review', 'open_pull_request'));

managementRoutes.post('/management/review/inspect', (c) =>
  handleManagementAction(c, 'review', 'inspect_pull_request'));

managementRoutes.post('/management/review/wait-checks', (c) =>
  handleManagementAction(c, 'review', 'wait_review_checks'));

// ---------------------------------------------------------------------------
// Deployment actions
// ---------------------------------------------------------------------------

managementRoutes.post('/management/deployment/audit', (c) =>
  handleManagementAction(c, 'deployment', 'audit_deployment_target'));

managementRoutes.post('/management/deployment/create', (c) =>
  handleManagementAction(c, 'deployment', 'create_deployment'));

managementRoutes.post('/management/deployment/inspect', (c) =>
  handleManagementAction(c, 'deployment', 'inspect_deployment'));

managementRoutes.post('/management/deployment/logs', (c) =>
  handleManagementAction(c, 'deployment', 'read_deployment_logs'));

// ---------------------------------------------------------------------------
// Operation resumption
// ---------------------------------------------------------------------------

managementRoutes.post('/management/operations/:operationId/resume', async (c) => {
  const ctx = c.get('ctx');
  const operationId = c.req.param('operationId');
  const rawBody = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const timeoutMs = typeof rawBody.timeoutMs === 'number' ? rawBody.timeoutMs : undefined;

  try {
    const service = getRuntimeManagementService(ctx);
    const result = await service.resumeOperation(operationId, timeoutMs);
    if (!result) {
      return c.json({ error: 'Operation not found or expired.', operationId }, 404);
    }
    return c.json(result);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
      operationId,
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

managementRoutes.get('/management/diagnostics', async (c) => {
  const ctx = c.get('ctx');
  const domain = c.req.query('domain');
  const workspacePath = c.req.query('workspacePath');

  try {
    const service = getRuntimeManagementService(ctx);
    const results = await diagnoseManagementAdapters(service, {
      domains: domain ? [domain] : undefined,
      workspacePath: workspacePath || undefined,
    });
    return c.json({ adapters: results });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleManagementAction(
  c: Context<RuntimeRouteEnv>,
  domain: RuntimeManagementDomain,
  action: RuntimeManagementAction,
) {
  const ctx = c.get('ctx');
  const rawBody = await c.req.json<Record<string, unknown>>().catch(
    () => ({} as Record<string, unknown>),
  );

  const actorClass = VALID_ACTOR_CLASSES.includes(rawBody.actorClass as RuntimeManagementActorClass)
    ? rawBody.actorClass as RuntimeManagementActorClass
    : undefined;
  const approvalRef = parseOptionalString(rawBody.approvalRef);

  try {
    const service = getRuntimeManagementService(ctx);
    const result = await service.execute({
      domain,
      action,
      adapter: parseOptionalString(rawBody.adapter),
      workspacePath: parseOptionalString(rawBody.workspacePath),
      sessionId: parseOptionalString(rawBody.sessionId),
      apply: rawBody.apply === true,
      authorization: actorClass || approvalRef
        ? { actorClass, approvalRef }
        : undefined,
      target: rawBody.target && typeof rawBody.target === 'object' && !Array.isArray(rawBody.target)
        ? rawBody.target as Record<string, unknown>
        : undefined,
      context: rawBody.context && typeof rawBody.context === 'object' && !Array.isArray(rawBody.context)
        ? rawBody.context as Record<string, unknown>
        : undefined,
    });
    return c.json(result);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
      domain,
      action,
    }, 500);
  }
}
