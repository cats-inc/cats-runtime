import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { AgentBackendManager } from './AgentBackendManager.js';
import { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import type { StreamEvent } from '../../../core/types.js';
import type { AgentAdapter, AgentProcessSpawner, AgentSpawnedProcess } from '../types.js';
import { buildAgentAdapter } from '../adapters/registry.js';
import { AcpAdapter } from '../adapters/acp/AcpAdapter.js';

vi.mock('../adapters/registry.js', () => ({
  buildAgentAdapter: vi.fn(),
}));

async function collectEvents(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

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

function createSpawner(process: FakeAcpProcess): AgentProcessSpawner {
  return () => process;
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

describe('AgentBackendManager', () => {
  beforeEach(() => {
    vi.mocked(buildAgentAdapter).mockReset();
  });

  it('layers session-level instructions before turn-level overrides', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'agent-session',
      providerName: 'claude',
      providerBackend: 'agent',
      providerInstanceId: 'bridge',
      cwd: '/repo',
      instructions: 'Session-level instructions.',
    });

    let capturedInstructions: string | undefined;
    let capturedAcpHost: Parameters<AgentAdapter['invoke']>[0]['acpHost'];
    const adapter: AgentAdapter = {
      kind: 'test-adapter',
      async *invoke(input) {
        capturedInstructions = input.turn.instructions;
        capturedAcpHost = input.acpHost;
        yield { type: 'result', sessionId: input.providerSessionId ?? input.sessionId };
      },
    };
    vi.mocked(buildAgentAdapter).mockReturnValue(adapter);

    const manager = new AgentBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'claude',
      backend: 'agent',
      instanceId: 'bridge',
      defaultTarget: true,
      remoteInstance: {
        id: 'bridge',
        providerName: 'claude',
        backend: 'agent',
        transport: 'agent_sdk_bridge',
        model: 'claude-sonnet-4',
      },
    };

    const handle = manager.spawn(session.id, target);
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
      instructions: 'Turn-level instructions.',
    }));

    expect(buildAgentAdapter).toHaveBeenCalledTimes(1);
    expect(capturedInstructions).toContain('Session-level instructions.');
    expect(capturedInstructions).toContain('Turn-level instructions.');
    expect(capturedInstructions).toMatch(
      /Session-level instructions\.\s+Turn-level instructions\./,
    );
    expect(capturedAcpHost).toBeUndefined();
    expect(events).toEqual([
      { type: 'result', sessionId: 'agent-session' },
    ]);
  });

  it('preserves structured probe details from the agent adapter', async () => {
    const registry = new SessionRegistry();
    const adapter: AgentAdapter = {
      kind: 'test-adapter',
      async *invoke() {
        yield { type: 'result', sessionId: 'unused' };
      },
      async probe() {
        return {
          health: {
            status: 'ok',
            checkedAt: '2026-03-26T00:00:00.000Z',
            details: 'probe ok',
          },
          liveProbe: {
            endpoint: 'http://agent.test/providers',
            providerListed: true,
          },
          checks: [
            {
              code: 'bridge_provider_listed',
              status: 'ok',
              message: 'provider listed',
              details: {
                providerListed: true,
              },
            },
          ],
        };
      },
    };
    vi.mocked(buildAgentAdapter).mockReturnValue(adapter);

    const manager = new AgentBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'claude',
      backend: 'agent',
      instanceId: 'bridge',
      defaultTarget: true,
      remoteInstance: {
        id: 'bridge',
        providerName: 'claude',
        backend: 'agent',
        transport: 'agent_sdk_bridge',
        model: 'claude-sonnet-4',
      },
    };

    await expect(manager.probe(target, true, 1000)).resolves.toEqual({
      kind: 'test-adapter',
      supported: true,
      result: {
        health: {
          status: 'ok',
          checkedAt: '2026-03-26T00:00:00.000Z',
          details: 'probe ok',
        },
        liveProbe: {
          endpoint: 'http://agent.test/providers',
          providerListed: true,
        },
        checks: [
          {
            code: 'bridge_provider_listed',
            status: 'ok',
            message: 'provider listed',
            details: {
              providerListed: true,
            },
          },
        ],
      },
    });
  });

  it('passes through bounded remote tool catalogs when the adapter supports discovery', async () => {
    const registry = new SessionRegistry();
    const adapter: AgentAdapter = {
      kind: 'test-adapter',
      async *invoke() {
        yield { type: 'result', sessionId: 'unused' };
      },
      async listTools() {
        return {
          method: 'tools_catalog',
          summary: '2 tool(s) across 2 group(s)',
          toolCount: 2,
          groupCount: 2,
          groups: [
            { id: 'core', label: 'Core', toolCount: 1 },
            { id: 'plugin:media', label: 'Media', toolCount: 1 },
          ],
          tools: [
            { name: 'read_file', source: 'core', groupId: 'core' },
            {
              name: 'share_image',
              source: 'plugin',
              groupId: 'plugin:media',
              pluginId: 'media',
              optional: true,
            },
          ],
        };
      },
    };
    vi.mocked(buildAgentAdapter).mockReturnValue(adapter);

    const manager = new AgentBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'openclaw',
      backend: 'agent',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'openclaw',
        backend: 'agent',
        transport: 'openclaw_gateway',
        model: 'openclaw-coder',
      },
    };

    await expect(manager.listTools(target)).resolves.toEqual({
      method: 'tools_catalog',
      summary: '2 tool(s) across 2 group(s)',
      toolCount: 2,
      groupCount: 2,
      groups: [
        { id: 'core', label: 'Core', toolCount: 1 },
        { id: 'plugin:media', label: 'Media', toolCount: 1 },
      ],
      tools: [
        { name: 'read_file', source: 'core', groupId: 'core' },
        {
          name: 'share_image',
          source: 'plugin',
          groupId: 'plugin:media',
          pluginId: 'media',
          optional: true,
        },
      ],
    });
  });

  it('passes runtime ACP host context into adapter invocation when the bridge is available', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'agent-acp-session',
      providerName: 'codex',
      providerBackend: 'agent',
      providerInstanceId: 'acp-local',
      cwd: '/repo',
      workspaceMode: 'shared',
      permissionMode: 'whitelist',
      allowedTools: ['read_file'],
    });

    let capturedAcpHost: NonNullable<Parameters<AgentAdapter['invoke']>[0]['acpHost']> | undefined;
    const adapter: AgentAdapter = {
      kind: 'acp',
      async *invoke(input) {
        capturedAcpHost = input.acpHost;
        yield { type: 'result', sessionId: input.providerSessionId ?? input.sessionId };
      },
    };
    vi.mocked(buildAgentAdapter).mockReturnValue(adapter);

    const manager = new AgentBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'agent',
      instanceId: 'acp-local',
      defaultTarget: true,
      remoteInstance: {
        id: 'acp-local',
        providerName: 'codex',
        backend: 'agent',
        transport: 'acp_stdio',
        toolProfile: 'extended',
        model: 'gpt-5.4',
      },
    };

    const handle = manager.spawn(session.id, target);
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
    }));

    expect(events).toEqual([
      { type: 'result', sessionId: 'agent-acp-session' },
    ]);
    expect(capturedAcpHost).toBeDefined();
    expect(capturedAcpHost?.context).toEqual(expect.objectContaining({
      sessionId: 'agent-acp-session',
      providerName: 'codex',
      providerInstanceId: 'acp-local',
      cwd: '/repo',
      workspaceMode: 'shared',
      permissionMode: 'whitelist',
      allowedTools: ['read_file'],
      toolProfile: 'extended',
      workspace: expect.objectContaining({
        kind: 'source',
        access: 'read_write',
        runtimeCwd: '/repo',
      }),
    }));
    expect(capturedAcpHost?.bridge.describe(capturedAcpHost.context)).toEqual(
      expect.objectContaining({
        toolPolicy: expect.objectContaining({
          permissionMode: 'whitelist',
          whitelistActive: true,
          allowedTools: ['read_file'],
        }),
      }),
    );
  });

  it('persists ACP provider session continuity state through the session registry', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'agent-acp-runtime',
      providerName: 'codex',
      providerBackend: 'agent',
      providerInstanceId: 'acp-local',
      cwd: '/repo',
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });

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
            sessionId: 'acp-runtime-session',
          },
        }) + '\n');
        return;
      }

      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-runtime-session',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: 'runtime-facing output',
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

    vi.mocked(buildAgentAdapter).mockReturnValue(new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    }));

    const manager = new AgentBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'agent',
      instanceId: 'acp-local',
      defaultTarget: true,
      remoteInstance: {
        id: 'acp-local',
        providerName: 'codex',
        backend: 'agent',
        transport: 'acp_stdio',
        command: 'codex-acp',
        args: ['serve'],
        cwd: '/repo',
        model: 'gpt-5.4',
      },
    };

    const handle = manager.spawn(session.id, target);
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
    }));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'init',
        providerSessionId: 'acp-runtime-session',
      }),
      {
        type: 'text',
        providerSessionId: 'acp-runtime-session',
        text: 'runtime-facing output',
      },
      expect.objectContaining({
        type: 'result',
        providerSessionId: 'acp-runtime-session',
      }),
    ]);
    expect(registry.get(session.id)).toEqual(expect.objectContaining({
      providerSessionId: 'acp-runtime-session',
      providerState: expect.objectContaining({
        agentSession: expect.objectContaining({
          providerSessionId: 'acp-runtime-session',
          status: 'idle',
        }),
      }),
    }));
  });

  it('best-effort closes ACP provider sessions during runtime close when the agent supports session close', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'agent-acp-close',
      providerName: 'codex',
      providerBackend: 'agent',
      providerInstanceId: 'acp-local',
      cwd: '/repo',
    });
    registry.setProviderState(session.id, {
      agentSession: {
        providerSessionId: 'acp-close-session',
      },
    });

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

    vi.mocked(buildAgentAdapter).mockReturnValue(new AcpAdapter({
      acpProcessSpawner: createSpawner(process),
    }));

    const manager = new AgentBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'agent',
      instanceId: 'acp-local',
      defaultTarget: true,
      remoteInstance: {
        id: 'acp-local',
        providerName: 'codex',
        backend: 'agent',
        transport: 'acp_stdio',
        command: 'codex-acp',
        args: ['serve'],
        cwd: '/repo',
        model: 'gpt-5.4',
      },
    };

    manager.spawn(session.id, target);
    await manager.close(session.id, 'close');

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
          sessionId: 'acp-close-session',
        },
      },
    ]);
    expect(manager.get(session.id)).toBeUndefined();
  });
});
