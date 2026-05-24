import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  SHARED_TOKENS_CSS,
  PROVIDER_BADGE_CSS,
  SHARED_UI_SCRIPT,
} from '../src/http/ui/shared.js';

function loadCatsUiHelpers(fetchImpl = () => Promise.reject(new Error('fetch not available in unit test'))) {
  const document = {
    readyState: 'loading',
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => ({
      className: '',
      setAttribute: () => {},
      appendChild: () => {},
      querySelector: () => null,
      classList: { add: () => {}, remove: () => {} },
      style: {},
    }),
    body: {
      appendChild: () => {},
      getAttribute: () => '',
      setAttribute: () => {},
    },
    documentElement: {
      getAttribute: () => '',
      setAttribute: () => {},
    },
  };
  const context = {
    window: {
      addEventListener: () => {},
    },
    document,
    fetch: fetchImpl,
    queueMicrotask: () => {},
    Element: class {},
    Node: class {},
    HTMLElement: class {},
  };
  context.window.document = document;
  context.window.window = context.window;
  context.window.Element = context.Element;
  context.window.Node = context.Node;
  context.window.HTMLElement = context.HTMLElement;
  runInNewContext(SHARED_UI_SCRIPT, context);
  return context.window.CatsUI;
}

function createAdvancedCatalogs() {
  return {
    claude: {
      provider: 'claude',
      entries: [
        { id: 'claude-sonnet-4-6', label: 'Sonnet', default: true },
        { id: 'claude-opus-4-6', label: 'Opus' },
      ],
      presets: [
        { id: 'balanced', label: 'Balanced', preferredEntryId: 'claude-sonnet-4-6' },
      ],
      defaultSelection: {
        entryMode: 'explicit',
        entryId: 'claude-sonnet-4-6',
        presetId: 'balanced',
      },
    },
    codex: {
      provider: 'codex',
      entries: [
        { id: 'gpt-5.4', label: 'GPT-5.4', default: true },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      ],
      presets: [
        { id: 'balanced', label: 'Balanced', preferredEntryId: 'gpt-5.4' },
      ],
      defaultSelection: {
        entryMode: 'explicit',
        entryId: 'gpt-5.4',
        presetId: 'balanced',
      },
    },
  };
}

describe('shared tokens CSS', () => {
  it('contains core design token custom properties', () => {
    expect(SHARED_TOKENS_CSS).toContain('--bg:');
    expect(SHARED_TOKENS_CSS).toContain('--surface:');
    expect(SHARED_TOKENS_CSS).toContain('--surface2:');
    expect(SHARED_TOKENS_CSS).toContain('--border:');
    expect(SHARED_TOKENS_CSS).toContain('--text:');
    expect(SHARED_TOKENS_CSS).toContain('--text2:');
    expect(SHARED_TOKENS_CSS).toContain('--accent:');
    expect(SHARED_TOKENS_CSS).toContain('--green:');
    expect(SHARED_TOKENS_CSS).toContain('--yellow:');
    expect(SHARED_TOKENS_CSS).toContain('--red:');
    expect(SHARED_TOKENS_CSS).toContain('--orange:');
    expect(SHARED_TOKENS_CSS).toContain('--radius:');
  });

  it('contains all provider color custom properties', () => {
    const providers = [
      'auggie', 'claude', 'codex', 'copilot', 'cursorp',
      'antigravity', 'kiro', 'kilo', 'opencode', 'pi', 'goose', 'junie',
    ];
    for (const p of providers) {
      expect(SHARED_TOKENS_CSS).toContain(`--${p}:`);
    }
  });
});

describe('provider badge CSS', () => {
  it('contains badge rules for all known providers', () => {
    const providers = [
      'claude', 'codex', 'copilot', 'cursor', 'antigravity',
      'kiro', 'kilo', 'auggie', 'opencode', 'pi', 'goose', 'junie', 'ollama',
    ];
    for (const p of providers) {
      expect(PROVIDER_BADGE_CSS).toContain(`[data-p="${p}"]`);
    }
  });

  it('contains base .provider-badge class', () => {
    expect(PROVIDER_BADGE_CSS).toContain('.provider-badge {');
  });

  it('contains status badge classes', () => {
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-ok');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-ready');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-degraded');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-bootstrap');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-unavailable');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-unknown');
  });
});

describe('shared UI script', () => {
  it('registers CatsUI on window', () => {
    expect(SHARED_UI_SCRIPT).toContain('window.CatsUI');
  });

  it('exports expected helper functions', () => {
    expect(SHARED_UI_SCRIPT).toContain('getApiKey');
    expect(SHARED_UI_SCRIPT).toContain('authHeaders');
    expect(SHARED_UI_SCRIPT).toContain('apiFetch');
    expect(SHARED_UI_SCRIPT).toContain('renderProviderBadge');
    expect(SHARED_UI_SCRIPT).toContain('renderStatusBadge');
    expect(SHARED_UI_SCRIPT).toContain('normalizeModelCatalog');
    expect(SHARED_UI_SCRIPT).toContain('normalizeAdvancedCatalog');
    expect(SHARED_UI_SCRIPT).toContain('getAdvancedCatalogChoices');
    expect(SHARED_UI_SCRIPT).toContain('resolveAdvancedCatalogChoice');
    expect(SHARED_UI_SCRIPT).toContain('readRuntimeProviderCatalogState');
    expect(SHARED_UI_SCRIPT).toContain('normalizePlaygroundAgentSelection');
  });

  it('reads API keys only from the current page inputs', () => {
    expect(SHARED_UI_SCRIPT).toContain("document.getElementById('apiKeyInput')");
    expect(SHARED_UI_SCRIPT).toContain("document.getElementById('api-key')");
    expect(SHARED_UI_SCRIPT).not.toContain('localStorage');
  });

  it('is an IIFE', () => {
    expect(SHARED_UI_SCRIPT).toMatch(/^\(function\(\)/);
    expect(SHARED_UI_SCRIPT).toMatch(/\}\)\(\);$/);
  });

  it('falls back to the first selectable provider and default routing', () => {
    const catsUi = loadCatsUiHelpers();
    const result = catsUi.normalizePlaygroundAgentSelection({
      provider: 'junie',
      model: 'gpt',
      selectableProviders: ['claude', 'codex'],
      providerOrder: ['claude', 'codex', 'junie'],
      advancedCatalogs: createAdvancedCatalogs(),
    });

    expect(result).toEqual({
      provider: 'claude',
      model: '',
      modelSelection: {
        entryMode: 'explicit',
        entryId: 'claude-sonnet-4-6',
        presetId: 'balanced',
      },
    });
  });

  it('falls back to a provider default entry when the requested model is unavailable', () => {
    const catsUi = loadCatsUiHelpers();
    const result = catsUi.normalizePlaygroundAgentSelection({
      provider: 'codex',
      model: 'gpt-4.1-legacy',
      selectableProviders: ['codex'],
      providerOrder: ['claude', 'codex'],
      advancedCatalogs: createAdvancedCatalogs(),
    });

    expect(result).toEqual({
      provider: 'codex',
      model: '',
      modelSelection: {
        entryMode: 'explicit',
        entryId: 'gpt-5.4',
        presetId: 'balanced',
      },
    });
  });

  it('preserves an explicit legacy model override when requested', () => {
    const catsUi = loadCatsUiHelpers();
    const result = catsUi.normalizePlaygroundAgentSelection({
      provider: 'codex',
      model: 'gpt-custom-preview',
      selectableProviders: ['codex'],
      providerOrder: ['codex'],
      advancedCatalogs: {},
      allowLegacyModel: true,
    });

    expect(result).toEqual({
      provider: 'codex',
      model: 'gpt-custom-preview',
      modelSelection: null,
    });
  });

  it('unwraps runtime model catalog envelopes before normalizing shared helpers', () => {
    const catsUi = loadCatsUiHelpers();
    const basicCatalog = catsUi.normalizeModelCatalog({
      catalog: {
        provider: 'junie',
        defaultModel: 'Gemini 3 Flash',
        models: [
          { id: 'Gemini 3 Flash', label: 'Gemini 3 Flash', default: true },
          { id: 'Claude Opus 4.7', label: 'Claude Opus 4.7' },
        ],
      },
    });

    expect(basicCatalog).toEqual({
      provider: 'junie',
      backend: '',
      instance: '',
      defaultModel: 'Gemini 3 Flash',
      source: 'static',
      cache: null,
      models: [
        { id: 'Gemini 3 Flash', label: 'Gemini 3 Flash', default: true },
        { id: 'Claude Opus 4.7', label: 'Claude Opus 4.7' },
      ],
      warnings: [],
    });

    const advancedCatalog = catsUi.normalizeAdvancedCatalog({
      catalog: {
        provider: 'junie',
        defaultModel: 'Gemini 3 Flash',
        entries: [
          { id: 'Gemini 3 Flash', label: 'Gemini 3 Flash', default: true },
          { id: 'Claude Opus 4.7', label: 'Claude Opus 4.7', capabilityTags: ['reasoning'] },
        ],
        support: { tier: 'entry_only', notes: [] },
      },
    });

    expect(advancedCatalog).toEqual({
      provider: 'junie',
      backend: '',
      instance: '',
      defaultModel: 'Gemini 3 Flash',
      source: 'static',
      cache: null,
      entries: [
        { id: 'Gemini 3 Flash', label: 'Gemini 3 Flash', default: true },
        { id: 'Claude Opus 4.7', label: 'Claude Opus 4.7', capabilityTags: ['reasoning'] },
      ],
      presets: [],
      controls: [],
      defaultSelection: null,
      support: { tier: 'entry_only', notes: [] },
      warnings: [],
    });
  });

  it('loads configured provider topology and availability from the shared runtime read seam', async () => {
    const catsUi = loadCatsUiHelpers(async (path: string) => {
      if (path === '/diagnostics/providers?defaultOnly=true') {
        return {
          ok: true,
          json: async () => ({
            providers: [
              { provider: 'claude', availability: { status: 'ok' } },
              { provider: 'codex', availability: { status: 'degraded' } },
              { provider: 'junie', availability: { status: 'unavailable' } },
            ],
          }),
        };
      }

      if (path === '/providers/config') {
        return {
          ok: true,
          json: async () => ({
            providers: {
              claude: { instances: [{ id: 'default' }] },
              codex: { instances: [{ id: 'default' }] },
              junie: { instances: [] },
            },
          }),
        };
      }

      throw new Error(`unexpected fetch path: ${path}`);
    });

    const result = await catsUi.readRuntimeProviderCatalogState({
      allowedProviders: ['claude', 'codex'],
    });

    expect(result).toEqual({
      providerCatalog: {
        providers: {
          claude: { instances: [{ id: 'default' }] },
          codex: { instances: [{ id: 'default' }] },
          junie: { instances: [] },
        },
      },
      configuredProviders: ['claude', 'codex'],
      providerAvailability: {
        claude: 'ok',
        codex: 'degraded',
      },
    });
  });
});
