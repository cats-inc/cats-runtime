import { describe, expect, it } from 'vitest';
import { findCatalogBoundaryViolations } from '../scripts/check-provider-catalog-boundaries.mjs';

describe('catalog code/data boundary guard', () => {
  it.each([
    "function fallback() { return 'gpt-9-test'; }",
    "const MODEL_CATALOG = { pi: [{ id: 'Opaque', label: 'Future' }] };",
    "const value = { defaultModel: 'Opaque' };",
    "const MODEL_EFFORTS = ['low', 'medium', 'high'];",
    "if (selection.model === 'Opaque') controls.effort = 'high';",
    "<script>const models = ['Opaque'];</script>",
    'const injected = `function boot() { return "gpt-9-test"; }`;',
  ])('rejects handwritten model knowledge: %s', source => {
    expect(findCatalogBoundaryViolations(source.startsWith('<') ? 'page.html' : 'source.ts', source).length).toBeGreaterThan(0);
  });
  it('allows generic binding code and empty runtime-populated lists', () => {
    expect(findCatalogBoundaryViolations('source.ts', `
      const models = [];
      if (typeof selection.model === 'string') args.push('--model', selection.model);
      const value = { model: selection.model, defaultModel: data.defaultModel };
    `)).toEqual([]);
  });
});
