import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHARED_UI_SCRIPT } from './shared.js';
import { buildProviderAdvancedKnowledge } from '../../core/models/providerAdvancedKnowledge.js';
import { getStaticProviderModels } from '../../core/models/providerModelCatalog.js';

function createCatsUI() {
  const window = {
    addEventListener: () => {},
    innerWidth: 1440,
    innerHeight: 900,
  };
  const document = {
    readyState: 'loading',
    addEventListener: () => {},
    querySelectorAll: () => [],
    body: {
      getAttribute: () => '',
      setAttribute: () => {},
    },
  };
  const context = {
    window,
    document,
    console,
    queueMicrotask: (fn: () => void) => fn(),
    Element: class {},
  };
  vm.runInNewContext(SHARED_UI_SCRIPT, context);
  return context.window.CatsUI;
}

describe('shared playground selection helpers', () => {
  it('renders the Antigravity first effort without default labels and preserves saved effort', () => {
    const catsUI = createCatsUI();
    const target = { providerName: 'antigravity', backend: 'cli' as const,
      instanceId: 'native', defaultTarget: true };
    const { catalog } = buildProviderAdvancedKnowledge(target, {
      provider: 'antigravity', backend: 'cli', instance: 'native', defaultModel: null,
      source: 'static', cache: null, models: getStaticProviderModels(target), warnings: [],
    });
    const html = readFileSync(new URL('./pages/playground.html', import.meta.url), 'utf8');
    const start = html.indexOf('function renderAgentModelControls(');
    const end = html.indexOf('function applyAgentModelControlValues(', start);
    const controls = { innerHTML: '' };
    const context = { window: { CatsUI: catsUI }, escapeHtml: String,
      div: { querySelector: () => controls }, catalog, entryId: '' };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    expect(catsUI.getAdvancedCatalogDefaultEntryId(catalog)).toBe('gemini-3.8-flash-low');
    for (const entry of catalog.entries) {
      context.entryId = entry.id;
      vm.runInContext('renderAgentModelControls(div, catalog, entryId, "")', context);
      expect(controls.innerHTML).not.toMatch(/default/i);
      const values = [...controls.innerHTML.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
      if (entry.id.includes('flash')) expect(values).toEqual(['low', 'medium', 'high']);
      else if (entry.id.includes('pro')) expect(values).toEqual(['low', 'high']);
      else expect(values).toEqual([]);
      if (values.length) expect(controls.innerHTML).toContain('<option value="low" selected>low</option>');
    }
    expect(catsUI.normalizePlaygroundAgentSelection({
      provider: 'antigravity', modelSelection: { entryId: 'gemini-3.8-flash-low',
        entryMode: 'explicit', controls: { 'antigravity.effort': 'high' } },
      selectableProviders: ['antigravity'], providerOrder: ['antigravity'],
      advancedCatalogs: { antigravity: catalog },
    }).modelSelection.controls).toEqual({ 'antigravity.effort': 'high' });
  });

  it('selects each Codex entry default and preserves explicit saved effort on reload', () => {
    const catsUI = createCatsUI();
    const catalog = {
      provider: 'codex', backend: 'cli', instance: 'default',
      entries: [
        { id: 'gpt-6-astra', label: 'gpt-6-astra', default: true,
          controlDefaults: { 'codex.reasoning_effort': 'medium' } },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol',
          controlDefaults: { 'codex.reasoning_effort': 'low' } },
      ],
      presets: [],
      controls: [{
        key: 'codex.reasoning_effort', kind: 'enum', scope: 'both',
        values: ['low', 'medium', 'high'].map((value) => ({ value, label: value })),
      }],
      defaultSelection: { entryId: 'gpt-6-astra', entryMode: 'explicit',
        controls: { 'codex.reasoning_effort': 'medium' } },
    };
    expect(catsUI.getAdvancedCatalogDefaultEntryId(catalog)).toBe('gpt-6-astra');
    expect(catsUI.getAdvancedEntryControlDefaults(catalog, 'gpt-5.6-sol', ''))
      .toEqual({ 'codex.reasoning_effort': 'low' });
    expect(catsUI.getAdvancedEntryControlDefaults(catalog, 'gpt-6-astra', ''))
      .toEqual({ 'codex.reasoning_effort': 'medium' });
    expect(catsUI.normalizePlaygroundAgentSelection({
      provider: 'codex',
      modelSelection: { entryId: 'gpt-5.6-sol', entryMode: 'explicit',
        controls: { 'codex.reasoning_effort': 'high' } },
      selectableProviders: ['codex'], providerOrder: ['codex'],
      advancedCatalogs: { codex: catalog },
    }).modelSelection.controls).toEqual({ 'codex.reasoning_effort': 'high' });
    expect(catsUI.formatAdvancedDefaultLabel('Low', true)).toBe('Low (default)');
    expect(catsUI.formatAdvancedDefaultLabel('Opus 5 with 1M context (Default)', true))
      .toBe('Opus 5 with 1M context (default)');
    expect(catsUI.formatAdvancedDefaultLabel('xHigh (DEFAULT)', false)).toBe('xHigh');
    expect(catsUI.formatAdvancedDefaultLabel('xHigh (Default)', undefined))
      .toBe('xHigh (default)');
    expect(catsUI.formatAdvancedDefaultLabel('Medium (default)', false)).toBe('Medium');
    expect(catsUI.formatAdvancedDefaultLabel('gpt-6-astra (default)', true))
      .toBe('gpt-6-astra (default)');
  });

  it('orders runtime-usable providers ahead of unavailable targets', () => {
    const catsUI = createCatsUI();

    expect(catsUI.listSelectablePlaygroundProviders(
      ['claude', 'codex', 'antigravity'],
      ['claude', 'codex', 'antigravity'],
      {
        claude: 'ok',
        codex: 'unavailable',
        antigravity: 'degraded',
      },
    )).toEqual(['claude', 'antigravity', 'codex']);
  });

  it('falls back from an unavailable preset provider to the first usable provider', () => {
    const catsUI = createCatsUI();

    const selection = catsUI.normalizePlaygroundAgentSelection({
      provider: 'codex',
      model: 'gpt-5.4',
      selectableProviders: ['claude', 'codex'],
      providerOrder: ['claude', 'codex'],
      providerAvailability: {
        claude: 'ok',
        codex: 'unavailable',
      },
      preferAvailableProvider: true,
      advancedCatalogs: {
        claude: {
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          defaultModel: 'opus',
          entries: [
            { id: 'opus', label: 'Opus 4.6 with 1M context', default: true },
            { id: 'sonnet', label: 'Sonnet 4.6' },
          ],
          presets: [],
          controls: [],
          defaultSelection: {
            entryMode: 'explicit',
            entryId: 'opus',
          },
          support: { tier: 'full' },
          warnings: [],
        },
      },
    });

    expect(selection).toEqual({
      provider: 'claude',
      model: '',
      modelSelection: {
        entryMode: 'explicit',
        entryId: 'opus',
      },
    });
  });

  it('falls back within the same provider when the requested entry and mode are not available', () => {
    const catsUI = createCatsUI();

    const selection = catsUI.normalizePlaygroundAgentSelection({
      provider: 'claude',
      model: 'claude-opus-4-6',
      modelSelection: {
        entryMode: 'explicit',
        entryId: 'opus',
        controls: {
          'claude.reasoning_effort': 'max',
        },
      },
      selectableProviders: ['claude'],
      providerOrder: ['claude'],
      providerAvailability: {
        claude: 'ok',
      },
      preferAvailableProvider: true,
      advancedCatalogs: {
        claude: {
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          defaultModel: 'sonnet',
          entries: [
            { id: 'sonnet', label: 'Sonnet 4.6', default: true },
            { id: 'haiku', label: 'Haiku 4.5' },
          ],
          presets: [],
          controls: [
            {
              key: 'claude.reasoning_effort',
              label: 'Reasoning effort',
              kind: 'enum',
              scope: 'both',
              values: [
                { value: 'low', applicableEntryIds: ['sonnet'] },
                { value: 'medium', applicableEntryIds: ['sonnet'] },
                { value: 'high', applicableEntryIds: ['sonnet'] },
                { value: 'max', applicableEntryIds: ['opus'] },
              ],
              applicableEntryIds: ['sonnet'],
              semanticTags: ['reasoning_intensity'],
            },
          ],
          defaultSelection: {
            entryMode: 'explicit',
            entryId: 'sonnet',
            controls: {
              'claude.reasoning_effort': 'medium',
            },
          },
          support: { tier: 'full' },
          warnings: [],
        },
      },
    });

    expect(selection).toEqual({
      provider: 'claude',
      model: '',
      modelSelection: {
        entryMode: 'explicit',
        entryId: 'sonnet',
        controls: {
          'claude.reasoning_effort': 'medium',
        },
      },
    });
  });

  it('derives per-entry control defaults from explicit enum default labels', () => {
    const catsUI = createCatsUI();
    const catalog = {
      provider: 'claude',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'opus',
      entries: [
        { id: 'opus', label: 'Opus 4.7 with 1M context', default: true },
        { id: 'sonnet', label: 'Sonnet 4.6' },
      ],
      presets: [],
      controls: [
        {
          key: 'claude.reasoning_effort',
          label: 'Reasoning effort',
          kind: 'enum',
          scope: 'both',
          values: [
            { value: 'low', label: 'Low', applicableEntryIds: ['opus', 'sonnet'] },
            { value: 'medium', label: 'Medium (default)', applicableEntryIds: ['sonnet'] },
            { value: 'high', label: 'High', applicableEntryIds: ['opus', 'sonnet'] },
            { value: 'xhigh', label: 'xHigh (default)', applicableEntryIds: ['opus'] },
            { value: 'max', label: 'Max', applicableEntryIds: ['opus'] },
          ],
          applicableEntryIds: ['opus', 'sonnet'],
        },
      ],
      defaultSelection: {
        entryMode: 'explicit',
        entryId: 'opus',
        controls: {
          'claude.reasoning_effort': 'xhigh',
        },
      },
      support: { tier: 'full' },
      warnings: [],
    };

    expect(catsUI.getAdvancedEntryControlDefaults(catalog, 'sonnet', '')).toEqual({
      'claude.reasoning_effort': 'medium',
    });
    expect(catsUI.getAdvancedEntryControlDefaults(catalog, 'opus', '')).toEqual({
      'claude.reasoning_effort': 'xhigh',
    });
  });

  it('merges entry-specific enum overrides without disturbing shared value order', () => {
    const catsUI = createCatsUI();
    const control = {
      key: 'codex.reasoning_effort',
      label: 'Reasoning effort',
      kind: 'enum',
      scope: 'both',
      values: [
        { value: 'low', label: 'Low', applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex-spark'] },
        { value: 'medium', label: 'Medium (default)', applicableEntryIds: ['gpt-5.4'] },
        { value: 'high', label: 'High', applicableEntryIds: ['gpt-5.4'] },
        { value: 'xhigh', label: 'Extra High', applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex-spark'] },
        { value: 'medium', label: 'Medium', applicableEntryIds: ['gpt-5.3-codex-spark'] },
        { value: 'high', label: 'High (default)', applicableEntryIds: ['gpt-5.3-codex-spark'] },
      ],
      applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex-spark'],
    };

    expect(catsUI.listApplicableEnumControlOptions(control, 'gpt-5.3-codex-spark')).toEqual([
      { value: 'low', label: 'Low', applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex-spark'] },
      { value: 'medium', label: 'Medium', applicableEntryIds: ['gpt-5.3-codex-spark'] },
      { value: 'high', label: 'High (default)', applicableEntryIds: ['gpt-5.3-codex-spark'] },
      { value: 'xhigh', label: 'Extra High', applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex-spark'] },
    ]);
  });
});
