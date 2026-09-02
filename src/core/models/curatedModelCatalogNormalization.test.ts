import { describe, expect, it } from 'vitest';
import {
  normalizeClaudeCuratedModelId,
  normalizeCodexCuratedModelId,
  normalizeCopilotModelName,
  normalizeCursorCuratedModelId,
  normalizeCursorModelName,
  normalizeJunieCuratedModelId,
  normalizeKiloModelName,
  normalizeKiroCuratedModelId,
} from './curatedModelCatalogNormalization.js';

describe('curatedModelCatalogNormalization', () => {
  it('resolves a version-suffixed picker label to the bare executable alias', () => {
    // The catalog labels carry the version the picker shows, so the id must not
    // move when the vendor bumps it. Label-only entries have no `name` to fall
    // back on, which is the case that pinning one version per alias broke.
    expect(normalizeClaudeCuratedModelId({ label: 'Opus 5 (1M context)' })).toBe('opus');
    expect(normalizeClaudeCuratedModelId({ label: 'Opus 6 (1M context)' })).toBe('opus');
    expect(normalizeClaudeCuratedModelId({ label: 'Sonnet 5' })).toBe('sonnet');
    expect(normalizeClaudeCuratedModelId({ label: 'Haiku 4.5' })).toBe('haiku');
    expect(normalizeClaudeCuratedModelId({ label: 'Fable 5.1' })).toBe('fable');
  });

  it('normalizes current Claude picker labels into executable aliases', () => {
    expect(normalizeClaudeCuratedModelId({ name: 'Opus', label: 'Opus 5 (1M context)' }))
      .toBe('opus');
    expect(normalizeClaudeCuratedModelId({ name: 'Fable', label: 'Fable 5.1' }))
      .toBe('fable');
    expect(normalizeClaudeCuratedModelId({ name: 'Sonnet', label: 'Sonnet 5' }))
      .toBe('sonnet');
    expect(normalizeClaudeCuratedModelId({ name: 'Haiku', label: 'Haiku 4.5' }))
      .toBe('haiku');
    expect(normalizeClaudeCuratedModelId({ name: 'Default (recommended)' })).toBeNull();
  });

  it('normalizes Cursor /model labels into runtime-owned catalog ids', () => {
    expect(normalizeCursorModelName('Auto')).toBe('auto');
    expect(normalizeCursorModelName('Codex 5.3 Extra High')).toBe('gpt-5.3-codex-xhigh');
    expect(normalizeCursorModelName('Codex 5.1 Max Medium Fast'))
      .toBe('gpt-5.1-codex-max-medium-fast');
    expect(normalizeCursorModelName('GPT-5.4 1M')).toBe('gpt-5.4-medium');
    expect(normalizeCursorModelName('GPT-5.4 Mini None')).toBe('gpt-5.4-mini-none');
    expect(normalizeCursorModelName('Opus 4.5 Thinking')).toBe('claude-4.5-opus-thinking');
    expect(normalizeCursorModelName('Opus 4.7 Low')).toBe('claude-4.7-opus-low');
    expect(normalizeCursorModelName('Opus 4.7 Thinking')).toBe('claude-4.7-opus-thinking');
    expect(normalizeCursorModelName('Opus 4.7 Max Thinking'))
      .toBe('claude-4.7-opus-max-thinking');
    expect(normalizeCursorModelName('Sonnet 4.6 1M')).toBe('claude-4.6-sonnet');
    expect(normalizeCursorModelName('Sonnet 4.6 1M Thinking'))
      .toBe('claude-4.6-sonnet-thinking');
    expect(normalizeCursorModelName('Gemini 3 Flash')).toBe('gemini-3-flash');
    expect(normalizeCursorModelName('Kimi K2.5')).toBe('kimi-k2.5');
    expect(normalizeCursorModelName('Unknown Cursor Model')).toBeNull();
  });

  it('takes curated Cursor ids verbatim and still maps legacy label-only entries', () => {
    // `cursor-agent models` prints `<id> - <label>`, so a curated `name` that is
    // already an id must survive untouched - including both Anthropic id
    // schemes, which diverge at 4.7 and cannot be derived from the label.
    expect(normalizeCursorCuratedModelId({ name: 'auto', label: 'Auto' })).toBe('auto');
    expect(normalizeCursorCuratedModelId({
      name: 'claude-opus-4-7-low',
      label: 'Claude Opus 4.7 1M Low',
    })).toBe('claude-opus-4-7-low');
    expect(normalizeCursorCuratedModelId({
      name: 'claude-4.6-opus-high',
      label: 'Claude Opus 4.6 1M',
    })).toBe('claude-4.6-opus-high');
    expect(normalizeCursorCuratedModelId({
      name: 'gpt-5.6-sol-xhigh',
      label: 'GPT-5.6 Sol 1M Extra High',
    })).toBe('gpt-5.6-sol-xhigh');

    // A label-only catalog (the pre-2026-08-26 shape) still goes through the mapper.
    expect(normalizeCursorCuratedModelId({ name: 'Codex 5.3 Extra High' }))
      .toBe('gpt-5.3-codex-xhigh');
    expect(normalizeCursorCuratedModelId({ name: 'Unknown Cursor Model' })).toBeNull();
  });

  it('rejects unsupported or mistyped Cursor anthropic labels and ids', () => {
    expect(normalizeCursorModelName('Sonnet 4.5')).toBeNull();
    expect(normalizeCursorModelName('Sonnet 4.5 Thinking')).toBeNull();
    expect(normalizeCursorModelName('Opus 4.5 1M')).toBeNull();
    expect(normalizeCursorModelName('claude-4.7-sonnet-xhigh')).toBeNull();
    expect(normalizeCursorModelName('claude-4.5-opus-low-thinking')).toBeNull();
  });

  it('normalizes Copilot picker labels into runtime-owned catalog ids', () => {
    expect(normalizeCopilotModelName('GPT-5.4')).toBe('gpt-5.4');
    expect(normalizeCopilotModelName('GPT-5.3-Codex')).toBe('gpt-5.3-codex');
    expect(normalizeCopilotModelName('GPT-5.4 mini')).toBe('gpt-5.4-mini');
    expect(normalizeCopilotModelName('GPT-5 mini')).toBe('gpt-5-mini');
    expect(normalizeCopilotModelName('GPT-4.1')).toBe('gpt-4.1');
    expect(normalizeCopilotModelName('Claude Sonnet 4.6')).toBe('claude-sonnet-4.6');
    expect(normalizeCopilotModelName('Claude Haiku 4.5')).toBe('claude-haiku-4.5');
    expect(normalizeCopilotModelName('Claude Opus 4.6')).toBe('claude-opus-4.6');
    expect(normalizeCopilotModelName('Claude Sonnet 4')).toBe('claude-sonnet-4');
    expect(normalizeCopilotModelName('Unknown Copilot Model')).toBeNull();
  });

  it('normalizes Codex curated catalog ids from the curated YAML allowlist', () => {
    expect(normalizeCodexCuratedModelId({ name: 'gpt-5.6-sol' }))
      .toBe('gpt-5.6-sol');
    expect(normalizeCodexCuratedModelId({ label: 'GPT-5.6-Terra' }))
      .toBe('gpt-5.6-terra');
    expect(normalizeCodexCuratedModelId({ name: 'gpt-5.6-luna' }))
      .toBe('gpt-5.6-luna');
    expect(normalizeCodexCuratedModelId({ label: 'GPT-5.5' }))
      .toBe('gpt-5.5');
    expect(normalizeCodexCuratedModelId({ name: 'gpt-5.2-codex' }))
      .toBe('gpt-5.2-codex');
    expect(normalizeCodexCuratedModelId({ label: 'gpt-5.1-codex-max' }))
      .toBe('gpt-5.1-codex-max');
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
    expect(normalizeKiloModelName('xAI: Grok Code Fast 1 Optimized'))
      .toBe('kilo/x-ai/grok-code-fast-1:optimized:free');
    expect(normalizeKiloModelName('xAI: Grok Code Fast 1 Optimized (free)'))
      .toBe('kilo/x-ai/grok-code-fast-1:optimized:free');
    expect(normalizeKiloModelName('StepFun: Step 3.5 Flash'))
      .toBe('kilo/stepfun/step-3.5-flash');
    expect(normalizeKiloModelName('Elephant')).toBe('kilo/openrouter/elephant-alpha');
    expect(normalizeKiloModelName('Elephant (new)')).toBe('kilo/openrouter/elephant-alpha');
    expect(normalizeKiloModelName('Anthropic: Claude Opus 4.6'))
      .toBe('kilo/anthropic/claude-opus-4.6');
    expect(normalizeKiloModelName('Anthropic: Claude Opus 4.7'))
      .toBe('kilo/anthropic/claude-opus-4.7');
    expect(normalizeKiloModelName('OpenAI: GPT-5.4')).toBe('kilo/openai/gpt-5.4');
    expect(normalizeKiloModelName('MiniMax: MiniMax M2.7')).toBe('kilo/minimax/minimax-m2.7');
    expect(normalizeKiloModelName('MoonshotAI: Kimi K2.5')).toBe('kilo/moonshotai/kimi-k2.5');
    expect(normalizeKiloModelName('Z.ai: GLM 5.1')).toBe('kilo/z-ai/glm-5.1');
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

  it('preserves Junie picker labels as literal curated ids', () => {
    expect(normalizeJunieCuratedModelId({ name: 'Gemini 3 Flash' })).toBe('Gemini 3 Flash');
    expect(normalizeJunieCuratedModelId({ name: 'Claude Opus 4.7' })).toBe('Claude Opus 4.7');
    expect(normalizeJunieCuratedModelId({ name: 'Claude Sonnet 4.6' })).toBe('Claude Sonnet 4.6');
    expect(normalizeJunieCuratedModelId({ name: 'Gemini 3.1 Pro Preview' })).toBe('Gemini 3.1 Pro Preview');
    expect(normalizeJunieCuratedModelId({ name: 'GPT-5.3-codex' })).toBe('GPT-5.3-codex');
    expect(normalizeJunieCuratedModelId({ name: 'GPT-5.4' })).toBe('GPT-5.4');
    expect(normalizeJunieCuratedModelId({ name: 'Grok 4.1 Fast Reasoning' })).toBe('Grok 4.1 Fast Reasoning');
    expect(normalizeJunieCuratedModelId({ name: 'Unknown Junie Model' })).toBe('Unknown Junie Model');
  });
});
