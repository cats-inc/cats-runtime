import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./pages/playground.html', import.meta.url), 'utf8');

describe('Playground agent presets', () => {
  const start = html.indexOf('const STARTER_AGENT_PRESET = [');
  const end = html.indexOf('let agentCounter=', start);
  const presets = JSON.parse(vm.runInNewContext(`${html.slice(start, end)}
    JSON.stringify({ starter: STARTER_AGENT_PRESET, twelve: TWELVE_AGENT_PRESET })`, {
    getDefaultModel: (provider: string) => `${provider}-default`,
  })) as { starter: Array<{ name: string; provider: string; tags: string[] }>;
    twelve: Array<{ name: string; provider: string; model: string; tags: string[] }> };

  it('starts with Codex CEO, Claude PM, Antigravity Coder and Grok Reviewer', () => {
    expect(presets.starter.map(({ name, provider, tags }) => ({ name, provider, tags }))).toEqual([
      { name: 'Agent-1', provider: 'codex', tags: ['orchestrator'] },
      { name: 'Agent-2', provider: 'claude', tags: ['pm'] },
      { name: 'Agent-3', provider: 'antigravity', tags: ['coder'] },
      { name: 'Agent-4', provider: 'grok', tags: ['reviewer'] },
    ]);
  });

  it('assigns the remaining twelve providers in order to the existing twelve roles', () => {
    const providers = ['muse', 'cursor', 'copilot', 'opencode', 'kilo', 'cline',
      'auggie', 'pi', 'kiro', 'junie', 'devin', 'goose'];
    const roles = ['orchestrator', 'pm', 'researcher', 'designer', 'architect', 'coder',
      'tester', 'reviewer', 'security', 'qa', 'tech_writer', 'marketer'];
    expect(presets.twelve).toEqual(providers.map((provider, index) => ({
      name: `Agent-${index + 1}`, provider, model: `${provider}-default`, tags: [roles[index]],
    })));
  });
});

type CustomSelectionInput = {
  requestedIsUnlisted: boolean;
  preserveCurrent: boolean;
  currentValue: string;
  customChosen: boolean;
};

function loadCustomSelectionRule(): (input: CustomSelectionInput) => boolean {
  const start = html.indexOf('function isAgentCustomModelSelection');
  const end = html.indexOf('function syncAgentModelField');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return vm.runInNewContext(`${html.slice(start, end)}\nisAgentCustomModelSelection`);
}

describe('Playground agent model selection', () => {
  const isCustom = loadCustomSelectionRule();

  it('adopts the catalog default for a starter card rendered before catalogs loaded', () => {
    // Before catalogs load, Custom is the only option, so the card starts there without a user choice.
    expect(isCustom({ requestedIsUnlisted: false, preserveCurrent: true, currentValue: '__custom_model__', customChosen: false }))
      .toBe(false);
  });

  it('keeps an empty Custom selection the user chose across catalog refreshes', () => {
    expect(isCustom({ requestedIsUnlisted: false, preserveCurrent: true, currentValue: '__custom_model__', customChosen: true }))
      .toBe(true);
  });

  it('keeps a saved or typed model string that the catalog does not list', () => {
    expect(isCustom({ requestedIsUnlisted: true, preserveCurrent: false, currentValue: 'opus', customChosen: false }))
      .toBe(true);
  });

  it('leaves Custom when the provider changes without preserving the current choice', () => {
    expect(isCustom({ requestedIsUnlisted: false, preserveCurrent: false, currentValue: '__custom_model__', customChosen: true }))
      .toBe(false);
  });
});
