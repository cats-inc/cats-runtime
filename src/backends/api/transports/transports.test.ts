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

  it('parses OpenAI chat completions tool calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'chatcmpl-1',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Checking the file.',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"src/app.ts"}',
              },
            }],
          },
        }],
        usage: { prompt_tokens: 5, completion_tokens: 9 },
      }),
    );

    const transport = new OpenAiTransport(fetchMock, {
      OPENAI_API_KEY: 'test-key',
    });
    const instance: RemoteProviderInstanceConfig = {
      id: 'main',
      providerName: 'openai',
      backend: 'api',
      transport: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      model: 'gpt-5',
    };

    const result = await transport.completeTurn(makeInput(instance));
    expect(result.responseId).toBe('chatcmpl-1');
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
});
