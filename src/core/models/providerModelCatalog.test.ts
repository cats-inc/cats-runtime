import { describe, expect, it, vi } from 'vitest';
import { ProviderModelCatalogService } from './providerModelCatalog.js';

function createCatalogConfig() {
  return {
    providerDefaultTargets: {
      ollama: { backend: 'local', instance: 'local' },
      codex: { backend: 'agent', instance: 'bridge' },
    },
    providerDefaultInstances: {},
    providerInstances: {},
    providerCommands: {},
    remoteProviderCatalog: {
      api: {},
      local: {
        ollama: {
          local: {
            id: 'local',
            providerName: 'ollama',
            backend: 'local',
            transport: 'ollama',
            baseUrl: 'http://127.0.0.1:11434',
            model: 'qwen3:latest',
          },
        },
      },
      agent: {
        codex: {
          bridge: {
            id: 'bridge',
            providerName: 'codex',
            backend: 'agent',
            transport: 'agent_sdk_bridge',
            baseUrl: 'http://127.0.0.1:8082',
            model: 'gpt-5.4',
          },
        },
      },
    },
  } as const;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('ProviderModelCatalogService', () => {
  it('marks running Ollama models, injects missing configured defaults, and caches warnings', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'deepseek-r1:14b' },
          ],
        });
      }

      if (url.endsWith('/api/ps')) {
        return jsonResponse({
          models: [
            { name: 'deepseek-r1:14b' },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
      fetch: fetchMock,
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('ollama');
    expect(first).toEqual({
      provider: 'ollama',
      backend: 'local',
      instance: 'local',
      defaultModel: 'qwen3:latest',
      source: 'dynamic',
      cache: {
        servedFromCache: false,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
      models: [
        {
          id: 'qwen3:latest',
          label: 'qwen3:latest',
          default: true,
          status: 'configured',
        },
        {
          id: 'deepseek-r1:14b',
          label: 'deepseek-r1:14b',
          status: 'running',
        },
      ],
      warnings: [
        "Configured default model 'qwen3:latest' was not returned by dynamic discovery; added as configured fallback.",
      ],
    });

    const second = await service.getCatalog('ollama');
    expect(second.cache).toEqual({
      servedFromCache: true,
      cachedAt: expect.any(String),
      ttlSec: 60,
    });
    expect(second.models).toEqual(first.models);
    expect(second.warnings).toEqual(first.warnings);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps dynamic Ollama discovery when the running-model probe fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'qwen3:latest' },
          ],
        });
      }

      if (url.endsWith('/api/ps')) {
        return jsonResponse({ error: 'unavailable' }, 503);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
      fetch: fetchMock,
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('ollama');
    expect(catalog.source).toBe('dynamic');
    expect(catalog.models).toEqual([
      {
        id: 'qwen3:latest',
        label: 'qwen3:latest',
        default: true,
        status: 'available',
      },
    ]);
    expect(catalog.warnings).toEqual([
      'Ollama running-model probe failed with status 503',
    ]);
  });
});
