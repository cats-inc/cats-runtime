import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';

function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function createApiConfigRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-api-test-'));
  const configPath = join(root, 'providers.yaml');
  writeFileSync(configPath, `
version: 1
routing:
  providers:
    claude:
      default_target:
        backend: api
        instance: sonnet
    openai:
      default_target:
        backend: api
        instance: main
    gemini:
      default_target:
        backend: api
        instance: pro
    ollama:
      default_target:
        backend: local
        instance: local
backends:
  api:
    providers:
      claude:
        instances:
          sonnet:
            transport: anthropic
            api_key_env: ANTHROPIC_API_KEY
            model: claude-sonnet-4-6
      openai:
        instances:
          main:
            transport: openai
            api_key_env: OPENAI_API_KEY
            model: gpt-5
      gemini:
        instances:
          pro:
            transport: google
            api_key_env: GEMINI_API_KEY
            model: gemini-2.5-pro
  local:
    providers:
      ollama:
        instances:
          local:
            transport: ollama
            base_url: http://127.0.0.1:11434
            model: qwen3:latest
`.trimStart());

  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: configPath,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
  };

  mkdirSync(env.CATS_RUNTIME_DATA_DIR, { recursive: true });
  mkdirSync(env.CATS_RUNTIME_SESSION_BASE_DIR, { recursive: true });
  mkdirSync(join(root, 'repo', 'src'), { recursive: true });
  writeFileSync(join(root, 'repo', 'src', 'app.ts'), 'export const value = 7;\n');

  return {
    root,
    env,
    config: loadConfig(env),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('API backend integration', () => {
  it('exposes API and local providers in /providers/config', async () => {
    const { config, cleanup } = createApiConfigRoot();
    const runtime = createRuntimeServer(config);

    try {
      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        providers: {
          claude: {
            defaultInstance: 'sonnet',
            defaultBackend: 'api',
            instances: [
              {
                id: 'sonnet',
                target: 'api/sonnet',
                backend: 'api',
                command: undefined,
                runner: undefined,
                runtime: undefined,
                transport: 'anthropic',
                model: 'claude-sonnet-4-6',
              },
            ],
          },
          openai: {
            defaultInstance: 'main',
            defaultBackend: 'api',
            instances: [
              {
                id: 'main',
                target: 'api/main',
                backend: 'api',
                command: undefined,
                runner: undefined,
                runtime: undefined,
                transport: 'openai',
                model: 'gpt-5',
              },
            ],
          },
          gemini: {
            defaultInstance: 'pro',
            defaultBackend: 'api',
            instances: [
              {
                id: 'pro',
                target: 'api/pro',
                backend: 'api',
                command: undefined,
                runner: undefined,
                runtime: undefined,
                transport: 'google',
                model: 'gemini-2.5-pro',
              },
            ],
          },
          ollama: {
            defaultInstance: 'local',
            defaultBackend: 'local',
            instances: [
              {
                id: 'local',
                target: 'local/local',
                backend: 'local',
                command: undefined,
                runner: undefined,
                runtime: undefined,
                transport: 'ollama',
                model: 'qwen3:latest',
              },
            ],
          },
        },
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('runs local tools through OpenAI sessions and supports read_only mode', async () => {
    const { config, env, cleanup } = createApiConfigRoot();
    let openAiCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/v1/chat/completions')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      openAiCalls += 1;
      if (openAiCalls === 1) {
        return jsonResponse({
          id: 'chatcmpl-1',
          choices: [{
            message: {
              role: 'assistant',
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
          usage: { prompt_tokens: 5, completion_tokens: 4 },
        });
      }

      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      const messages = Array.isArray(body.messages) ? body.messages : [];

      if (openAiCalls === 2) {
        expect(messages.some((message) => {
          if (!message || typeof message !== 'object') return false;
          const payload = message as Record<string, unknown>;
          return payload.role === 'tool'
            && typeof payload.content === 'string'
            && payload.content.includes('export const value = 7;');
        })).toBe(true);

        return jsonResponse({
          id: 'chatcmpl-2',
          choices: [{
            message: {
              role: 'assistant',
              content: 'The file exports value 7.',
            },
          }],
          usage: { prompt_tokens: 6, completion_tokens: 7 },
        });
      }

      expect(messages.some((message) => {
        if (!message || typeof message !== 'object') return false;
        const payload = message as Record<string, unknown>;
        return payload.role === 'assistant'
          && Array.isArray(payload.tool_calls)
          && (payload.tool_calls as Array<Record<string, unknown>>).some((toolCall) =>
            toolCall.function && typeof toolCall.function === 'object'
            && (toolCall.function as Record<string, unknown>).name === 'read_file');
      })).toBe(true);
      expect(messages.some((message) => {
        if (!message || typeof message !== 'object') return false;
        const payload = message as Record<string, unknown>;
        return payload.role === 'tool'
          && typeof payload.content === 'string'
          && payload.content.includes('export const value = 7;');
      })).toBe(true);

      return jsonResponse({
        id: 'chatcmpl-3',
        choices: [{
          message: {
            role: 'assistant',
            content: 'It was src/app.ts.',
          },
        }],
        usage: { prompt_tokens: 4, completion_tokens: 5 },
      });
    });

    const runtime = createRuntimeServer(config, {
      apiBackend: {
        fetch: fetchMock,
        env: {
          ...env,
          OPENAI_API_KEY: 'openai-test-key',
          ANTHROPIC_API_KEY: 'anthropic-test-key',
          GEMINI_API_KEY: 'gemini-test-key',
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          cwd: join(env.HOME, 'repo'),
          workspaceMode: 'read_only',
        }),
      });
      expect(createResponse.status).toBe(201);
      const session = await createResponse.json() as Record<string, unknown>;
      expect(session.providerBackend).toBe('api');
      expect(session.status).toBe('ready');

      const messageResponse = await runtime.app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Read src/app.ts and summarize it.' }),
      });
      expect(messageResponse.status).toBe(200);
      const streamEvents = parseNdjson(await messageResponse.text());
      expect(streamEvents).toEqual([
        expect.objectContaining({ type: 'init', sessionId: 'chatcmpl-1' }),
        expect.objectContaining({
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'call_1',
        }),
        expect.objectContaining({
          type: 'tool_result',
          toolName: 'read_file',
          toolId: 'call_1',
          text: expect.stringContaining('export const value = 7;'),
        }),
        expect.objectContaining({ type: 'text', text: 'The file exports value 7.' }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'chatcmpl-1',
          usage: { inputTokens: 11, outputTokens: 11 },
        }),
      ]);

      const historyResponse = await runtime.app.request(`/sessions/${session.id}/history`);
      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [
          { role: 'user', text: 'Read src/app.ts and summarize it.', timestamp: expect.any(String) },
          { role: 'assistant', text: 'The file exports value 7.', timestamp: expect.any(String) },
        ],
      });

      const closeResponse = await runtime.app.request(`/sessions/${session.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const resumeResponse = await runtime.app.request(`/sessions/${session.id}/resume`, {
        method: 'POST',
      });
      expect(resumeResponse.status).toBe(200);

      const secondMessageResponse = await runtime.app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Which file was that?' }),
      });
      expect(secondMessageResponse.status).toBe(200);
      expect(parseNdjson(await secondMessageResponse.text())).toEqual([
        expect.objectContaining({ type: 'init', sessionId: 'chatcmpl-3' }),
        expect.objectContaining({ type: 'text', text: 'It was src/app.ts.' }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'chatcmpl-3',
          usage: { inputTokens: 4, outputTokens: 5 },
        }),
      ]);
      expect(openAiCalls).toBe(3);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('runs tool loops for Claude and Gemini API sessions', async () => {
    const { config, env, cleanup } = createApiConfigRoot();
    let anthropicCalls = 0;
    let geminiCalls = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/v1/messages')) {
        anthropicCalls += 1;
        if (anthropicCalls === 1) {
          return jsonResponse({
            id: 'msg_1',
            content: [
              { type: 'tool_use', id: 'claude-tool-1', name: 'read_file', input: { path: 'src/app.ts' } },
            ],
            usage: { input_tokens: 3, output_tokens: 2 },
          });
        }
        return jsonResponse({
          id: 'msg_2',
          content: [{ type: 'text', text: 'Claude saw value 7.' }],
          usage: { input_tokens: 4, output_tokens: 5 },
        });
      }

      if (url.includes(':generateContent')) {
        geminiCalls += 1;
        if (geminiCalls === 1) {
          return jsonResponse({
            candidates: [{
              content: {
                parts: [
                  { functionCall: { name: 'read_file', args: { path: 'src/app.ts' } } },
                ],
              },
            }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
          });
        }
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{ text: 'Gemini saw value 7.' }],
            },
          }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const runtime = createRuntimeServer(config, {
      apiBackend: {
        fetch: fetchMock,
        env: {
          ...env,
          OPENAI_API_KEY: 'openai-test-key',
          ANTHROPIC_API_KEY: 'anthropic-test-key',
          GEMINI_API_KEY: 'gemini-test-key',
        },
      },
    });

    try {
      const claudeResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          instance: 'api/sonnet',
          cwd: join(env.HOME, 'repo'),
          workspaceMode: 'shared',
        }),
      });
      expect(claudeResponse.status).toBe(201);
      const claudeSession = await claudeResponse.json() as Record<string, unknown>;

      const claudeMessage = await runtime.app.request(`/sessions/${claudeSession.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Inspect src/app.ts.' }),
      });
      expect(claudeMessage.status).toBe(200);
      expect(parseNdjson(await claudeMessage.text())).toEqual([
        expect.objectContaining({ type: 'init', sessionId: 'msg_1' }),
        expect.objectContaining({ type: 'tool_use', toolName: 'read_file' }),
        expect.objectContaining({ type: 'tool_result', toolName: 'read_file' }),
        expect.objectContaining({ type: 'text', text: 'Claude saw value 7.' }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'msg_1',
          usage: { inputTokens: 7, outputTokens: 7 },
        }),
      ]);

      const geminiResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'gemini',
          cwd: join(env.HOME, 'repo'),
          workspaceMode: 'shared',
        }),
      });
      expect(geminiResponse.status).toBe(201);
      const geminiSession = await geminiResponse.json() as Record<string, unknown>;
      expect(geminiSession.providerBackend).toBe('api');

      const geminiMessage = await runtime.app.request(`/sessions/${geminiSession.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Inspect src/app.ts.' }),
      });
      expect(geminiMessage.status).toBe(200);
      expect(parseNdjson(await geminiMessage.text())).toEqual([
        expect.objectContaining({ type: 'init' }),
        expect.objectContaining({ type: 'tool_use', toolName: 'read_file' }),
        expect.objectContaining({ type: 'tool_result', toolName: 'read_file' }),
        expect.objectContaining({ type: 'text', text: 'Gemini saw value 7.' }),
        expect.objectContaining({
          type: 'result',
          usage: { inputTokens: 5, outputTokens: 5 },
        }),
      ]);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('replays multi-tool Claude turns after resume without splitting the batch', async () => {
    const { root, config, env, cleanup } = createApiConfigRoot();
    writeFileSync(join(root, 'repo', 'src', 'other.ts'), 'export const other = 9;\n');

    let anthropicCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/v1/messages')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      anthropicCalls += 1;
      if (anthropicCalls === 1) {
        return jsonResponse({
          id: 'msg_1',
          content: [
            { type: 'text', text: 'Checking both files.' },
            { type: 'tool_use', id: 'claude-tool-1', name: 'read_file', input: { path: 'src/app.ts' } },
            { type: 'tool_use', id: 'claude-tool-2', name: 'read_file', input: { path: 'src/other.ts' } },
          ],
          usage: { input_tokens: 3, output_tokens: 2 },
        });
      }

      if (anthropicCalls === 2) {
        return jsonResponse({
          id: 'msg_2',
          content: [{ type: 'text', text: 'Both files were inspected.' }],
          usage: { input_tokens: 4, output_tokens: 5 },
        });
      }

      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      const messages = Array.isArray(body.messages) ? body.messages : [];

      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking both files.' },
            { type: 'tool_use', id: 'claude-tool-1', name: 'read_file', input: { path: 'src/app.ts' } },
            { type: 'tool_use', id: 'claude-tool-2', name: 'read_file', input: { path: 'src/other.ts' } },
          ],
        }),
        expect.objectContaining({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'claude-tool-1',
              content: expect.stringContaining('export const value = 7;'),
              is_error: false,
            },
            {
              type: 'tool_result',
              tool_use_id: 'claude-tool-2',
              content: expect.stringContaining('export const other = 9;'),
              is_error: false,
            },
          ],
        }),
      ]));

      return jsonResponse({
        id: 'msg_3',
        content: [{ type: 'text', text: 'Replay preserved both tool calls.' }],
        usage: { input_tokens: 5, output_tokens: 6 },
      });
    });

    const runtime = createRuntimeServer(config, {
      apiBackend: {
        fetch: fetchMock,
        env: {
          ...env,
          OPENAI_API_KEY: 'openai-test-key',
          ANTHROPIC_API_KEY: 'anthropic-test-key',
          GEMINI_API_KEY: 'gemini-test-key',
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          instance: 'api/sonnet',
          cwd: join(env.HOME, 'repo'),
          workspaceMode: 'shared',
        }),
      });
      expect(createResponse.status).toBe(201);
      const session = await createResponse.json() as Record<string, unknown>;

      const messageResponse = await runtime.app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Inspect both files.' }),
      });
      expect(messageResponse.status).toBe(200);
      expect(parseNdjson(await messageResponse.text())).toEqual([
        expect.objectContaining({ type: 'init', sessionId: 'msg_1' }),
        expect.objectContaining({ type: 'text', text: 'Checking both files.' }),
        expect.objectContaining({ type: 'tool_use', toolId: 'claude-tool-1' }),
        expect.objectContaining({ type: 'tool_use', toolId: 'claude-tool-2' }),
        expect.objectContaining({ type: 'tool_result', toolId: 'claude-tool-1' }),
        expect.objectContaining({ type: 'tool_result', toolId: 'claude-tool-2' }),
        expect.objectContaining({ type: 'text', text: 'Both files were inspected.' }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'msg_1',
          usage: { inputTokens: 7, outputTokens: 7 },
        }),
      ]);

      const closeResponse = await runtime.app.request(`/sessions/${session.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const resumeResponse = await runtime.app.request(`/sessions/${session.id}/resume`, {
        method: 'POST',
      });
      expect(resumeResponse.status).toBe(200);

      const replayResponse = await runtime.app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Did replay keep both tool calls?' }),
      });
      expect(replayResponse.status).toBe(200);
      expect(parseNdjson(await replayResponse.text())).toEqual([
        expect.objectContaining({ type: 'init', sessionId: 'msg_3' }),
        expect.objectContaining({ type: 'text', text: 'Replay preserved both tool calls.' }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'msg_3',
          usage: { inputTokens: 5, outputTokens: 6 },
        }),
      ]);
      expect(anthropicCalls).toBe(3);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('accepts local Ollama targets alongside API providers', async () => {
    const { config, env, cleanup } = createApiConfigRoot();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/api/chat')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      return jsonResponse({
        message: {
          content: 'Ollama reply',
        },
        prompt_eval_count: 3,
        eval_count: 5,
      });
    });

    const runtime = createRuntimeServer(config, {
      apiBackend: {
        fetch: fetchMock,
        env: {
          ...env,
          OPENAI_API_KEY: 'openai-test-key',
          ANTHROPIC_API_KEY: 'anthropic-test-key',
          GEMINI_API_KEY: 'gemini-test-key',
        },
      },
    });

    try {
      const ollamaResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'ollama',
          instance: 'local/local',
          cwd: join(env.HOME, 'repo'),
          workspaceMode: 'shared',
        }),
      });
      expect(ollamaResponse.status).toBe(201);
      const session = await ollamaResponse.json() as Record<string, unknown>;
      expect(session.providerBackend).toBe('local');

      const messageResponse = await runtime.app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ message: 'Hi Ollama' }),
      });
      expect(messageResponse.status).toBe(200);
      expect(parseNdjson(await messageResponse.text())).toEqual([
        expect.objectContaining({ type: 'init' }),
        expect.objectContaining({ type: 'text', text: 'Ollama reply' }),
        expect.objectContaining({
          type: 'result',
          usage: { inputTokens: 3, outputTokens: 5 },
        }),
      ]);
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
