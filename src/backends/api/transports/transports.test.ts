import { describe, expect, it, vi } from 'vitest';
import { AnthropicTransport } from './anthropic.js';
import { GeminiTransport } from './gemini.js';
import { OllamaTransport } from './ollama.js';
import { OpenAiTransport } from './openai.js';
import type { ApiCompletionInput } from '../types.js';
import type { RemoteProviderInstanceConfig } from '../../cli/config.js';

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function makeInput(
  instance: RemoteProviderInstanceConfig,
): ApiCompletionInput {
  return {
    sessionId: 'session-1',
    providerName: instance.providerName,
    instance,
    model: instance.model || 'test-model',
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    tools: [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    ],
  };
}

describe('API transports', () => {
  it('parses Anthropic message responses with tool calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_1',
        content: [
          { type: 'text', text: 'Checking the file.' },
          { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'src/app.ts' } },
        ],
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
    );

    const transport = new AnthropicTransport(fetchMock, {
      ANTHROPIC_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'sonnet',
      providerName: 'claude',
      backend: 'api',
      transport: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-6',
    };

    const result = await transport.completeTurn(makeInput(instance));
    expect(result.responseId).toBe('msg_1');
    expect(result.assistant.parts).toEqual([
      { type: 'text', text: 'Checking the file.' },
      expect.objectContaining({
        type: 'tool_call',
        id: 'tool-1',
        name: 'read_file',
        arguments: { path: 'src/app.ts' },
      }),
    ]);
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('adds an Anthropic prompt cache breakpoint to the reusable prefix', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_1',
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );

    const transport = new AnthropicTransport(fetchMock, {
      ANTHROPIC_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'sonnet',
      providerName: 'claude',
      backend: 'api',
      transport: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-6',
    };

    await transport.completeTurn({
      ...makeInput(instance),
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'You are helpful.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Remember src/app.ts.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Now inspect it.' }] },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    expect(messages[0]).toEqual({
      role: 'user',
      content: [{
        type: 'text',
        text: 'Remember src/app.ts.',
        cache_control: { type: 'ephemeral' },
      }],
    });
  });

  it('parses OpenAI Responses API tool calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Checking the file.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'read_file',
            arguments: '{"path":"src/app.ts"}',
          },
        ],
        usage: { input_tokens: 5, output_tokens: 9 },
      }),
    );

    const transport = new OpenAiTransport(fetchMock, {
      OPENAI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'main',
      providerName: 'codex',
      backend: 'api',
      transport: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      model: 'gpt-5',
    };

    const result = await transport.completeTurn(makeInput(instance));
    const [requestUrl] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).toContain('/v1/responses');
    expect(result.responseId).toBe('resp_1');
    expect(result.assistant.parts).toEqual([
      { type: 'text', text: 'Checking the file.' },
      expect.objectContaining({
        type: 'tool_call',
        id: 'call_1',
        name: 'read_file',
        arguments: { path: 'src/app.ts' },
      }),
    ]);
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 9 });
  });

  it('uses OpenAI previous_response_id for continuation when available', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_2',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Continued.' }],
        }],
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
    );

    const transport = new OpenAiTransport(fetchMock, {
      OPENAI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'main',
      providerName: 'codex',
      backend: 'api',
      transport: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      model: 'gpt-5',
    };

    const result = await transport.completeTurn({
      ...makeInput(instance),
      previousResponseId: 'resp_prev',
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'Stay terse.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'What changed?' }] },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    expect(body.previous_response_id).toBe('resp_prev');
    expect(body.instructions).toBe('Stay terse.');
    expect(body.input).toEqual([
      { role: 'user', content: 'What changed?' },
    ]);
    expect(result.progress).toEqual([
      {
        kind: 'provider_cache',
        status: 'reused',
        message: 'Reused OpenAI previous_response_id continuation.',
        metadata: {
          strategy: 'previous_response_id',
          previousResponseId: 'resp_prev',
        },
      },
    ]);
  });

  it('falls back to a full OpenAI transcript when previous_response_id is rejected', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: 'previous_response_id not found',
        },
      }), {
        status: 404,
        headers: {
          'content-type': 'application/json',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'resp_2',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Recovered.' }],
        }],
        usage: { input_tokens: 6, output_tokens: 4 },
      }));

    const transport = new OpenAiTransport(fetchMock, {
      OPENAI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'main',
      providerName: 'codex',
      backend: 'api',
      transport: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      model: 'gpt-5',
    };

    const result = await transport.completeTurn({
      ...makeInput(instance),
      previousResponseId: 'resp_missing',
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Try again' }] },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1] ?? [];
    const retryBody = JSON.parse(String(retryInit?.body || '{}')) as Record<string, unknown>;
    expect(retryBody.previous_response_id).toBeUndefined();
    expect(result.progress).toEqual([
      {
        kind: 'provider_cache',
        status: 'fallback',
        message: 'OpenAI previous_response_id continuation was rejected; retried with full transcript.',
        metadata: {
          strategy: 'previous_response_id',
          previousResponseId: 'resp_missing',
        },
      },
    ]);
  });

  it('parses Gemini function calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [{
          content: {
            parts: [
              { text: 'Checking the file.' },
              { functionCall: { name: 'read_file', args: { path: 'src/app.ts' } } },
            ],
          },
        }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      }),
    );

    const transport = new GeminiTransport(fetchMock, {
      GEMINI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'pro',
      providerName: 'gemini',
      backend: 'api',
      transport: 'google',
      apiKeyEnv: 'GEMINI_API_KEY',
      model: 'gemini-2.5-pro',
    };

    const result = await transport.completeTurn(makeInput(instance));
    expect(result.assistant.parts).toEqual([
      { type: 'text', text: 'Checking the file.' },
      expect.objectContaining({
        type: 'tool_call',
        name: 'read_file',
        arguments: { path: 'src/app.ts' },
      }),
    ]);
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it('sends Gemini system prompts via systemInstruction instead of contents role', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [{
          content: {
            parts: [{ text: 'Done.' }],
          },
        }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
      }),
    );

    const transport = new GeminiTransport(fetchMock, {
      GEMINI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'pro',
      providerName: 'gemini',
      backend: 'api',
      transport: 'google',
      apiKeyEnv: 'GEMINI_API_KEY',
      model: 'gemini-2.5-pro',
    };

    await transport.completeTurn({
      ...makeInput(instance),
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'You are precise.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'You are precise.' }],
    });
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Hi' }],
      },
    ]);
  });

  it('creates and uses Gemini cached content for large reusable prefixes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/v1beta/cachedContents')) {
        return jsonResponse({
          name: 'cachedContents/test-cache',
          expireTime: '2026-03-16T03:00:00Z',
        });
      }

      if (url.includes(':generateContent')) {
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{ text: 'Used cached context.' }],
            },
          }],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const transport = new GeminiTransport(fetchMock, {
      GEMINI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'flash',
      providerName: 'gemini',
      backend: 'api',
      transport: 'google',
      apiKeyEnv: 'GEMINI_API_KEY',
      model: 'gemini-3-flash-preview',
    };

    const result = await transport.completeTurn({
      ...makeInput(instance),
      turnStep: 0,
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'A'.repeat(18000) }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Stored context.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'What next?' }] },
      ],
    });

    expect(result.sessionState?.geminiCachedContent).toEqual(expect.objectContaining({
      name: 'cachedContents/test-cache',
      model: 'gemini-3-flash-preview',
    }));

    const [, cacheInit] = fetchMock.mock.calls[0] ?? [];
    const cacheBody = JSON.parse(String(cacheInit?.body || '{}')) as Record<string, unknown>;
    expect(cacheBody.model).toBe('models/gemini-3-flash-preview');

    const [, generateInit] = fetchMock.mock.calls[1] ?? [];
    const generateBody = JSON.parse(String(generateInit?.body || '{}')) as Record<string, unknown>;
    expect(generateBody.cachedContent).toBe('cachedContents/test-cache');
    expect(generateBody.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'What next?' }],
      },
    ]);
    expect(generateBody.tools).toBeUndefined();
    expect(generateBody.systemInstruction).toBeUndefined();
    expect(result.progress).toEqual([
      {
        kind: 'provider_cache',
        status: 'created',
        message: 'Created Gemini cached context for the reusable prompt prefix.',
        metadata: {
          strategy: 'cached_content',
          cachedContent: 'cachedContents/test-cache',
          ttl: '3600s',
        },
      },
    ]);
  });

  it('reuses Gemini cached content metadata on later turns', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/v1beta/cachedContents')) {
        return jsonResponse({
          name: 'cachedContents/existing',
          expireTime: '2099-01-01T00:00:00Z',
        });
      }

      if (url.includes(':generateContent')) {
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{ text: 'Reused cached context.' }],
            },
          }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const transport = new GeminiTransport(fetchMock, {
      GEMINI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'pro',
      providerName: 'gemini',
      backend: 'api',
      transport: 'google',
      apiKeyEnv: 'GEMINI_API_KEY',
      model: 'gemini-2.5-pro',
    };

    const first = await transport.completeTurn({
      ...makeInput(instance),
      turnStep: 0,
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'A'.repeat(18000) }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Stored context.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'What next?' }] },
      ],
    });

    const result = await transport.completeTurn({
      ...makeInput(instance),
      turnStep: 0,
      sessionState: first.sessionState,
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'A'.repeat(18000) }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Stored context.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'What next?' }] },
      ],
    });

    const [, init] = fetchMock.mock.calls[2] ?? [];
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    expect(body.cachedContent).toBe('cachedContents/existing');
    expect(result.progress).toEqual([
      {
        kind: 'provider_cache',
        status: 'reused',
        message: 'Reused Gemini cached context.',
        metadata: {
          strategy: 'cached_content',
          cachedContent: 'cachedContents/existing',
        },
      },
    ]);
  });

  it('parses Ollama chat responses with local tool calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        message: {
          content: 'Checking the file.',
          tool_calls: [{
            function: {
              name: 'read_file',
              arguments: { path: 'src/app.ts' },
            },
          }],
        },
        prompt_eval_count: 2,
        eval_count: 6,
      }),
    );

    const transport = new OllamaTransport(fetchMock);
    const instance: RemoteProviderInstanceConfig = {
      id: 'local',
      providerName: 'ollama',
      backend: 'local',
      transport: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:latest',
    };

    const result = await transport.completeTurn(makeInput(instance));
    expect(result.assistant.parts).toEqual([
      { type: 'text', text: 'Checking the file.' },
      expect.objectContaining({
        type: 'tool_call',
        name: 'read_file',
        arguments: { path: 'src/app.ts' },
      }),
    ]);
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 6 });
  });

  it('applies Ollama keep_alive hints from payload templates and emits model-state progress', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        message: {
          content: 'Still warm.',
        },
        prompt_eval_count: 1,
        eval_count: 2,
      }),
    );

    const transport = new OllamaTransport(fetchMock, {});
    const instance: RemoteProviderInstanceConfig = {
      id: 'local',
      providerName: 'ollama',
      backend: 'local',
      transport: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:latest',
      payloadTemplate: {
        keep_alive: '15m',
        options: {
          temperature: 0.1,
        },
      },
    };

    const result = await transport.completeTurn(makeInput(instance));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    expect(body.keep_alive).toBe('15m');
    expect(body.options).toEqual({
      temperature: 0.1,
      num_predict: 8192,
    });
    expect(result.progress).toEqual([
      {
        kind: 'model_state',
        status: 'hinted',
        message: 'Applied an Ollama keep_alive hint to keep the model warm.',
        metadata: {
          strategy: 'keep_alive',
          keepAlive: '15m',
        },
      },
    ]);
  });
});
