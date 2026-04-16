import { describe, expect, it } from 'vitest';
import {
  normalizeCodexCuratedModelId,
  normalizeCopilotModelName,
  normalizeCursorModelName,
  normalizeKiloModelName,
  normalizeKiroCuratedModelId,
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
    expect(normalizeCopilotModelName('Claude Opus 4.6')).toBe('claude-opus-4.6');
    expect(normalizeCopilotModelName('Claude Sonnet 4')).toBe('claude-sonnet-4');
    expect(normalizeCopilotModelName('Unknown Copilot Model')).toBeNull();
  });

  it('normalizes Codex curated catalog ids from the curated YAML allowlist', () => {
    expect(normalizeCodexCuratedModelId({ name: 'gpt-5.1-codex-mini' }))
      .toBe('gpt-5.1-codex-mini');
    expect(normalizeCodexCuratedModelId({ label: 'gpt-5.4-mini' }))
      .toBe('gpt-5.4-mini');
    expect(normalizeCodexCuratedModelId({ name: 'unknown-codex-model' })).toBeNull();
  });

  it('normalizes Kilo picker labels into runtime-owned gateway ids', () => {
    expect(normalizeKiloModelName('Kilo Auto Frontier')).toBe('kilo/kilo-auto/frontier');
    expect(normalizeKiloModelName('ByteDance Seed: Dola Seed 2.0 Pro (free)'))
      .toBe('kilo/bytedance-seed/dola-seed-2.0-pro:free');
    expect(normalizeKiloModelName('xAI: Grok Code Fast 1 Optimized (free)'))
      .toBe('kilo/x-ai/grok-code-fast-1:optimized:free');
    expect(normalizeKiloModelName('Elephant (new)')).toBe('kilo/openrouter/elephant-alpha');
    expect(normalizeKiloModelName('Anthropic: Claude Opus 4.6'))
      .toBe('kilo/anthropic/claude-opus-4.6');
    expect(normalizeKiloModelName('OpenAI: GPT-5.4')).toBe('kilo/openai/gpt-5.4');
    expect(normalizeKiloModelName('MiniMax: MiniMax M2.7')).toBe('kilo/minimax/minimax-m2.7');
    expect(normalizeKiloModelName('MoonshotAI: Kimi K2.5')).toBe('kilo/moonshotai/kimi-k2.5');
    expect(normalizeKiloModelName('Z.ai: GLM 5.1 (new)')).toBe('kilo/z-ai/glm-5.1');
    expect(normalizeKiloModelName('Unknown Kilo Model')).toBeNull();
  });

  it('normalizes Kiro model names into runtime-owned catalog ids', () => {
    expect(normalizeKiroCuratedModelId({ name: 'auto' })).toBe('auto');
    expect(normalizeKiroCuratedModelId({ name: 'claude-opus-4.6' })).toBe('claude-opus-4.6');
    expect(normalizeKiroCuratedModelId({ name: 'claude-sonnet-4.6' })).toBe('claude-sonnet-4.6');
    expect(normalizeKiroCuratedModelId({ name: 'claude-haiku-4.5' })).toBe('claude-haiku-4.5');
    expect(normalizeKiroCuratedModelId({ name: 'deepseek-3.2' })).toBe('deepseek-3.2');
    expect(normalizeKiroCuratedModelId({ name: 'minimax-m2.5' })).toBe('minimax-m2.5');
    expect(normalizeKiroCuratedModelId({ name: 'glm-5' })).toBe('glm-5');
    expect(normalizeKiroCuratedModelId({ name: 'qwen3-coder-next' })).toBe('qwen3-coder-next');
    expect(normalizeKiroCuratedModelId({ name: 'Unknown Kiro Model' })).toBeNull();
  });
});
