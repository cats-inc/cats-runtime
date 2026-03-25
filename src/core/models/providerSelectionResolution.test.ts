import { describe, expect, it } from 'vitest';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { ProviderAdvancedKnowledgeContext } from './providerAdvancedKnowledge.js';
import {
  buildProviderExecutionRequestPatch,
  resolveProviderSelection,
} from './providerSelectionResolution.js';

function createKnowledgeContext(
  overrides: Partial<ProviderAdvancedKnowledgeContext>,
): ProviderAdvancedKnowledgeContext {
  const target: ProviderTargetDescriptor = overrides.target ?? {
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

  return {
    target,
    catalog: overrides.catalog ?? {
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
      defaultModel: 'gpt-5.4',
      source: 'static',
      cache: null,
      entries: [
        { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
        { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      ],
      presets: [
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
      ],
      controls: [{
        key: 'openai.reasoning_effort',
        label: 'Reasoning effort',
        kind: 'enum',
        scope: 'both',
        values: ['low', 'medium', 'high'],
        applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex'],
      }],
      defaultSelection: {
        entryId: 'gpt-5.4',
        entryMode: 'auto',
        presetId: 'balanced',
        controls: {
          'openai.reasoning_effort': 'medium',
        },
      },
      support: {
        tier: 'full',
      },
      warnings: [],
    },
    supportTier: overrides.supportTier ?? 'full',
    entryDefaults: overrides.entryDefaults ?? {
      'gpt-5.4': { 'openai.reasoning_effort': 'medium' },
      'gpt-5.3-codex': { 'openai.reasoning_effort': 'medium' },
    },
    controlsByKey: overrides.controlsByKey ?? {
      'openai.reasoning_effort': {
        key: 'openai.reasoning_effort',
        label: 'Reasoning effort',
        kind: 'enum',
        scope: 'both',
        values: ['low', 'medium', 'high'],
        applicableEntryIds: ['gpt-5.4', 'gpt-5.3-codex'],
      },
    },
  };
}

describe('provider selection resolution', () => {
  it('lets auto resolution switch entries for a preset but keeps explicit pins strict', () => {
    const knowledge = createKnowledgeContext({});

    const autoResolved = resolveProviderSelection(knowledge, {
      entryMode: 'auto',
      presetId: 'fast',
    });
    expect(autoResolved.resolution.model).toBe('gpt-5.3-codex');

    expect(() => resolveProviderSelection(knowledge, {
      entryId: 'gpt-5.3-codex',
      entryMode: 'explicit',
      presetId: 'deep_reasoning',
    })).toThrow(/not applicable/i);
  });

  it('applies defaults and overrides with the required precedence order', () => {
    const knowledge = createKnowledgeContext({});

    const resolved = resolveProviderSelection(knowledge, {
      entryMode: 'auto',
      presetId: 'deep_reasoning',
      controls: {
        'openai.reasoning_effort': 'low',
      },
    }, {
      requestControls: {
        'openai.reasoning_effort': 'medium',
      },
      mode: 'request',
    });

    expect(resolved.resolution.controls).toEqual({
      'openai.reasoning_effort': 'medium',
    });
    expect(resolved.execution.requestBodyPatch).toEqual({
      reasoning: {
        effort: 'medium',
      },
    });
  });

  it('rejects request-only controls when callers try to store them on the session', () => {
    const knowledge = createKnowledgeContext({
      target: {
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
      },
      catalog: {
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen3:latest',
        source: 'config',
        cache: null,
        entries: [{ id: 'qwen3:latest', label: 'qwen3:latest', default: true }],
        presets: [],
        controls: [{
          key: 'ollama.keep_alive',
          label: 'Keep alive',
          kind: 'string',
          scope: 'request',
          applicableEntryIds: ['qwen3:latest'],
        }],
        defaultSelection: {
          entryId: 'qwen3:latest',
          entryMode: 'auto',
        },
        support: {
          tier: 'full',
        },
        warnings: [],
      },
      controlsByKey: {
        'ollama.keep_alive': {
          key: 'ollama.keep_alive',
          label: 'Keep alive',
          kind: 'string',
          scope: 'request',
          applicableEntryIds: ['qwen3:latest'],
        },
      },
      entryDefaults: {},
    });

    expect(() => resolveProviderSelection(knowledge, {
      entryId: 'qwen3:latest',
      entryMode: 'explicit',
      controls: {
        'ollama.keep_alive': '15m',
      },
    })).toThrow(/request-scoped only/i);
  });

  it('maps resolved control snapshots into backend request patches', () => {
    const patch = buildProviderExecutionRequestPatch({
      backend: 'local',
      remoteInstance: {
        id: 'local',
        providerName: 'ollama',
        backend: 'local',
        transport: 'ollama',
      },
    }, {
      'ollama.temperature': 0.2,
      'ollama.keep_alive': '15m',
    });

    expect(patch).toEqual({
      keep_alive: '15m',
      options: {
        temperature: 0.2,
      },
    });
  });
});
