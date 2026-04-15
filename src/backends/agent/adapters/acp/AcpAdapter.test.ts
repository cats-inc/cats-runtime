import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type {
  AgentAcpHostBridge,
  AgentAcpHostContext,
  AgentCliCommandRunner,
  AgentProcessSpawner,
  AgentSpawnedProcess,
} from '../../types.js';
import type { StreamEvent } from '../../../../core/types.js';
import { RuntimeAcpHostBridge } from '../../acp/RuntimeAcpHostBridge.js';
import { AcpAdapter } from './AcpAdapter.js';

class FakeAcpProcess extends EventEmitter implements AgentSpawnedProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0, null);
    return true;
  }
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

async function collectEvents(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function startFakeServer(
  process: FakeAcpProcess,
  onMessage: (message: Record<string, unknown>) => void | Promise<void>,
): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    void onMessage(JSON.parse(line) as Record<string, unknown>);
  });
}

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

function createGenericStdioInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-generic',
    providerName: 'generic',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'generic-acp',
    args: ['serve'],
    cwd: '/tmp/acp',
    startupTimeoutMs: 15000,
    model: 'generic-model',
  };
}

function createClaudeHttpInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-claude-remote',
    providerName: 'claude',
    backend: 'agent',
    transport: 'acp',
    baseUrl: 'http://claude-acp.test',
    authTokenEnv: 'CLAUDE_ACP_TOKEN',
    headers: {
      'x-client-id': 'cats-runtime',
      accept: 'application/json',
    },
    model: 'sonnet',
  };
}

function createClaudeStdioInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-claude-local',
    providerName: 'claude',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'claude-agent-acp',
    args: ['serve'],
    cwd: '/tmp/acp',
    startupTimeoutMs: 15000,
    model: 'sonnet',
  };
}

function createGeminiHttpInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-gemini-remote',
    providerName: 'gemini',
    backend: 'agent',
    transport: 'acp',
    baseUrl: 'http://gemini-acp.test',
    authTokenEnv: 'GEMINI_ACP_TOKEN',
    headers: {
      'x-client-id': 'cats-runtime',
      accept: 'application/json',
    },
    model: 'gemini-2.5-pro',
  };
}

function createGeminiStdioInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-gemini-local',
    providerName: 'gemini',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'gemini-acp',
    args: ['serve'],
    cwd: '/tmp/acp',
    startupTimeoutMs: 15000,
    model: 'gemini-2.5-pro',
  };
}

function createCursorHttpInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-cursor-remote',
    providerName: 'cursor',
    backend: 'agent',
    transport: 'acp',
    baseUrl: 'http://cursor-acp.test',
    authTokenEnv: 'CURSOR_ACP_TOKEN',
    headers: {
      'x-client-id': 'cats-runtime',
      accept: 'application/json',
    },
    model: 'cursor-fast',
  };
}

function createCursorStdioInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-cursor-local',
    providerName: 'cursor',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'cursor-acp',
    args: ['serve'],
    cwd: '/tmp/acp',
    startupTimeoutMs: 15000,
    model: 'cursor-fast',
  };
}

function createCopilotHttpInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-copilot-remote',
    providerName: 'copilot',
    backend: 'agent',
    transport: 'acp',
    baseUrl: 'http://copilot-acp.test',
    authTokenEnv: 'COPILOT_ACP_TOKEN',
    headers: {
      'x-client-id': 'cats-runtime',
      accept: 'application/json',
    },
    model: 'copilot-chat',
  };
}

function createCopilotStdioInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'acp-copilot-local',
    providerName: 'copilot',
    backend: 'agent',
    transport: 'acp_stdio',
    command: 'copilot-acp',
    args: ['serve'],
    cwd: '/tmp/acp',
    startupTimeoutMs: 15000,
    model: 'copilot-chat',
  };
}

function createHostBridge(permissionMode: 'skip' | 'default' | 'whitelist' = 'skip'): AgentAcpHostBridge {
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
          permissionMode,
          whitelistActive: permissionMode === 'whitelist',
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
          ...(permissionMode === 'whitelist' ? { allowedTools: ['read_file'] } : {}),
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
    listMcpServers() {
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

function createSuccessfulProbeRunner(): AgentCliCommandRunner {
  return async () => ({
    code: 0,
    stdout: 'codex-acp help output',
    stderr: '',
    timedOut: false,
    durationMs: 42,
  });
}

function createFailedProbeRunner(): AgentCliCommandRunner {
  return async () => ({
    code: 1,
    stdout: '',
    stderr: 'boom',
    timedOut: false,
    durationMs: 17,
  });
}

function createSpawner(process: FakeAcpProcess): AgentProcessSpawner {
  return () => process;
}

function createInvokeInput(
  instance: RemoteProviderInstanceConfig,
  hostBridge: AgentAcpHostBridge,
  permissionMode: 'skip' | 'default' | 'whitelist' = 'skip',
  allowedTools?: string[],
) {
  const cwd = instance.cwd || '/tmp/acp';
  return {
    sessionId: 'session-1',
    providerName: 'codex',
    instance,
    turn: {
      message: 'hello from cats-runtime',
      instructions: 'Follow runtime instructions.',
    },
    sessionKey: 'session-key-1',
    acpHost: {
      bridge: hostBridge,
      context: {
        sessionId: 'session-1',
        providerName: 'codex',
        providerInstanceId: instance.id,
        cwd,
        workspace: {
          kind: 'source' as const,
          access: 'read_write' as const,
          runtimeCwd: cwd,
        },
        permissionMode,
        ...(allowedTools ? { allowedTools } : {}),
      },
    },
    signal: new AbortController().signal,
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

  it('describes stdio ACP targets with launch metadata and tool-call event support', () => {
    const adapter = new AcpAdapter();

    const inspection = adapter.inspect(createStdioInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Codex ACP is a supported Tier 1 ACP target'),
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

  it('describes HTTP ACP targets with claude profile when provider name is claude', () => {
    const adapter = new AcpAdapter({
      env: { CLAUDE_ACP_TOKEN: 'secret-token' },
    });

    const inspection = adapter.inspect(createClaudeHttpInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('provider-managed ACP transport'),
      endpoint: 'http://claude-acp.test',
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

  it('describes stdio ACP targets with Claude ACP profile label', () => {
    const adapter = new AcpAdapter();

    const inspection = adapter.inspect(createClaudeStdioInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Claude ACP is a supported Tier 1 ACP target'),
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

  it('describes HTTP ACP targets with gemini profile when provider name is gemini', () => {
    const adapter = new AcpAdapter({
      env: { GEMINI_ACP_TOKEN: 'secret-token' },
    });

    const inspection = adapter.inspect(createGeminiHttpInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('provider-managed ACP transport'),
      endpoint: 'http://gemini-acp.test',
      transport: {
        kind: 'http',
        protocol: 'acp_v1',
        liveProbe: 'none',
        modelDiscovery: 'none',
        toolDiscovery: 'none',
        streaming: 'generic',
      },
      request: { headerNames: ['x-client-id'] },
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

  it('describes stdio ACP targets with Gemini ACP profile label', () => {
    const adapter = new AcpAdapter();
    const inspection = adapter.inspect(createGeminiStdioInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Gemini ACP is a supported Tier 1 ACP target'),
      launch: {
        kind: 'stdio',
        command: 'gemini-acp',
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
      request: { headerNames: [] },
      auth: { mechanisms: [], credentials: [] },
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

  it('describes HTTP ACP targets with cursor profile when provider name is cursor', () => {
    const adapter = new AcpAdapter({
      env: { CURSOR_ACP_TOKEN: 'secret-token' },
    });

    const inspection = adapter.inspect(createCursorHttpInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('provider-managed ACP transport'),
      endpoint: 'http://cursor-acp.test',
      transport: {
        kind: 'http',
        protocol: 'acp_v1',
        liveProbe: 'none',
        modelDiscovery: 'none',
        toolDiscovery: 'none',
        streaming: 'generic',
      },
      request: { headerNames: ['x-client-id'] },
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

  it('describes stdio ACP targets with Cursor ACP profile label', () => {
    const adapter = new AcpAdapter();
    const inspection = adapter.inspect(createCursorStdioInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Cursor ACP is a supported Tier 1 ACP target'),
      launch: {
        kind: 'stdio',
        command: 'cursor-acp',
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
      request: { headerNames: [] },
      auth: { mechanisms: [], credentials: [] },
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

  it('describes HTTP ACP targets with copilot profile when provider name is copilot', () => {
    const adapter = new AcpAdapter({
      env: { COPILOT_ACP_TOKEN: 'secret-token' },
    });

    const inspection = adapter.inspect(createCopilotHttpInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('provider-managed ACP transport'),
      endpoint: 'http://copilot-acp.test',
      transport: {
        kind: 'http',
        protocol: 'acp_v1',
        liveProbe: 'none',
        modelDiscovery: 'none',
        toolDiscovery: 'none',
        streaming: 'generic',
      },
      request: { headerNames: ['x-client-id'] },
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

  it('describes stdio ACP targets with Copilot ACP profile label', () => {
    const adapter = new AcpAdapter();
    const inspection = adapter.inspect(createCopilotStdioInstance());

    expect(inspection).toEqual({
      adapter: 'acp',
      family: 'protocol',
      summary: expect.stringContaining('Copilot ACP is a supported Tier 1 ACP target'),
      launch: {
        kind: 'stdio',
        command: 'copilot-acp',
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
      request: { headerNames: [] },
      auth: { mechanisms: [], credentials: [] },
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

  it('discovers effective ACP command tools through transient session bootstrap', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-tools',
            update: {
              sessionUpdate: 'available_commands_update',
              availableCommandsUpdate: {
                availableCommands: [
                  { name: '/plan', description: 'Create a plan' },
                  { name: '/review', description: 'Review the patch' },
                ],
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-tools',
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    });

    await expect(adapter.listTools(createStdioInstance())).resolves.toEqual({
      method: 'tools_effective',
      summary: 'ACP bootstrap discovered 2 effective command(s) for codex/acp-local.',
      toolCount: 2,
      groupCount: 1,
      groups: [{
        id: 'acp_commands',
        label: 'ACP Commands',
        toolCount: 2,
      }],
      tools: [
        {
          name: '/plan',
          title: 'Create a plan',
          groupId: 'acp_commands',
          source: 'session',
        },
        {
          name: '/review',
          title: 'Review the patch',
          groupId: 'acp_commands',
          source: 'session',
        },
      ],
    });
  });

  it('discovers models through transient ACP session bootstrap', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-models',
            models: [
              { modelId: 'gpt-5.4', name: 'GPT-5.4' },
              { id: 'gpt-5.4-mini', title: 'GPT-5.4 Mini' },
            ],
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    });

    await expect(adapter.listModels(createStdioInstance())).resolves.toEqual([
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    ]);
  });

  it('runs a stdio help probe for codex ACP Tier 1 targets', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'probe-session',
            models: [
              { modelId: 'gpt-5.4', name: 'GPT-5.4' },
            ],
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
      acpProcessSpawner: createSpawner(process),
    });

    await expect(adapter.probe(createStdioInstance())).resolves.toEqual({
      health: {
        status: 'ok',
        checkedAt: expect.any(String),
        details: "ACP stdio help probe succeeded for 'codex-acp serve --help'.",
      },
      liveProbe: {
        transport: 'stdio',
        command: 'codex-acp',
        args: ['serve', '--help'],
        profile: 'codex-acp',
        profileLabel: 'Codex ACP',
        exitCode: 0,
        timedOut: false,
        durationMs: 42,
        hasOutput: true,
        bootstrapSession: true,
        bootstrapCwd: '/tmp/acp',
        bootstrapSessionIdPresent: true,
        bootstrapModelCount: 1,
        loadSessionSupported: true,
      },
      checks: [
        {
          code: 'acp_help_probe_exit',
          status: 'ok',
          message: 'ACP stdio command accepted the help probe.',
          details: {
            command: 'codex-acp serve --help',
            exitCode: 0,
            timedOut: false,
            durationMs: 42,
          },
        },
        {
          code: 'acp_target_profile',
          status: 'ok',
          message: "Resolved ACP target profile 'Codex ACP'.",
          details: {
            profile: 'codex-acp',
            label: 'Codex ACP',
            family: 'codex',
          },
        },
        {
          code: 'acp_session_bootstrap',
          status: 'ok',
          message: 'ACP stdio target completed initialize plus session bootstrap.',
          details: {
            cwd: '/tmp/acp',
            sessionIdPresent: true,
            modelCount: 1,
            loadSessionSupported: true,
          },
        },
      ],
    });
  });

  it('runs a stdio help probe for claude ACP Tier 1 targets', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
            },
          },
        }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'probe-session-claude',
            models: [{ modelId: 'sonnet', name: 'Sonnet' }],
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
      acpProcessSpawner: createSpawner(process),
    });

    await expect(adapter.probe!(createClaudeStdioInstance())).resolves.toEqual({
      health: {
        status: 'ok',
        checkedAt: expect.any(String),
        details: "ACP stdio help probe succeeded for 'claude-agent-acp serve --help'.",
      },
      liveProbe: {
        transport: 'stdio',
        command: 'claude-agent-acp',
        args: ['serve', '--help'],
        profile: 'claude-acp',
        profileLabel: 'Claude ACP',
        exitCode: 0,
        timedOut: false,
        durationMs: 42,
        hasOutput: true,
        bootstrapSession: true,
        bootstrapCwd: '/tmp/acp',
        bootstrapSessionIdPresent: true,
        bootstrapModelCount: 1,
        loadSessionSupported: true,
      },
      checks: [
        {
          code: 'acp_help_probe_exit',
          status: 'ok',
          message: 'ACP stdio command accepted the help probe.',
          details: {
            command: 'claude-agent-acp serve --help',
            exitCode: 0,
            timedOut: false,
            durationMs: 42,
          },
        },
        {
          code: 'acp_target_profile',
          status: 'ok',
          message: "Resolved ACP target profile 'Claude ACP'.",
          details: {
            profile: 'claude-acp',
            label: 'Claude ACP',
            family: 'claude',
          },
        },
        {
          code: 'acp_session_bootstrap',
          status: 'ok',
          message: 'ACP stdio target completed initialize plus session bootstrap.',
          details: {
            cwd: '/tmp/acp',
            sessionIdPresent: true,
            modelCount: 1,
            loadSessionSupported: true,
          },
        },
      ],
    });
  });

  it('runs a stdio help probe for gemini ACP Tier 1 targets', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
        }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { sessionId: 'probe-session-gemini', models: [{ modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }] },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
      acpProcessSpawner: createSpawner(process),
    });

    const result = await adapter.probe!(createGeminiStdioInstance());
    expect(result.health.status).toBe('ok');
    expect(result.liveProbe).toEqual(expect.objectContaining({
      profile: 'gemini-acp',
      profileLabel: 'Gemini ACP',
      command: 'gemini-acp',
    }));
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'acp_target_profile',
        details: expect.objectContaining({ profile: 'gemini-acp', label: 'Gemini ACP', family: 'gemini' }),
      }),
    ]));
  });

  it('runs a stdio help probe for cursor ACP Tier 1 targets', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
        }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { sessionId: 'probe-session-cursor', models: [{ modelId: 'cursor-fast', name: 'Cursor Fast' }] },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
      acpProcessSpawner: createSpawner(process),
    });

    const result = await adapter.probe!(createCursorStdioInstance());
    expect(result.health.status).toBe('ok');
    expect(result.liveProbe).toEqual(expect.objectContaining({
      profile: 'cursor-acp',
      profileLabel: 'Cursor ACP',
      command: 'cursor-acp',
    }));
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'acp_target_profile',
        details: expect.objectContaining({ profile: 'cursor-acp', label: 'Cursor ACP', family: 'cursor' }),
      }),
    ]));
  });

  it('runs a stdio help probe for copilot ACP Tier 1 targets', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
        }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { sessionId: 'probe-session-copilot', models: [{ modelId: 'copilot-chat', name: 'Copilot Chat' }] },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
      acpProcessSpawner: createSpawner(process),
    });

    const result = await adapter.probe!(createCopilotStdioInstance());
    expect(result.health.status).toBe('ok');
    expect(result.liveProbe).toEqual(expect.objectContaining({
      profile: 'copilot-acp',
      profileLabel: 'Copilot ACP',
      command: 'copilot-acp',
    }));
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'acp_target_profile',
        details: expect.objectContaining({ profile: 'copilot-acp', label: 'Copilot ACP', family: 'copilot' }),
      }),
    ]));
  });

  it('reports failed stdio help probes as unavailable', async () => {
    const adapter = new AcpAdapter({
      cliCommandRunner: createFailedProbeRunner(),
    });

    await expect(adapter.probe(createStdioInstance())).resolves.toEqual({
      health: {
        status: 'unavailable',
        checkedAt: expect.any(String),
        details: "ACP stdio help probe failed for 'codex-acp serve --help'.",
      },
      liveProbe: {
        transport: 'stdio',
        command: 'codex-acp',
        args: ['serve', '--help'],
        profile: 'codex-acp',
        profileLabel: 'Codex ACP',
        exitCode: 1,
        timedOut: false,
        durationMs: 17,
        hasOutput: true,
      },
      checks: [
        {
          code: 'acp_help_probe_exit',
          status: 'unavailable',
          message: 'ACP stdio command did not complete the help probe successfully.',
          details: {
            command: 'codex-acp serve --help',
            exitCode: 1,
            timedOut: false,
            durationMs: 17,
          },
        },
        {
          code: 'acp_target_profile',
          status: 'ok',
          message: "Resolved ACP target profile 'Codex ACP'.",
          details: {
            profile: 'codex-acp',
            label: 'Codex ACP',
            family: 'codex',
          },
        },
      ],
    });
  });

  it('reports bootstrap failures even when the ACP help probe succeeds', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
      acpProcessSpawner: createSpawner(process),
    });
    const instance = {
      ...createStdioInstance(),
      startupTimeoutMs: 10,
    };

    await expect(adapter.probe(instance)).resolves.toEqual({
      health: {
        status: 'unavailable',
        checkedAt: expect.any(String),
        details: "ACP stdio help probe succeeded for 'codex-acp serve --help', but bootstrap failed.",
      },
      liveProbe: {
        transport: 'stdio',
        command: 'codex-acp',
        args: ['serve', '--help'],
        profile: 'codex-acp',
        profileLabel: 'Codex ACP',
        exitCode: 0,
        timedOut: false,
        durationMs: 42,
        hasOutput: true,
        bootstrapSession: false,
        bootstrapCwd: '/tmp/acp',
      },
      checks: [
        {
          code: 'acp_help_probe_exit',
          status: 'ok',
          message: 'ACP stdio command accepted the help probe.',
          details: {
            command: 'codex-acp serve --help',
            exitCode: 0,
            timedOut: false,
            durationMs: 42,
          },
        },
        {
          code: 'acp_target_profile',
          status: 'ok',
          message: "Resolved ACP target profile 'Codex ACP'.",
          details: {
            profile: 'codex-acp',
            label: 'Codex ACP',
            family: 'codex',
          },
        },
        {
          code: 'acp_session_bootstrap',
          status: 'unavailable',
          message: 'ACP stdio target did not complete initialize plus session bootstrap.',
          details: {
            cwd: '/tmp/acp',
            error: "ACP stdio request 'session/new' timed out after 10ms.",
          },
        },
      ],
    });
  });

  it('reports runtime host services when an ACP host bridge is configured', () => {
    const adapter = new AcpAdapter({
      acpHostBridge: createHostBridge(),
    });

    const inspection = adapter.inspect(createHttpInstance());

    expect(inspection.summary).toContain('provider-managed ACP transport');
    expect(inspection.capabilities.runtimeServices).toBe(true);
  });

  it('throws when invoke is used without a runtime ACP host bridge binding', async () => {
    const adapter = new AcpAdapter();
    const iterator = adapter.invoke({
      sessionId: 'session-1',
      providerName: 'codex',
      instance: createStdioInstance(),
      turn: {
        message: 'hello',
      },
      sessionKey: 'session-key-1',
      signal: new AbortController().signal,
    });

    await expect(iterator.next()).rejects.toThrow(
      /no runtime ACP host-capability bridge is attached/,
    );
  });

  it('boots a new ACP session and emits prompt-turn text plus a final result', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-1',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-1',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: 'hello from codex-acp',
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpHostBridge: createHostBridge(),
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), createHostBridge()),
    ));

    expect(events).toEqual([
      {
        type: 'init',
        providerSessionId: 'acp-session-1',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            providerSessionId: 'acp-session-1',
            status: 'active',
            adapterState: expect.objectContaining({
              acpProfile: 'codex-acp',
              loadSessionSupported: true,
              protocolVersion: 1,
              sessionCwd: '/tmp/acp',
            }),
          }),
        }),
      },
      {
        type: 'text',
        providerSessionId: 'acp-session-1',
        text: 'hello from codex-acp',
      },
      {
        type: 'result',
        providerSessionId: 'acp-session-1',
        summary: 'ACP stop reason: end_turn',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            providerSessionId: 'acp-session-1',
            status: 'idle',
            adapterState: expect.objectContaining({
              stopReason: 'end_turn',
            }),
          }),
        }),
        metadata: {
          stopReason: 'end_turn',
        },
      },
    ]);
  });

  it('passes host-bridge MCP server declarations through session bootstrap and persists them', async () => {
    const process = new FakeAcpProcess();
    const seenMessages: Array<Record<string, unknown>> = [];
    startFakeServer(process, (message) => {
      seenMessages.push(message);
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-mcp',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge: AgentAcpHostBridge = {
      ...createHostBridge(),
      listMcpServers() {
        return [{
          type: 'stdio',
          name: 'cats-runtime',
          command: 'node',
          args: ['build/runtime/bin/mcp.js'],
          env: [{
            name: 'CATS_RUNTIME_MCP_PROXY_URL',
            value: 'http://127.0.0.1:3110/mcp',
          }],
        }];
      },
    };

    const adapter = new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(createInvokeInput(
      createStdioInstance(),
      hostBridge,
    )));

    expect(seenMessages).toContainEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: {
        cwd: '/tmp/acp',
        mcpServers: [{
          type: 'stdio',
          name: 'cats-runtime',
          command: 'node',
          args: ['build/runtime/bin/mcp.js'],
          env: [{
            name: 'CATS_RUNTIME_MCP_PROXY_URL',
            value: 'http://127.0.0.1:3110/mcp',
          }],
        }],
      },
    });

    expect(events[0]).toEqual(expect.objectContaining({
      type: 'init',
      providerSessionId: 'acp-session-mcp',
      providerState: expect.objectContaining({
        agentSession: expect.objectContaining({
          adapterState: expect.objectContaining({
            sessionMcpServers: [{
              type: 'stdio',
              name: 'cats-runtime',
              command: 'node',
              args: ['build/runtime/bin/mcp.js'],
              env: [{
                name: 'CATS_RUNTIME_MCP_PROXY_URL',
                value: 'http://127.0.0.1:3110/mcp',
              }],
            }],
          }),
        }),
      }),
    }));
  });

  it('advertises the codex terminal-output capability hint during ACP initialize', async () => {
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-init-codex',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), hostBridge),
    ));

    expect(initializeParams).toEqual(expect.objectContaining({
      clientCapabilities: expect.objectContaining({
        _meta: {
          terminal_output: true,
        },
      }),
    }));
  });

  it('keeps generic ACP stdio initialize payloads free of codex-specific capability hints', async () => {
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-init-generic',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    await collectEvents(adapter.invoke(
      createInvokeInput(createGenericStdioInstance(), hostBridge),
    ));

    const capabilities = initializeParams?.clientCapabilities as Record<string, unknown> | undefined;
    expect(capabilities?._meta).toBeUndefined();
  });

  it('keeps claude ACP stdio initialize payloads free of provider-specific capability hints', async () => {
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-init-claude',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    await collectEvents(adapter.invoke(
      createInvokeInput(createClaudeStdioInstance(), hostBridge),
    ));

    const capabilities = initializeParams?.clientCapabilities as Record<string, unknown> | undefined;
    expect(capabilities?._meta).toBeUndefined();
  });

  it('keeps gemini ACP stdio initialize payloads free of provider-specific capability hints', async () => {
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-session-init-gemini' } }) + '\n');
        return;
      }
      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({ acpHostBridge: hostBridge, acpProcessSpawner: createSpawner(process) });
    await collectEvents(adapter.invoke(createInvokeInput(createGeminiStdioInstance(), hostBridge)));

    const capabilities = initializeParams?.clientCapabilities as Record<string, unknown> | undefined;
    expect(capabilities?._meta).toBeUndefined();
  });

  it('keeps cursor ACP stdio initialize payloads free of provider-specific capability hints', async () => {
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-session-init-cursor' } }) + '\n');
        return;
      }
      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({ acpHostBridge: hostBridge, acpProcessSpawner: createSpawner(process) });
    await collectEvents(adapter.invoke(createInvokeInput(createCursorStdioInstance(), hostBridge)));

    const capabilities = initializeParams?.clientCapabilities as Record<string, unknown> | undefined;
    expect(capabilities?._meta).toBeUndefined();
  });

  it('keeps copilot ACP stdio initialize payloads free of provider-specific capability hints', async () => {
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } }) + '\n');
        return;
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-session-init-copilot' } }) + '\n');
        return;
      }
      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({ acpHostBridge: hostBridge, acpProcessSpawner: createSpawner(process) });
    await collectEvents(adapter.invoke(createInvokeInput(createCopilotStdioInstance(), hostBridge)));

    const capabilities = initializeParams?.clientCapabilities as Record<string, unknown> | undefined;
    expect(capabilities?._meta).toBeUndefined();
  });

  it('mediates ACP fs read/write requests through the runtime host bridge and workspace policy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-fs-'));
    tempRoots.push(root);
    writeFileSync(join(root, 'note.txt'), 'line1\nline2\nline3\n', 'utf8');

    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;
    let promptRequestId = 0;
    const readReplies: Array<Record<string, unknown>> = [];
    const writeReplies: Array<Record<string, unknown>> = [];

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-fs',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        promptRequestId = message.id as number;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'fs/read_text_file',
          params: {
            sessionId: 'acp-session-fs',
            path: join(root, 'note.txt'),
            line: 2,
            limit: 1,
          },
        }) + '\n');
        return;
      }

      if (message.id === 77) {
        readReplies.push(message);
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 78,
          method: 'fs/write_text_file',
          params: {
            sessionId: 'acp-session-fs',
            path: join(root, 'generated.txt'),
            content: 'written through ACP',
          },
        }) + '\n');
        return;
      }

      if (message.id === 78) {
        writeReplies.push(message);
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: promptRequestId,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = new RuntimeAcpHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });
    const instance = {
      ...createStdioInstance(),
      cwd: root,
    };

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(instance, hostBridge, 'skip'),
    ));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-fs',
      }),
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-fs',
      }),
    ]);
    expect(readReplies).toEqual([{
      jsonrpc: '2.0',
      id: 77,
      result: {
        content: 'line2',
      },
    }]);
    expect(writeReplies).toEqual([{
      jsonrpc: '2.0',
      id: 78,
      result: {},
    }]);
    expect(initializeParams).toEqual(expect.objectContaining({
      clientCapabilities: expect.objectContaining({
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      }),
    }));
    expect(readFileSync(join(root, 'generated.txt'), 'utf8')).toBe('written through ACP');
  });

  it('handles ACP terminal create/output/wait/release through a managed terminal bridge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-terminal-'));
    tempRoots.push(root);

    const nodeBinary = globalThis.process.execPath;
    const process = new FakeAcpProcess();
    let initializeParams: Record<string, unknown> | undefined;
    let promptRequestId = 0;
    let createdTerminalId = '';
    let waitReply: Record<string, unknown> | undefined;
    let outputReply: Record<string, unknown> | undefined;
    let releaseReply: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        initializeParams = message.params as Record<string, unknown>;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-terminal',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        promptRequestId = message.id as number;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 90,
          method: 'terminal/create',
          params: {
            sessionId: 'acp-session-terminal',
            command: nodeBinary,
            args: ['-e', "process.stdout.write('hello from terminal')"],
            cwd: root,
          },
        }) + '\n');
        return;
      }

      if (message.id === 90) {
        createdTerminalId = ((message.result as Record<string, unknown>).terminalId as string);
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 91,
          method: 'terminal/wait_for_exit',
          params: {
            sessionId: 'acp-session-terminal',
            terminalId: createdTerminalId,
          },
        }) + '\n');
        return;
      }

      if (message.id === 91) {
        waitReply = message;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 92,
          method: 'terminal/output',
          params: {
            sessionId: 'acp-session-terminal',
            terminalId: createdTerminalId,
          },
        }) + '\n');
        return;
      }

      if (message.id === 92) {
        outputReply = message;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 93,
          method: 'terminal/release',
          params: {
            sessionId: 'acp-session-terminal',
            terminalId: createdTerminalId,
          },
        }) + '\n');
        return;
      }

      if (message.id === 93) {
        releaseReply = message;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: promptRequestId,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = new RuntimeAcpHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });
    const instance = {
      ...createStdioInstance(),
      cwd: root,
    };

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(instance, hostBridge, 'skip'),
    ));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-terminal',
      }),
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-terminal',
      }),
    ]);
    expect(initializeParams).toEqual(expect.objectContaining({
      clientCapabilities: expect.objectContaining({
        terminal: true,
      }),
    }));
    expect(createdTerminalId).toBe('acp-terminal-1');
    expect(waitReply).toEqual({
      jsonrpc: '2.0',
      id: 91,
      result: {
        exitCode: 0,
        signal: null,
      },
    });
    expect(outputReply).toEqual({
      jsonrpc: '2.0',
      id: 92,
      result: {
        output: 'hello from terminal',
        truncated: false,
        exitStatus: {
          exitCode: 0,
          signal: null,
        },
      },
    });
    expect(releaseReply).toEqual({
      jsonrpc: '2.0',
      id: 93,
      result: {},
    });
  });

  it('normalizes ACP reasoning, plan, and terminal-output updates into runtime progress events', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-progress',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-progress',
            update: {
              sessionUpdate: 'agent_thought_chunk',
              content: 'Need to inspect the repository first.',
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-progress',
            update: {
              sessionUpdate: 'plan',
              plan: {
                entries: [
                  { step: 'Inspect repository', status: 'in_progress' },
                  { step: 'Apply changes', status: 'pending' },
                ],
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-progress',
            update: {
              sessionUpdate: 'tool_call',
              toolCall: {
                toolCallId: 'cmd-1',
                title: 'Run Shell',
                kind: 'execute',
                rawInput: {
                  command: 'ls',
                },
                meta: {
                  terminal_info: {
                    terminal_id: 'cmd-1',
                    cwd: '/tmp/acp',
                  },
                },
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-progress',
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallUpdate: {
                toolCallId: 'cmd-1',
                meta: {
                  terminal_output: {
                    terminal_id: 'cmd-1',
                    data: 'README.md\nsrc\n',
                  },
                },
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-progress',
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallUpdate: {
                toolCallId: 'cmd-1',
                fields: {
                  status: 'completed',
                  content: [
                    { text: 'shell finished' },
                  ],
                },
                meta: {
                  terminal_exit: {
                    terminal_id: 'cmd-1',
                    exit_code: 0,
                    signal: null,
                  },
                },
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), hostBridge),
    ));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-progress',
      }),
      {
        type: 'progress',
        providerSessionId: 'acp-session-progress',
        text: 'Need to inspect the repository first.',
        providerState: expect.any(Object),
        metadata: {
          kind: 'reasoning',
          status: 'running',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:agent_thought_chunk',
            hasReasoningDelta: true,
          },
        },
      },
      {
        type: 'progress',
        providerSessionId: 'acp-session-progress',
        text: 'Codex updated the plan (2 steps).',
        providerState: expect.any(Object),
        metadata: {
          kind: 'plan',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:plan',
            stepCount: 2,
          },
        },
      },
      {
        type: 'tool_use',
        providerSessionId: 'acp-session-progress',
        toolName: 'Run Shell',
        toolId: 'cmd-1',
        toolArgs: {
          command: 'ls',
        },
        providerState: expect.any(Object),
        metadata: {
          native: {
            sourceEvent: 'session/update:tool_call',
            toolKind: 'execute',
            meta: {
              terminal_info: {
                terminal_id: 'cmd-1',
                cwd: '/tmp/acp',
              },
            },
          },
        },
      },
      {
        type: 'progress',
        providerSessionId: 'acp-session-progress',
        toolId: 'cmd-1',
        toolName: 'Run Shell',
        text: 'README.md\nsrc\n',
        providerState: expect.any(Object),
        metadata: {
          kind: 'command',
          status: 'running',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:tool_call_update:terminal_output',
            terminalId: 'cmd-1',
          },
        },
      },
      {
        type: 'progress',
        providerSessionId: 'acp-session-progress',
        toolId: 'cmd-1',
        toolName: 'Run Shell',
        text: 'Command exited with code 0.',
        providerState: expect.any(Object),
        metadata: {
          kind: 'command',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:tool_call_update:terminal_exit',
            terminalId: 'cmd-1',
            exitCode: 0,
          },
        },
      },
      {
        type: 'tool_result',
        providerSessionId: 'acp-session-progress',
        toolName: 'Run Shell',
        toolId: 'cmd-1',
        text: 'shell finished',
        providerState: expect.any(Object),
        metadata: {
          native: {
            sourceEvent: 'session/update:tool_call_update',
            status: 'completed',
            meta: {
              terminal_exit: {
                terminal_id: 'cmd-1',
                exit_code: 0,
                signal: null,
              },
            },
          },
        },
      },
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-progress',
      }),
    ]);
  });

  it('persists ACP session info, commands, and config-option updates into runtime progress/state', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-stateful',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-stateful',
            update: {
              sessionUpdate: 'session_info_update',
              sessionInfoUpdate: {
                title: 'Repo Refactor',
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-stateful',
            update: {
              sessionUpdate: 'available_commands_update',
              availableCommandsUpdate: {
                availableCommands: [
                  { name: '/plan', description: 'Create a plan' },
                  { name: '/review', description: 'Review the patch' },
                ],
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-stateful',
            update: {
              sessionUpdate: 'config_option_update',
              configOptionUpdate: {
                configOptions: [
                  {
                    configId: 'model',
                    name: 'Model',
                    payload: {
                      currentValue: 'gpt-5.4-mini',
                    },
                  },
                  {
                    configId: 'mode',
                    name: 'Mode',
                    payload: {
                      currentValue: 'plan',
                    },
                  },
                ],
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), hostBridge),
    ));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-stateful',
      }),
      {
        type: 'progress',
        providerSessionId: 'acp-session-stateful',
        text: 'Codex session title updated to Repo Refactor.',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            adapterState: expect.objectContaining({
              sessionTitle: 'Repo Refactor',
            }),
          }),
        }),
        metadata: {
          kind: 'session',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:session_info_update',
            title: 'Repo Refactor',
          },
        },
      },
      {
        type: 'progress',
        providerSessionId: 'acp-session-stateful',
        text: 'Codex updated available commands (2 commands).',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            adapterState: expect.objectContaining({
              availableCommands: ['/plan', '/review'],
            }),
          }),
        }),
        metadata: {
          kind: 'command',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:available_commands_update',
            commandCount: 2,
            commandNames: ['/plan', '/review'],
          },
        },
      },
      {
        type: 'progress',
        providerSessionId: 'acp-session-stateful',
        text: 'Codex model state updated to gpt-5.4-mini.',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            adapterState: expect.objectContaining({
              configOptions: [
                {
                  id: 'model',
                  label: 'Model',
                  value: 'gpt-5.4-mini',
                },
                {
                  id: 'mode',
                  label: 'Mode',
                  value: 'plan',
                },
              ],
            }),
          }),
        }),
        metadata: {
          kind: 'model_state',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:config_option_update',
            configId: 'model',
            value: 'gpt-5.4-mini',
          },
        },
      },
      {
        type: 'result',
        providerSessionId: 'acp-session-stateful',
        summary: 'ACP stop reason: end_turn',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            status: 'idle',
            adapterState: expect.objectContaining({
              sessionTitle: 'Repo Refactor',
              availableCommands: ['/plan', '/review'],
              configOptions: [
                {
                  id: 'model',
                  label: 'Model',
                  value: 'gpt-5.4-mini',
                },
                {
                  id: 'mode',
                  label: 'Mode',
                  value: 'plan',
                },
              ],
              stopReason: 'end_turn',
            }),
          }),
        }),
        metadata: {
          stopReason: 'end_turn',
        },
      },
    ]);
  });

  it('persists ACP current-mode and usage updates into runtime progress/state', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-usage',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-usage',
            update: {
              sessionUpdate: 'current_mode_update',
              currentModeUpdate: {
                modeId: 'code',
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-usage',
            update: {
              sessionUpdate: 'usage_update',
              usageUpdate: {
                used: 53000,
                size: 200000,
                cost: {
                  amount: 0.045,
                  currency: 'USD',
                },
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge();
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), hostBridge),
    ));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-usage',
      }),
      {
        type: 'progress',
        providerSessionId: 'acp-session-usage',
        text: 'Codex current mode updated to code.',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            adapterState: expect.objectContaining({
              currentModeId: 'code',
            }),
          }),
        }),
        metadata: {
          kind: 'session',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:current_mode_update',
            modeId: 'code',
          },
        },
      },
      {
        type: 'progress',
        providerSessionId: 'acp-session-usage',
        text: 'Codex context window usage updated to 53000/200000 tokens. Session cost is now 0.045 USD.',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            adapterState: expect.objectContaining({
              contextWindowUsage: {
                used: 53000,
                size: 200000,
                costAmount: 0.045,
                costCurrency: 'USD',
              },
            }),
          }),
        }),
        metadata: {
          kind: 'session',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          native: {
            sourceEvent: 'session/update:usage_update',
            used: 53000,
            size: 200000,
            costAmount: 0.045,
            costCurrency: 'USD',
          },
        },
      },
      {
        type: 'result',
        providerSessionId: 'acp-session-usage',
        summary: 'ACP stop reason: end_turn',
        providerState: expect.objectContaining({
          agentSession: expect.objectContaining({
            adapterState: expect.objectContaining({
              currentModeId: 'code',
              contextWindowUsage: {
                used: 53000,
                size: 200000,
                costAmount: 0.045,
                costCurrency: 'USD',
              },
              stopReason: 'end_turn',
            }),
          }),
        }),
        metadata: {
          stopReason: 'end_turn',
        },
      },
    ]);
  });

  it('uses session/load for continuity and suppresses replay updates during bootstrap', async () => {
    const process = new FakeAcpProcess();
    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/load') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-restore',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: 'old replay that should stay internal',
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            restored: true,
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-restore',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: 'fresh prompt output',
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpHostBridge: createHostBridge(),
      acpProcessSpawner: createSpawner(process),
    });

    const input = createInvokeInput(createStdioInstance(), createHostBridge());
    const events = await collectEvents(adapter.invoke({
      ...input,
      providerSessionId: 'acp-session-restore',
      sessionState: {
        agentSession: {
          providerSessionId: 'acp-session-restore',
          adapterState: {
            acpProfile: 'codex-acp',
          },
        },
      },
    }));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-restore',
      }),
      {
        type: 'text',
        providerSessionId: 'acp-session-restore',
        text: 'fresh prompt output',
      },
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-restore',
      }),
    ]);
  });

  it('answers ACP permission requests using the runtime permission mode mapping', async () => {
    const process = new FakeAcpProcess();
    let permissionReply: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-2',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'session/request_permission',
          params: {
            sessionId: 'acp-session-2',
            options: [
              { optionId: 'allow-once', kind: 'allow_once' },
              { optionId: 'reject-once', kind: 'reject_once' },
            ],
          },
        }) + '\n');
        return;
      }

      if (message.id === 77) {
        permissionReply = message;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-2',
            update: {
              sessionUpdate: 'tool_call',
              toolCall: {
                toolCallId: 'tool-1',
                title: 'Run Shell',
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session-2',
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallUpdate: {
                toolCallId: 'tool-1',
                fields: {
                  status: 'completed',
                  content: [
                    { text: 'shell finished' },
                  ],
                },
              },
            },
          },
        }) + '\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge('skip');
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), hostBridge, 'skip'),
    ));

    expect(permissionReply).toEqual({
      jsonrpc: '2.0',
      id: 77,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: 'allow-once',
        },
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-2',
      }),
      {
        type: 'progress',
        providerSessionId: 'acp-session-2',
        text: 'Runtime approved ACP permission request.',
        providerState: expect.any(Object),
        metadata: {
          kind: 'guardrail',
          status: 'updated',
          source: 'runtime',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          outcome: 'selected',
          optionId: 'allow-once',
          optionKind: 'allow_once',
          policyReason: 'policy_allowed',
          permissionMode: 'skip',
        },
      },
      {
        type: 'tool_use',
        providerSessionId: 'acp-session-2',
        toolName: 'Run Shell',
        toolId: 'tool-1',
        providerState: expect.any(Object),
        metadata: {
          native: {
            sourceEvent: 'session/update:tool_call',
          },
        },
      },
      {
        type: 'tool_result',
        providerSessionId: 'acp-session-2',
        toolName: 'Run Shell',
        toolId: 'tool-1',
        text: 'shell finished',
        providerState: expect.any(Object),
      },
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-2',
      }),
    ]);
  });

  it('rejects ACP permission requests when whitelist policy does not match the requested tool', async () => {
    const process = new FakeAcpProcess();
    let permissionReply: Record<string, unknown> | undefined;

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-3',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'session/request_permission',
          params: {
            sessionId: 'acp-session-3',
            toolCall: {
              toolCallId: 'tool-2',
              title: 'Run Shell',
              kind: 'execute',
            },
            options: [
              { optionId: 'allow-once', kind: 'allow_once' },
              { optionId: 'reject-once', kind: 'reject_once' },
            ],
          },
        }) + '\n');
        return;
      }

      if (message.id === 77) {
        permissionReply = message;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge('whitelist');
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    const events = await collectEvents(adapter.invoke(
      createInvokeInput(createStdioInstance(), hostBridge, 'whitelist', ['read_file']),
    ));

    expect(permissionReply).toEqual({
      jsonrpc: '2.0',
      id: 77,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: 'reject-once',
        },
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-3',
      }),
      {
        type: 'progress',
        providerSessionId: 'acp-session-3',
        toolId: 'tool-2',
        toolName: 'Run Shell',
        text: 'Runtime rejected ACP permission request for Run Shell.',
        providerState: expect.any(Object),
        metadata: {
          kind: 'guardrail',
          status: 'blocked',
          source: 'runtime',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          outcome: 'selected',
          optionId: 'reject-once',
          optionKind: 'reject_once',
          policyReason: 'policy_rejected',
          permissionMode: 'whitelist',
        },
      },
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-3',
      }),
    ]);
  });

  it('cancels ACP permission requests when the turn has already been aborted', async () => {
    const process = new FakeAcpProcess();
    let permissionReply: Record<string, unknown> | undefined;
    const controller = new AbortController();

    startFakeServer(process, async (message) => {
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            sessionId: 'acp-session-abort',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        controller.abort();
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'session/request_permission',
          params: {
            sessionId: 'acp-session-abort',
            toolCall: {
              toolCallId: 'tool-3',
              title: 'Run Shell',
            },
            options: [
              { optionId: 'allow-once', kind: 'allow_once' },
              { optionId: 'reject-once', kind: 'reject_once' },
            ],
          },
        }) + '\n');
        return;
      }

      if (message.id === 77) {
        permissionReply = message;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            stopReason: 'cancelled',
          },
        }) + '\n');
      }
    });

    const hostBridge = createHostBridge('skip');
    const adapter = new AcpAdapter({
      acpHostBridge: hostBridge,
      acpProcessSpawner: createSpawner(process),
    });

    const input = createInvokeInput(createStdioInstance(), hostBridge, 'skip');
    const events = await collectEvents(adapter.invoke({
      ...input,
      signal: controller.signal,
    }));

    expect(permissionReply).toEqual({
      jsonrpc: '2.0',
      id: 77,
      result: {
        outcome: {
          outcome: 'cancelled',
        },
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-session-abort',
      }),
      {
        type: 'progress',
        providerSessionId: 'acp-session-abort',
        toolId: 'tool-3',
        toolName: 'Run Shell',
        text: 'Runtime cancelled ACP permission request for Run Shell after the turn was aborted.',
        providerState: expect.any(Object),
        metadata: {
          kind: 'guardrail',
          status: 'blocked',
          source: 'runtime',
          provider: 'codex',
          backend: 'agent',
          instance: 'acp-local',
          outcome: 'cancelled',
          policyReason: 'turn_aborted',
          permissionMode: 'skip',
        },
      },
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-abort',
        summary: 'ACP stop reason: cancelled',
      }),
    ]);
  });

  it('loads the provider-managed ACP session and emits a cancel notification for remote abort', async () => {
    const process = new FakeAcpProcess();
    const seenMessages: Array<Record<string, unknown>> = [];

    startFakeServer(process, async (message) => {
      seenMessages.push(message);
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/load') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            restored: true,
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    });

    await adapter.cancel('session-1', createStdioInstance(), {
      agentSession: {
        providerSessionId: 'acp-session-cancel',
        adapterState: {
          sessionCwd: '/tmp/acp',
        },
      },
    });

    expect(seenMessages).toEqual([
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: expect.any(Object),
      },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/load',
        params: {
          sessionId: 'acp-session-cancel',
          cwd: '/tmp/acp',
          mcpServers: [],
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: {
          sessionId: 'acp-session-cancel',
        },
      },
    ]);
  });

  it('reuses persisted MCP server declarations when reattaching for remote cancel', async () => {
    const process = new FakeAcpProcess();
    const seenMessages: Array<Record<string, unknown>> = [];
    startFakeServer(process, (message) => {
      seenMessages.push(message);
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/load') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            restored: true,
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    });

    await adapter.cancel('session-1', createStdioInstance(), {
      agentSession: {
        providerSessionId: 'acp-session-cancel',
        adapterState: {
          sessionCwd: '/tmp/acp',
          sessionMcpServers: [{
            type: 'http',
            name: 'runtime-http',
            url: 'http://127.0.0.1:3110/mcp',
            headers: [{
              name: 'authorization',
              value: 'Bearer test-token',
            }],
          }],
        },
      },
    });

    expect(seenMessages).toEqual([
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: expect.any(Object),
      },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/load',
        params: {
          sessionId: 'acp-session-cancel',
          cwd: '/tmp/acp',
          mcpServers: [{
            type: 'http',
            name: 'runtime-http',
            url: 'http://127.0.0.1:3110/mcp',
            headers: [{
              name: 'authorization',
              value: 'Bearer test-token',
            }],
          }],
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: {
          sessionId: 'acp-session-cancel',
        },
      },
    ]);
  });

  it('closes provider-managed ACP sessions when the agent advertises close-session support', async () => {
    const process = new FakeAcpProcess();
    const seenMessages: Array<Record<string, unknown>> = [];
    startFakeServer(process, (message) => {
      seenMessages.push(message);
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              session: {
                close: {},
              },
            },
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/close') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            closed: true,
          },
        }) + '\n');
      }
    });

    const adapter = new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    });

    await adapter.close('session-1', createStdioInstance(), {
      agentSession: {
        providerSessionId: 'acp-session-close',
      },
    }, 'close');

    expect(seenMessages).toEqual([
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: expect.any(Object),
      },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/close',
        params: {
          sessionId: 'acp-session-close',
        },
      },
    ]);
  });
});
