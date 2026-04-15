import { describe, expect, it } from 'vitest';
import { inspectAgentTarget } from './inspection.js';

describe('inspectAgentTarget', () => {
  it('describes OpenClaw gateway transport semantics', () => {
    const inspection = inspectAgentTarget({
      id: 'gateway',
      providerName: 'openclaw',
      backend: 'agent',
      transport: 'openclaw_gateway',
      urlEnv: 'OPENCLAW_URL',
      authTokenEnv: 'OPENCLAW_TOKEN',
      passwordEnv: 'OPENCLAW_PASSWORD',
      model: 'openclaw-coder',
    }, {
      env: {
        OPENCLAW_URL: 'wss://gateway.test/ws',
        OPENCLAW_TOKEN: 'secret',
      },
    });

    expect(inspection).toEqual({
      adapter: 'openclaw',
      family: 'gateway',
      summary: expect.stringContaining('OpenClaw gateway'),
      endpoint: 'wss://gateway.test/ws',
      transport: {
        kind: 'websocket',
        protocol: 'openclaw_gateway_v3',
        liveProbe: 'rpc_health',
        modelDiscovery: 'models_list',
        toolDiscovery: 'tools_catalog',
        streaming: 'agent_event_frames',
      },
      request: {
        headerNames: ['authorization'],
      },
      auth: {
        mechanisms: ['connect_auth', 'handshake_header'],
        credentials: [
          { kind: 'url', configured: true },
          { kind: 'auth_token', configured: true },
          { kind: 'password', configured: false },
        ],
      },
      continuity: {
        providerManagedSessions: true,
        sessionKey: true,
        providerSessionState: true,
        cancel: false,
      },
      capabilities: {
        probe: true,
        modelDiscovery: true,
        toolCatalog: true,
        effectiveToolCatalog: true,
        cancel: false,
        runtimeServices: true,
        toolCallEvents: false,
      },
    });
  });

  it('describes Agent SDK bridge transport semantics', () => {
    const inspection = inspectAgentTarget({
      id: 'sdk',
      providerName: 'claude',
      backend: 'agent',
      transport: 'agent_sdk_bridge',
      baseUrl: 'http://agent-sdk.test',
      authTokenEnv: 'AGENT_SDK_TOKEN',
      model: 'sonnet',
    }, {
      env: {
        AGENT_SDK_TOKEN: 'bridge-token',
      },
    });

    expect(inspection).toEqual({
      adapter: 'agent_sdk_bridge',
      family: 'bridge',
      summary: expect.stringContaining('Agent SDK bridge'),
      endpoint: 'http://agent-sdk.test',
      transport: {
        kind: 'http',
        protocol: 'agent_sdk_http_v1',
        liveProbe: 'providers_get',
        modelDiscovery: 'providers_get',
        toolDiscovery: 'providers_get',
        streaming: 'sse',
      },
      request: {
        headerNames: ['authorization'],
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
        cancel: true,
      },
      capabilities: {
        probe: true,
        modelDiscovery: true,
        toolCatalog: true,
        effectiveToolCatalog: false,
        cancel: true,
        runtimeServices: true,
        toolCallEvents: true,
      },
    });
  });

  it('describes ACP stdio transport semantics', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-local',
      providerName: 'codex',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'codex-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
      model: 'gpt-5.4',
    });

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Codex ACP is the current ACP pilot target'),
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
        liveProbe: 'command_help',
        modelDiscovery: 'session_bootstrap',
        toolDiscovery: 'session_bootstrap',
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
        cancel: true,
      },
      capabilities: {
        probe: true,
        modelDiscovery: true,
        toolCatalog: true,
        effectiveToolCatalog: true,
        cancel: true,
        runtimeServices: false,
        toolCallEvents: true,
      },
    });
  });

  it('describes ACP stdio transport semantics for claude profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-claude-local',
      providerName: 'claude',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'claude-agent-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
      model: 'sonnet',
    });

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Claude ACP is the current ACP pilot target'),
      launch: {
        kind: 'stdio',
        command: 'claude-agent-acp',
        args: ['serve'],
        cwd: '/tmp/acp',
        startupTimeoutMs: 15000,
      },
      transport: {
        kind: 'stdio',
        protocol: 'acp_v1',
        liveProbe: 'command_help',
        modelDiscovery: 'session_bootstrap',
        toolDiscovery: 'session_bootstrap',
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
        cancel: true,
      },
      capabilities: {
        probe: true,
        modelDiscovery: true,
        toolCatalog: true,
        effectiveToolCatalog: true,
        cancel: true,
        runtimeServices: false,
        toolCallEvents: true,
      },
    });
  });
});
