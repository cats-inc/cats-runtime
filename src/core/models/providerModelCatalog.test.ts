import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
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
  it('does not treat default as a Claude opus alias', () => {
    expect(normalizeProviderCatalogModelId({
      providerName: 'claude',
      backend: 'cli',
    }, 'default')).toBe('default');
    expect(normalizeProviderCatalogModelId({
      providerName: 'claude',
      backend: 'cli',
    }, 'claude-opus-4-6')).toBe('opus');
  });

  it('normalizes Kilo picker labels to canonical gateway ids', () => {
    expect(normalizeProviderCatalogModelId({
      providerName: 'kilo',
      backend: 'cli',
    }, 'OpenAI: GPT-5.4')).toBe('kilo/openai/gpt-5.4');
    expect(normalizeProviderCatalogModelId({
      providerName: 'kilo',
      backend: 'cli',
    }, 'Elephant (new)')).toBe('kilo/openrouter/elephant-alpha');
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
    env: {
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
      expect(second).toEqual({
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

  it('serves an honest curated Junie alias fallback when live discovery is unavailable', () => {
    const base = createCatalogConfig();
    const config = {
      ...base,
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

    const service = new ProviderModelCatalogService(config as never);

    expect(service.getImmediateCatalog('junie')).toEqual({
      provider: 'junie',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'gpt',
      source: 'static',
      cache: null,
      models: [
        { id: 'gpt', label: 'gpt', default: true },
        { id: 'gpt-codex', label: 'gpt-codex', default: false },
        { id: 'sonnet', label: 'sonnet', default: false },
        { id: 'opus', label: 'opus', default: false },
        { id: 'gemini-pro', label: 'gemini-pro', default: false },
        { id: 'gemini-flash', label: 'gemini-flash', default: false },
        { id: 'grok', label: 'grok', default: false },
      ],
      warnings: [
        'Junie CLI does not expose a live model list; serving a curated alias fallback only. '
        + "Junie's dynamic Default, BYOK, and custom models are not enumerated here.",
      ],
    });
  });

  it('adds an honest warning when Cursor is still serving the curated static fallback', async () => {
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

      expect(service.inspectSummary('cursor')).toEqual({
        source: 'static',
        defaultModel: 'composer-2-fast',
        modelCount: cursorStaticModelCount,
        warnings: [
          'Live model discovery is available for cursor/cli/default via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
        ],
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

  it('loads dynamic Cursor model catalogs through cursor-agent --list-models', async () => {
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

  it('returns an immediate snapshot without invoking slow dynamic discovery runners', () => {
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
      opencodeModelDiscoveryRunner,
    });

    expect(service.getImmediateCatalog('pi')).toEqual({
      provider: 'pi',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'openai-codex/gpt-5.4',
      source: 'static',
      cache: null,
      models: [
        {
          id: 'openai-codex/gpt-5.4',
          label: 'openai-codex/gpt-5.4',
          default: true,
        },
      ],
      warnings: [],
    });
    expect(service.getImmediateCatalog('opencode')).toEqual({
      provider: 'opencode',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'opencode-go/glm-5',
      source: 'static',
      cache: null,
      models: [
        {
          id: 'opencode-go/glm-5',
          label: 'glm-5',
          default: true,
        },
        {
          id: 'opencode-go/kimi-k2.5',
          label: 'kimi k2.5',
          default: false,
        },
        {
          id: 'opencode-go/minimax-m2.5',
          label: 'minimax m2.5',
          default: false,
        },
      ],
      warnings: [],
    });
    expect(piModelDiscoveryRunner.run).not.toHaveBeenCalled();
    expect(opencodeModelDiscoveryRunner.run).not.toHaveBeenCalled();
  });

  it('builds an immediate advanced catalog without probing verified remote providers', () => {
    const config = {
      ...createCatalogConfig(),
      providerDefaultTargets: {
        ...createCatalogConfig().providerDefaultTargets,
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
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('dynamic discovery should not run');
    });

    const service = new ProviderModelCatalogService(config as never, {
      fetch: fetchMock,
      env: {
        OPENAI_API_KEY: 'test-key',
      },
    });

    expect(service.getImmediateAdvancedCatalog('codex')).toEqual({
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
      controls: [
        {
          key: 'openai.reasoning_effort',
          label: 'Reasoning effort',
          description: 'Controls OpenAI reasoning effort for supported GPT-5 entries.',
          kind: 'enum',
          scope: 'both',
          values: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ],
          applicableEntryIds: ['gpt-5.4'],
          semanticTags: ['reasoning_intensity'],
        },
      ],
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
        advancedMetadataStatus: 'verified_manifest',
        discoveryMode: 'manual_refresh',
        provenance: {
          status: 'verified_manifest',
          manifestId: 'codex-api-openai-v1',
          manifestVersion: '2026-04-07',
          evidenceRefs: [
            'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-api-openai-v1',
          ],
        },
      },
      warnings: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      ttlMs: 60_000,
    });

    expect(service.inspectSummary('codex')).toEqual({
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

  it('applies curated Claude CLI metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Claude',
        '    version: 2.1.96',
        '    last_updated: 2026-04-08',
        '    models:',
        '      - name: Opus',
        '        label: Opus 4.6 with 1M context',
        '        default: true',
        '        context: 1000000',
        '        max_output: 32000',
        '        notes:',
        '          - Most capable for complex work.',
        '        options:',
        '          - name: Effort',
        '            values:',
        '              - name: Low',
        '                notes:',
        '                  - Lighter reasoning for faster responses.',
        '              - name: Medium',
        '                notes:',
        '                  - Balanced effort for most work.',
        '              - name: High',
        '                notes:',
        '                  - Greater depth for complex tasks.',
        '              - name: Max',
        '                notes:',
        '                  - Maximum effort for the most complex work.',
        '            default: Medium',
        '      - name: Sonnet',
        '        label: Sonnet 4.6',
        '        notes:',
        '          - Best for everyday tasks.',
        '        options:',
        '          - name: Effort',
        '            values: [Low, Medium, High]',
        '            default: Medium',
        '      - name: Haiku',
        '        label: Haiku 4.5',
        '        notes:',
        '          - Fastest for quick answers.',
        '        options: []',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          claude: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          claude: {
            default: {
              id: 'default',
              providerName: 'claude',
              commandConfig: {
                path: 'claude',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          claude: {
            path: 'claude',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('claude')).toEqual({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'opus',
        source: 'static',
        cache: null,
        models: [
          { id: 'opus', label: 'Opus 4.6 with 1M context', default: true },
          { id: 'sonnet', label: 'Sonnet 4.6', default: false },
          { id: 'haiku', label: 'Haiku 4.5', default: false },
        ],
        warnings: [],
      });
      expect(service.getImmediateAdvancedCatalog('claude')).toEqual({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'opus',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'opus',
            label: 'Opus 4.6 with 1M context',
            default: true,
            capabilityTags: ['tool_use', 'reasoning'],
            limits: {
              contextWindowTokens: 1000000,
              maxOutputTokens: 32000,
            },
            notes: ['Most capable for complex work.'],
          },
          {
            id: 'sonnet',
            label: 'Sonnet 4.6',
            default: false,
            capabilityTags: ['tool_use'],
            notes: ['Best for everyday tasks.'],
          },
          {
            id: 'haiku',
            label: 'Haiku 4.5',
            default: false,
            capabilityTags: ['tool_use', 'latency_optimized'],
            notes: ['Fastest for quick answers.'],
          },
        ],
        presets: [],
        controls: [
          {
            key: 'claude.reasoning_effort',
            label: 'Reasoning effort',
            description: 'Controls Claude Code effort for supported models.',
            kind: 'enum',
            scope: 'both',
            values: [
              {
                value: 'low',
                label: 'Low',
                description: 'Lighter reasoning for faster responses.',
                applicableEntryIds: ['opus', 'sonnet'],
              },
              {
                value: 'medium',
                label: 'Medium (default)',
                description: 'Balanced effort for most work.',
                applicableEntryIds: ['opus', 'sonnet'],
              },
              {
                value: 'high',
                label: 'High',
                description: 'Greater depth for complex tasks.',
                applicableEntryIds: ['opus', 'sonnet'],
              },
              {
                value: 'max',
                label: 'Max',
                description: 'Maximum effort for the most complex work.',
                applicableEntryIds: ['opus'],
              },
            ],
            applicableEntryIds: ['opus', 'sonnet'],
            semanticTags: ['reasoning_intensity'],
          },
        ],
        defaultSelection: {
          entryId: 'opus',
          entryMode: 'explicit',
          controls: {
            'claude.reasoning_effort': 'medium',
          },
        },
        support: {
          tier: 'full',
          advancedMetadataStatus: 'verified_manifest',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'verified_manifest',
            manifestId: 'claude-cli-v1',
            manifestVersion: '2026-04-07',
            evidenceRefs: [
              'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#claude-cli-v1',
            ],
          },
        },
        warnings: [],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Claude CLI xHigh effort defaults from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Claude',
        '    version: 2.1.111',
        '    last_updated: 2026-04-17',
        '    models:',
        '      - name: Opus',
        '        label: Opus 4.7 with 1M context',
        '        default: true',
        '        options:',
        '          - name: Effort',
        '            values:',
        '              - name: Low',
        '              - name: High',
        '              - name: xHigh',
        '                notes:',
        '                  - Deeper reasoning than high, just below maximum.',
        '              - name: Max',
        '            default: xHigh',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          claude: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          claude: {
            default: {
              id: 'default',
              providerName: 'claude',
              commandConfig: {
                path: 'claude',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          claude: {
            path: 'claude',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      const advanced = service.getImmediateAdvancedCatalog('claude');
      expect(advanced).not.toBeNull();
      if (!advanced) {
        throw new Error('Expected Claude advanced catalog to be available.');
      }

      expect(advanced.controls).toEqual([
        {
          key: 'claude.reasoning_effort',
          label: 'Reasoning effort',
          description: 'Controls Claude Code effort for supported models.',
          kind: 'enum',
          scope: 'both',
          values: [
            {
              value: 'low',
              label: 'Low',
              description: 'Lighter reasoning for faster responses.',
              applicableEntryIds: ['opus'],
            },
            {
              value: 'high',
              label: 'High',
              description: 'Greater depth for complex tasks.',
              applicableEntryIds: ['opus'],
            },
            {
              value: 'xhigh',
              label: 'xHigh (default)',
              description: 'Deeper reasoning than high, just below maximum.',
              applicableEntryIds: ['opus'],
            },
            {
              value: 'max',
              label: 'Max',
              description: 'Maximum effort for the most complex work.',
              applicableEntryIds: ['opus'],
            },
          ],
          applicableEntryIds: ['opus'],
          semanticTags: ['reasoning_intensity'],
        },
      ]);
      expect(advanced.defaultSelection).toEqual({
        entryId: 'opus',
        entryMode: 'explicit',
        controls: {
          'claude.reasoning_effort': 'xhigh',
        },
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Codex CLI effort metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Codex',
        '    version: 0.118.0',
        '    last_updated: 2026-04-08',
        '    shared_options:',
        '      - name: Reasoning Level',
        '        values: [Low, Medium, High, Extra High]',
        '        default: Medium',
        '    models:',
        '      - name: gpt-5.4',
        '        label: gpt-5.4',
        '        default: true',
        '      - name: gpt-5.2-codex',
        '        label: gpt-5.2-codex',
        '      - name: gpt-5.1-codex-max',
        '        label: gpt-5.1-codex-max',
        '      - name: gpt-5.4-mini',
        '        label: gpt-5.4-mini',
        '      - name: gpt-5.3-codex',
        '        label: gpt-5.3-codex',
        '      - name: gpt-5.3-codex-spark',
        '        label: gpt-5.3-codex-spark',
        '        options:',
        '          - name: Reasoning Level',
        '            default: High',
        '      - name: gpt-5.2',
        '        label: gpt-5.2',
        '      - name: gpt-5.1-codex-mini',
        '        label: gpt-5.1-codex-mini',
        '        options:',
        '          - name: Reasoning Level',
        '            values: [Medium, High]',
        '            default: Medium',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          codex: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          codex: {
            default: {
              id: 'default',
              providerName: 'codex',
              commandConfig: {
                path: 'codex',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          codex: {
            path: 'codex',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('codex')).toEqual({
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', default: false },
          { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max', default: false },
          { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', default: false },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false },
          { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark', default: false },
          { id: 'gpt-5.2', label: 'gpt-5.2', default: false },
          { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini', default: false },
        ],
        warnings: [],
      });
      const catalog = service.getImmediateAdvancedCatalog('codex');
      expect(catalog.provider).toBe('codex');
      expect(catalog.backend).toBe('cli');
      expect(catalog.defaultModel).toBe('gpt-5.4');
      expect(catalog.entries).toHaveLength(8);
      expect(catalog.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-5.4',
          label: 'gpt-5.4',
          default: true,
        }),
        expect.objectContaining({
          id: 'gpt-5.2-codex',
          label: 'gpt-5.2-codex',
        }),
        expect.objectContaining({
          id: 'gpt-5.1-codex-max',
          label: 'gpt-5.1-codex-max',
        }),
        expect.objectContaining({
          id: 'gpt-5.3-codex-spark',
          label: 'gpt-5.3-codex-spark',
        }),
        expect.objectContaining({
          id: 'gpt-5.1-codex-mini',
          label: 'gpt-5.1-codex-mini',
        }),
      ]));
      expect(catalog.controls).toHaveLength(1);
      expect(catalog.controls[0]).toEqual({
        key: 'codex.reasoning_effort',
        label: 'Reasoning effort',
        description: 'Controls Codex CLI reasoning depth for supported models.',
        kind: 'enum',
        scope: 'both',
        values: expect.arrayContaining([
          {
            value: 'low',
            label: 'Low',
            description: 'Fast responses with lighter reasoning.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.2-codex',
              'gpt-5.1-codex-max',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.3-codex-spark',
              'gpt-5.2',
            ],
          },
          {
            value: 'medium',
            label: 'Medium (default)',
            description: 'Balances speed and reasoning depth for everyday tasks.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.2-codex',
              'gpt-5.1-codex-max',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.2',
              'gpt-5.1-codex-mini',
            ],
          },
          {
            value: 'medium',
            label: 'Medium',
            description: 'Balances speed and reasoning depth for everyday tasks.',
            applicableEntryIds: [
              'gpt-5.3-codex-spark',
            ],
          },
          {
            value: 'high',
            label: 'High',
            description: 'Greater reasoning depth for complex problems.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.2-codex',
              'gpt-5.1-codex-max',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.2',
              'gpt-5.1-codex-mini',
            ],
          },
          {
            value: 'high',
            label: 'High (default)',
            description: 'Greater reasoning depth for complex problems.',
            applicableEntryIds: [
              'gpt-5.3-codex-spark',
            ],
          },
          {
            value: 'xhigh',
            label: 'Extra High',
            description: 'Extra high reasoning depth for complex problems.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.2-codex',
              'gpt-5.1-codex-max',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.3-codex-spark',
              'gpt-5.2',
            ],
          },
        ]),
        applicableEntryIds: [
          'gpt-5.4',
          'gpt-5.2-codex',
          'gpt-5.1-codex-max',
          'gpt-5.4-mini',
          'gpt-5.3-codex',
          'gpt-5.3-codex-spark',
          'gpt-5.2',
          'gpt-5.1-codex-mini',
        ],
        semanticTags: ['reasoning_intensity'],
      });
      expect(catalog.controls[0]?.values).toHaveLength(6);
      expect(catalog.defaultSelection).toEqual({
        entryId: 'gpt-5.4',
        entryMode: 'explicit',
        controls: {
          'codex.reasoning_effort': 'medium',
        },
      });
      expect(catalog.support).toEqual({
        tier: 'full',
        advancedMetadataStatus: 'verified_manifest',
        discoveryMode: 'manual_refresh',
        provenance: {
          status: 'verified_manifest',
          manifestId: 'codex-cli-v1',
          manifestVersion: '2026-04-07',
          evidenceRefs: [
            'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-cli-v1',
          ],
        },
      });
      expect(catalog.warnings).toEqual([]);
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Gemini CLI entry metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Gemini',
        '    version: 0.36.0',
        '    last_updated: 2026-04-08',
        '    models:',
        '      - name: gemini-3.1-pro-preview',
        '        label: Gemini 3.1 Pro Preview',
        '        default: true',
        '        notes:',
        '          - Primary reasoning model.',
        '      - name: gemini-3-flash-preview',
        '        label: Gemini 3 Flash Preview',
        '      - name: gemini-3.1-flash-lite-preview',
        '        label: Gemini 3.1 Flash Lite Preview',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          gemini: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          gemini: {
            default: {
              id: 'default',
              providerName: 'gemini',
              commandConfig: {
                path: 'gemini',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          gemini: {
            path: 'gemini',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('gemini')).toEqual({
        provider: 'gemini',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gemini-3.1-pro-preview',
        source: 'static',
        cache: null,
        models: [
          {
            id: 'gemini-3.1-pro-preview',
            label: 'Gemini 3.1 Pro Preview',
            default: true,
          },
          {
            id: 'gemini-3-flash-preview',
            label: 'Gemini 3 Flash Preview',
            default: false,
          },
          {
            id: 'gemini-3.1-flash-lite-preview',
            label: 'Gemini 3.1 Flash Lite Preview',
            default: false,
          },
        ],
        warnings: [],
      });
      expect(service.getImmediateAdvancedCatalog('gemini')).toEqual({
        provider: 'gemini',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gemini-3.1-pro-preview',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'gemini-3.1-pro-preview',
            label: 'Gemini 3.1 Pro Preview',
            default: true,
            capabilityTags: ['tool_use', 'reasoning'],
            notes: ['Primary reasoning model.'],
          },
          {
            id: 'gemini-3-flash-preview',
            label: 'Gemini 3 Flash Preview',
            default: false,
            capabilityTags: ['tool_use', 'latency_optimized'],
          },
          {
            id: 'gemini-3.1-flash-lite-preview',
            label: 'Gemini 3.1 Flash Lite Preview',
            default: false,
            capabilityTags: ['tool_use', 'latency_optimized'],
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Copilot CLI entry metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Copilot',
        '    version: v1.0.26',
        '    last_updated: 2026-04-15',
        '    providers:',
        '      - name: OpenAI',
        '        shared_options:',
        '          - name: Reasoning Effort',
        '            values: [Low, Medium, High]',
        '            default: Medium',
        '        models:',
        '          - name: GPT-5.4',
        '            default: true',
        '          - name: GPT-5.4 mini',
        '          - name: GPT-5.2-Codex',
        '            options:',
        '              - name: Reasoning Effort',
        '                default: High',
        '      - name: Anthropic',
        '        shared_options:',
        '          - name: Effort Level',
        '            values: [Low, Medium, High]',
        '            default: Medium',
        '        models:',
        '          - name: Claude Opus 4.6',
        '            options:',
        '              - name: Effort Level',
        '                default: High',
        '          - name: Claude Sonnet 4',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          copilot: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          copilot: {
            default: {
              id: 'default',
              providerName: 'copilot',
              commandConfig: {
                path: 'copilot',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          copilot: {
            path: 'copilot',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('copilot')).toEqual({
        provider: 'copilot',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'GPT-5.4', default: true },
          { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', default: false },
          { id: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', default: false },
          { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', default: false },
          { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', default: false },
        ],
        warnings: [],
      });
      expect(service.getImmediateAdvancedCatalog('copilot')).toEqual({
        provider: 'copilot',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            default: true,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'gpt-5.4-mini',
            label: 'GPT-5.4 mini',
            default: false,
            capabilityTags: ['reasoning', 'latency_optimized'],
          },
          {
            id: 'gpt-5.2-codex',
            label: 'GPT-5.2-Codex',
            default: false,
          },
          {
            id: 'claude-opus-4.6',
            label: 'Claude Opus 4.6',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'claude-sonnet-4',
            label: 'Claude Sonnet 4',
            default: false,
          },
        ],
        presets: [],
        controls: [
          expect.objectContaining({
            key: 'copilot.reasoning_effort',
            label: 'Reasoning effort',
            description: 'Controls GitHub Copilot CLI reasoning effort for supported models.',
            kind: 'enum',
            scope: 'both',
            values: expect.arrayContaining([
              expect.objectContaining({
                value: 'low',
                label: 'Low',
                applicableEntryIds: [
                  'gpt-5.4',
                  'gpt-5.4-mini',
                  'gpt-5.2-codex',
                  'claude-opus-4.6',
                  'claude-sonnet-4',
                ],
              }),
              expect.objectContaining({
                value: 'medium',
                label: 'Medium (default)',
                applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4'],
              }),
              expect.objectContaining({
                value: 'high',
                label: 'High (default)',
                applicableEntryIds: ['gpt-5.2-codex', 'claude-opus-4.6'],
              }),
              expect.objectContaining({
                value: 'medium',
                label: 'Medium',
                applicableEntryIds: ['gpt-5.2-codex', 'claude-opus-4.6'],
              }),
              expect.objectContaining({
                value: 'high',
                label: 'High',
                applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4'],
              }),
              expect.objectContaining({
                value: 'high',
                label: 'High (default)',
                applicableEntryIds: ['gpt-5.2-codex', 'claude-opus-4.6'],
              }),
            ]),
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.4-mini',
              'gpt-5.2-codex',
              'claude-opus-4.6',
              'claude-sonnet-4',
            ],
            semanticTags: ['reasoning_intensity'],
          }),
        ],
        defaultSelection: {
          entryId: 'gpt-5.4',
          entryMode: 'explicit',
          controls: {
            'copilot.reasoning_effort': 'medium',
          },
        },
        support: {
          tier: 'full',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Kilo CLI entry metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Kilo',
        '    version: v7.2.0',
        '    last_updated: 2026-04-14',
        '    models:',
        '      - name: Kilo Auto Frontier',
        '      - name: "xAI: Grok Code Fast 1 Optimized (free)"',
        '      - name: Elephant (new)',
        '      - name: "OpenAI: GPT-5.4"',
        '        default: true',
        '      - name: "MiniMax: MiniMax M2.7"',
        '      - name: "Z.ai: GLM 5.1 (new)"',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          kilo: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          kilo: {
            default: {
              id: 'default',
              providerName: 'kilo',
              commandConfig: {
                path: 'kilo',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          kilo: {
            path: 'kilo',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('kilo')).toEqual({
        provider: 'kilo',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'kilo/openai/gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'kilo/kilo-auto/frontier', label: 'Kilo Auto Frontier', default: false },
          {
            id: 'kilo/x-ai/grok-code-fast-1:optimized:free',
            label: 'xAI: Grok Code Fast 1 Optimized (free)',
            default: false,
          },
          { id: 'kilo/openrouter/elephant-alpha', label: 'Elephant (new)', default: false },
          { id: 'kilo/openai/gpt-5.4', label: 'OpenAI: GPT-5.4', default: true },
          { id: 'kilo/minimax/minimax-m2.7', label: 'MiniMax: MiniMax M2.7', default: false },
          { id: 'kilo/z-ai/glm-5.1', label: 'Z.ai: GLM 5.1 (new)', default: false },
        ],
        warnings: [],
      });
      expect(service.getImmediateAdvancedCatalog('kilo')).toEqual({
        provider: 'kilo',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'kilo/openai/gpt-5.4',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'kilo/kilo-auto/frontier',
            label: 'Kilo Auto Frontier',
            default: false,
          },
          {
            id: 'kilo/x-ai/grok-code-fast-1:optimized:free',
            label: 'xAI: Grok Code Fast 1 Optimized (free)',
            default: false,
          },
          {
            id: 'kilo/openrouter/elephant-alpha',
            label: 'Elephant (new)',
            default: false,
          },
          {
            id: 'kilo/openai/gpt-5.4',
            label: 'OpenAI: GPT-5.4',
            default: true,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'kilo/minimax/minimax-m2.7',
            label: 'MiniMax: MiniMax M2.7',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
          {
            id: 'kilo/z-ai/glm-5.1',
            label: 'Z.ai: GLM 5.1 (new)',
            default: false,
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Kiro CLI entry metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Kiro',
        '    version: 2.0.0',
        '    last_updated: 2026-04-15',
        '    models:',
        '      - name: auto',
        '        default: true',
        '      - name: claude-opus-4.6',
        '      - name: claude-sonnet-4.6',
        '      - name: claude-opus-4.5',
        '      - name: claude-sonnet-4.5',
        '      - name: claude-sonnet-4',
        '      - name: claude-haiku-4.5',
        '      - name: deepseek-3.2',
        '      - name: minimax-m2.5',
        '      - name: minimax-m2.1',
        '      - name: glm-5',
        '      - name: qwen3-coder-next',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          kiro: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          kiro: {
            default: {
              id: 'default',
              providerName: 'kiro',
              commandConfig: {
                path: 'kiro-cli',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          kiro: {
            path: 'kiro-cli',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('kiro')).toEqual({
        provider: 'kiro',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'claude-opus-4.6',
        source: 'static',
        cache: null,
        models: [
          { id: 'auto', label: 'auto', default: false },
          { id: 'claude-opus-4.6', label: 'claude-opus-4.6', default: true },
          { id: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6', default: false },
          { id: 'claude-opus-4.5', label: 'claude-opus-4.5', default: false },
          { id: 'claude-sonnet-4.5', label: 'claude-sonnet-4.5', default: false },
          { id: 'claude-sonnet-4', label: 'claude-sonnet-4', default: false },
          { id: 'claude-haiku-4.5', label: 'claude-haiku-4.5', default: false },
          { id: 'deepseek-3.2', label: 'deepseek-3.2', default: false },
          { id: 'minimax-m2.5', label: 'minimax-m2.5', default: false },
          { id: 'minimax-m2.1', label: 'minimax-m2.1', default: false },
          { id: 'glm-5', label: 'glm-5', default: false },
          { id: 'qwen3-coder-next', label: 'qwen3-coder-next', default: false },
        ],
        warnings: [],
      });
      expect(service.getImmediateAdvancedCatalog('kiro')).toEqual({
        provider: 'kiro',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'claude-opus-4.6',
        source: 'static',
        cache: null,
        entries: [
          { id: 'auto', label: 'auto', default: true },
          {
            id: 'claude-opus-4.6',
            label: 'claude-opus-4.6',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'claude-sonnet-4.6',
            label: 'claude-sonnet-4.6',
            default: false,
          },
          {
            id: 'claude-opus-4.5',
            label: 'claude-opus-4.5',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'claude-sonnet-4.5',
            label: 'claude-sonnet-4.5',
            default: false,
          },
          {
            id: 'claude-sonnet-4',
            label: 'claude-sonnet-4',
            default: false,
          },
          {
            id: 'claude-haiku-4.5',
            label: 'claude-haiku-4.5',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
          {
            id: 'deepseek-3.2',
            label: 'deepseek-3.2',
            default: false,
          },
          {
            id: 'minimax-m2.5',
            label: 'minimax-m2.5',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
          {
            id: 'minimax-m2.1',
            label: 'minimax-m2.1',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
          {
            id: 'glm-5',
            label: 'glm-5',
            default: false,
          },
          {
            id: 'qwen3-coder-next',
            label: 'qwen3-coder-next',
            default: false,
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('warns when curated CLI models cannot be normalized', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Codex',
        '    version: 0.118.0',
        '    last_updated: 2026-04-08',
        '    models:',
        '      - name: gpt-5.4',
        '        default: true',
        '      - name: gpt-5.0',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          codex: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
          codex: {
            default: {
              id: 'default',
              providerName: 'codex',
              commandConfig: {
                path: 'codex',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
        },
        providerCommands: {
          ...base.providerCommands,
          codex: {
            path: 'codex',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        },
      } as const;

      const service = new ProviderModelCatalogService(config as never, {
        env: runtime.env,
      });

      expect(service.getImmediateCatalog('codex')).toEqual({
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
        ],
        warnings: [
          "Curated model 'gpt-5.0' for Codex could not be normalized and was ignored.",
        ],
      });
    } finally {
      runtime.cleanup();
    }
  });

  it('applies curated Cursor label-only entry metadata from curated-model-catalogs.yaml', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Cursor',
        '    version: 2026.04.13-a9d7fb5',
        '    last_updated: 2026-04-14',
        '    models:',
        '      - name: Auto',
        '      - name: Composer 2 Fast',
        '        default: true',
        '      - name: Codex 5.3 Extra High',
        '      - name: GPT-5.4 1M',
        '      - name: Opus 4.5 Thinking',
        '      - name: Gemini 3 Flash',
        '',
      ].join('\n'), 'utf8');

      const base = createCatalogConfig();
      const config = {
        ...base,
        configPath: runtime.paths.configPath,
        sessionBaseDir: runtime.paths.sessionBaseDir,
        providerDefaultTargets: {
          ...base.providerDefaultTargets,
          cursor: { backend: 'cli', instance: 'default' },
        },
        providerInstances: {
          ...base.providerInstances,
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
          ...base.providerCommands,
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

      expect(service.getImmediateCatalog('cursor')).toEqual({
        provider: 'cursor',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'composer-2-fast',
        source: 'static',
        cache: null,
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'composer-2-fast', label: 'Composer 2 Fast', default: true },
          { id: 'gpt-5.3-codex-xhigh', label: 'Codex 5.3 Extra High' },
          { id: 'gpt-5.4-medium', label: 'GPT-5.4 1M' },
          { id: 'claude-4.5-opus-thinking', label: 'Opus 4.5 Thinking' },
          { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
        ],
        warnings: [
          'Live model discovery is available for cursor/cli/default via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
        ],
      });
      expect(service.getImmediateAdvancedCatalog('cursor')).toEqual({
        provider: 'cursor',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'composer-2-fast',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'auto',
            label: 'Auto',
            default: false,
          },
          {
            id: 'composer-2-fast',
            label: 'Composer 2 Fast',
            default: true,
          },
          {
            id: 'gpt-5.3-codex-xhigh',
            label: 'Codex 5.3 Extra High',
            default: false,
          },
          {
            id: 'gpt-5.4-medium',
            label: 'GPT-5.4 1M',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'claude-4.5-opus-thinking',
            label: 'Opus 4.5 Thinking',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'gemini-3-flash',
            label: 'Gemini 3 Flash',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [
          'Live model discovery is available for cursor/cli/default via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
        ],
      });
    } finally {
      runtime.cleanup();
    }
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
        values: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
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
        advancedMetadataStatus: 'verified_manifest',
        discoveryMode: 'manual_refresh',
        provenance: {
          status: 'verified_manifest',
          manifestId: 'codex-api-openai-v1',
          manifestVersion: '2026-04-07',
          evidenceRefs: [
            'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-api-openai-v1',
          ],
        },
      },
      warnings: [],
    });
  });
});
