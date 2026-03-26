import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProviderModelCatalogService } from './providerModelCatalog.js';

function createCatalogConfig() {
  return {
    providerDefaultTargets: {
      ollama: { backend: 'local', instance: 'local' },
      codex: { backend: 'agent', instance: 'bridge' },
      goose: { backend: 'cli', instance: 'default' },
      pi: { backend: 'cli', instance: 'default' },
    },
    providerDefaultInstances: {},
    providerInstances: {
      goose: {
        default: {
          id: 'default',
          providerName: 'goose',
          commandConfig: {
            path: 'goose',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      },
      pi: {
        default: {
          id: 'default',
          providerName: 'pi',
          commandConfig: {
            path: 'pi',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      },
    },
    providerCommands: {
      goose: {
        path: 'goose',
        runner: 'auto',
        runtime: { mode: 'native' },
      },
      pi: {
        path: 'pi',
        runner: 'auto',
        runtime: { mode: 'native' },
      },
    },
    sessionBaseDir: '/tmp/cats-runtime-sessions',
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

function createGooseConfigRoot(content: string) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-goose-models-'));
  const gooseConfigPath = join(root, '.config', 'goose', 'config.yaml');
  mkdirSync(join(root, '.config', 'goose'), { recursive: true });
  writeFileSync(gooseConfigPath, content);

  return {
    root,
    gooseConfigPath,
    env: {
      HOME: root,
      USERPROFILE: root,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
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

  it('uses runtime-owned Goose config as the default-model hint for CLI catalogs', async () => {
    const { env, cleanup } = createGooseConfigRoot([
      'GOOSE_PROVIDER: anthropic',
      'GOOSE_MODEL: claude-sonnet-4-5',
      '',
    ].join('\n'));

    try {
      const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
        env,
      });

      const catalog = await service.getCatalog('goose');
      expect(catalog).toEqual({
        provider: 'goose',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'anthropic/claude-sonnet-4-5',
        source: 'static',
        cache: null,
        models: [
          {
            id: 'anthropic/claude-sonnet-4-5',
            label: 'anthropic/claude-sonnet-4-5',
            default: true,
            status: 'configured',
          },
          {
            id: 'openai/gpt-5-codex',
            label: 'openai/gpt-5-codex',
          },
          {
            id: 'openai/gpt-5',
            label: 'openai/gpt-5',
          },
        ],
        warnings: [],
      });
    } finally {
      cleanup();
    }
  });

  it('loads dynamic Pi model catalogs through the shared runtime catalog service', async () => {
    const piModelDiscoveryRunner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: [
          'provider    model',
          'openai-codex  gpt-5.4',
          'anthropic     claude-sonnet-4-5',
          '',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };

    const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
      piModelDiscoveryRunner,
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('pi');
    expect(first).toEqual(expect.objectContaining({
      provider: 'pi',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'openai-codex/gpt-5.4',
      source: 'dynamic',
      cache: {
        servedFromCache: false,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
      warnings: [],
    }));
    expect(first.models).toEqual([
      {
        id: 'anthropic/claude-sonnet-4-5',
        label: 'anthropic/claude-sonnet-4-5',
        default: false,
        status: 'available',
      },
      {
        id: 'openai-codex/gpt-5.4',
        label: 'openai-codex/gpt-5.4',
        default: true,
        status: 'available',
      },
    ]);

    const second = await service.getCatalog('pi');
    expect(second.cache).toEqual({
      servedFromCache: true,
      cachedAt: expect.any(String),
      ttlSec: 60,
    });
    expect(second.models).toEqual(first.models);
    expect(vi.mocked(piModelDiscoveryRunner.run)).toHaveBeenCalledTimes(1);
  });

  it('builds an additive advanced catalog with presets and controls for OpenAI targets', async () => {
    const config = {
      ...createCatalogConfig(),
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: createCatalogConfig().remoteProviderCatalog.local,
        agent: {},
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never, {
      env: {
        OPENAI_API_KEY: 'test-key',
      },
    });

    const catalog = await service.getAdvancedCatalog('codex');
    expect(catalog).toEqual({
      provider: 'codex',
      backend: 'api',
      instance: 'main',
      defaultModel: 'gpt-5.4',
      source: 'config',
      cache: null,
      entries: [
        {
          id: 'gpt-5.4',
          label: 'gpt-5.4',
          default: true,
          status: 'configured',
          capabilityTags: ['tool_use', 'reasoning'],
        },
      ],
      presets: [
        {
          id: 'balanced',
          label: 'Balanced',
          availability: 'supported',
          applicableEntryIds: ['gpt-5.4'],
          preferredEntryId: 'gpt-5.4',
          controlDefaults: {
            'openai.reasoning_effort': 'medium',
          },
        },
        {
          id: 'fast',
          label: 'Fast',
          availability: 'supported',
          applicableEntryIds: ['gpt-5.4'],
          preferredEntryId: 'gpt-5.4',
          controlDefaults: {
            'openai.reasoning_effort': 'low',
          },
        },
        {
          id: 'deep_reasoning',
          label: 'Deep reasoning',
          availability: 'supported',
          applicableEntryIds: ['gpt-5.4'],
          preferredEntryId: 'gpt-5.4',
          controlDefaults: {
            'openai.reasoning_effort': 'high',
          },
        },
      ],
      controls: [{
        key: 'openai.reasoning_effort',
        label: 'Reasoning effort',
        description: 'Controls OpenAI reasoning effort for supported GPT-5 entries.',
        kind: 'enum',
        scope: 'both',
        values: ['low', 'medium', 'high'],
        applicableEntryIds: ['gpt-5.4'],
        semanticTags: ['reasoning_intensity'],
      }],
      defaultSelection: {
        entryId: 'gpt-5.4',
        entryMode: 'auto',
        presetId: 'balanced',
        controls: {
          'openai.reasoning_effort': 'medium',
        },
      },
      support: {
        tier: 'full',
      },
      warnings: [],
    });
  });
});
