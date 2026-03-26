import { describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { AgentSdkBridgeAdapter } from './AgentSdkBridgeAdapter.js';

function createInstance(): RemoteProviderInstanceConfig {
  return {
    id: 'sdk',
    providerName: 'claude',
    backend: 'agent',
    transport: 'agent_sdk_bridge',
    baseUrl: 'http://agent-sdk.test',
    model: 'sonnet',
  };
}

describe('AgentSdkBridgeAdapter', () => {
  it('keeps probe health ok when the target provider is listed, the model is visible, and streaming is advertised', async () => {
    const adapter = new AgentSdkBridgeAdapter({
      fetch: async () => new Response(JSON.stringify({
        providers: [
          {
            name: 'claude',
            default_model: 'sonnet',
            models: ['sonnet', 'haiku'],
            capabilities: {
              streaming: true,
              mcp: true,
              vision: false,
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const result = await adapter.probe(createInstance());

    expect(result.health).toEqual(expect.objectContaining({
      status: 'ok',
      details: 'claude available via Agent SDK bridge',
    }));
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'bridge_provider_streaming_supported',
        status: 'ok',
        details: expect.objectContaining({
          streamingAdvertised: true,
        }),
      }),
    ]));
    expect(result.liveProbe).toEqual(expect.objectContaining({
      semanticStatus: 'ok',
      configuredModelListed: true,
      capabilities: {
        streaming: true,
        mcp: true,
        vision: false,
      },
    }));
  });

  it('degrades probe health when the bridge registry does not advertise streaming support', async () => {
    const adapter = new AgentSdkBridgeAdapter({
      fetch: async () => new Response(JSON.stringify({
        providers: [
          {
            name: 'claude',
            default_model: 'sonnet',
            models: ['sonnet', 'haiku'],
            capabilities: {
              streaming: false,
              mcp: true,
              vision: false,
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const result = await adapter.probe(createInstance());

    expect(result.health).toEqual(expect.objectContaining({
      status: 'degraded',
      details: 'claude is listed by Agent SDK bridge but does not advertise streaming support',
    }));
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'bridge_provider_streaming_supported',
        status: 'degraded',
        details: expect.objectContaining({
          streamingAdvertised: false,
        }),
      }),
    ]));
    expect(result.liveProbe).toEqual(expect.objectContaining({
      semanticStatus: 'degraded',
      configuredModelListed: true,
      capabilities: {
        streaming: false,
        mcp: true,
        vision: false,
      },
    }));
  });
});
