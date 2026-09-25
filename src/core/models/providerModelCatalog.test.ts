import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getStaticProviderModels,
  normalizeProviderCatalogModelId,
  ProviderModelCatalogService,
} from './providerModelCatalog.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from '../../../tests/support/runtimeTestPaths.js';

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

describe('normalizeProviderCatalogModelId', () => {

  it('preserves Junie picker labels as literal model ids', () => {
    expect(normalizeProviderCatalogModelId({
      providerName: 'junie',
      backend: 'cli',
    }, ' Claude Opus 4.7 ')).toBe('Claude Opus 4.7');
    expect(normalizeProviderCatalogModelId({
      providerName: 'junie',
      backend: 'cli',
    }, 'Gemini 3.1 Flash Lite')).toBe('Gemini 3.1 Flash Lite');
    expect(normalizeProviderCatalogModelId({
      providerName: 'junie',
      backend: 'cli',
    }, 'GPT-5.3-codex')).toBe('GPT-5.3-codex');
  });
});

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
    env: { ...createRuntimeTestEnv(process.env.HOME!),
      HOME: root,
      USERPROFILE: root,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createTempDataDir() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-model-catalog-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createRuntimeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-model-catalog-'));
  const paths = createRuntimeTestPaths(root);
  ensureRuntimeTestDirs(paths);
  return {
    root,
    paths,
    env: createRuntimeTestEnv(root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const junieStaticWarning =
  'Junie CLI does not expose a live model list; serving the curated picker snapshot as a static fallback. '
  + "Junie's dynamic Default, BYOK, and custom models are not enumerated here.";

const junieCuratedModels = [
  { id: 'Gemini 3 Flash', label: 'Gemini 3 Flash', default: true },
  { id: 'Claude Opus 4.6', label: 'Claude Opus 4.6' },
  { id: 'Claude Opus 4.7', label: 'Claude Opus 4.7' },
  { id: 'Claude Sonnet 4.6', label: 'Claude Sonnet 4.6' },
  { id: 'Gemini 3.1 Flash Lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'Gemini 3.1 Pro Preview', label: 'Gemini 3.1 Pro Preview' },
  { id: 'GPT-5', label: 'GPT-5' },
  { id: 'GPT-5.2', label: 'GPT-5.2' },
  { id: 'GPT-5.3-codex', label: 'GPT-5.3-codex' },
  { id: 'GPT-5.4', label: 'GPT-5.4' },
  { id: 'Grok 4.1 Fast Reasoning', label: 'Grok 4.1 Fast Reasoning' },
];

const junieCuratedAdvancedEntries = [
  {
    id: 'Gemini 3 Flash',
    label: 'Gemini 3 Flash',
    default: true,
    capabilityTags: ['latency_optimized'],
  },
  {
    id: 'Claude Opus 4.6',
    label: 'Claude Opus 4.6',
    default: false,
    capabilityTags: ['reasoning'],
  },
  {
    id: 'Claude Opus 4.7',
    label: 'Claude Opus 4.7',
    default: false,
    capabilityTags: ['reasoning'],
  },
  {
    id: 'Claude Sonnet 4.6',
    label: 'Claude Sonnet 4.6',
    default: false,
  },
  {
    id: 'Gemini 3.1 Flash Lite',
    label: 'Gemini 3.1 Flash Lite',
    default: false,
    capabilityTags: ['latency_optimized'],
  },
  {
    id: 'Gemini 3.1 Pro Preview',
    label: 'Gemini 3.1 Pro Preview',
    default: false,
    capabilityTags: ['reasoning'],
  },
  {
    id: 'GPT-5',
    label: 'GPT-5',
    default: false,
  },
  {
    id: 'GPT-5.2',
    label: 'GPT-5.2',
    default: false,
  },
  {
    id: 'GPT-5.3-codex',
    label: 'GPT-5.3-codex',
    default: false,
  },
  {
    id: 'GPT-5.4',
    label: 'GPT-5.4',
    default: false,
    capabilityTags: ['reasoning'],
  },
  {
    id: 'Grok 4.1 Fast Reasoning',
    label: 'Grok 4.1 Fast Reasoning',
    default: false,
    capabilityTags: ['reasoning'],
  },
];

describe('ProviderModelCatalogService', () => {
  it('serves the model id verified by the authenticated Grok model-list probe', () => {
    const base = createCatalogConfig();
    const config = {
      ...base,
      providerDefaultTargets: {
        ...base.providerDefaultTargets,
        grok: { backend: 'cli', instance: 'native' },
      },
      providerInstances: {
        ...base.providerInstances,
        grok: {
          native: {
            id: 'native',
            providerName: 'grok',
            commandConfig: {
              path: 'grok',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
      },
      providerCommands: {
        ...base.providerCommands,
        grok: {
          path: 'grok',
          runner: 'auto',
          runtime: { mode: 'native' },
        },
      },
    } as const;

    const catalog = new ProviderModelCatalogService(config as never).getImmediateCatalog('grok');

    expect(catalog.models).toEqual([
      {
        id: 'grok-4.7',
        label: 'Grok 4.7',
      },
      {
        id: 'grok-4.7-build-fast',
        label: 'Grok 4.7 Fast',
      },
      {
        id: 'grok-4.6',
        label: 'Grok 4.6',
      },
      {
        id: 'grok-4.5',
        label: 'Grok 4.5',
      },
    ]);
    // 1.0.41 `grok models` marks grok-4.7 (default), but that line no longer
    // matches the saved config default. Session markers are not catalog defaults.
    expect(catalog.defaultModel).toBeNull();
    expect(catalog.models.some((model) => model.default)).toBe(false);
    expect(catalog.warnings).toEqual([]);
  });

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
    expect(first).toMatchObject({
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
    expect(second.cache).toMatchObject({
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

    expect(service.inspectSummary('ollama')).toMatchObject({
      source: 'dynamic',
      defaultModel: 'qwen3:latest',
      defaultModelStatus: 'configured',
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
      expect(first.cache).toMatchObject({
        servedFromCache: false,
        cachedAt: '2026-03-27T00:00:00.000Z',
        ttlSec: 60,
      });

      refreshFailed = true;
      vi.setSystemTime(new Date('2026-03-27T00:01:01.000Z'));

      const second = await service.getCatalog('ollama');
      expect(second.source).toBe('dynamic');
      expect(second.cache).toMatchObject({
        servedFromCache: true,
        cachedAt: '2026-03-27T00:00:00.000Z',
        ttlSec: 60,
        stale: true,
        backoff: {
          active: true,
          consecutiveFailures: 1,
          lastFailureAt: '2026-03-27T00:01:01.000Z',
          nextRefreshAllowedAt: '2026-03-27T00:02:01.000Z',
          reason: 'Dynamic model discovery failed for ollama/local/local: connection refused',
        },
      });
      expect(second.models).toEqual(first.models);
      expect(second.warnings).toEqual([
        "Configured default model 'qwen3:latest' was not returned by dynamic discovery; added as configured fallback.",
        "Dynamic model discovery failed for ollama/local/local: connection refused Serving stale cached catalog from 2026-03-27T00:00:00.000Z.",
        'Dynamic model discovery backoff is active for ollama/local/local until 2026-03-27T00:02:01.000Z after 1 failure(s): Dynamic model discovery failed for ollama/local/local: connection refused',
      ]);

      const third = await service.getCatalog('ollama');
      expect(third.cache).toEqual(second.cache);
      expect(third.warnings).toEqual([
        'Dynamic model discovery backoff is active for ollama/local/local until 2026-03-27T00:02:01.000Z after 1 failure(s): Dynamic model discovery failed for ollama/local/local: connection refused',
        "Configured default model 'qwen3:latest' was not returned by dynamic discovery; added as configured fallback.",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses persisted dynamic snapshots after restart without re-probing', async () => {
    const dataDir = createTempDataDir();

    try {
      const config = {
        ...createCatalogConfig(),
        dataDir: dataDir.root,
      } as const;
      const firstFetch = vi.fn<typeof fetch>(async (input) => {
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

      const firstService = new ProviderModelCatalogService(config as never, {
        fetch: firstFetch,
        ttlMs: 60_000,
      });

      const first = await firstService.getCatalog('ollama');
      expect(first.source).toBe('dynamic');
      expect(firstFetch).toHaveBeenCalledTimes(2);

      const secondFetch = vi.fn<typeof fetch>(async () => {
        throw new Error('restart should use persisted snapshot');
      });
      const secondService = new ProviderModelCatalogService(config as never, {
        fetch: secondFetch,
        ttlMs: 60_000,
      });

      const second = await secondService.getCatalog('ollama');
      expect(second).toMatchObject({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen3:latest',
        source: 'dynamic',
        cache: {
          servedFromCache: true,
          cachedAt: expect.any(String),
          ttlSec: 60,
          persisted: true,
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
      expect(secondFetch).not.toHaveBeenCalled();
    } finally {
      dataDir.cleanup();
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

  it('keeps the curated Goose shortlist independent of the active provider config', async () => {
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
      expect(catalog).toMatchObject({
        provider: 'goose',
        backend: 'cli',
        instance: 'default',
        defaultModel: null,
        source: 'static',
        cache: null,
        models: [
          { id: 'chatgpt_codex/gpt-5.6-sol', label: 'gpt-5.6-sol — Off' },
          { id: 'chatgpt_codex/gpt-5.6-terra', label: 'gpt-5.6-terra — Off' },
          { id: 'chatgpt_codex/gpt-5.6-luna', label: 'gpt-5.6-luna — Off' },
          { id: 'chatgpt_codex/gpt-5.6', label: 'gpt-5.6 — Off' },
          { id: 'chatgpt_codex/gpt-5.5', label: 'gpt-5.5 — Off' },
          { id: 'chatgpt_codex/gpt-5.4', label: 'gpt-5.4 — Off' },
        ],
        warnings: [],
      });
    } finally {
      cleanup();
    }
  });

  it('falls back to the bundled Junie curated catalog when the runtime YAML is absent', () => {
    const runtime = createRuntimeRoot();

    try {
      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          junie: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          junie: {
            default: {
              id: 'default',
              providerName: 'junie',
              commandConfig: {
                path: 'junie',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          junie: {
            path: 'junie',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('junie')).toMatchObject({
        provider: 'junie',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'Gemini 3.7 Flash',
        source: 'static',
        models: [
          { id: 'Gemini 3.7 Flash', label: 'Gemini 3.7 Flash — Medium', default: true },
          { id: 'Claude Fable 5.1', label: 'Claude Fable 5.1 — Low' },
          { id: 'Gemini 3.8 Flash', label: 'Gemini 3.8 Flash — Medium' },
          { id: 'GPT-5.6-SOL', label: 'GPT-5.6-SOL — Low' },
          { id: 'Grok 4.6', label: 'Grok 4.6 — Low' },
        ],
        warnings: [],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('serves the bundled Cursor shortlist without promising upstream expansion', async () => {
    const runtime = createRuntimeRoot();

    try {
      const config = {
        ...createCatalogConfig(),
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
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

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });
      const cursorCatalog = service.getImmediateCatalog('cursor');
      expect(cursorCatalog).not.toBeNull();
      if (!cursorCatalog) {
        throw new Error('Expected Cursor static catalog to be available.');
      }
      const cursorStaticModelCount = cursorCatalog.models.length;

      expect(service.inspectSummary('cursor')).toMatchObject({
        source: 'static',
        defaultModel: null,
        modelCount: cursorStaticModelCount,
        warnings: [],
        statusCounts: {
          configured: 0,
          available: 0,
          running: 0,
          unknown: cursorStaticModelCount,
        },
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('loads dynamic Cursor model catalogs through cursor-agent --list-models', async ({ onTestFinished }) => {
    const runtime = createRuntimeRoot();
    onTestFinished(runtime.cleanup);
    // Exercise discovery without an opted-in shortlist, independent of the
    // bundled policy and the developer's personal catalog.
    writeFileSync(runtime.paths.curatedModelCatalogPath, JSON.stringify({schema_version:2,catalogs:['cursor','pi','opencode'].map(provider=>({provider,backend:'cli',selection_mode:'discovery',models:[]}))}));
    const cursorModelDiscoveryRunner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: [
          'Loading models…',
          'Available models',
          '',
          'auto - Auto',
          'gpt-5.4-medium - GPT-5.4 1M',
          'claude-4.6-opus-high-thinking - Opus 4.6 1M Thinking  (default)',
          'gpt-5.4-xhigh - GPT-5.4 1M Extra High  (current)',
          '',
          'Tip: use --model <id> to switch.',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };

    const config = {
      ...createCatalogConfig(),
      configPath: runtime.paths.configPath,
      sessionBaseDir: runtime.paths.sessionBaseDir,
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

    const service = new ProviderModelCatalogService(config as never, {
      cursorModelDiscoveryRunner,
      env: runtime.env,
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('cursor', undefined, { forceRefresh: true });
    expect(catalog).toEqual(expect.objectContaining({
      provider: 'cursor',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'claude-4.6-opus-high-thinking',
      source: 'dynamic',
      cache: {
        servedFromCache: false,
        cachedAt: expect.any(String),
        ttlSec: 60,
      },
      warnings: [],
    }));
    expect(catalog.models).toEqual([
      {
        id: 'auto',
        label: 'Auto',
        status: 'available',
      },
      {
        id: 'gpt-5.4-medium',
        label: 'GPT-5.4 1M',
        status: 'available',
      },
      {
        id: 'claude-4.6-opus-high-thinking',
        label: 'Opus 4.6 1M Thinking',
        default: true,
        status: 'available',
      },
      {
        id: 'gpt-5.4-xhigh',
        label: 'GPT-5.4 1M Extra High',
        status: 'available',
      },
    ]);
    expect(vi.mocked(cursorModelDiscoveryRunner.run)).toHaveBeenCalledTimes(1);
  });

  it('loads dynamic Pi model catalogs through the shared runtime catalog service', async ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-pi-dynamic-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    // Test unrestricted discovery independently of the bundled shortlist.
    writeFileSync(paths.curatedModelCatalogPath, JSON.stringify({schema_version:2,catalogs:['cursor','pi','opencode'].map(provider=>({provider,backend:'cli',selection_mode:'discovery',models:[]}))}));
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
      env: createRuntimeTestEnv(root),
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('pi');
    expect(first).toEqual(expect.objectContaining({
      provider: 'pi',
      backend: 'cli',
      instance: 'default',
      defaultModel: null,
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
        status: 'available',
      },
      {
        id: 'openai-codex/gpt-5.4',
        label: 'openai-codex/gpt-5.4',
        status: 'available',
      },
    ]);

    const second = await service.getCatalog('pi');
    expect(second.cache).toMatchObject({
      servedFromCache: true,
      cachedAt: expect.any(String),
      ttlSec: 60,
    });
    expect(second.models).toEqual(first.models);
    expect(vi.mocked(piModelDiscoveryRunner.run)).toHaveBeenCalledTimes(1);
  });

  it('loads dynamic OpenCode model catalogs and forwards runtime refresh to the CLI helper', async ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-opencode-dynamic-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    // Explicitly exercise an installation without a curated shortlist.
    writeFileSync(paths.curatedModelCatalogPath, JSON.stringify({schema_version:2,catalogs:['cursor','pi','opencode'].map(provider=>({provider,backend:'cli',selection_mode:'discovery',models:[]}))}));
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
      env: createRuntimeTestEnv(root),
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('opencode');
    expect(first).toEqual(expect.objectContaining({
      provider: 'opencode',
      backend: 'cli',
      instance: 'default',
      defaultModel: null,
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
        status: 'available',
      },
      {
        id: 'opencode-go/glm-5',
        label: 'opencode-go/glm-5',
        status: 'available',
      },
    ]);

    const refreshed = await service.getCatalog('opencode', undefined, { forceRefresh: true });
    expect(refreshed.models).toEqual([
      {
        id: 'anthropic/claude-sonnet-4-5',
        label: 'anthropic/claude-sonnet-4-5',
        status: 'available',
      },
      {
        id: 'openai/gpt-5.4',
        label: 'openai/gpt-5.4',
        status: 'available',
      },
      {
        id: 'opencode-go/glm-5',
        label: 'opencode-go/glm-5',
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

  it('returns an immediate snapshot without invoking slow dynamic discovery runners', ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-immediate-catalog-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const piModelDiscoveryRunner = {
      run: vi.fn(async () => {
        throw new Error('dynamic discovery should not run');
      }),
    };
    const opencodeModelDiscoveryRunner = {
      run: vi.fn(async () => {
        throw new Error('dynamic discovery should not run');
      }),
    };

    const service = new ProviderModelCatalogService(createCatalogConfig() as never, {
      piModelDiscoveryRunner,
      env: createRuntimeTestEnv(root),
      opencodeModelDiscoveryRunner,
    });

    expect(service.getImmediateCatalog('pi')).toMatchObject({
      provider: 'pi', backend: 'cli', instance: 'default',
      defaultModel: null, source: 'static', cache: null,
      models: getStaticProviderModels({ providerName: 'pi', backend: 'cli' }),
      warnings: [],
    });
    expect(service.getImmediateCatalog('opencode')).toMatchObject({
      provider: 'opencode', backend: 'cli', instance: 'default',
      defaultModel: null, source: 'static', cache: null,
      models: getStaticProviderModels({ providerName: 'opencode', backend: 'cli' }),
      warnings: [],
    });
    expect(piModelDiscoveryRunner.run).not.toHaveBeenCalled();
    expect(opencodeModelDiscoveryRunner.run).not.toHaveBeenCalled();
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
      env: { ...createRuntimeTestEnv(process.env.HOME!),
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_ORG_ID: 'test-openai-org',
        OPENAI_PROJECT_ID: 'test-openai-project',
      },
      ttlMs: 60_000,
    });

    const first = await service.getCatalog('codex');
    expect(first).toMatchObject({
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
    expect(second.cache).toMatchObject({
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
      env: { ...createRuntimeTestEnv(process.env.HOME!),
        OPENAI_API_KEY: 'test-openai-key',
      },
      remoteDiscoveryTimeoutMs: 25,
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('codex');
    expect(catalog).toMatchObject({
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
        expect.stringContaining(
          'Dynamic model discovery backoff is active for codex/api/main until ',
        ),
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
      env: { ...createRuntimeTestEnv(process.env.HOME!),
        OPENAI_API_KEY: 'test-openai-key',
      },
      ttlMs: 60_000,
    });

    expect(service.inspectSummary('codex')).toMatchObject({
      source: 'config',
      defaultModel: 'gpt-5.4',
      defaultModelStatus: 'configured',
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
      env: { ...createRuntimeTestEnv(process.env.HOME!),
        GEMINI_API_KEY: 'test-gemini-key',
        GEMINI_BASE_URL: 'https://generativelanguage.test',
      },
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('gemini');
    expect(catalog).toMatchObject({
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
      env: { ...createRuntimeTestEnv(process.env.HOME!),},
      ttlMs: 60_000,
    });

    const catalog = await service.getCatalog('claude');
    expect(catalog).toMatchObject({
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
});
