import { describe, expect, it, vi } from 'vitest';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { AgentBackendManager } from '../../backends/agent/runtime/AgentBackendManager.js';
import { probeSetupNonCliTarget } from './setupConnections.js';

const target = (transport: string, extra = {}) => ({ providerName: transport, backend: 'local',
  instanceId: 'local', remoteInstance: { transport, ...extra } }) as ProviderTargetDescriptor;

describe('explicit setup connection checks', () => {
  it('does not contact endpoints on passive scans', async () => {
    const fetch = vi.fn();
    const probe = vi.fn();
    for (const transport of ['ollama', 'openclaw_gateway']) {
      expect(await probeSetupNonCliTarget(target(transport), { includeConnections: false, env: {}, fetch,
        agentBackend: { probe } })).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('checks Ollama model listing without inference and separates local installation from connection', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://127.0.0.1:11434/api/tags');
      return Response.json({ models: [] });
    });
    const lookup = vi.fn(async () => ({ available: true, resolvedPath: '/isolated/ollama' }));
    const result = await probeSetupNonCliTarget(target('ollama'), { includeConnections: true, env: {}, fetch, lookup });
    expect(result).toMatchObject({ available: true, commandStatus: 'ready', connectionStatus: 'connected' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('never treats a reachable remote service as a locally installed binary', async () => {
    const lookup = vi.fn();
    const result = await probeSetupNonCliTarget(target('ollama', { baseUrl: 'https://remote.invalid' }), {
      includeConnections: true, env: {}, fetch: async () => Response.json({ models: [] }), lookup,
    });
    expect(result).toMatchObject({ connectionStatus: 'connected' });
    expect(result?.commandStatus).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports failed and malformed Ollama responses without echoing secrets', async () => {
    for (const fetch of [async () => Response.json({ error: 'private-value' }, { status: 401 }),
      async () => Response.json({ wrongService: true }), async () => { throw new Error('private-value'); }]) {
      const result = await probeSetupNonCliTarget(target('ollama', { baseUrl: 'https://remote.invalid' }), {
        includeConnections: true, env: {}, fetch,
      });
      expect(result).toMatchObject({ available: false, connectionStatus: 'failed' });
      expect(JSON.stringify(result)).not.toContain('private-value');
    }
  });

  it('uses the gateway live probe and does not claim authentication is unnecessary', async () => {
    const probe = vi.fn(async () => ({ kind: 'openclaw', supported: true,
      result: { health: { status: 'ok', checkedAt: '2026-09-16' } } }));
    const gateway = target('openclaw_gateway', { url: 'ws://gateway.invalid', authTokenEnv: 'TEST_TOKEN' });
    const result = await probeSetupNonCliTarget(gateway, { includeConnections: true, env: {},
      agentBackend: { probe } as unknown as Pick<AgentBackendManager, 'probe'> });
    expect(probe).toHaveBeenCalledWith(gateway, true, undefined, { mode: 'live' });
    expect(result).toMatchObject({ connectionStatus: 'connected', authStatus: 'unknown' });
  });
});
