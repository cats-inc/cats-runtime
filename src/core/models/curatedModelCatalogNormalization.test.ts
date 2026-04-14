import { describe, expect, it } from 'vitest';
import {
  normalizeCopilotModelName,
  normalizeCursorModelName,
} from './curatedModelCatalogNormalization.js';

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

  it('normalizes Copilot picker labels into runtime-owned catalog ids', () => {
    expect(normalizeCopilotModelName('GPT-5.4')).toBe('gpt-5.4');
    expect(normalizeCopilotModelName('GPT-5.4 mini')).toBe('gpt-5.4-mini');
    expect(normalizeCopilotModelName('GPT-5 mini')).toBe('gpt-5-mini');
    expect(normalizeCopilotModelName('Claude Opus 4.6')).toBe('claude-opus-4-6');
    expect(normalizeCopilotModelName('Claude Sonnet 4')).toBe('claude-sonnet-4');
    expect(normalizeCopilotModelName('Unknown Copilot Model')).toBeNull();
  });
});
