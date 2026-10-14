import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHARED_UI_SCRIPT } from './shared.js';

const playground = readFileSync(new URL('./pages/playground.html', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('./pages/index.html', import.meta.url), 'utf8');
const extractFunction = (html: string, name: string) => {
  const start = html.indexOf(`function ${name}(`);
  return html.slice(start, html.indexOf('\nfunction ', start + 1));
};
const extractProviderOrder = (html: string, name: string): string[] =>
  vm.runInNewContext(new RegExp(`const ${name} = (\\[[^;]+\\]);`, 'u').exec(html)![1]!);

describe('fresh provider picker defaults', () => {
  it('adds a fresh Agent with the first usable ordered provider and keeps explicit selections', () => {
    const window: { addEventListener(): void; CatsUI?: {
      normalizePlaygroundAgentSelection(input: Record<string, unknown>): { provider: string };
    } } = { addEventListener() {} };
    const providerOrder = extractProviderOrder(playground, 'PROVIDERS');
    expect(providerOrder[0]).toBe('codex');
    vm.runInNewContext(SHARED_UI_SCRIPT, { window, document: { readyState: 'loading', addEventListener() {} } });
    let selection: { provider: string } | undefined;
    let availability: Record<string, string> = {};
    const stopBeforeRender = new Error('selection captured');
    const addAgent = vm.runInNewContext(`(${extractFunction(playground, 'addAgent')})`, {
      providerOptionsReady: true, providerOptionsLoading: false,
      getAgentCount: () => 0, MAX_AGENT_COUNT: 16,
      normalizeAgentSelectionState: (provider: string) => {
        selection = window.CatsUI!.normalizePlaygroundAgentSelection({ provider,
          selectableProviders: ['claude', 'codex'], providerOrder,
          providerAvailability: availability });
        throw stopBeforeRender;
      },
    });
    expect(() => addAgent()).toThrow(stopBeforeRender);
    expect(selection?.provider).toBe('codex');
    expect(() => addAgent('saved', 'claude')).toThrow(stopBeforeRender);
    expect(selection?.provider).toBe('claude');
    availability = { codex: 'unavailable', claude: 'ok' };
    expect(() => addAgent()).toThrow(stopBeforeRender);
    expect(selection?.provider).toBe('claude');
  });

  it('uses the first configured dashboard provider only when there is no retained selection', () => {
    const markup = /<select id="inputProvider"[^>]*>([\s\S]*?)<\/select>/u.exec(dashboard)![1]!;
    const options = [...markup.matchAll(/<option value="([^"]*)"([^>]*)>/gu)];
    expect(options.length).toBeGreaterThan(0);
    const initialValue = (options.find(option => /\bselected\b/u.test(option[2]!)) ?? options[0])![1]!;
    const providerOrder = extractProviderOrder(dashboard, 'PROVIDER_ORDER');
    expect(providerOrder).toEqual(extractProviderOrder(playground, 'PROVIDERS'));
    for (const [saved, providers, expected] of [
      [initialValue, ['codex', 'claude'], 'codex'],
      ['', ['codex', 'claude'], 'codex'], ['claude', ['codex', 'claude'], 'claude'],
      ['', ['claude'], 'claude'], ['', [], ''],
    ] as Array<[string, string[], string]>) {
      const select = { value: saved, innerHTML: '', disabled: false };
      const providerCatalog = { providers: Object.fromEntries(
        providers.map(provider => [provider, { instances: [{ id: 'default' }] }]),
      ) };
      const configuredProviderNames = vm.runInNewContext(
        `(${extractFunction(dashboard, 'configuredProviderNames')})`, {
          providerCatalog, PROVIDER_ORDER: providerOrder, PROVIDER_AVAILABILITY: {}, window: {},
        },
      );
      const sync = vm.runInNewContext(`(${extractFunction(dashboard, 'syncProviderSelect')})`, {
        document: { getElementById: () => select }, providerCatalog,
        configuredProviderNames, escapeHtml: (value: string) => value,
        formatProviderSelectLabel: (value: string) => value, setCreateModalEnabled() {},
      });
      sync();
      expect(select.value).toBe(expected);
      expect(select.disabled).toBe(providers.length === 0);
    }
  });
});
