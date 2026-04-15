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
      summary: expect.stringContaining('Codex ACP is a supported Tier 1 ACP target'),
      profile: {
        id: 'codex-acp',
        label: 'Codex ACP',
        family: 'codex',
        tier: 1,
      },
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
      summary: expect.stringContaining('Claude ACP is a supported Tier 1 ACP target'),
      profile: {
        id: 'claude-acp',
        label: 'Claude ACP',
        family: 'claude',
        tier: 1,
      },
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

  it('describes ACP stdio transport semantics for gemini profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-gemini-local',
      providerName: 'gemini',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'gemini-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
      model: 'gemini-2.5-pro',
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Gemini ACP is a supported Tier 1 ACP target'),
      profile: expect.objectContaining({
        id: 'gemini-acp',
        family: 'gemini',
        tier: 1,
      }),
      launch: expect.objectContaining({ command: 'gemini-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for cursor profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-cursor-local',
      providerName: 'cursor',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'cursor-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
      model: 'cursor-fast',
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Cursor ACP is a supported Tier 1 ACP target'),
      profile: expect.objectContaining({
        id: 'cursor-acp',
        family: 'cursor',
        tier: 1,
      }),
      launch: expect.objectContaining({ command: 'cursor-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for copilot profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-copilot-local',
      providerName: 'copilot',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'copilot-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
      model: 'copilot-chat',
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Copilot ACP is a supported Tier 1 ACP target'),
      profile: expect.objectContaining({
        id: 'copilot-acp',
        family: 'copilot',
        tier: 1,
      }),
      launch: expect.objectContaining({ command: 'copilot-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for opencode profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-opencode-local',
      providerName: 'opencode',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'opencode-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('OpenCode ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'opencode-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for kilo profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-kilo-local',
      providerName: 'kilo',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'kilo-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Kilo ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'kilo-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for goose profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-goose-local',
      providerName: 'goose',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'goose-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Goose ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'goose-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for pi profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-pi-local',
      providerName: 'pi',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'pi-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Pi ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'pi-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for auggie profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-auggie-local',
      providerName: 'auggie',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'auggie-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Auggie ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'auggie-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for junie profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-junie-local',
      providerName: 'junie',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'junie-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Junie ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'junie-acp' }),
    }));
  });

  it('describes ACP stdio transport semantics for kiro profile', () => {
    const inspection = inspectAgentTarget({
      id: 'acp-kiro-local',
      providerName: 'kiro',
      backend: 'agent',
      transport: 'acp_stdio',
      command: 'kiro-acp',
      args: ['serve'],
      cwd: '/tmp/acp',
      startupTimeoutMs: 15000,
    });

    expect(inspection).toEqual(expect.objectContaining({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Kiro ACP is a supported Tier 2 ACP target'),
      launch: expect.objectContaining({ command: 'kiro-acp' }),
    }));
  });
});
