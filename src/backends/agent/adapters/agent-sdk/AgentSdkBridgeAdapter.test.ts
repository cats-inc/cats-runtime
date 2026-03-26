import { describe, expect, it } from 'vitest';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { ProviderEvolutionEvidenceCollector } from '../../../../core/compatibility/providerEvolution.js';
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

  it('records dropped and unknown bridge events for provider-evolution evidence while preserving tool_result output', async () => {
    const encoder = new TextEncoder();
    const adapter = new AgentSdkBridgeAdapter({
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';

        if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
          return new Response(JSON.stringify({
            id: 'bridge-session-1',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream' && method === 'POST') {
          const stream = new ReadableStream({
            start(controller) {
              for (const chunk of [
                'data: {"type":"session_created","providerSessionId":"upstream-session-1"}\n\n',
                'data: {"type":"content","content":"alpha"}\n\n',
                'data: {"type":"tool_use","toolName":"read_file","toolInput":{"path":"probe-note.txt"}}\n\n',
                'data: {"type":"tool_result","toolName":"read_file","toolUseId":"tool-1","content":"done"}\n\n',
                'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test"}]}\n\n',
                'data: {"type":"mystery.event","value":1}\n\n',
                'data: not-json\n\n',
                'data: [DONE]\n\n',
              ]) {
                controller.enqueue(encoder.encode(chunk));
              }
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
    });
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'claude',
      instance: 'sdk',
      parserId: 'agent_sdk_http_v1',
      probeProfile: 'manual_text',
      transport: 'agent',
    });

    const events = [];
    for await (const event of adapter.invoke({
      sessionId: 'agent-session',
      sessionKey: 'probe-session',
      providerName: 'claude',
      instance: createInstance(),
      turn: {
        message: 'Probe',
      },
      signal: new AbortController().signal,
      evolutionObserver: collector,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: 'init', providerSessionId: 'bridge-session-1' }),
      expect.objectContaining({ type: 'text', text: 'alpha' }),
      expect.objectContaining({ type: 'tool_use', toolName: 'read_file' }),
      expect.objectContaining({ type: 'tool_result', toolName: 'read_file', toolId: 'tool-1', text: 'done' }),
      expect.objectContaining({ type: 'result', providerSessionId: 'bridge-session-1' }),
    ]);

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredCount).toBe(3);
    expect(bundle.summary.ignoredEventTypes).toEqual({
      session_created: 1,
      service_update: 1,
      '[DONE]': 1,
    });
    expect(bundle.summary.unknownCount).toBe(1);
    expect(bundle.summary.unknownEventTypes).toEqual({
      'mystery.event': 1,
    });
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.rawPassthroughEventTypes).toEqual({
      sse_data: 1,
    });
  });
});
