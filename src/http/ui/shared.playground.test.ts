import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { SHARED_UI_SCRIPT } from './shared.js';

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
  it('orders runtime-usable providers ahead of unavailable targets', () => {
    const catsUI = createCatsUI();

    expect(catsUI.listSelectablePlaygroundProviders(
      ['claude', 'codex', 'gemini'],
      ['claude', 'codex', 'gemini'],
      {
        claude: 'ok',
        codex: 'unavailable',
        gemini: 'degraded',
      },
    )).toEqual(['claude', 'gemini', 'codex']);
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
});
