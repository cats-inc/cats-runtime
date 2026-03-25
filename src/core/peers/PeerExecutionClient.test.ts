import { describe, expect, it } from 'vitest';
import type { SessionInfo, StreamEvent, TurnInput } from '../types.js';
import { createPeerPayloadSignature } from './auth.js';
import { PeerExecutionClient } from './PeerExecutionClient.js';
import type { PeerRegistryEntry } from './types.js';

function createSession(
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id: 'session-1',
    providerName: 'codex',
    providerBackend: 'api',
    providerInstanceId: 'main',
    status: 'ready',
    origin: 'runtime',
    cwd: '/workspace',
    instructions: 'Base instructions.',
    context: {
      source: 'interactive',
      workspace: {
        cwd: '/workspace',
      },
    },
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-25T00:00:00.000Z',
    updatedAt: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

function createPeerEntry(
  peerId = 'peer-a',
): PeerRegistryEntry {
  return {
    identity: {
      peerId,
      displayName: peerId,
      runtimeVersion: '0.1.0-test',
      advertisedUrl: `http://${peerId}.local:3110`,
    },
    liveness: {
      state: 'alive',
      firstSeenAt: '2026-03-25T00:00:00.000Z',
      observedAt: '2026-03-25T00:00:00.000Z',
      expiresAt: '2026-03-25T00:00:30.000Z',
      ageMs: 0,
      expiresInMs: 30_000,
    },
    capabilities: {
      providers: ['codex'],
      targets: [{
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        default: true,
      }],
      targetLimit: 16,
      truncated: false,
    },
    load: {
      activeSessions: 0,
      busyWorkers: 0,
      idleWorkers: 1,
      providerWorkers: {},
      capacityState: 'idle',
    },
    trust: {
      state: 'trusted',
      reason: 'configured_trust',
    },
    sources: ['static:peer-a'],
    sourceKinds: ['static'],
  };
}

async function collectEvents(
  stream: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('PeerExecutionClient', () => {
  it('builds a bounded peer execution request and strips caller workspace paths by default', () => {
    const client = new PeerExecutionClient({
      config: {
        requestTimeoutMs: 30_000,
        sharedSecret: 'lan-secret',
      },
      localPeerId: 'local-peer',
      now: () => Date.parse('2026-03-25T00:00:00.000Z'),
    });

    const { request, trace } = client.buildRequest({
      session: createSession(),
      turn: {
        message: 'hello peer',
        instructions: 'Turn instructions.',
      } satisfies TurnInput,
      peer: createPeerEntry(),
      routing: {
        mode: 'peer',
        peerId: 'peer-a',
        strategy: 'explicit',
        shareWorkspace: false,
      },
      runId: 'run-1',
      transport: 'ndjson',
    });

    expect(request).toEqual({
      caller: {
        peerId: 'local-peer',
        sessionId: 'session-1',
        runId: 'run-1',
        traceId: expect.any(String),
      },
      target: {
        provider: 'codex',
        backend: 'api',
        instance: 'main',
      },
      workspace: {
        mode: 'none',
      },
      turn: {
        message: 'hello peer',
        instructions: 'Base instructions.\n\nTurn instructions.',
        context: {
          source: 'interactive',
          workspace: {},
        },
      },
    });
    expect(trace).toEqual(expect.objectContaining({
      peerId: 'peer-a',
      callerPeerId: 'local-peer',
      transport: 'ndjson',
      strategy: 'explicit',
      workspaceMode: 'none',
      routedAt: '2026-03-25T00:00:00.000Z',
    }));
  });

  it('streams and decorates NDJSON peer execution events', async () => {
    const client = new PeerExecutionClient({
      config: {
        requestTimeoutMs: 30_000,
        sharedSecret: 'lan-secret',
      },
      localPeerId: 'local-peer',
      fetch: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        const body = String(init?.body || '');

        expect(headers.authorization).toBe('Bearer lan-secret');
        expect(headers['x-cats-peer-id']).toBe('local-peer');
        expect(headers['x-cats-peer-signature']).toBe(
          createPeerPayloadSignature('lan-secret', body),
        );

        return new Response([
          JSON.stringify({ type: 'text', text: 'peer hello' }),
          JSON.stringify({ type: 'result' }),
        ].join('\n') + '\n', {
          status: 200,
          headers: {
            'content-type': 'application/x-ndjson',
          },
        });
      },
    });

    const peer = createPeerEntry();
    const { request, trace } = client.buildRequest({
      session: createSession(),
      turn: { message: 'hello' },
      peer,
      routing: {
        mode: 'peer',
        peerId: peer.identity.peerId,
        strategy: 'explicit',
        shareWorkspace: false,
      },
      runId: 'run-1',
      transport: 'ndjson',
    });

    await expect(collectEvents(
      client.streamExecution(peer, request, trace, new AbortController().signal),
    )).resolves.toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'peer hello',
        metadata: expect.objectContaining({
          peerRouting: expect.objectContaining({
            mode: 'peer',
            peerId: 'peer-a',
            strategy: 'explicit',
          }),
        }),
      }),
      expect.objectContaining({
        type: 'result',
      }),
    ]);
  });

  it('rejects SSE streams that end without a terminal event', async () => {
    const client = new PeerExecutionClient({
      config: {
        requestTimeoutMs: 30_000,
        sharedSecret: 'lan-secret',
      },
      localPeerId: 'local-peer',
      fetch: async () => new Response([
        'data: {"type":"text","text":"partial"}',
        '',
      ].join('\n'), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
        },
      }),
    });

    const peer = createPeerEntry();
    const { request, trace } = client.buildRequest({
      session: createSession(),
      turn: { message: 'hello' },
      peer,
      routing: {
        mode: 'peer',
        peerId: peer.identity.peerId,
        strategy: 'explicit',
        shareWorkspace: false,
      },
      runId: 'run-1',
      transport: 'sse',
    });

    await expect(collectEvents(
      client.streamExecution(peer, request, trace, new AbortController().signal),
    )).rejects.toThrow('closed the execution stream without a terminal event');
  });

  it('rejects peer requests that exceed the configured routing timeout', async () => {
    const client = new PeerExecutionClient({
      config: {
        requestTimeoutMs: 5,
        sharedSecret: 'lan-secret',
      },
      localPeerId: 'local-peer',
      fetch: async (_input, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('missing signal'));
          return;
        }

        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        }, { once: true });
      }),
    });

    const peer = createPeerEntry();
    const { request, trace } = client.buildRequest({
      session: createSession(),
      turn: { message: 'hello' },
      peer,
      routing: {
        mode: 'peer',
        peerId: peer.identity.peerId,
        strategy: 'explicit',
        shareWorkspace: false,
      },
      runId: 'run-1',
      transport: 'ndjson',
    });

    await expect(collectEvents(
      client.streamExecution(peer, request, trace, new AbortController().signal),
    )).rejects.toThrow('did not respond before the routing timeout');
  });

  it('omits the authorization header when no peer shared secret is configured', async () => {
    const client = new PeerExecutionClient({
      config: {
        requestTimeoutMs: 30_000,
        sharedSecret: undefined,
      },
      localPeerId: 'local-peer',
      fetch: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.authorization).toBeUndefined();
        expect(headers['x-cats-peer-id']).toBe('local-peer');
        expect(headers['x-cats-peer-signature']).toBeUndefined();
        return new Response([
          JSON.stringify({ type: 'result' }),
        ].join('\n') + '\n', {
          status: 200,
          headers: {
            'content-type': 'application/x-ndjson',
          },
        });
      },
    });

    const peer = createPeerEntry();
    const { request, trace } = client.buildRequest({
      session: createSession(),
      turn: { message: 'hello' },
      peer,
      routing: {
        mode: 'peer',
        peerId: peer.identity.peerId,
        strategy: 'explicit',
        shareWorkspace: false,
      },
      runId: 'run-1',
      transport: 'ndjson',
    });

    await expect(collectEvents(
      client.streamExecution(peer, request, trace, new AbortController().signal),
    )).resolves.toEqual([
      expect.objectContaining({
        type: 'result',
      }),
    ]);
  });
});
