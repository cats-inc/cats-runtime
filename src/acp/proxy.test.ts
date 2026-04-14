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
        result: { ok: true },
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
      result: { ok: true },
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
});
