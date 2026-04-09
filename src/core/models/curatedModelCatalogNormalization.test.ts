import { describe, expect, it } from 'vitest';
import { normalizeCursorModelName } from './curatedModelCatalogNormalization.js';

describe('curatedModelCatalogNormalization', () => {
  it('normalizes Cursor /model labels into runtime-owned catalog ids', () => {
    expect(normalizeCursorModelName('Auto')).toBe('auto');
    expect(normalizeCursorModelName('Codex 5.3 Extra High')).toBe('gpt-5.3-codex-xhigh');
    expect(normalizeCursorModelName('Codex 5.1 Max Medium Fast'))
      .toBe('gpt-5.1-codex-max-medium-fast');
    expect(normalizeCursorModelName('GPT-5.4 1M')).toBe('gpt-5.4-medium');
    expect(normalizeCursorModelName('GPT-5.4 Mini None')).toBe('gpt-5.4-mini-none');
    expect(normalizeCursorModelName('Opus 4.5 Thinking')).toBe('claude-4.5-opus-thinking');
    expect(normalizeCursorModelName('Gemini 3 Flash')).toBe('gemini-3-flash');
    expect(normalizeCursorModelName('Kimi K2.5')).toBe('kimi-k2.5');
    expect(normalizeCursorModelName('Unknown Cursor Model')).toBeNull();
  });
});
