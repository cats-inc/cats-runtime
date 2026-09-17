import vm from 'node:vm';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeTestEnv } from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { describe, expect, it } from 'vitest';

import { SHARED_UI_SCRIPT } from './shared.js';
import { buildProviderAdvancedKnowledge } from '../../core/models/providerAdvancedKnowledge.js';
import { getStaticProviderModels } from '../../core/models/providerModelCatalog.js';

describe.each(['cursor', 'copilot'])('%s fixed presets in Playground', (provider) => {
  it('uses the same six parameterized fallbacks and preserves custom strings on reload', () => {
    const html = readFileSync(fileURLToPath(new URL('./pages/playground.html', import.meta.url)), 'utf8');
    const array = html.match(new RegExp(`^  ${provider}:(\\[.*\\]),$`, 'm'))?.[1];
    expect(array).toBeDefined();
    const fallback = vm.runInNewContext(`(${array})`) as Array<{ value: string; label: string }>;
    const models = getStaticProviderModels({ providerName: provider, backend: 'cli' });
    expect(fallback).toEqual(models.map(({ id, label, default: isDefault }) => ({
      value: id, label: `${label}${isDefault ? ' (default)' : ''}`,
    })));
    expect(fallback).toHaveLength(6);
    expect(fallback.filter(entry => /default/i.test(entry.label))).toHaveLength(provider === 'cursor' ? 0 : 1);
    const catalog = {
      provider, backend: 'cli', instance: 'native', defaultModel: null,
      source: 'static', cache: null, entries: models, controls: [], presets: [],
      defaultSelection: null, support: { tier: 'entry_only' }, warnings: [],
    };
    const catsUI = createCatsUI();
    const input = { provider, selectableProviders: [provider], providerOrder: [provider],
      advancedCatalogs: { [provider]: catalog }, allowLegacyModel: true };
    expect(catsUI.normalizePlaygroundAgentSelection(input).modelSelection.entryId).toBe(models[0].id);
    const custom = 'claude-opus-5[thinking=false,context=1m,effort=max,fast=true]';
    expect(catsUI.normalizePlaygroundAgentSelection({ ...input, model: custom }))
      .toEqual({ provider, model: custom, modelSelection: null });
    expect(catsUI.normalizePlaygroundAgentSelection({ ...input,
      modelSelection: { entryMode: 'explicit', entryId: 'gpt-5.4-medium' },
    })).toEqual({ provider, model: 'gpt-5.4-medium', modelSelection: null });

    // Read the actual form serializer: the custom action itself is never sent
    // as a catalog id and does not acquire structured preset controls.
    const start = html.indexOf('function readAgentModelState(div)');
    const end = html.indexOf('\nfunction ', start + 1);
    const readState = vm.runInNewContext(`(${html.slice(start, end)})`) as (div: unknown) => unknown;
    expect(readState({ querySelector: (selector: string) => ({ value: ({
      '.agent-provider': provider, '.agent-entry-choice': '__custom_model__',
      '.agent-custom-model': ` ${custom} `,
    } as Record<string, string>)[selector] }) })).toEqual({ model: custom, modelSelection: null });

    // Exercise the actual fixed-combo menu path with Runtime metadata, not
    // only the already-decorated offline labels. Copilot's default must survive.
    const syncStart = html.indexOf('function syncAgentModelField(div,options={})');
    const syncEnd = html.indexOf('\nfunction ', syncStart + 1);
    let renderedChoices: Array<{ value: string; label: string }> = [];
    const element = { value: '', classList: { remove() {}, add() {} } };
    const syncField = vm.runInNewContext(`(${html.slice(syncStart, syncEnd)})`, {
      window: { CatsUI: catsUI },
      normalizeAgentSelectionState: () => ({ provider, model: '', modelSelection: null }),
      renderAgentProviderSelectOptions: () => provider,
      getProviderAdvancedCatalog: () => catalog,
      listAgentCatalogEntries: () => catalog.entries,
      PROVIDER_MODELS: { [provider]: fallback },
      providerOptionsReady: true, providerOptionsLoading: false, providerOptionsRequestId: 1,
      renderAgentRoutingSelectOptions: (_select: unknown, choices: typeof renderedChoices) => {
        renderedChoices = choices;
      },
      syncAgentPresetField() {}, renderAgentModelChoice() {}, refreshAgentCardSummary() {},
    }) as (div: unknown, options: unknown) => void;
    syncField({ querySelector: () => element }, { preserve: false, provider });
    expect(renderedChoices).toEqual([...fallback, { value: '__custom_model__', label: 'Custom model…' }]);
  });
});

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
  it('renders each Muse effort menu without defaults and persists first/saved selections', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-muse-playground-'));
    try {
      const catsUI = createCatsUI();
      const target = { providerName: 'muse', backend: 'cli' as const,
        instanceId: 'native', defaultTarget: true };
      const { catalog } = buildProviderAdvancedKnowledge(target, {
        provider: 'muse', backend: 'cli', instance: 'native', defaultModel: null,
        source: 'static', cache: null, models: getStaticProviderModels(target), warnings: [],
      }, { env: createRuntimeTestEnv(root, {
        CATS_RUNTIME_PACKAGE_ROOT: fileURLToPath(new URL('../../../', import.meta.url)),
      }) });
      const html = readFileSync(fileURLToPath(new URL('./pages/playground.html', import.meta.url)), 'utf8');
      const start = html.indexOf('function renderAgentModelControls(');
      const end = html.indexOf('\nfunction ', start + 1);
      const controls = { innerHTML: '' };
      const context = { window: { CatsUI: catsUI }, escapeHtml: String,
        div: { querySelector: () => controls }, catalog, entryId: '' };
      vm.createContext(context);
      vm.runInContext(html.slice(start, end), context);
      for (const entry of catalog.entries) {
        context.entryId = entry.id;
        vm.runInContext('renderAgentModelControls(div, catalog, entryId, "")', context);
        expect(controls.innerHTML).not.toMatch(/default/i);
        const expected = ['minimal', 'low', 'medium', 'high', 'xhigh',
          ...(entry.id.includes('1.3') ? ['max'] : [])];
        const options = [...controls.innerHTML.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
          .map(match => [match[1], match[2]]);
        expect(options).toEqual(expected.map(value => [value, value]));
        expect(controls.innerHTML).toContain('<option value="minimal" selected>minimal</option>');
        const input = { provider: 'muse', selectableProviders: ['muse'], providerOrder: ['muse'],
          advancedCatalogs: { muse: catalog },
          modelSelection: { entryId: entry.id, entryMode: 'explicit' } };
        // The form serializer, rather than metadata normalization, persists the
        // displayed first value. Exercise it before any user effort change.
        const readStart = html.indexOf('function readAgentModelControlValues(');
        const readEnd = html.indexOf('\nfunction syncAgentPresetField(', readStart);
        const formContext = { getProviderAdvancedCatalog: () => catalog, form: {
          querySelector: (selector: string) => ({ value: ({ '.agent-provider': 'muse',
            '.agent-entry-choice': entry.id } as Record<string, string>)[selector] || '' }),
          querySelectorAll: () => [{
            value: controls.innerHTML.match(/<option value="([^"]+)" selected>/)?.[1],
            getAttribute: (name: string) => name === 'data-model-control-key'
              ? 'muse.reasoning_effort' : 'enum',
          }],
        } };
        const submitted = vm.runInNewContext(`${html.slice(readStart, readEnd)}\nreadAgentModelState(form)`, formContext);
        expect(submitted.modelSelection.controls)
          .toEqual({ 'muse.reasoning_effort': 'minimal' });
        expect(catsUI.normalizePlaygroundAgentSelection({ ...input,
          modelSelection: { ...input.modelSelection, controls: { 'muse.reasoning_effort': 'high' } },
        }).modelSelection.controls).toEqual({ 'muse.reasoning_effort': 'high' });
      }
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });

  it('renders Grok model-specific effort in picker order without active or default markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-grok-playground-'));
    try {
      const catsUI = createCatsUI();
      const target = { providerName: 'grok', backend: 'cli' as const,
        instanceId: 'native', defaultTarget: true };
      const { catalog } = buildProviderAdvancedKnowledge(target, {
        provider: 'grok', backend: 'cli', instance: 'native', defaultModel: null,
        source: 'static', cache: null, models: getStaticProviderModels(target), warnings: [],
      }, { env: createRuntimeTestEnv(root, {
        CATS_RUNTIME_PACKAGE_ROOT: fileURLToPath(new URL('../../../', import.meta.url)),
      }) });
      const html = readFileSync(new URL('./pages/playground.html', import.meta.url), 'utf8');
      const start = html.indexOf('function renderAgentModelControls(');
      const end = html.indexOf('function applyAgentModelControlValues(', start);
      const controls = { innerHTML: '' };
      const context = { window: { CatsUI: catsUI }, escapeHtml: String,
        div: { querySelector: () => controls }, catalog, entryId: '' };
      vm.createContext(context);
      vm.runInContext(html.slice(start, end), context);
      expect(catsUI.getAdvancedCatalogDefaultEntryId(catalog)).toBe('grok-4.6');
      for (const entry of catalog.entries) {
        context.entryId = entry.id;
        vm.runInContext('renderAgentModelControls(div, catalog, entryId, "")', context);
        expect(controls.innerHTML).not.toMatch(/default|active/i);
        const options = [...controls.innerHTML.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
          .map((match) => [match[1], match[2]]);
        expect(options).toEqual([
          ...(entry.id === 'grok-4.6' ? [['xhigh', 'Extra High Effort']] : []),
          ['high', 'High Effort'], ['medium', 'Medium Effort'], ['low', 'Low Effort'],
        ]);
        const [value, label] = options[0];
        expect(controls.innerHTML).toContain(`<option value="${value}" selected>${label}</option>`);
      }
      expect(catsUI.normalizePlaygroundAgentSelection({
        provider: 'grok', modelSelection: { entryId: 'grok-4.6', entryMode: 'explicit',
          controls: { 'grok.reasoning_effort': 'low' } },
        selectableProviders: ['grok'], providerOrder: ['grok'], advancedCatalogs: { grok: catalog },
      }).modelSelection.controls).toEqual({ 'grok.reasoning_effort': 'low' });
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });

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
