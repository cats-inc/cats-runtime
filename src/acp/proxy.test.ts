import { describe, expect, it, vi } from 'vitest';
import {
  createHttpAcpProxyHandler,
  resolveAcpProxyTarget,
  resolveAcpProxyTimeoutMs,
} from './proxy.js';

describe('ACP HTTP proxy', () => {
  it('prefers an explicit ACP proxy URL override', () => {
    expect(resolveAcpProxyTarget({
      CATS_RUNTIME_ACP_PROXY_URL: 'http://127.0.0.1:4110/acp',
      CATS_RUNTIME_API_KEY: 'secret',
      CATS_RUNTIME_HOST: '0.0.0.0',
      CATS_RUNTIME_PORT: '3110',
    })).toEqual({
      url: 'http://127.0.0.1:4110/acp',
      authorizationHeader: 'Bearer secret',
    });
  });

  it('derives a loopback ACP target from runtime host and port', () => {
    expect(resolveAcpProxyTarget({
      CATS_RUNTIME_HOST: '0.0.0.0',
      CATS_RUNTIME_PORT: '3210',
    })).toEqual({
      url: 'http://127.0.0.1:3210/acp',
      authorizationHeader: undefined,
    });
  });

  it('uses a conservative default ACP proxy timeout and accepts explicit overrides', () => {
    expect(resolveAcpProxyTimeoutMs({})).toBe(30 * 60 * 1000);
    expect(resolveAcpProxyTimeoutMs({
      CATS_RUNTIME_ACP_PROXY_TIMEOUT_MS: '45000',
    })).toBe(45000);
  });

  it('forwards authorization and returns upstream JSON-RPC responses', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3110/acp');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret');
      expect(JSON.parse(String(init?.body))).toEqual({
        jsonrpc: '2.0',
        id: 9,
        method: 'initialize',
      });
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        result: {
          ok: true,
          _meta: {
            catsRuntime: {
              transport: 'http',
              path: '/acp',
              sessionLifecycle: 'prompt_enabled_over_http_ndjson',
            },
          },
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const handler = createHttpAcpProxyHandler({
      env: {
        CATS_RUNTIME_API_KEY: 'secret',
      },
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 9,
      method: 'initialize',
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {
        ok: true,
        _meta: {
          catsRuntime: {
            transport: 'stdio',
            path: '/acp',
            sessionLifecycle: 'prompt_enabled_over_stdio_proxy',
            proxy: {
              mode: 'http_proxy',
              upstreamTransport: 'http',
              targetUrl: 'http://127.0.0.1:3110/acp',
            },
          },
        },
      },
    });
  });

  it('maps upstream reachability failures to ACP errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED');
    }) as typeof fetch;
    const handler = createHttpAcpProxyHandler({
      env: {},
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'initialize',
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: {
        code: -32603,
        data: {
          reason: 'upstream_unavailable',
          targetUrl: 'http://127.0.0.1:3110/acp',
        },
      },
    });
  });

  it('forwards HTTP NDJSON prompt streams through the ACP proxy responder', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toBe('application/x-ndjson');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'runtime-session',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                  type: 'text',
                  text: 'Inspecting workspace. ',
                },
              },
            },
          })}\n`));
          controller.enqueue(encoder.encode(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 'prompt-1',
            result: {
              stopReason: 'end_turn',
              _meta: {
                catsRuntime: {
                  transport: 'http',
                  turnStream: 'application/x-ndjson',
                },
              },
            },
          })}\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson',
        },
      });
    }) as typeof fetch;

    const handler = createHttpAcpProxyHandler({
      env: {},
      fetchImpl,
    });
    const notify = vi.fn(async () => undefined);

    await expect(handler({
      jsonrpc: '2.0',
      id: 'prompt-1',
      method: 'session/prompt',
      params: {
        sessionId: 'runtime-session',
        prompt: [{ type: 'text', text: 'Inspect the workspace.' }],
      },
    }, {
      notify,
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'prompt-1',
      result: {
        stopReason: 'end_turn',
        _meta: {
          catsRuntime: {
            transport: 'stdio',
            turnStream: 'application/x-ndjson',
            proxy: {
              mode: 'http_proxy',
              upstreamTransport: 'http',
              targetUrl: 'http://127.0.0.1:3110/acp',
            },
          },
        },
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'runtime-session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: 'Inspecting workspace. ',
          },
        },
      },
    });
  });
});
