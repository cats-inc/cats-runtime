import { describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type { AgentAcpHostBridge, AgentAcpHostContext } from '../../types.js';
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

function createHostBridge(): AgentAcpHostBridge {
  return {
    describe(_context: AgentAcpHostContext) {
      return {
        summary: 'host bridge ready',
        workspace: {
          kind: 'source',
          access: 'read_write',
          runtimeCwd: '/tmp/acp',
        },
        toolPolicy: {
          profile: 'standard',
          permissionMode: 'skip',
          whitelistActive: false,
          fullAccessTools: ['read_file'],
          previewOnlyTools: [],
          blockedTools: [],
          counts: {
            total: 1,
            fullAccess: 1,
            previewOnly: 0,
            blocked: 0,
          },
          capabilities: [{
            name: 'read_file',
            domain: 'filesystem',
            access: 'full_access',
            readOnlyCompatible: true,
            mutating: false,
          }],
        },
        capabilities: {
          permissionPolicy: true,
          filesystem: true,
          terminal: true,
          toolExecution: true,
          clientMcpServers: false,
        },
      };
    },
    listTools() {
      return [];
    },
    async executeTool() {
      return {
        callId: 'noop',
        name: 'noop',
        output: '',
      };
    },
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

  it('reports runtime host services when an ACP host bridge is configured', () => {
    const adapter = new AcpAdapter({
      acpHostBridge: createHostBridge(),
    });

    const inspection = adapter.inspect(createHttpInstance());

    expect(inspection.summary).toContain('host-capability bridge is configured');
    expect(inspection.capabilities.runtimeServices).toBe(true);
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
      /no runtime ACP host-capability bridge is attached/,
    );
  });

  it('throws a Phase 3 follow-up error once the ACP host bridge is attached', async () => {
    const adapter = new AcpAdapter({
      acpHostBridge: createHostBridge(),
    });

    const iterator = adapter.invoke({
      sessionId: 'session-1',
      providerName: 'codex',
      instance: createStdioInstance(),
      turn: {
        messages: [],
      },
      sessionKey: 'session-key-1',
      acpHost: {
        bridge: createHostBridge(),
        context: {
          sessionId: 'session-1',
          providerName: 'codex',
          providerInstanceId: 'acp-local',
          cwd: '/tmp/acp',
          workspace: {
            kind: 'source',
            access: 'read_write',
            runtimeCwd: '/tmp/acp',
          },
        },
      },
      signal: new AbortController().signal,
    });

    await expect(iterator.next()).rejects.toThrow(
      /PLAN-032 Phase 3/,
    );
  });
});
