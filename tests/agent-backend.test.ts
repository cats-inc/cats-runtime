import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';

function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createAgentConfigRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-agent-test-'));
  const configPath = join(root, 'providers.yaml');
  writeFileSync(configPath, `
version: 1
routing:
  providers:
    openclaw:
      default_target:
        backend: agent
        instance: gateway
backends:
  agent:
    providers:
      openclaw:
        default_instance: gateway
        transport: openclaw_gateway
        url: ws://gateway.test/ws
        auth_token_env: OPENCLAW_TOKEN
        client_id: cats-runtime-test
        scopes:
          - operator.admin
        instances:
          gateway:
            model: openclaw-coder
`.trimStart());

  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: configPath,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    OPENCLAW_TOKEN: 'test-token',
  };

  mkdirSync(env.CATS_RUNTIME_DATA_DIR, { recursive: true });
  mkdirSync(env.CATS_RUNTIME_SESSION_BASE_DIR, { recursive: true });
  mkdirSync(join(root, 'repo'), { recursive: true });

  return {
    root,
    env,
    config: loadConfig(env),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

class FakeOpenClawSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;
  private requestCount = 0;

  constructor(private readonly scripts: FakeOpenClawGatewayScript[]) {
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
    this.requestCount += 1;
    const method = typeof frame.method === 'string' ? frame.method : '';

    if (method === 'connect') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { protocol: 1 },
      });
      return;
    }

    if (method === 'agent') {
      const params = frame.params as Record<string, unknown>;
      const script = this.scripts.shift() || {
        runId: `run-${this.requestCount}`,
        assistant: ['done'],
      };

      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'accepted',
          runId: script.runId,
          sessionKey: params.sessionKey,
        },
      });

      for (const text of script.assistant) {
        this.emitFrame({
          type: 'event',
          event: 'agent',
          payload: {
            runId: script.runId,
            stream: 'assistant',
            data: { delta: text },
          },
        });
      }
      return;
    }

    if (method === 'agent.wait') {
      const params = frame.params as Record<string, unknown>;
      const runId = typeof params.runId === 'string' ? params.runId : 'run-unknown';
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'ok',
          runId,
          summary: `completed ${runId}`,
          artifacts: [{
            id: `${runId}-artifact`,
            path: `/tmp/${runId}.md`,
            label: `Artifact ${runId}`,
          }],
          services: [{
            id: `${runId}-preview`,
            name: 'preview',
            url: `https://preview.test/${runId}`,
          }],
        },
      });
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  private emitFrame(frame: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(frame),
    }));
  }
}

interface FakeOpenClawGatewayScript {
  runId: string;
  assistant: string[];
}

function createFakeWebSocketFactory(
  scripts: FakeOpenClawGatewayScript[],
  sentFrames: Array<Record<string, unknown>>,
) {
  return (_url: string | URL, _init?: WebSocketInit) => {
    const socket = new FakeOpenClawSocket(scripts);
    const originalSend = socket.send.bind(socket);
    socket.send = ((data) => {
      originalSend(data);
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      sentFrames.push(frame);
    }) as typeof socket.send;
    return socket as unknown as WebSocket;
  };
}

describe('agent backend integration', () => {
  it('creates, streams, resumes, and reuses OpenClaw-backed sessions', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const scripts: FakeOpenClawGatewayScript[] = [
      { runId: 'run-1', assistant: ['hello ', 'world'] },
      { runId: 'run-2', assistant: ['welcome back'] },
    ];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory(scripts, sentFrames),
      },
    });

    try {
      const providerResponse = await runtime.app.request('/providers/config');
      expect(providerResponse.status).toBe(200);
      expect(await providerResponse.json()).toEqual({
        providers: {
          openclaw: {
            defaultInstance: 'gateway',
            defaultBackend: 'agent',
            instances: [{
              id: 'gateway',
              target: 'agent/gateway',
              backend: 'agent',
              command: undefined,
              runner: undefined,
              runtime: undefined,
              transport: 'openclaw_gateway',
              model: 'openclaw-coder',
            }],
          },
        },
      });

      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          cwd: config.sessionBaseDir,
          sessionKey: 'task-123',
          reusePolicy: 'prefer_existing',
          instructions: 'Focus on architecture.',
          context: {
            source: 'interactive',
            taskId: 'task-123',
          },
          outputDir: '/tmp/out',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string; providerBackend: string; sessionKey: string };
      expect(created.providerBackend).toBe('agent');
      expect(created.sessionKey).toBe('task-123');

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Draft the report',
        }),
      });
      expect(messageResponse.status).toBe(200);
      const events = parseNdjson(await messageResponse.text());
      expect(events.map((event) => event.type)).toEqual(['init', 'text', 'text', 'result']);
      expect(events.at(-1)?.artifacts).toEqual([{
        id: 'run-1-artifact',
        path: '/tmp/run-1.md',
        label: 'Artifact run-1',
      }]);

      const historyResponse = await runtime.app.request(`/sessions/${created.id}/history`);
      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toMatchObject({
        sessionKey: 'task-123',
        outputDir: '/tmp/out',
        context: {
          source: 'interactive',
          taskId: 'task-123',
        },
        artifacts: [{
          id: 'run-1-artifact',
          path: '/tmp/run-1.md',
        }],
      });

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const reuseResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          sessionKey: 'task-123',
          reusePolicy: 'require_existing',
        }),
      });
      expect(reuseResponse.status).toBe(200);
      const reused = await reuseResponse.json() as { id: string };
      expect(reused.id).toBe(created.id);

      const resumedMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Continue',
        }),
      });
      expect(resumedMessage.status).toBe(200);
      const resumedEvents = parseNdjson(await resumedMessage.text());
      expect(resumedEvents.map((event) => event.type)).toEqual(['init', 'text', 'result']);

      const agentRequests = sentFrames.filter((frame) => frame.method === 'agent');
      expect(agentRequests).toHaveLength(2);
      expect((agentRequests[0].params as Record<string, unknown>).sessionKey).toBe('task-123');
      expect((agentRequests[1].params as Record<string, unknown>).sessionKey).toBe('task-123');
      expect((agentRequests[0].params as Record<string, unknown>).message)
        .toBe('Focus on architecture.\n\nDraft the report');
      expect((agentRequests[1].params as Record<string, unknown>).message)
        .toBe('Focus on architecture.\n\nContinue');
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
