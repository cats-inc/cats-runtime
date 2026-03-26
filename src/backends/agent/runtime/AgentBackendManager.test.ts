import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentBackendManager } from './AgentBackendManager.js';
import { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import type { StreamEvent } from '../../../core/types.js';
import type { AgentAdapter } from '../types.js';
import { buildAgentAdapter } from '../adapters/registry.js';

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
    const adapter: AgentAdapter = {
      kind: 'test-adapter',
      async *invoke(input) {
        capturedInstructions = input.turn.instructions;
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
});
