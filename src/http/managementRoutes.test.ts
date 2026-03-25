import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { managementRoutes } from './routes/management.js';
import { RuntimeManagementService } from '../core/management/RuntimeManagementService.js';
import { StubManagementAdapter } from '../core/management/adapters/stub/StubAdapter.js';
import type { AppContext } from './app.js';

function createTestApp(): { app: ReturnType<typeof Hono.prototype>; service: RuntimeManagementService } {
  const service = new RuntimeManagementService({
    config: {
      version: 1,
      adapters: {
        review: { default: 'github', instances: {} },
        deployment: { default: 'zeabur', instances: {} },
      },
    },
  });
  service.registerAdapter(new StubManagementAdapter('github', ['review'], [
    'audit_review_target', 'open_pull_request', 'inspect_pull_request', 'wait_review_checks',
  ]));
  service.registerAdapter(new StubManagementAdapter('zeabur', ['deployment'], [
    'audit_deployment_target', 'create_deployment', 'inspect_deployment', 'read_deployment_logs',
  ]));

  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  app.use('*', async (c, next) => {
    c.set('ctx', { management: service } as AppContext);
    await next();
  });
  app.route('/', managementRoutes);

  return { app, service };
}

describe('management routes', () => {
  let app: ReturnType<typeof Hono.prototype>;
  let service: RuntimeManagementService;

  beforeEach(() => {
    const created = createTestApp();
    app = created.app;
    service = created.service;
  });

  // -----------------------------------------------------------------------
  // Review routes
  // -----------------------------------------------------------------------

  it('POST /management/review/audit returns result', async () => {
    const res = await app.request('/management/review/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: '/tmp' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe('review');
    expect(body.action).toBe('audit_review_target');
    expect(body.state).toBe('completed');
  });

  it('POST /management/review/open-pr returns result', async () => {
    const res = await app.request('/management/review/open-pr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspacePath: '/tmp',
        actorClass: 'owner',
        apply: true,
        target: { title: 'test' },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('open_pull_request');
  });

  it('POST /management/review/inspect returns result', async () => {
    const res = await app.request('/management/review/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { number: 1 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('inspect_pull_request');
  });

  it('POST /management/review/wait-checks returns result', async () => {
    const res = await app.request('/management/review/wait-checks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { number: 1, timeoutMs: 1000 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('wait_review_checks');
  });

  // -----------------------------------------------------------------------
  // Deployment routes
  // -----------------------------------------------------------------------

  it('POST /management/deployment/audit returns result', async () => {
    const res = await app.request('/management/deployment/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe('deployment');
    expect(body.action).toBe('audit_deployment_target');
  });

  it('POST /management/deployment/create returns result', async () => {
    const res = await app.request('/management/deployment/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorClass: 'owner', apply: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('create_deployment');
  });

  it('POST /management/deployment/inspect returns result', async () => {
    const res = await app.request('/management/deployment/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it('POST /management/deployment/logs returns result', async () => {
    const res = await app.request('/management/deployment/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  // -----------------------------------------------------------------------
  // Authorization blocking
  // -----------------------------------------------------------------------

  it('blocks mutating apply without authorization', async () => {
    const res = await app.request('/management/review/open-pr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apply: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('blocked');
    expect(body.contract.applyDecision).toBe('blocked');
  });

  // -----------------------------------------------------------------------
  // Operation resume
  // -----------------------------------------------------------------------

  it('POST /management/operations/:id/resume returns 404 for unknown', async () => {
    const res = await app.request('/management/operations/nonexistent/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('POST /management/operations/:id/resume returns result for known op', async () => {
    const op = service.operations.create();
    service.operations.complete(op.operationId, { checks: 'passed' });

    const res = await app.request(`/management/operations/${op.operationId}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('completed');
  });

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  it('GET /management/diagnostics returns adapter diagnostics', async () => {
    const res = await app.request('/management/diagnostics');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adapters).toBeDefined();
    expect(body.adapters.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /management/diagnostics?domain=review filters by domain', async () => {
    const res = await app.request('/management/diagnostics?domain=review');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adapters.every((a: { domain: string }) => a.domain === 'review')).toBe(true);
  });
});
