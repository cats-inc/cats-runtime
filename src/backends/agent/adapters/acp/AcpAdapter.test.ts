import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type {
  AgentAcpHostBridge,
  AgentAcpHostContext,
  AgentCliCommandRunner,
  AgentProcessSpawner,
  AgentSpawnedProcess,
} from '../../types.js';
import type { StreamEvent } from '../../../../core/types.js';
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
        cwd: '/tmp/acp',
        workspace: {
          kind: 'source' as const,
          access: 'read_write' as const,
          runtimeCwd: '/tmp/acp',
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
        cancel: true,
      },
      capabilities: {
        probe: true,
        modelDiscovery: true,
        toolCatalog: false,
        effectiveToolCatalog: false,
        cancel: true,
        runtimeServices: false,
        toolCallEvents: true,
      },
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

  it('runs a stdio help probe for codex ACP pilot targets', async () => {
    const adapter = new AcpAdapter({
      cliCommandRunner: createSuccessfulProbeRunner(),
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
      ],
    });
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
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-session-3',
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
});
