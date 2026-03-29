import { describe, expect, it, vi } from 'vitest';

import {
  createHttpMcpProxyHandler,
  inspectMcpProxy,
  resolveMcpProxyTarget,
  resolveMcpProxyTimeoutMs,
} from './proxy.js';

describe('MCP HTTP proxy', () => {
  it('prefers an explicit proxy URL override', () => {
    expect(resolveMcpProxyTarget({
      CATS_RUNTIME_MCP_PROXY_URL: 'http://127.0.0.1:4110/mcp',
      CATS_RUNTIME_API_KEY: 'secret',
      CATS_RUNTIME_HOST: '0.0.0.0',
      CATS_RUNTIME_PORT: '3110',
    })).toEqual({
      url: 'http://127.0.0.1:4110/mcp',
      authorizationHeader: 'Bearer secret',
    });
  });

  it('derives a loopback target from runtime host and port', () => {
    expect(resolveMcpProxyTarget({
      CATS_RUNTIME_HOST: '0.0.0.0',
      CATS_RUNTIME_PORT: '3210',
    })).toEqual({
      url: 'http://127.0.0.1:3210/mcp',
      authorizationHeader: undefined,
    });
  });

  it('formats IPv6 hosts when deriving the proxy target', () => {
    expect(resolveMcpProxyTarget({
      CATS_RUNTIME_HOST: '::1',
      CATS_RUNTIME_PORT: '3210',
    })).toEqual({
      url: 'http://[::1]:3210/mcp',
      authorizationHeader: undefined,
    });
  });

  it('ignores a generic PORT env when no runtime-specific port is configured', () => {
    expect(resolveMcpProxyTarget({
      PORT: '9999',
    })).toEqual({
      url: 'http://127.0.0.1:3110/mcp',
      authorizationHeader: undefined,
    });
  });

  it('uses a conservative default proxy timeout and accepts explicit overrides', () => {
    expect(resolveMcpProxyTimeoutMs({})).toBe(30 * 60 * 1000);
    expect(resolveMcpProxyTimeoutMs({
      CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '45000',
    })).toBe(45000);
  });

  it('returns an MCP error when the proxy target is invalid', async () => {
    const handler = createHttpMcpProxyHandler({
      env: {
        CATS_RUNTIME_PORT: '0',
      },
      fetchImpl: vi.fn(),
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32603,
        data: {
          reason: 'invalid_proxy_target',
        },
      },
    });
  });

  it('returns an MCP error when the proxy timeout env is invalid', async () => {
    const handler = createHttpMcpProxyHandler({
      env: {
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '0',
      },
      fetchImpl: vi.fn(),
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {},
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32603,
        data: {
          reason: 'invalid_proxy_timeout',
        },
      },
    });
  });

  it('forwards authorization and returns upstream JSON-RPC responses', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3110/mcp');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret');
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual({
        jsonrpc: '2.0',
        id: 9,
        method: 'ping',
      });
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        result: { ok: true },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const handler = createHttpMcpProxyHandler({
      env: {
        CATS_RUNTIME_API_KEY: 'secret',
      },
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 9,
      method: 'ping',
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: { ok: true },
    });
  });

  it('maps upstream reachability failures to MCP errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED');
    }) as typeof fetch;
    const handler = createHttpMcpProxyHandler({
      env: {},
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'tools/list',
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: {
        code: -32603,
        message: 'Primary cats-runtime MCP endpoint is unavailable at http://127.0.0.1:3110/mcp. Start cats-runtime and retry.',
        data: {
          reason: 'upstream_unavailable',
          targetUrl: 'http://127.0.0.1:3110/mcp',
        },
      },
    });
  });

  it('maps proxy-side request timeouts to MCP errors', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('The operation was aborted due to timeout'));
        });
      })) as typeof fetch;
    const handler = createHttpMcpProxyHandler({
      env: {
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '5',
      },
      fetchImpl,
    });

    const responsePromise = handler({
      jsonrpc: '2.0',
      id: 'req-timeout',
      method: 'tools/list',
    });
    await vi.advanceTimersByTimeAsync(10);

    await expect(responsePromise).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'req-timeout',
      error: {
        code: -32603,
        data: {
          reason: 'upstream_timeout',
          targetUrl: 'http://127.0.0.1:3110/mcp',
          timeoutMs: 5,
        },
      },
    });

    vi.useRealTimers();
  });

  it('maps upstream auth failures to MCP errors when the body is not JSON-RPC', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: 'Missing or invalid Authorization header',
    }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
      },
    })) as typeof fetch;

    const handler = createHttpMcpProxyHandler({
      env: {
        CATS_RUNTIME_MCP_PROXY_URL: 'http://127.0.0.1:3555/mcp',
      },
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 12,
      method: 'initialize',
      params: {},
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 12,
      error: {
        code: -32603,
        data: {
          reason: 'upstream_unauthorized',
          httpStatus: 401,
        },
      },
    });
  });

  it('maps invalid upstream payloads to MCP errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json', {
      status: 200,
      headers: {
        'content-type': 'text/plain',
      },
    })) as typeof fetch;

    const handler = createHttpMcpProxyHandler({
      env: {},
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 13,
      method: 'initialize',
      params: {},
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 13,
      error: {
        code: -32603,
        data: {
          reason: 'invalid_upstream_response',
          httpStatus: 200,
        },
      },
    });
  });

  it('maps timeout-like upstream HTTP statuses to timeout errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('gateway timeout', {
      status: 504,
      headers: {
        'content-type': 'text/plain',
      },
    })) as typeof fetch;
    const handler = createHttpMcpProxyHandler({
      env: {
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '2500',
      },
      fetchImpl,
    });

    await expect(handler({
      jsonrpc: '2.0',
      id: 15,
      method: 'initialize',
      params: {},
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 15,
      error: {
        code: -32603,
        data: {
          reason: 'upstream_timeout',
          httpStatus: 504,
          timeoutMs: 2500,
        },
      },
    });
  });

  it('inspects proxy target and reports successful ping preflight', async () => {
    const inspection = await inspectMcpProxy({
      env: {
        CATS_RUNTIME_MCP_PROXY_URL: 'http://127.0.0.1:4110/mcp',
        CATS_RUNTIME_API_KEY: 'secret',
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '1234',
      },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 'proxy-preflight',
        result: { ok: true },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })) as typeof fetch,
    });

    expect(inspection).toEqual({
      target: {
        url: 'http://127.0.0.1:4110/mcp',
        authorizationConfigured: true,
        timeoutMs: 1234,
      },
      probe: {
        status: 'ok',
        reason: 'reachable',
        message: 'Primary cats-runtime MCP endpoint responded to ping at http://127.0.0.1:4110/mcp.',
      },
    });
  });

  it('inspects proxy target and preserves classified preflight failures', async () => {
    const inspection = await inspectMcpProxy({
      env: {
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '5',
      },
      fetchImpl: vi.fn(async () => {
        throw new TypeError('connect ECONNREFUSED');
      }) as typeof fetch,
    });

    expect(inspection).toEqual({
      target: {
        url: 'http://127.0.0.1:3110/mcp',
        authorizationConfigured: false,
        timeoutMs: 5,
      },
      probe: {
        status: 'error',
        reason: 'upstream_unavailable',
        message: 'Primary cats-runtime MCP endpoint is unavailable at http://127.0.0.1:3110/mcp. Start cats-runtime and retry.',
      },
    });
  });
});
