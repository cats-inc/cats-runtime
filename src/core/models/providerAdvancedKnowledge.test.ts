import { describe, expect, it } from 'vitest';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { buildProviderAdvancedKnowledge } from './providerAdvancedKnowledge.js';
import type { ProviderModelCatalogResult } from './providerModelCatalog.js';

function createCatalog(
  overrides: Partial<ProviderModelCatalogResult> = {},
): ProviderModelCatalogResult {
  return {
    provider: 'codex',
    backend: 'api',
    instance: 'main',
    defaultModel: 'gpt-5.4',
    source: 'static',
    cache: null,
    models: [
      { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { id: 'gpt-5-mini', label: 'gpt-5-mini' },
    ],
    warnings: [],
    ...overrides,
  };
}

describe('buildProviderAdvancedKnowledge', () => {
  it('builds runtime-owned OpenAI presets, controls, and capability tags', () => {
    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'main',
      defaultTarget: true,
      remoteInstance: {
        id: 'main',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-5.4',
      },
    };

    const knowledge = buildProviderAdvancedKnowledge(target, createCatalog());

    expect(knowledge.supportTier).toBe('full');
    expect(knowledge.catalog.entries).toEqual([
      {
        id: 'gpt-5.4',
        label: 'gpt-5.4',
        default: true,
        capabilityTags: ['tool_use', 'reasoning'],
      },
      {
        id: 'gpt-5.3-codex',
        label: 'gpt-5.3-codex',
        capabilityTags: ['tool_use'],
      },
      {
        id: 'gpt-5-mini',
        label: 'gpt-5-mini',
        capabilityTags: ['tool_use', 'latency_optimized'],
      },
    ]);
    expect(knowledge.catalog.controls).toEqual([
      {
        key: 'openai.reasoning_effort',
        label: 'Reasoning effort',
        description: 'Controls OpenAI reasoning effort for supported GPT-5 entries.',
        kind: 'enum',
        scope: 'both',
        values: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
        applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5-mini'],
        semanticTags: ['reasoning_intensity'],
      },
    ]);
    expect(knowledge.catalog.presets).toEqual([
      {
        id: 'balanced',
        label: 'Balanced',
        availability: 'supported',
        applicableEntryIds: ['gpt-5.4'],
        preferredEntryId: 'gpt-5.4',
        controlDefaults: {
          'openai.reasoning_effort': 'medium',
        },
      },
      {
        id: 'fast',
        label: 'Fast',
        availability: 'supported',
        applicableEntryIds: ['gpt-5.3-codex'],
        preferredEntryId: 'gpt-5.3-codex',
        controlDefaults: {
          'openai.reasoning_effort': 'low',
        },
      },
      {
        id: 'deep_reasoning',
        label: 'Deep reasoning',
        availability: 'supported',
        applicableEntryIds: ['gpt-5.4'],
        preferredEntryId: 'gpt-5.4',
        controlDefaults: {
          'openai.reasoning_effort': 'high',
        },
      },
    ]);
    expect(knowledge.catalog.defaultSelection).toEqual({
      entryId: 'gpt-5.4',
      entryMode: 'auto',
      presetId: 'balanced',
      controls: {
        'openai.reasoning_effort': 'medium',
      },
    });
  });

  it('publishes curated native Codex CLI effort controls and defaults', () => {
    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'cli',
      instanceId: 'default',
      defaultTarget: true,
      cliInstance: {
        id: 'default',
        providerName: 'codex',
        backend: 'cli',
        command: 'codex',
      },
    };

    const knowledge = buildProviderAdvancedKnowledge(target, createCatalog({
      provider: 'codex',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'gpt-5.4',
      models: [
        { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
        { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
        { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
        { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
        { id: 'gpt-5.2', label: 'gpt-5.2' },
        { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
        { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
      ],
    }));

    expect(knowledge.supportTier).toBe('full');
    expect(knowledge.catalog.controls).toEqual([
      {
        key: 'codex.reasoning_effort',
        label: 'Reasoning effort',
        description: 'Controls Codex CLI reasoning depth for supported models.',
        kind: 'enum',
        scope: 'both',
        values: [
          {
            value: 'low',
            label: 'Low',
            description: 'Fast responses with lighter reasoning.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.2-codex',
              'gpt-5.2',
              'gpt-5.1-codex-max',
            ],
          },
          {
            value: 'medium',
            label: 'Medium (default)',
            description: 'Balances speed and reasoning depth for everyday tasks.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.2-codex',
              'gpt-5.2',
              'gpt-5.1-codex-max',
              'gpt-5.1-codex-mini',
            ],
          },
          {
            value: 'high',
            label: 'High',
            description: 'Greater reasoning depth for complex problems.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.2-codex',
              'gpt-5.2',
              'gpt-5.1-codex-max',
              'gpt-5.1-codex-mini',
            ],
          },
          {
            value: 'xhigh',
            label: 'Extra high',
            description: 'Extra high reasoning depth for complex problems.',
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.4-mini',
              'gpt-5.3-codex',
              'gpt-5.2-codex',
              'gpt-5.2',
              'gpt-5.1-codex-max',
            ],
          },
        ],
        applicableEntryIds: [
          'gpt-5.4',
          'gpt-5.4-mini',
          'gpt-5.3-codex',
          'gpt-5.2-codex',
          'gpt-5.2',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
        ],
        semanticTags: ['reasoning_intensity'],
      },
    ]);
    expect(knowledge.catalog.presets).toEqual([]);
    expect(knowledge.catalog.defaultSelection).toEqual({
      entryId: 'gpt-5.4',
      entryMode: 'explicit',
      controls: {
        'codex.reasoning_effort': 'medium',
      },
    });
    expect(knowledge.entryDefaults['gpt-5.1-codex-mini']).toEqual({
      'codex.reasoning_effort': 'medium',
    });
    expect(knowledge.controlsByKey['codex.reasoning_effort']).toBeDefined();
  });

  it('publishes curated native Claude CLI aliases and effort controls', () => {
    const target: ProviderTargetDescriptor = {
      providerName: 'claude',
      backend: 'cli',
      instanceId: 'default',
      defaultTarget: true,
      cliInstance: {
        id: 'default',
        providerName: 'claude',
        backend: 'cli',
        command: 'claude',
      },
    };

    const knowledge = buildProviderAdvancedKnowledge(target, {
      provider: 'claude',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'default',
      source: 'static',
      cache: null,
      models: [
        { id: 'default', label: 'Default (recommended)', default: true },
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'haiku', label: 'Haiku' },
      ],
      warnings: [],
    });

    expect(knowledge.supportTier).toBe('full');
    expect(knowledge.catalog.entries).toEqual([
      {
        id: 'default',
        label: 'Default (recommended)',
        default: true,
        capabilityTags: ['tool_use'],
        notes: ['Opus 4.6 with 1M context. Most capable for complex work.'],
      },
      {
        id: 'sonnet',
        label: 'Sonnet',
        capabilityTags: ['tool_use'],
        notes: ['Sonnet 4.6. Best for everyday tasks.'],
      },
      {
        id: 'haiku',
        label: 'Haiku',
        capabilityTags: ['tool_use', 'latency_optimized'],
        notes: ['Haiku 4.5. Fastest for quick answers.'],
      },
    ]);
    expect(knowledge.catalog.controls[0]).toEqual({
      key: 'claude.reasoning_effort',
      label: 'Reasoning effort',
      description: 'Controls Claude Code effort for supported models.',
      kind: 'enum',
      scope: 'both',
      values: [
        {
          value: 'low',
          label: 'Low',
          description: 'Lighter reasoning for faster responses.',
          applicableEntryIds: ['default', 'sonnet'],
        },
        {
          value: 'medium',
          label: 'Medium (default)',
          description: 'Balanced effort for most work.',
          applicableEntryIds: ['default', 'sonnet'],
        },
        {
          value: 'high',
          label: 'High',
          description: 'Greater depth for complex tasks.',
          applicableEntryIds: ['default', 'sonnet'],
        },
        {
          value: 'max',
          label: 'Max',
          description: 'Maximum effort for the most complex work.',
          applicableEntryIds: ['default'],
        },
      ],
      applicableEntryIds: ['default', 'sonnet'],
      semanticTags: ['reasoning_intensity'],
    });
    expect(knowledge.catalog.defaultSelection).toEqual({
      entryId: 'default',
      entryMode: 'explicit',
      controls: {
        'claude.reasoning_effort': 'medium',
      },
    });
  });

  it('keeps Ollama controls runtime-owned without leaking raw vendor payloads', () => {
    const target: ProviderTargetDescriptor = {
      providerName: 'ollama',
      backend: 'local',
      instanceId: 'local',
      defaultTarget: true,
      remoteInstance: {
        id: 'local',
        providerName: 'ollama',
        backend: 'local',
        transport: 'ollama',
        model: 'qwen3:latest',
      },
    };

    const knowledge = buildProviderAdvancedKnowledge(target, createCatalog({
      provider: 'ollama',
      backend: 'local',
      instance: 'local',
      defaultModel: 'qwen3:latest',
      models: [
        { id: 'qwen3:latest', label: 'qwen3:latest', default: true, status: 'running' },
        { id: 'llama3.2:latest', label: 'llama3.2:latest', status: 'available' },
      ],
    }));

    expect(knowledge.supportTier).toBe('full');
    expect(knowledge.catalog.controls).toEqual([
      {
        key: 'ollama.temperature',
        label: 'Temperature',
        description: 'Adjusts Ollama sampling temperature.',
        kind: 'number',
        scope: 'both',
        minimum: 0,
        maximum: 2,
        step: 0.1,
        applicableEntryIds: ['qwen3:latest', 'llama3.2:latest'],
        semanticTags: ['sampling_temperature'],
      },
      {
        key: 'ollama.keep_alive',
        label: 'Keep alive',
        description: 'Keeps the Ollama model loaded for the configured duration.',
        kind: 'string',
        scope: 'request',
        applicableEntryIds: ['qwen3:latest', 'llama3.2:latest'],
        semanticTags: ['model_warmth'],
      },
    ]);
    expect(knowledge.catalog.defaultSelection).toEqual({
      entryId: 'qwen3:latest',
      entryMode: 'auto',
      presetId: 'balanced',
    });
  });
});
