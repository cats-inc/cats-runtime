import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createPeerPayloadSignature } from '../core/peers/auth.js';
import { createPeerExecutionError } from '../core/peers/errors.js';
import { PeerTrustService } from '../core/peers/PeerTrustService.js';
import type { StreamEvent } from '../core/types.js';
import { createRuntimeStartupState } from '../startup.js';
import type { AppContext } from './app.js';
import { peerExecutionRoutes } from './routes/peerExecutions.js';

function createRequestBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    caller: {
      peerId: 'caller-peer',
      sessionId: 'session-1',
      runId: 'run-1',
      traceId: 'trace-1',
    },
    target: {
      provider: 'codex',
      backend: 'api',
      instance: 'main',
      model: 'gpt-5.4',
    },
    workspace: {
      mode: 'none',
    },
    turn: {
      message: 'hello peer',
    },
    ...overrides,
  };
}

function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .map((frame) => frame
      .split('\n')
      .find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

function createSignedHeaders(
  body: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: 'Bearer lan-secret',
    'content-type': 'application/json',
    'x-cats-peer-id': 'caller-peer',
    'x-cats-peer-signature': createPeerPayloadSignature('lan-secret', body),
    ...overrides,
  };
}

function createApp(
  options: {
    execute?: (request: unknown, signal?: AbortSignal) => AsyncGenerator<StreamEvent>;
    trustedPeerIds?: string[];
  } = {},
): {
  app: Hono<{ Variables: { ctx: AppContext } }>;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(options.execute || (async function* () {
    yield {
      type: 'init',
      sessionId: 'peer-exec-1',
    } satisfies StreamEvent;
    yield {
      type: 'result',
      summary: 'Peer execution completed.',
    } satisfies StreamEvent;
  }));
  const trust = new PeerTrustService({
    config: {
      sharedSecret: 'lan-secret',
      trustedPeerIds: options.trustedPeerIds || ['caller-peer'],
      rejectedPeerIds: [],
    },
    localPeerId: 'callee-peer',
  });
  const ctx = {
    startup: createRuntimeStartupState(),
    peerTrust: trust,
    peerExecutionService: {
      execute,
    },
  } as AppContext;
  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    await next();
  });
  app.route('/', peerExecutionRoutes);
  return { app, execute };
}

describe('peer execution routes', () => {
  it('rejects unauthenticated peer execution requests', async () => {
    const { app, execute } = createApp();

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(createRequestBody()),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Missing peer Authorization bearer token.',
      code: 'peer_auth_required',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('streams authenticated peer execution requests over NDJSON', async () => {
    const { app, execute } = createApp();
    const body = JSON.stringify(createRequestBody());

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body, {
        accept: 'application/x-ndjson',
      }),
      body,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(parseNdjson(await response.text())).toEqual([
      {
        type: 'init',
        sessionId: 'peer-exec-1',
      },
      {
        type: 'result',
        summary: 'Peer execution completed.',
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched authenticated caller ids', async () => {
    const { app, execute } = createApp();
    const body = JSON.stringify(createRequestBody({
      caller: {
        peerId: 'other-peer',
        sessionId: 'session-1',
        runId: 'run-1',
        traceId: 'trace-1',
      },
    }));

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body),
      body,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Peer caller id 'other-peer' does not match authenticated peer 'caller-peer'.",
      code: 'peer_auth_failed',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('streams peer execution failures over SSE with routing failure metadata', async () => {
    const { app, execute } = createApp({
      execute: async function* () {
        throw createPeerExecutionError({
          code: 'peer_execution_rejected',
          message: 'Peer execution failed before completion.',
          retryable: false,
          peerId: 'callee-peer',
          status: 409,
        });
      },
    });
    const body = JSON.stringify(createRequestBody());

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body, {
        accept: 'text/event-stream',
      }),
      body,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(parseSse(await response.text())).toEqual([
      {
        type: 'error',
        text: 'Peer execution failed before completion.',
        metadata: {
          peerRoutingFailure: {
            code: 'peer_execution_rejected',
            message: 'Peer execution failed before completion.',
            retryable: false,
            peerId: 'callee-peer',
            status: 409,
          },
        },
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects peer execution requests with an invalid payload signature', async () => {
    const { app, execute } = createApp();
    const body = JSON.stringify(createRequestBody());

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body, {
        'x-cats-peer-signature': createPeerPayloadSignature('wrong-secret', body),
      }),
      body,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Peer execution auth failed.',
      code: 'peer_auth_failed',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects peer execution requests without the signature algorithm prefix', async () => {
    const { app, execute } = createApp();
    const body = JSON.stringify(createRequestBody());

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body, {
        'x-cats-peer-signature': createPeerPayloadSignature('lan-secret', body).slice('sha256='.length),
      }),
      body,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Peer execution auth failed.',
      code: 'peer_auth_failed',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
