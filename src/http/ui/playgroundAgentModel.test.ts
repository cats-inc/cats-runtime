import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./pages/playground.html', import.meta.url), 'utf8');

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
