import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createPeerPayloadSignature } from '../core/peers/auth.js';
import { PeerExecutionAdmissionService } from '../core/peers/PeerExecutionAdmissionService.js';
import { PeerExecutionReplayService } from '../core/peers/PeerExecutionReplayService.js';
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
  options: {
    legacy?: boolean;
    timestamp?: string;
    nonce?: string;
  } = {},
): Record<string, string> {
  const timestamp = options.timestamp ?? '1763510400000';
  const nonce = options.nonce ?? 'nonce-1';
  return {
    authorization: 'Bearer lan-secret',
    'content-type': 'application/json',
    'x-cats-peer-id': 'caller-peer',
    ...(
      options.legacy
        ? {}
        : {
            'x-cats-peer-timestamp': timestamp,
            'x-cats-peer-nonce': nonce,
          }
    ),
    'x-cats-peer-signature': createPeerPayloadSignature(
      'lan-secret',
      body,
      options.legacy
        ? undefined
        : {
            timestamp,
            nonce,
          },
    ),
    ...overrides,
  };
}

function createApp(
  options: {
    execute?: (request: unknown, signal?: AbortSignal) => AsyncGenerator<StreamEvent>;
    trustedPeerIds?: string[];
    admission?: PeerExecutionAdmissionService;
    replay?: PeerExecutionReplayService;
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
      sharedSecrets: [],
      trustedPeerIds: options.trustedPeerIds || ['caller-peer'],
      rejectedPeerIds: [],
    },
    localPeerId: 'callee-peer',
  });
  const ctx = {
    startup: createRuntimeStartupState(),
    peerTrust: trust,
    peerExecutionAdmission: options.admission ?? new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 60_000,
        maxAuthFailuresPerWindow: 5,
        maxInboundExecutions: 8,
        maxInboundExecutionsPerPeer: 2,
        limitOverrides: [],
      },
    }),
    peerExecutionReplay: options.replay ?? new PeerExecutionReplayService({
      config: {
        replayWindowMs: 60_000,
        replayNonceTtlMs: 120_000,
        maxReplayNoncesPerCaller: 32,
        limitOverrides: [],
      },
      now: () => 1_763_510_400_000,
    }),
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

  it('rate-limits repeated peer auth failures for the same caller', async () => {
    const admission = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 60_000,
        maxAuthFailuresPerWindow: 2,
        maxInboundExecutions: 8,
        maxInboundExecutionsPerPeer: 2,
        limitOverrides: [],
      },
    });
    const { app, execute } = createApp({ admission });
    const headers = {
      'content-type': 'application/json',
      'x-cats-peer-id': 'caller-peer',
    };

    const first = await app.request('/peer/executions', {
      method: 'POST',
      headers,
      body: JSON.stringify(createRequestBody()),
    });
    expect(first.status).toBe(401);

    const second = await app.request('/peer/executions', {
      method: 'POST',
      headers,
      body: JSON.stringify(createRequestBody()),
    });
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({
      error: 'Peer execution auth is temporarily rate limited for this caller.',
      code: 'peer_auth_rate_limited',
      retryAfterMs: expect.any(Number),
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

  it('accepts legacy payload-only signatures during migration', async () => {
    const { app, execute } = createApp();
    const body = JSON.stringify(createRequestBody());

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body, {
        accept: 'application/x-ndjson',
      }, {
        legacy: true,
      }),
      body,
    });

    expect(response.status).toBe(200);
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

  it('rejects inbound peer execution when the caller exceeds admission capacity', async () => {
    const admission = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 60_000,
        maxAuthFailuresPerWindow: 5,
        maxInboundExecutions: 8,
        maxInboundExecutionsPerPeer: 1,
        limitOverrides: [],
      },
    });
    const held = admission.acquireInboundExecution('caller-peer');
    expect(held.ok).toBe(true);
    if (!held.ok) {
      throw new Error('Expected to hold one inbound execution slot.');
    }

    try {
      const { app, execute } = createApp({ admission });
      const body = JSON.stringify(createRequestBody());

      const response = await app.request('/peer/executions', {
        method: 'POST',
        headers: createSignedHeaders(body),
        body,
      });

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        error: 'Peer execution caller exceeded inbound execution capacity.',
        code: 'peer_execution_rate_limited',
        details: {
          reason: 'peer_limit',
          activeGlobal: 1,
          activeForPeer: 1,
          maxGlobal: 8,
          maxPerPeer: 1,
          overrideApplied: false,
        },
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      held.release();
    }
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

  it('rejects peer execution requests with stale replay headers', async () => {
    const replay = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 10_000,
        replayNonceTtlMs: 60_000,
        maxReplayNoncesPerCaller: 32,
        limitOverrides: [],
      },
      now: () => 1_763_510_400_000,
    });
    const { app, execute } = createApp({ replay });
    const body = JSON.stringify(createRequestBody());

    const response = await app.request('/peer/executions', {
      method: 'POST',
      headers: createSignedHeaders(body, {}, {
        timestamp: '1763510380000',
        nonce: 'nonce-stale',
      }),
      body,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Peer execution auth timestamp is outside the allowed replay window.',
      code: 'peer_auth_stale',
      details: {
        callerKey: 'peer:caller-peer',
        replayWindowMs: 10_000,
        now: 1_763_510_400_000,
        timestampMs: 1_763_510_380_000,
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects replayed peer execution nonces inside the configured window', async () => {
    const replay = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 60_000,
        replayNonceTtlMs: 60_000,
        maxReplayNoncesPerCaller: 32,
        limitOverrides: [],
      },
      now: () => 1_763_510_400_000,
    });
    const { app, execute } = createApp({ replay });
    const body = JSON.stringify(createRequestBody());
    const headers = createSignedHeaders(body, {}, {
      timestamp: '1763510400000',
      nonce: 'nonce-replay',
    });

    const first = await app.request('/peer/executions', {
      method: 'POST',
      headers,
      body,
    });
    expect(first.status).toBe(200);

    const second = await app.request('/peer/executions', {
      method: 'POST',
      headers,
      body,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: 'Peer execution auth nonce has already been used inside the replay window.',
      code: 'peer_auth_replayed',
      details: {
        callerKey: 'peer:caller-peer',
        nonce: 'nonce-replay',
        replayWindowMs: 60_000,
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
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

  it('surfaces per-peer inbound quota overrides in admission failures', async () => {
    const admission = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 60_000,
        maxAuthFailuresPerWindow: 5,
        maxInboundExecutions: 8,
        maxInboundExecutionsPerPeer: 3,
        limitOverrides: [{
          peerId: 'caller-peer',
          maxInboundExecutions: 1,
        }],
      },
    });
    const held = admission.acquireInboundExecution('caller-peer');
    expect(held.ok).toBe(true);
    if (!held.ok) {
      throw new Error('Expected to hold the overridden inbound execution slot.');
    }

    try {
      const { app } = createApp({ admission });
      const body = JSON.stringify(createRequestBody());
      const response = await app.request('/peer/executions', {
        method: 'POST',
        headers: createSignedHeaders(body),
        body,
      });

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        error: 'Peer execution caller exceeded inbound execution capacity.',
        code: 'peer_execution_rate_limited',
        details: {
          reason: 'peer_limit',
          activeGlobal: 1,
          activeForPeer: 1,
          maxGlobal: 8,
          maxPerPeer: 1,
          overrideApplied: true,
        },
      });
    } finally {
      held.release();
    }
  });
});
