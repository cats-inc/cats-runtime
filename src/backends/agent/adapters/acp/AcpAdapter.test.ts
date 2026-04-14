import { describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { AcpAdapter } from './AcpAdapter.js';

function createHttpInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-remote',
    providerName: 'codex',
    backend: 'agent',
    transport: 'acp',
    baseUrl: 'http://acp.test',
    authTokenEnv: 'ACP_TOKEN',
    headers: {
      'x-client-id': 'cats-runtime',
      accept: 'application/json',
    },
    model: 'gpt-5.4',
  };
}

function createStdioInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-local',
    providerName: 'codex',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'codex-acp',
    args: ['serve'],
    cwd: '/tmp/acp',
    startupTimeoutMs: 15000,
    model: 'gpt-5.4',
  };
}

describe('AcpAdapter', () => {
  it('describes HTTP ACP targets with bearer-header auth when endpoint credentials exist', () => {
    const adapter = new AcpAdapter({
      env: {
        ACP_TOKEN: 'secret-token',
      },
    });

    const inspection = adapter.inspect(createHttpInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('provider-managed ACP transport'),
      endpoint: 'http://acp.test',
      transport: {
        kind: 'http',
        protocol: 'acp_v1',
        liveProbe: 'none',
        modelDiscovery: 'none',
        toolDiscovery: 'none',
        streaming: 'generic',
      },
      request: {
        headerNames: ['x-client-id'],
      },
      auth: {
        mechanisms: ['bearer_header'],
        credentials: [
          { kind: 'base_url', configured: true },
          { kind: 'auth_token', configured: true },
        ],
      },
      continuity: {
        providerManagedSessions: true,
        sessionKey: true,
        providerSessionState: true,
        cancel: false,
      },
      capabilities: {
        probe: false,
        modelDiscovery: false,
        toolCatalog: false,
        effectiveToolCatalog: false,
        cancel: false,
        runtimeServices: false,
        toolCallEvents: false,
      },
    });
  });

  it('describes stdio ACP targets with launch metadata and no transport auth mechanism', () => {
    const adapter = new AcpAdapter();

    const inspection = adapter.inspect(createStdioInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('stdio agent command'),
      launch: {
        kind: 'stdio',
        command: 'codex-acp',
        args: ['serve'],
        cwd: '/tmp/acp',
        startupTimeoutMs: 15000,
      },
      transport: {
        kind: 'stdio',
        protocol: 'acp_v1',
        liveProbe: 'none',
        modelDiscovery: 'none',
        toolDiscovery: 'none',
        streaming: 'generic',
      },
      request: {
        headerNames: [],
      },
      auth: {
        mechanisms: [],
        credentials: [],
      },
      continuity: {
        providerManagedSessions: true,
        sessionKey: true,
        providerSessionState: true,
        cancel: false,
      },
      capabilities: {
        probe: false,
        modelDiscovery: false,
        toolCatalog: false,
        effectiveToolCatalog: false,
        cancel: false,
        runtimeServices: false,
        toolCallEvents: false,
      },
    });
  });

  it('throws an explicit Phase 2 follow-up error when invoke is used before execution exists', async () => {
    const adapter = new AcpAdapter();

    const iterator = adapter.invoke({
      sessionId: 'session-1',
      providerName: 'codex',
      instance: createStdioInstance(),
      turn: {
        messages: [],
      },
      sessionKey: 'session-key-1',
      signal: new AbortController().signal,
    });

    await expect(iterator.next()).rejects.toThrow(
      /PLAN-032 Phase 2 to add the ACP host-capability bridge/,
    );
  });
});
