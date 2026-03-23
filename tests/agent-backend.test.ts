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

function createAgentSdkConfigRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-agent-sdk-test-'));
  const configPath = join(root, 'providers.yaml');
  writeFileSync(configPath, `
version: 1
routing:
  providers:
    claude:
      default_target:
        backend: agent
        instance: sdk
backends:
  agent:
    providers:
      claude:
        default_instance: sdk
        transport: agent_sdk_bridge
        base_url: http://agent-sdk.test
        auth_token_env: AGENT_SDK_TOKEN
        instances:
          sdk:
            model: sonnet
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
    AGENT_SDK_TOKEN: 'bridge-token',
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
              install: null,
              compatibility: null,
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

  it('supports an Agent SDK bridge adapter as a second agent target', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      fetchCalls.push({ url, method, body });

      if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
        return new Response(JSON.stringify({
          id: 'bridge-session-1',
          provider: 'claude',
          model: 'sonnet',
          status: 'idle',
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream' && method === 'POST') {
        const sse = [
          'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
          '',
          'data: not-json',
          '',
          'data: {"type":"content","content":"bridge hello "}',
          '',
          'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
          '',
          'data: {"type":"content","content":"world"}',
          '',
          'data: {"type":"token_usage","usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}',
          '',
          'data: {"type":"complete","sessionId":"bridge-session-1","finishReason":"stop"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort' && method === 'POST') {
        return new Response(null, {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: fakeFetch,
      },
    });

    try {
      const providerResponse = await runtime.app.request('/providers/config');
      expect(providerResponse.status).toBe(200);
      expect(await providerResponse.json()).toEqual({
        providers: {
          claude: {
            defaultInstance: 'sdk',
            defaultBackend: 'agent',
            instances: [{
              id: 'sdk',
              target: 'agent/sdk',
              backend: 'agent',
              command: undefined,
              runner: undefined,
              runtime: undefined,
              transport: 'agent_sdk_bridge',
              model: 'sonnet',
              install: null,
              compatibility: null,
            }],
          },
        },
      });

      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-task-1',
          reusePolicy: 'prefer_existing',
          instructions: 'Use the bridge carefully.',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string; providerBackend: string; sessionKey: string };
      expect(created.providerBackend).toBe('agent');
      expect(created.sessionKey).toBe('sdk-task-1');

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Plan the next step',
        }),
      });
      expect(messageResponse.status).toBe(200);
      expect(parseNdjson(await messageResponse.text())).toEqual([
        {
          type: 'init',
          providerSessionId: 'bridge-session-1',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'active',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-1',
              },
            },
          },
        },
        {
          type: 'text',
          providerSessionId: 'bridge-session-1',
          text: 'bridge hello ',
        },
        {
          type: 'tool_use',
          providerSessionId: 'bridge-session-1',
          toolName: 'grep',
          toolArgs: {
            pattern: 'TODO',
          },
        },
        {
          type: 'text',
          providerSessionId: 'bridge-session-1',
          text: 'world',
        },
        {
          type: 'result',
          providerSessionId: 'bridge-session-1',
          usage: {
            inputTokens: 12,
            outputTokens: 5,
          },
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'idle',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-1',
                upstreamProviderSessionId: 'sdk-provider-1',
              },
            },
          },
          metadata: {
            provider: 'claude',
            runtimeUsage: {
              totalTokens: 17,
              sourceConfidence: 'aggregated',
              latencyMs: expect.any(Number),
            },
          },
        },
      ]);

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const reuseResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          sessionKey: 'sdk-task-1',
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

      const createCalls = fetchCalls.filter((call) => call.url === 'http://agent-sdk.test/api/v1/sessions');
      expect(createCalls).toHaveLength(1);
      const streamCalls = fetchCalls.filter((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream',
      );
      expect(streamCalls).toHaveLength(2);
      expect(streamCalls[0]?.body).toEqual({
        message: 'Use the bridge carefully.\n\nPlan the next step',
      });
      expect(streamCalls[1]?.body).toEqual({
        message: 'Use the bridge carefully.\n\nContinue',
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('recreates a missing Agent SDK bridge session on resume', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    let createCount = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      fetchCalls.push({ url, method, body });

      if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
        createCount += 1;
        return new Response(JSON.stringify({
          id: `bridge-session-${createCount}`,
          provider: 'claude',
          model: 'sonnet',
          status: 'idle',
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream' && method === 'POST') {
        if (fetchCalls.filter((call) => call.url === url).length === 1) {
          const sse = [
            'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
            '',
            'data: {"type":"content","content":"first turn"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n');
          return new Response(sse, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        return new Response(JSON.stringify({ error: 'session not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-2/messages/stream' && method === 'POST') {
        const sse = [
          'data: {"type":"session_created","sessionId":"bridge-session-2","providerSessionId":"sdk-provider-2"}',
          '',
          'data: {"type":"content","content":"second turn"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort' && method === 'POST') {
        return new Response(null, {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: fakeFetch,
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-task-2',
          reusePolicy: 'prefer_existing',
          instructions: 'Use the bridge carefully.',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const firstMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'First',
        }),
      });
      expect(firstMessage.status).toBe(200);

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const reuseResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          sessionKey: 'sdk-task-2',
          reusePolicy: 'require_existing',
        }),
      });
      expect(reuseResponse.status).toBe(200);

      const resumedMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Second',
        }),
      });
      expect(resumedMessage.status).toBe(200);
      expect(parseNdjson(await resumedMessage.text())).toEqual([
        {
          type: 'init',
          providerSessionId: 'bridge-session-2',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-2',
              sessionKey: 'sdk-task-2',
              status: 'active',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-2',
              },
            },
          },
        },
        {
          type: 'text',
          providerSessionId: 'bridge-session-2',
          text: 'second turn',
        },
        {
          type: 'result',
          providerSessionId: 'bridge-session-2',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-2',
              sessionKey: 'sdk-task-2',
              status: 'idle',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-2',
                upstreamProviderSessionId: 'sdk-provider-2',
              },
            },
          },
          metadata: {
            provider: 'claude',
          },
        },
      ]);

      const createCalls = fetchCalls.filter((call) => call.url === 'http://agent-sdk.test/api/v1/sessions');
      expect(createCalls).toHaveLength(2);
      expect(fetchCalls.some((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort'
          && call.method === 'POST',
      )).toBe(true);
      expect(fetchCalls.some((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
          && call.body?.message === 'Use the bridge carefully.\n\nSecond',
      )).toBe(true);
      expect(fetchCalls.some((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-2/messages/stream'
          && call.body?.message === 'Use the bridge carefully.\n\nSecond',
      )).toBe(true);
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
