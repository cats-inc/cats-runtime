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

type ConnectRetryScenario =
  | 'legacy-root-nonce'
  | 'gateway-client-id'
  | 'device-unsupported'
  | 'device-identity';

class RetryConnectOpenClawSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;
  readonly connectParams: Array<Record<string, unknown>> = [];

  constructor(
    private readonly scenario: ConnectRetryScenario,
    private readonly attempt: number,
  ) {
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
      if (this.shouldRejectConnect(params)) {
        const message = this.buildConnectErrorMessage();
        this.emitFrame({
          type: 'res',
          id: frame.id,
          ok: false,
          error: {
            message,
          },
        });
        this.emitClose(1008, message);
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
          runId: `run-${this.scenario}`,
          sessionKey: 'probe-session',
          summary: this.scenario === 'legacy-root-nonce'
            ? 'gateway done with legacy nonce'
            : this.scenario === 'gateway-client-id'
              ? 'gateway done with gateway client id'
              : this.scenario === 'device-unsupported'
                ? 'gateway done without device identity'
                : 'gateway done with device identity',
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

  private emitClose(code: number, reason: string): void {
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED;
      const closeEvent = new Event('close') as Event & { code?: number; reason?: string };
      closeEvent.code = code;
      closeEvent.reason = reason;
      this.dispatchEvent(closeEvent);
    });
  }

  private shouldRejectConnect(params: Record<string, unknown>): boolean {
    if (this.attempt !== 1) {
      return false;
    }
    if (this.scenario === 'legacy-root-nonce') {
      return typeof params.nonce !== 'string';
    }
    if (this.scenario === 'device-unsupported') {
      return typeof params.device === 'object' && params.device !== null;
    }
    if (this.scenario === 'device-identity') {
      const device = params.device as Record<string, unknown> | undefined;
      return !device
        || typeof device.id !== 'string'
        || typeof device.publicKey !== 'string'
        || typeof device.signature !== 'string'
        || typeof device.signedAt !== 'number'
        || device.nonce !== 'nonce-1';
    }

    const client = params.client as Record<string, unknown> | undefined;
    return client?.id !== 'gateway-client';
  }

  private buildConnectErrorMessage(): string {
    if (this.scenario === 'legacy-root-nonce') {
      return "invalid connect params: at root: must have required property 'nonce'";
    }
    if (this.scenario === 'device-unsupported') {
      return "invalid connect params: at root: unexpected property 'device'";
    }
    return 'invalid connect params: at /client/id: must be equal to constant; '
      + 'at /client/id: must match a schema in anyOf';
  }
}

function createRetrySocketFactory(scenario: ConnectRetryScenario) {
  const sockets: RetryConnectOpenClawSocket[] = [];
  let attempt = 0;
  return {
    sockets,
    factory: () => {
      const socket = new RetryConnectOpenClawSocket(scenario, ++attempt);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  };
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

  it('reconnects with the legacy root nonce when older gateways require it', async () => {
    const { sockets, factory } = createRetrySocketFactory('legacy-root-nonce');
    const adapter = new OpenClawAdapter({
      webSocketFactory: factory,
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
      expect.objectContaining({ type: 'result', summary: 'gateway done with legacy nonce' }),
    ]);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.connectParams).toEqual([
      expect.not.objectContaining({ nonce: expect.anything() }),
    ]);
    expect(sockets[1]?.connectParams).toEqual([
      expect.objectContaining({ nonce: 'nonce-1' }),
    ]);
  });

  it('reconnects with the supported gateway client id when older runtime configs still use cats-runtime', async () => {
    const { sockets, factory } = createRetrySocketFactory('gateway-client-id');
    const adapter = new OpenClawAdapter({
      webSocketFactory: factory,
    });

    const events = [];
    for await (const event of adapter.invoke({
      sessionId: 'runtime-session',
      sessionKey: 'probe-session',
      providerName: 'openclaw',
      instance: {
        ...createInstance(),
        clientId: 'cats-runtime',
      },
      turn: {
        message: 'Probe OpenClaw',
      },
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: 'init', providerSessionId: 'probe-session' }),
      expect.objectContaining({ type: 'result', summary: 'gateway done with gateway client id' }),
    ]);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.connectParams).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ id: 'cats-runtime' }),
      }),
    ]);
    expect(sockets[1]?.connectParams).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ id: 'gateway-client' }),
      }),
    ]);
  });

  it('includes a signed device identity in connect payloads for scoped local operator access', async () => {
    const { sockets, factory } = createRetrySocketFactory('device-identity');
    const adapter = new OpenClawAdapter({
      webSocketFactory: factory,
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
      expect.objectContaining({ type: 'result', summary: 'gateway done with device identity' }),
    ]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.connectParams).toEqual([
      expect.objectContaining({
        device: expect.objectContaining({
          id: expect.any(String),
          publicKey: expect.any(String),
          signature: expect.any(String),
          signedAt: expect.any(Number),
          nonce: 'nonce-1',
        }),
      }),
    ]);
  });

  it('retries without device identity when older gateways reject the device field', async () => {
    const { sockets, factory } = createRetrySocketFactory('device-unsupported');
    const adapter = new OpenClawAdapter({
      webSocketFactory: factory,
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
      expect.objectContaining({ type: 'result', summary: 'gateway done without device identity' }),
    ]);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.connectParams).toEqual([
      expect.objectContaining({
        device: expect.objectContaining({
          id: expect.any(String),
          publicKey: expect.any(String),
          signature: expect.any(String),
          signedAt: expect.any(Number),
          nonce: 'nonce-1',
        }),
      }),
    ]);
    expect(sockets[1]?.connectParams).toEqual([
      expect.not.objectContaining({
        device: expect.anything(),
      }),
    ]);
  });
});
