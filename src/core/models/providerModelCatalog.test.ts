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
      opencode: { backend: 'cli', instance: 'default' },
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
      opencode: {
        default: {
          id: 'default',
          providerName: 'opencode',
          commandConfig: {
            path: 'opencode',
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
      opencode: {
        path: 'opencode',
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

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
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

  it('inspects cached dynamic catalog summaries without triggering another probe', async () => {
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

    await service.getCatalog('ollama');

    expect(service.inspectSummary('ollama')).toEqual({
      source: 'dynamic',
      defaultModel: 'qwen3:latest',
      modelCount: 2,
      warnings: [
        "Configured default model 'qwen3:latest' was not returned by dynamic discovery; added as configured fallback.",
      ],
      statusCounts: {
        configured: 1,
        available: 0,
        running: 1,
        unknown: 0,
      },
      cache: {
        servedFromCache: true,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
    });
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

  it('reuses stale dynamic catalogs when refresh fails after the TTL window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T00:00:00.000Z'));

    try {
      let refreshFailed = false;
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input.url;
        if (refreshFailed) {
          throw new Error('connection refused');
        }

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
      expect(first.source).toBe('dynamic');
      expect(first.cache).toEqual({
        servedFromCache: false,
        cachedAt: '2026-03-27T00:00:00.000Z',
        ttlSec: 60,
      });

      refreshFailed = true;
      vi.setSystemTime(new Date('2026-03-27T00:01:01.000Z'));

      const second = await service.getCatalog('ollama');
      expect(second.source).toBe('dynamic');
      expect(second.cache).toEqual({
        servedFromCache: true,
        cachedAt: '2026-03-27T00:00:00.000Z',
        ttlSec: 60,
        stale: true,
      });
      expect(second.models).toEqual(first.models);
      expect(second.warnings).toEqual([
        "Configured default model 'qwen3:latest' was not returned by dynamic discovery; added as configured fallback.",
        "Dynamic model discovery failed for ollama/local/local: connection refused Serving stale cached catalog from 2026-03-27T00:00:00.000Z.",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bypasses a fresh dynamic cache when forceRefresh is requested', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: fetchMock.mock.calls.length <= 1 ? 'deepseek-r1:14b' : 'qwen2.5-coder:7b' },
          ],
        });
      }

      if (url.endsWith('/api/ps')) {
        return jsonResponse({ models: [] });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
      fetch: fetchMock,
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('ollama');
    expect(first.source).toBe('dynamic');
    expect(first.cache).toEqual(expect.objectContaining({
      servedFromCache: false,
    }));
    expect(first.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'deepseek-r1:14b',
      }),
    ]));

    const refreshed = await service.getCatalog('ollama', undefined, {
      forceRefresh: true,
    });
    expect(refreshed.source).toBe('dynamic');
    expect(refreshed.cache).toEqual(expect.objectContaining({
      servedFromCache: false,
    }));
    expect(refreshed.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'qwen2.5-coder:7b',
      }),
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

  it('adds an honest warning when Cursor still uses the static catalog fallback', async () => {
    const config = {
      ...createCatalogConfig(),
      providerDefaultTargets: {
        cursor: { backend: 'cli', instance: 'default' },
      },
      providerInstances: {
        ...createCatalogConfig().providerInstances,
        cursor: {
          default: {
            id: 'default',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
      },
      providerCommands: {
        ...createCatalogConfig().providerCommands,
        cursor: {
          path: 'cursor-agent',
          runner: 'auto',
          runtime: { mode: 'native' },
        },
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never);

    expect(service.inspectSummary('cursor')).toEqual({
      source: 'static',
      defaultModel: 'gpt-5.4',
      modelCount: 3,
      warnings: [
        'Dynamic model discovery is not available for cursor/cli/default because Cursor does not currently expose a stable model-listing seam to the runtime.',
      ],
      statusCounts: {
        configured: 0,
        available: 0,
        running: 0,
        unknown: 3,
      },
    });
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

  it('loads dynamic OpenCode model catalogs and forwards runtime refresh to the CLI helper', async () => {
    const opencodeModelDiscoveryRunner = {
      run: vi.fn(async (_instance, args: string[]) => ({
        exitCode: 0,
        stdout: args.includes('--refresh')
          ? [
              'anthropic/claude-sonnet-4-5',
              'opencode-go/glm-5',
              'openai/gpt-5.4',
            ].join('\n')
          : [
              'anthropic/claude-sonnet-4-5',
              'opencode-go/glm-5',
            ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };

    const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
      opencodeModelDiscoveryRunner,
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('opencode');
    expect(first).toEqual(expect.objectContaining({
      provider: 'opencode',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'opencode-go/glm-5',
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
        id: 'opencode-go/glm-5',
        label: 'opencode-go/glm-5',
        default: true,
        status: 'available',
      },
    ]);

    const refreshed = await service.getCatalog('opencode', undefined, { forceRefresh: true });
    expect(refreshed.models).toEqual([
      {
        id: 'anthropic/claude-sonnet-4-5',
        label: 'anthropic/claude-sonnet-4-5',
        default: false,
        status: 'available',
      },
      {
        id: 'openai/gpt-5.4',
        label: 'openai/gpt-5.4',
        default: false,
        status: 'available',
      },
      {
        id: 'opencode-go/glm-5',
        label: 'opencode-go/glm-5',
        default: true,
        status: 'available',
      },
    ]);
    expect(vi.mocked(opencodeModelDiscoveryRunner.run)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        providerName: 'opencode',
      }),
      ['models'],
      '/tmp/cats-runtime-sessions',
    );
    expect(vi.mocked(opencodeModelDiscoveryRunner.run)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerName: 'opencode',
      }),
      ['models', '--refresh'],
      '/tmp/cats-runtime-sessions',
    );
  });

  it('loads a dynamic OpenAI catalog when auth is configured and caches the result', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      expect(url).toBe('https://api.openai.test/v1/models');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-openai-key');
      expect(headers.get('OpenAI-Organization')).toBe('test-openai-org');
      expect(headers.get('OpenAI-Project')).toBe('test-openai-project');
      return jsonResponse({
        data: [
          { id: 'gpt-5.4' },
          { id: 'gpt-5.4-mini' },
          { id: 'text-embedding-3-small' },
        ],
      });
    });

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
              organizationEnv: 'OPENAI_ORG_ID',
              projectEnv: 'OPENAI_PROJECT_ID',
              baseUrl: 'https://api.openai.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: createCatalogConfig().remoteProviderCatalog.local,
        agent: createCatalogConfig().remoteProviderCatalog.agent,
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
      env: {
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_ORG_ID: 'test-openai-org',
        OPENAI_PROJECT_ID: 'test-openai-project',
      },
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('codex');
    expect(first).toEqual({
      provider: 'codex',
      backend: 'api',
      instance: 'main',
      defaultModel: 'gpt-5.4',
      source: 'dynamic',
      cache: {
        servedFromCache: false,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
      models: [
        {
          id: 'gpt-5.4',
          label: 'gpt-5.4',
          default: true,
          status: 'available',
        },
        {
          id: 'gpt-5.4-mini',
          label: 'gpt-5.4-mini',
          default: false,
          status: 'available',
        },
      ],
      warnings: [],
    });

    const second = await service.getCatalog('codex');
    expect(second.cache).toEqual({
      servedFromCache: true,
      cachedAt: expect.any(String),
      ttlSec: 60,
    });
    expect(second.models).toEqual(first.models);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to config when remote API model discovery times out', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
    }));

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
              baseUrl: 'https://api.openai.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: createCatalogConfig().remoteProviderCatalog.local,
        agent: createCatalogConfig().remoteProviderCatalog.agent,
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      remoteDiscoveryTimeoutMs: 25,
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('codex');
    expect(catalog).toEqual({
      provider: 'codex',
      backend: 'api',
      instance: 'main',
      defaultModel: 'gpt-5.4',
      source: 'config',
      cache: null,
      models: [
        {
          id: 'gpt-5.4',
          label: 'gpt-5.4',
          default: true,
          status: 'configured',
        },
      ],
      warnings: [
        "Dynamic model discovery failed for codex/api/main: Timed out while listing models from 'https://api.openai.test/v1/models'",
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('inspects bounded API model summaries without triggering remote discovery', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('inspectSummary should not trigger remote discovery');
    });

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
              baseUrl: 'https://api.openai.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: createCatalogConfig().remoteProviderCatalog.local,
        agent: createCatalogConfig().remoteProviderCatalog.agent,
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      ttlMs: 60_000,
    });

    expect(service.inspectSummary('codex')).toEqual({
      source: 'config',
      defaultModel: 'gpt-5.4',
      modelCount: 1,
      warnings: [],
      statusCounts: {
        configured: 1,
        available: 0,
        running: 0,
        unknown: 0,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads paginated Gemini model catalogs through the shared runtime catalog service', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const headers = new Headers(init?.headers);
      expect(headers.get('x-goog-api-key')).toBe('test-gemini-key');
      if (url === 'https://generativelanguage.test/v1beta/models') {
        return jsonResponse({
          models: [
            {
              name: 'models/gemini-2.5-pro',
              displayName: 'Gemini 2.5 Pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-004',
              displayName: 'Text Embedding 004',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
          nextPageToken: 'page-2',
        });
      }

      if (url === 'https://generativelanguage.test/v1beta/models?pageToken=page-2') {
        return jsonResponse({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedGenerationMethods: ['streamGenerateContent'],
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const config = {
      ...createCatalogConfig(),
      providerDefaultTargets: {
        gemini: { backend: 'api', instance: 'pro' },
      },
      remoteProviderCatalog: {
        api: {
          gemini: {
            pro: {
              id: 'pro',
              providerName: 'gemini',
              backend: 'api',
              transport: 'gemini',
              apiKeyEnv: 'GEMINI_API_KEY',
              baseUrlEnv: 'GEMINI_BASE_URL',
              model: 'gemini-2.5-pro',
            },
          },
        },
        local: createCatalogConfig().remoteProviderCatalog.local,
        agent: createCatalogConfig().remoteProviderCatalog.agent,
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
      env: {
        GEMINI_API_KEY: 'test-gemini-key',
        GEMINI_BASE_URL: 'https://generativelanguage.test',
      },
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('gemini');
    expect(catalog).toEqual({
      provider: 'gemini',
      backend: 'api',
      instance: 'pro',
      defaultModel: 'gemini-2.5-pro',
      source: 'dynamic',
      cache: {
        servedFromCache: false,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
      models: [
        {
          id: 'gemini-2.5-pro',
          label: 'Gemini 2.5 Pro',
          default: true,
          status: 'available',
        },
        {
          id: 'gemini-2.5-flash',
          label: 'Gemini 2.5 Flash',
          default: false,
          status: 'available',
        },
      ],
      warnings: [],
    });
  });

  it('keeps API targets on config fallback when remote model discovery auth is not ready', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const config = {
      ...createCatalogConfig(),
      providerDefaultTargets: {
        claude: { backend: 'api', instance: 'sonnet' },
      },
      remoteProviderCatalog: {
        api: {
          claude: {
            sonnet: {
              id: 'sonnet',
              providerName: 'claude',
              backend: 'api',
              transport: 'anthropic',
              apiKeyEnv: 'ANTHROPIC_API_KEY',
              baseUrl: 'https://api.anthropic.test',
              model: 'claude-sonnet-4-6',
            },
          },
        },
        local: createCatalogConfig().remoteProviderCatalog.local,
        agent: createCatalogConfig().remoteProviderCatalog.agent,
      },
    } as const;

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
      env: {},
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('claude');
    expect(catalog).toEqual({
      provider: 'claude',
      backend: 'api',
      instance: 'sonnet',
      defaultModel: 'claude-sonnet-4-6',
      source: 'config',
      cache: null,
      models: [
        {
          id: 'claude-sonnet-4-6',
          label: 'claude-sonnet-4-6',
          default: true,
          status: 'configured',
        },
      ],
      warnings: [
        "Dynamic model discovery skipped for claude/api/sonnet: required x-api-key credentials are not configured via 'ANTHROPIC_API_KEY'.",
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
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

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5.4' },
        ],
      }),
    );

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
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
      source: 'dynamic',
      cache: {
        servedFromCache: false,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
      entries: [
        {
          id: 'gpt-5.4',
          label: 'gpt-5.4',
          default: true,
          status: 'available',
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
