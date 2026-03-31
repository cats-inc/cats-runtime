import { describe, expect, it } from 'vitest';
import { ProviderEvolutionEvidenceCollector } from '../../../../core/compatibility/providerEvolution.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { OpenClawAdapter } from './OpenClawAdapter.js';

function createInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'gateway',
    providerName: 'openclaw',
    backend: 'agent',
    transport: 'openclaw_gateway',
    url: 'ws://gateway.test/ws',
    model: 'openclaw-coder',
  };
}

class FakeOpenClawSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      this.emitFrame({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-1' },
      });
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    const method = typeof frame.method === 'string' ? frame.method : '';

    if (method === 'connect') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { protocol: 3 },
      });
      return;
    }

    if (method === 'agent') {
      const params = frame.params as Record<string, unknown>;
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'accepted',
          runId: 'run-1',
          sessionKey: params.sessionKey,
        },
      });
      this.emitRaw('not-json');
      this.emitFrame({
        type: 'event',
        event: 'channel.update',
        payload: { name: 'telegram' },
      });
      this.emitFrame(['unexpected', 'frame']);
      this.emitFrame({
        type: 'event',
        event: 'agent',
        payload: null,
      });
      this.emitFrame({
        type: 'event',
        event: 'agent',
        payload: {
          runId: 'run-1',
          stream: 'assistant',
          data: { delta: 'hello' },
        },
      });
      this.emitFrame({
        type: 'event',
        event: 'agent',
        payload: {
          runId: 'run-1',
          stream: 'artifact',
          data: 'invalid-artifact-payload',
        },
      });
      this.emitFrame({
        type: 'event',
        event: 'agent',
        payload: {
          runId: 'run-1',
          stream: 'artifact',
          data: {
            artifacts: [{
              id: 'artifact-1',
              path: '/tmp/run-1.md',
              label: 'Run 1 Artifact',
            }],
          },
        },
      });
      this.emitFrame({
        type: 'event',
        event: 'agent',
        payload: {
          runId: 'run-1',
          stream: 'mystery',
          data: { value: 1 },
        },
      });
      return;
    }

    if (method === 'agent.wait') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'ok',
          runId: 'run-1',
          summary: 'gateway done',
        },
      });
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  private emitFrame(frame: unknown): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(frame),
    }));
  }

  private emitRaw(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

class FailingOpenClawSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED;
      const closeEvent = new Event('close') as Event & { code?: number };
      closeEvent.code = 1006;
      this.dispatchEvent(closeEvent);
    });
  }

  send(): void {
    throw new Error('send should not be called when the socket closes before open');
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

class RejectNonceOpenClawSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;
  readonly connectParams: Array<Record<string, unknown>> = [];

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      this.emitFrame({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-1' },
      });
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    const method = typeof frame.method === 'string' ? frame.method : '';

    if (method === 'connect') {
      const params = (frame.params ?? {}) as Record<string, unknown>;
      this.connectParams.push(params);
      if (typeof params.nonce === 'string') {
        this.emitFrame({
          type: 'res',
          id: frame.id,
          ok: false,
          error: {
            message: "invalid connect params: at root: unexpected property 'nonce'",
          },
        });
        return;
      }

      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { protocol: 3 },
      });
      return;
    }

    if (method === 'agent') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'ok',
          runId: 'run-fallback',
          sessionKey: 'probe-session',
          summary: 'gateway done without nonce',
        },
      });
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  private emitFrame(frame: unknown): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(frame),
    }));
  }
}

describe('OpenClawAdapter', () => {
  it('returns an unavailable probe result when the gateway closes before open without crashing the process', async () => {
    const adapter = new OpenClawAdapter({
      webSocketFactory: () => new FailingOpenClawSocket() as unknown as WebSocket,
    });

    await expect(adapter.probe(createInstance())).resolves.toEqual({
      health: expect.objectContaining({
        status: 'unavailable',
        details: 'OpenClaw websocket closed before open (1006)',
      }),
    });
  });

  it('records dropped and unknown gateway frames for provider-evolution evidence while preserving artifact output', async () => {
    const adapter = new OpenClawAdapter({
      webSocketFactory: () => new FakeOpenClawSocket() as unknown as WebSocket,
    });
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'openclaw',
      instance: 'gateway',
      parserId: 'openclaw_gateway_v3',
      probeProfile: 'manual_smoke',
      transport: 'agent',
    });

    const events = [];
    for await (const event of adapter.invoke({
      sessionId: 'runtime-session',
      sessionKey: 'probe-session',
      providerName: 'openclaw',
      instance: createInstance(),
      turn: {
        message: 'Probe OpenClaw',
      },
      signal: new AbortController().signal,
      evolutionObserver: collector,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: 'init', providerSessionId: 'probe-session' }),
      expect.objectContaining({ type: 'text', text: 'hello' }),
      expect.objectContaining({
        type: 'raw',
        artifacts: [{
          id: 'artifact-1',
          path: '/tmp/run-1.md',
          label: 'Run 1 Artifact',
        }],
      }),
      expect.objectContaining({ type: 'result', summary: 'gateway done' }),
    ]);

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredCount).toBe(1);
    expect(bundle.summary.ignoredEventTypes).toEqual({
      'channel.update': 1,
    });
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.rawPassthroughEventTypes).toEqual({
      ws_message: 1,
    });
    expect(bundle.summary.schemaFailureCount).toBe(3);
    expect(bundle.summary.schemaFailureCounts).toEqual({
      ws_frame: 1,
      agent: 1,
      artifact: 1,
    });
    expect(bundle.summary.unknownCount).toBe(1);
    expect(bundle.summary.unknownEventTypes).toEqual({
      mystery: 1,
    });
  });

  it('retries connect without nonce when newer gateway schemas reject the nonce field', async () => {
    let socket: RejectNonceOpenClawSocket | null = null;
    const adapter = new OpenClawAdapter({
      webSocketFactory: () => {
        socket = new RejectNonceOpenClawSocket();
        return socket as unknown as WebSocket;
      },
    });

    const events = [];
    for await (const event of adapter.invoke({
      sessionId: 'runtime-session',
      sessionKey: 'probe-session',
      providerName: 'openclaw',
      instance: createInstance(),
      turn: {
        message: 'Probe OpenClaw',
      },
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: 'init', providerSessionId: 'probe-session' }),
      expect.objectContaining({ type: 'result', summary: 'gateway done without nonce' }),
    ]);
    expect(socket?.connectParams).toEqual([
      expect.objectContaining({ nonce: 'nonce-1' }),
      expect.not.objectContaining({ nonce: expect.anything() }),
    ]);
  });
});
