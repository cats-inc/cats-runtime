import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { interactionRoutes } from './interactions.js';
import { bearerAuth } from '../auth.js';
import { InteractionStore } from '../../core/interactions/InteractionStore.js';
import { InteractionError } from '../../core/interactions/types.js';
import type { AppContext } from '../app.js';

function fixture() {
  const controller = new AbortController();
  const store = new InteractionStore('session', { version: 1, kinds: ['user_input'], timeoutMs: 60_000 });
  let deliveries = 0;
  const id = store.register({ executionId: 'execution', signal: controller.signal,
    prompt: { kind: 'user_input', title: 'Question', fields: [{ id: 'secret', label: 'Answer', type: 'string', required: true, secret: true }] },
    respond: async () => { deliveries++; }, fallback: async () => {},
  });
  const ctx = { registry: { get: (id: string) => id === 'session' ? { id } : undefined },
    runtime: {
      interactionSnapshot: () => store.snapshot(),
      respondToInteraction: (session: string, id: string, value: unknown) => {
        if (session !== store.sessionId) throw new InteractionError('interaction_not_found', 'Not found');
        return store.respond(id, value);
      },
    },
  } as unknown as AppContext;
  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  app.use('*', bearerAuth({ apiKey: 'fixture-token' } as AppContext['config']));
  app.use('*', async (c, next) => { c.set('ctx', ctx); await next(); });
  app.route('/', interactionRoutes);
  const url = `/sessions/session/interactions/${id}/responses`;
  const headers = { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' };
  const response = { expectedRevision: 1, idempotencyKey: 'fixture-response', answer: { action: 'accept', values: { secret: 'private-marker' } } };
  return { app, controller, url, headers, response, deliveries: () => deliveries };
}

describe('provider interaction HTTP control', () => {
  it('requires authentication and limits the route to its owning session', async () => {
    const f = fixture();
    try {
      expect((await f.app.request('/sessions/session/interactions')).status).toBe(401);
      expect((await f.app.request(f.url, { method: 'POST', body: JSON.stringify(f.response) })).status).toBe(401);
      expect((await f.app.request('/sessions/foreign/interactions', { headers: f.headers })).status).toBe(404);
    } finally { f.controller.abort(); }
  });
  it('serves a no-store snapshot and idempotent redacted receipts without waiting for the model turn', async () => {
    const f = fixture();
    try {
      const snapshot = await f.app.request('/sessions/session/interactions', { headers: f.headers });
      expect(snapshot.headers.get('Cache-Control')).toBe('no-store');
      expect((await snapshot.json()).interactions[0].status).toBe('pending');
      const request = () => f.app.request(f.url, { method: 'POST', headers: f.headers, body: JSON.stringify(f.response) });
      const [one, two] = await Promise.all([request(), request()]);
      expect(one.status).toBe(200); expect(two.status).toBe(200);
      const receipt = await one.text();
      expect(receipt).not.toContain('private-marker'); expect(receipt).not.toContain('prompt');
      expect(f.deliveries()).toBe(1);
      const stale = await f.app.request(f.url, { method: 'POST', headers: f.headers,
        body: JSON.stringify({ ...f.response, idempotencyKey: 'different' }) });
      expect(stale.status).toBe(409);
    } finally { f.controller.abort(); }
  });
  it('rejects invalid bodies and late replies after cancellation', async () => {
    const f = fixture();
    const invalid = await f.app.request(f.url, { method: 'POST', headers: f.headers, body: '{' });
    expect(invalid.status).toBe(400);
    const large = await f.app.request(f.url, { method: 'POST', headers: f.headers, body: 'x'.repeat(40_000) });
    expect(large.status).toBe(413);
    f.controller.abort();
    expect((await f.app.request(f.url, { method: 'POST', headers: f.headers, body: JSON.stringify(f.response) })).status).toBe(409);
    expect(f.deliveries()).toBe(0);
  });
});
