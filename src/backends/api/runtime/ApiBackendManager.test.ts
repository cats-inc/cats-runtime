import { describe, expect, it, vi } from 'vitest';
import { ApiBackendManager } from './ApiBackendManager.js';
import { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import type { StreamEvent } from '../../../core/types.js';

async function collectEvents(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('ApiBackendManager', () => {
  it('keeps session-level instructions when a turn does not override them', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      instructions: 'Session-level instructions.',
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_123',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hello from api backend' }],
        }],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-4.1',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://example.test',
        systemPrompt: 'Remote system prompt.',
      },
    };

    const handle = manager.spawn(session.id, target);
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody?.instructions).toContain('Remote system prompt.');
    expect(capturedBody?.instructions).toContain('Session-level instructions.');
    expect(events).toEqual([
      expect.objectContaining({ type: 'init', sessionId: 'resp_123' }),
      { type: 'text', text: 'hello from api backend', raw: expect.any(Object) },
      expect.objectContaining({
        type: 'result',
        sessionId: 'resp_123',
        usage: {
          inputTokens: 12,
          outputTokens: 4,
        },
      }),
    ]);
  });

  it('layers session-level instructions before turn-level overrides', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-layered',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      instructions: 'Session-level instructions.',
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_456',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hello from layered api backend' }],
        }],
        usage: {
          input_tokens: 8,
          output_tokens: 3,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-4.1',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://example.test',
      },
    };

    const handle = manager.spawn(session.id, target);
    await collectEvents(handle.streamMessage({
      message: 'hello',
      instructions: 'Turn-level instructions.',
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody?.instructions).toContain('Session-level instructions.');
    expect(capturedBody?.instructions).toContain('Turn-level instructions.');
    expect(String(capturedBody?.instructions)).toMatch(
      /Session-level instructions\.\s+Turn-level instructions\./,
    );
  });

  it('applies resolved advanced model controls as provider request patches', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-controls',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      model: 'gpt-5.4',
      modelSelection: {
        entryMode: 'auto',
        presetId: 'deep_reasoning',
        controls: {
          'openai.reasoning_effort': 'high',
        },
      },
      modelResolution: {
        entryId: 'gpt-5.4',
        model: 'gpt-5.4',
        entryMode: 'auto',
        presetId: 'deep_reasoning',
        controls: {
          'openai.reasoning_effort': 'high',
        },
        supportTier: 'full',
        warnings: [],
      },
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_controls',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hello from controlled api backend' }],
        }],
        usage: {
          input_tokens: 8,
          output_tokens: 2,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-4.1',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://example.test',
      },
    };

    const handle = manager.spawn(session.id, target);
    await collectEvents(handle.streamMessage({
      message: 'hello',
    }));

    expect(capturedBody?.reasoning).toEqual({
      effort: 'high',
    });
  });
});
