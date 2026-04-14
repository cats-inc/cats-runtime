import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(knowledge.catalog.support).toEqual({
      tier: 'full',
      advancedMetadataStatus: 'verified_manifest',
      discoveryMode: 'manual_refresh',
      provenance: {
        status: 'verified_manifest',
        manifestId: 'codex-api-openai-v1',
        manifestVersion: '2026-04-07',
        evidenceRefs: [
          'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-api-openai-v1',
        ],
      },
    });
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
        { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
        { id: 'gpt-5.2', label: 'gpt-5.2' },
      ],
    }));

    expect(knowledge.supportTier).toBe('full');
    expect(knowledge.catalog.support).toEqual({
      tier: 'full',
      advancedMetadataStatus: 'verified_manifest',
      discoveryMode: 'manual_refresh',
      provenance: {
        status: 'verified_manifest',
        manifestId: 'codex-cli-v1',
        manifestVersion: '2026-04-07',
        evidenceRefs: [
          'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-cli-v1',
        ],
      },
    });
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
              'gpt-5.3-codex-spark',
              'gpt-5.2',
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
              'gpt-5.2',
            ],
          },
          {
            value: 'medium',
            label: 'Medium',
            description: 'Balances speed and reasoning depth for everyday tasks.',
            applicableEntryIds: [
              'gpt-5.3-codex-spark',
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
              'gpt-5.2',
            ],
          },
          {
            value: 'high',
            label: 'High (default)',
            description: 'Greater reasoning depth for complex problems.',
            applicableEntryIds: [
              'gpt-5.3-codex-spark',
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
              'gpt-5.3-codex-spark',
              'gpt-5.2',
            ],
          },
        ],
        applicableEntryIds: [
          'gpt-5.4',
          'gpt-5.4-mini',
          'gpt-5.3-codex',
          'gpt-5.3-codex-spark',
          'gpt-5.2',
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
    expect(knowledge.entryDefaults['gpt-5.3-codex-spark']).toEqual({
      'codex.reasoning_effort': 'high',
    });
    expect(knowledge.entryDefaults['gpt-5.2']).toEqual({
      'codex.reasoning_effort': 'medium',
    });
    expect(knowledge.controlsByKey['codex.reasoning_effort']).toBeDefined();
  });

  it('treats curated CLI entries as authoritative for advanced entry filtering and order', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-curated-knowledge-'));
    const curatedPath = join(runtimeRoot, 'config', 'curated-model-catalogs.yaml');
    mkdirSync(join(runtimeRoot, 'config'), { recursive: true });
    writeFileSync(curatedPath, [
      'schema_version: 1',
      'catalogs:',
      '  - cli: Codex',
      '    last_updated: 2026-04-08',
      '    shared_options:',
      '      - name: Reasoning Level',
      '        values: [Low, Medium, High, Extra High]',
      '        default: Medium',
      '    models:',
      '      - name: gpt-5.3-codex-spark',
      '        label: gpt-5.3-codex-spark',
      '        default: true',
      '        options:',
      '          - name: Reasoning Level',
      '            default: High',
      '      - name: gpt-5.0',
      '      - name: gpt-5.4',
      '        label: gpt-5.4',
      '',
    ].join('\n'), 'utf8');

    try {
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
          { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
          { id: 'gpt-5.2', label: 'gpt-5.2' },
        ],
      }), {
        env: {
          ...process.env,
          CATS_RUNTIME_DIR: runtimeRoot,
        },
      });

      expect(knowledge.catalog.entries.map((entry) => entry.id)).toEqual([
        'gpt-5.3-codex-spark',
        'gpt-5.4',
      ]);
      expect(knowledge.catalog.controls).toEqual([
        expect.objectContaining({
          key: 'codex.reasoning_effort',
          label: 'Reasoning effort',
          description: 'Controls Codex CLI reasoning depth for supported models.',
          kind: 'enum',
          scope: 'both',
          values: expect.arrayContaining([
            {
              value: 'low',
              label: 'Low',
              description: 'Fast responses with lighter reasoning.',
              applicableEntryIds: ['gpt-5.3-codex-spark', 'gpt-5.4'],
            },
            {
              value: 'medium',
              label: 'Medium',
              description: 'Balances speed and reasoning depth for everyday tasks.',
              applicableEntryIds: ['gpt-5.3-codex-spark'],
            },
            {
              value: 'high',
              label: 'High (default)',
              description: 'Greater reasoning depth for complex problems.',
              applicableEntryIds: ['gpt-5.3-codex-spark'],
            },
            {
              value: 'xhigh',
              label: 'Extra High',
              description: 'Extra high reasoning depth for complex problems.',
              applicableEntryIds: ['gpt-5.3-codex-spark', 'gpt-5.4'],
            },
            {
              value: 'medium',
              label: 'Medium (default)',
              description: 'Balances speed and reasoning depth for everyday tasks.',
              applicableEntryIds: ['gpt-5.4'],
            },
            {
              value: 'high',
              label: 'High',
              description: 'Greater reasoning depth for complex problems.',
              applicableEntryIds: ['gpt-5.4'],
            },
          ]),
          applicableEntryIds: ['gpt-5.3-codex-spark', 'gpt-5.4'],
          semanticTags: ['reasoning_intensity'],
        }),
      ]);
      expect(knowledge.catalog.defaultSelection).toEqual({
        entryId: 'gpt-5.3-codex-spark',
        entryMode: 'explicit',
        controls: {
          'codex.reasoning_effort': 'high',
        },
      });
      expect(knowledge.catalog.warnings).toEqual([
        "Curated model 'gpt-5.0' for Codex could not be normalized and was ignored.",
      ]);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('normalizes curated Cursor raw labels into advanced catalog entries', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-curated-cursor-'));
    const curatedPath = join(runtimeRoot, 'config', 'curated-model-catalogs.yaml');
    mkdirSync(join(runtimeRoot, 'config'), { recursive: true });
    writeFileSync(curatedPath, [
      'schema_version: 1',
      'catalogs:',
      '  - cli: Cursor',
      '    last_updated: 2026-04-14',
      '    models:',
      '      - name: Composer 2 Fast',
      '      - name: GPT-5.4 1M',
      '      - name: Opus 4.5 Thinking',
      '      - name: Gemini 3 Flash',
      '',
    ].join('\n'), 'utf8');

    try {
      const target: ProviderTargetDescriptor = {
        providerName: 'cursor',
        backend: 'cli',
        instanceId: 'default',
        defaultTarget: true,
        cliInstance: {
          id: 'default',
          providerName: 'cursor',
          backend: 'cli',
          command: 'cursor-agent',
        },
      };

      const knowledge = buildProviderAdvancedKnowledge(target, createCatalog({
        provider: 'cursor',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4-medium',
        models: [
          { id: 'composer-2-fast', label: 'composer-2-fast' },
          { id: 'gpt-5.4-medium', label: 'gpt-5.4-medium', default: true },
          { id: 'claude-4.5-opus-thinking', label: 'claude-4.5-opus-thinking' },
          { id: 'gemini-3-flash', label: 'gemini-3-flash' },
        ],
      }), {
        env: {
          ...process.env,
          CATS_RUNTIME_DIR: runtimeRoot,
        },
      });

      expect(knowledge.supportTier).toBe('entry_only');
      expect(knowledge.catalog.entries).toEqual([
        {
          id: 'composer-2-fast',
          label: 'Composer 2 Fast',
        },
        {
          id: 'gpt-5.4-medium',
          label: 'GPT-5.4 1M',
          default: true,
          capabilityTags: ['reasoning'],
        },
        {
          id: 'claude-4.5-opus-thinking',
          label: 'Opus 4.5 Thinking',
          capabilityTags: ['reasoning'],
        },
        {
          id: 'gemini-3-flash',
          label: 'Gemini 3 Flash',
          capabilityTags: ['latency_optimized'],
        },
      ]);
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.defaultSelection).toBeNull();
      expect(knowledge.catalog.warnings).toEqual([]);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('normalizes curated Copilot grouped providers into advanced catalog entries', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-curated-copilot-'));
    const curatedPath = join(runtimeRoot, 'config', 'curated-model-catalogs.yaml');
    mkdirSync(join(runtimeRoot, 'config'), { recursive: true });
    writeFileSync(curatedPath, [
      'schema_version: 1',
      'catalogs:',
      '  - cli: Copilot',
      '    version: v1.0.26',
      '    last_updated: 2026-04-15',
      '    providers:',
      '      - name: OpenAI',
      '        shared_options:',
      '          - name: Reasoning Effort',
      '            values:',
      '              - name: Low',
      '                notes:',
      '                  - "Faster responses, less detailed reasoning"',
      '              - name: Medium',
      '                notes:',
      '                  - "Balanced speed and reasoning depth"',
      '              - name: High',
      '                notes:',
      '                  - "More thorough reasoning, slower responses"',
      '            default: Medium',
      '        models:',
      '          - name: GPT-5.4',
      '            default: true',
      '          - name: GPT-5.4 mini',
      '          - name: GPT-5.2-Codex',
      '            options:',
      '              - name: Reasoning Effort',
      '                default: High',
      '      - name: Anthropic',
      '        shared_options:',
      '          - name: Effort Level',
      '            values:',
      '              - name: Low',
      '                notes:',
      '                  - "Minimal thinking, prioritizes speed"',
      '              - name: Medium',
      '                notes:',
      '                  - "Balanced, thinks on harder problems"',
      '              - name: High',
      '                notes:',
      '                  - "Optimal performance, thorough thinking"',
      '            default: Medium',
      '        models:',
      '          - name: Claude Opus 4.6',
      '            options:',
      '              - name: Effort Level',
      '                default: High',
      '          - name: Claude Sonnet 4',
      '',
    ].join('\n'), 'utf8');

    try {
      const target: ProviderTargetDescriptor = {
        providerName: 'copilot',
        backend: 'cli',
        instanceId: 'default',
        defaultTarget: true,
        cliInstance: {
          id: 'default',
          providerName: 'copilot',
          backend: 'cli',
          command: 'copilot',
        },
      };

      const knowledge = buildProviderAdvancedKnowledge(target, createCatalog({
        provider: 'copilot',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
          { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
          { id: 'claude-opus-4.6', label: 'claude-opus-4.6' },
          { id: 'claude-sonnet-4', label: 'claude-sonnet-4' },
        ],
      }), {
        env: {
          ...process.env,
          CATS_RUNTIME_DIR: runtimeRoot,
        },
      });

      expect(knowledge.supportTier).toBe('full');
      expect(knowledge.catalog.support).toEqual({
        tier: 'full',
        advancedMetadataStatus: 'unverified_omitted',
        discoveryMode: 'manual_refresh',
        provenance: {
          status: 'unverified_omitted',
        },
      });
      expect(knowledge.catalog.entries).toEqual([
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          default: true,
          capabilityTags: ['reasoning'],
        },
        {
          id: 'gpt-5.4-mini',
          label: 'GPT-5.4 mini',
          default: false,
          capabilityTags: ['reasoning', 'latency_optimized'],
        },
        {
          id: 'gpt-5.2-codex',
          label: 'GPT-5.2-Codex',
          default: false,
        },
        {
          id: 'claude-opus-4.6',
          label: 'Claude Opus 4.6',
          default: false,
          capabilityTags: ['reasoning'],
        },
        {
          id: 'claude-sonnet-4',
          label: 'Claude Sonnet 4',
          default: false,
        },
      ]);
      expect(knowledge.catalog.controls).toEqual([
        {
          key: 'copilot.reasoning_effort',
          label: 'Reasoning effort',
          description: 'Controls GitHub Copilot CLI reasoning effort for supported models.',
          kind: 'enum',
          scope: 'both',
          values: expect.arrayContaining([
            {
              value: 'low',
              label: 'Low',
              description: 'Faster responses, less detailed reasoning',
              applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2-codex'],
            },
            {
              value: 'medium',
              label: 'Medium (default)',
              description: 'Balanced speed and reasoning depth',
              applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini'],
            },
            {
              value: 'high',
              label: 'High',
              description: 'More thorough reasoning, slower responses',
              applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini'],
            },
            {
              value: 'high',
              label: 'High (default)',
              description: 'More thorough reasoning, slower responses',
              applicableEntryIds: ['gpt-5.2-codex'],
            },
            {
              value: 'low',
              label: 'Low',
              description: 'Minimal thinking, prioritizes speed',
              applicableEntryIds: ['claude-opus-4.6', 'claude-sonnet-4'],
            },
            {
              value: 'medium',
              label: 'Medium (default)',
              description: 'Balanced, thinks on harder problems',
              applicableEntryIds: ['claude-sonnet-4'],
            },
            {
              value: 'high',
              label: 'High (default)',
              description: 'Optimal performance, thorough thinking',
              applicableEntryIds: ['claude-opus-4.6'],
            },
            {
              value: 'high',
              label: 'High',
              description: 'Optimal performance, thorough thinking',
              applicableEntryIds: ['claude-sonnet-4'],
            },
          ]),
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.4-mini',
            'gpt-5.2-codex',
            'claude-opus-4.6',
            'claude-sonnet-4',
          ],
          semanticTags: ['reasoning_intensity'],
        },
      ]);
      expect(knowledge.catalog.defaultSelection).toEqual({
        entryId: 'gpt-5.4',
        entryMode: 'explicit',
        controls: {
          'copilot.reasoning_effort': 'medium',
        },
      });
      expect(knowledge.entryDefaults['gpt-5.2-codex']).toEqual({
        'copilot.reasoning_effort': 'high',
      });
      expect(knowledge.controlsByKey['copilot.reasoning_effort']).toBeDefined();
      expect(knowledge.catalog.warnings).toEqual([]);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('normalizes curated Kilo raw labels into advanced catalog entries', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-curated-kilo-'));
    const curatedPath = join(runtimeRoot, 'config', 'curated-model-catalogs.yaml');
    mkdirSync(join(runtimeRoot, 'config'), { recursive: true });
    writeFileSync(curatedPath, [
      'schema_version: 1',
      'catalogs:',
      '  - cli: Kilo',
      '    last_updated: 2026-04-14',
      '    models:',
      '      - name: Kilo Auto Frontier',
      '      - name: Elephant (new)',
      '      - name: "OpenAI: GPT-5.4"',
      '        default: true',
      '      - name: "MoonshotAI: Kimi K2.5"',
      '',
    ].join('\n'), 'utf8');

    try {
      const target: ProviderTargetDescriptor = {
        providerName: 'kilo',
        backend: 'cli',
        instanceId: 'default',
        defaultTarget: true,
        cliInstance: {
          id: 'default',
          providerName: 'kilo',
          backend: 'cli',
          command: 'kilo',
        },
      };

      const knowledge = buildProviderAdvancedKnowledge(target, createCatalog({
        provider: 'kilo',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'kilo/openai/gpt-5.4',
        models: [
          { id: 'kilo/kilo-auto/frontier', label: 'kilo/kilo-auto/frontier' },
          { id: 'kilo/openrouter/elephant-alpha', label: 'kilo/openrouter/elephant-alpha' },
          { id: 'kilo/openai/gpt-5.4', label: 'kilo/openai/gpt-5.4', default: true },
          { id: 'kilo/moonshotai/kimi-k2.5', label: 'kilo/moonshotai/kimi-k2.5' },
        ],
      }), {
        env: {
          ...process.env,
          CATS_RUNTIME_DIR: runtimeRoot,
        },
      });

      expect(knowledge.supportTier).toBe('entry_only');
      expect(knowledge.catalog.entries).toEqual([
        {
          id: 'kilo/kilo-auto/frontier',
          label: 'Kilo Auto Frontier',
          default: false,
        },
        {
          id: 'kilo/openrouter/elephant-alpha',
          label: 'Elephant (new)',
          default: false,
        },
        {
          id: 'kilo/openai/gpt-5.4',
          label: 'OpenAI: GPT-5.4',
          default: true,
          capabilityTags: ['reasoning'],
        },
        {
          id: 'kilo/moonshotai/kimi-k2.5',
          label: 'MoonshotAI: Kimi K2.5',
          default: false,
        },
      ]);
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.defaultSelection).toBeNull();
      expect(knowledge.catalog.warnings).toEqual([]);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
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
      defaultModel: 'opus',
      source: 'static',
      cache: null,
      models: [
        { id: 'opus', label: 'Opus 4.6 with 1M context', default: true },
        { id: 'sonnet', label: 'Sonnet 4.6' },
        { id: 'haiku', label: 'Haiku 4.5' },
      ],
      warnings: [],
    });

    expect(knowledge.supportTier).toBe('full');
    expect(knowledge.catalog.support).toEqual({
      tier: 'full',
      advancedMetadataStatus: 'verified_manifest',
      discoveryMode: 'manual_refresh',
      provenance: {
        status: 'verified_manifest',
        manifestId: 'claude-cli-v1',
        manifestVersion: '2026-04-07',
        evidenceRefs: [
          'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#claude-cli-v1',
        ],
      },
    });
    expect(knowledge.catalog.entries).toEqual([
      {
        id: 'opus',
        label: 'Opus 4.6 with 1M context',
        default: true,
        capabilityTags: ['tool_use', 'reasoning'],
        notes: ['Most capable for complex work.'],
      },
      {
        id: 'sonnet',
        label: 'Sonnet 4.6',
        capabilityTags: ['tool_use'],
        notes: ['Best for everyday tasks.'],
      },
      {
        id: 'haiku',
        label: 'Haiku 4.5',
        capabilityTags: ['tool_use', 'latency_optimized'],
        notes: ['Fastest for quick answers.'],
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
          applicableEntryIds: ['opus', 'sonnet'],
        },
        {
          value: 'medium',
          label: 'Medium (default)',
          description: 'Balanced effort for most work.',
          applicableEntryIds: ['opus', 'sonnet'],
        },
        {
          value: 'high',
          label: 'High',
          description: 'Greater depth for complex tasks.',
          applicableEntryIds: ['opus', 'sonnet'],
        },
        {
          value: 'max',
          label: 'Max',
          description: 'Maximum effort for the most complex work.',
          applicableEntryIds: ['opus'],
        },
      ],
      applicableEntryIds: ['opus', 'sonnet'],
      semanticTags: ['reasoning_intensity'],
    });
    expect(knowledge.catalog.defaultSelection).toEqual({
      entryId: 'opus',
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
    expect(knowledge.catalog.support).toEqual({
      tier: 'full',
      advancedMetadataStatus: 'verified_manifest',
      discoveryMode: 'manual_refresh',
      provenance: {
        status: 'verified_manifest',
        manifestId: 'ollama-local-v1',
        manifestVersion: '2026-04-07',
        evidenceRefs: [
          'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#ollama-local-v1',
        ],
      },
    });
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

  it('keeps unverified targets conservative and marks omitted metadata explicitly', () => {
    const target: ProviderTargetDescriptor = {
      providerName: 'pi',
      backend: 'cli',
      instanceId: 'default',
      defaultTarget: true,
      cliInstance: {
        id: 'default',
        providerName: 'pi',
        backend: 'cli',
        command: 'pi',
      },
    };

    const knowledge = buildProviderAdvancedKnowledge(target, {
      provider: 'pi',
      backend: 'cli',
      instance: 'default',
      defaultModel: 'openai-codex/gpt-5.4',
      source: 'static',
      cache: null,
      models: [
        { id: 'openai-codex/gpt-5.4', label: 'openai-codex/gpt-5.4', default: true },
      ],
      warnings: [],
    });

    expect(knowledge.supportTier).toBe('entry_only');
    expect(knowledge.catalog.support).toEqual({
      tier: 'entry_only',
      advancedMetadataStatus: 'unverified_omitted',
      discoveryMode: 'manual_refresh',
      provenance: {
        status: 'unverified_omitted',
      },
    });
    expect(knowledge.catalog.presets).toEqual([]);
    expect(knowledge.catalog.controls).toEqual([]);
    expect(knowledge.catalog.defaultSelection).toBeNull();
  });
});
