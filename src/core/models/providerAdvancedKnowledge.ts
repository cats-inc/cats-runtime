import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type {
  ProviderAdvancedCatalogControl,
  ProviderAdvancedCatalogEntry,
  ProviderAdvancedCatalogPreset,
  ProviderAdvancedCatalogResult,
  ProviderAdvancedCatalogSupportTier,
  ProviderAdvancedControlValue,
} from './providerAdvancedCatalog.js';
import type { ProviderModelCatalogResult } from './providerModelCatalog.js';
import { cloneProviderControls } from './providerControlUtils.js';
import type { ProviderModelSelection } from './providerSelectionResolution.js';

export interface ProviderAdvancedKnowledgeContext {
  target: ProviderTargetDescriptor;
  catalog: ProviderAdvancedCatalogResult;
  supportTier: ProviderAdvancedCatalogSupportTier;
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
  controlsByKey: Record<string, ProviderAdvancedCatalogControl>;
}

function buildEntryCapabilityTags(
  target: ProviderTargetDescriptor,
  entryId: string,
): string[] | undefined {
  // These are conservative runtime-owned heuristics until curated provider
  // metadata grows explicit capability/tier annotations per entry.
  const tags = new Set<string>();
  if (
    target.backend === 'api'
    || target.backend === 'agent'
    || target.providerName === 'codex'
    || target.providerName === 'claude'
    || target.providerName === 'gemini'
  ) {
    tags.add('tool_use');
  }

  const normalized = entryId.toLowerCase();
  if (
    normalized.includes('opus')
    || normalized.includes('pro')
    || normalized.includes('gpt-5.4')
    || normalized.includes('reason')
  ) {
    tags.add('reasoning');
  }
  if (
    normalized.includes('haiku')
    || normalized.includes('flash')
    || normalized.includes('mini')
  ) {
    tags.add('latency_optimized');
  }

  return tags.size > 0 ? Array.from(tags) : undefined;
}

function toAdvancedEntries(
  target: ProviderTargetDescriptor,
  catalog: ProviderModelCatalogResult,
): ProviderAdvancedCatalogEntry[] {
  return catalog.models.map((entry) => ({
    id: entry.id,
    label: entry.label,
    ...(entry.default !== undefined ? { default: entry.default } : {}),
    ...(entry.status ? { status: entry.status } : {}),
    ...(buildEntryCapabilityTags(target, entry.id)
      ? { capabilityTags: buildEntryCapabilityTags(target, entry.id) }
      : {}),
  }));
}

function pickEntryByPatterns(
  entries: ProviderAdvancedCatalogEntry[],
  patterns: RegExp[],
): ProviderAdvancedCatalogEntry | undefined {
  for (const pattern of patterns) {
    const match = entries.find((entry) => pattern.test(entry.id));
    if (match) {
      return match;
    }
  }

  return undefined;
}

function inferSupportTier(
  target: ProviderTargetDescriptor,
): ProviderAdvancedCatalogSupportTier {
  if (target.backend === 'api' && target.remoteInstance?.transport === 'openai') {
    return 'full';
  }
  if (target.backend === 'local' && target.remoteInstance?.transport === 'ollama') {
    return 'full';
  }

  return 'entry_only';
}

function hasVerifiedAdvancedMetadata(
  target: ProviderTargetDescriptor,
): boolean {
  return inferSupportTier(target) === 'full';
}

function buildOpenAiControls(
  entries: ProviderAdvancedCatalogEntry[],
): {
  controls: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  const applicableEntryIds = entries
    .filter((entry) => /gpt-5/i.test(entry.id))
    .map((entry) => entry.id);

  if (applicableEntryIds.length === 0) {
    return {
      controls: [],
      entryDefaults: {},
    };
  }

  return {
    controls: [{
      key: 'openai.reasoning_effort',
      label: 'Reasoning effort',
      description: 'Controls OpenAI reasoning effort for supported GPT-5 entries.',
      kind: 'enum',
      scope: 'both',
      values: ['low', 'medium', 'high'],
      applicableEntryIds,
      semanticTags: ['reasoning_intensity'],
    }],
    entryDefaults: Object.fromEntries(
      applicableEntryIds.map((entryId) => [
        entryId,
        { 'openai.reasoning_effort': 'medium' as ProviderAdvancedControlValue },
      ]),
    ),
  };
}

function buildOllamaControls(
  entries: ProviderAdvancedCatalogEntry[],
): {
  controls: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  const applicableEntryIds = entries.map((entry) => entry.id);
  if (applicableEntryIds.length === 0) {
    return {
      controls: [],
      entryDefaults: {},
    };
  }

  return {
    controls: [
      {
        key: 'ollama.temperature',
        label: 'Temperature',
        description: 'Adjusts Ollama sampling temperature.',
        kind: 'number',
        scope: 'both',
        minimum: 0,
        maximum: 2,
        step: 0.1,
        applicableEntryIds,
        semanticTags: ['sampling_temperature'],
      },
      {
        key: 'ollama.keep_alive',
        label: 'Keep alive',
        description: 'Keeps the Ollama model loaded for the configured duration.',
        kind: 'string',
        scope: 'request',
        applicableEntryIds,
        semanticTags: ['model_warmth'],
      },
    ],
    entryDefaults: {},
  };
}

function buildControls(
  target: ProviderTargetDescriptor,
  entries: ProviderAdvancedCatalogEntry[],
): {
  controls: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  if (target.backend === 'api' && target.remoteInstance?.transport === 'openai') {
    return buildOpenAiControls(entries);
  }
  if (target.backend === 'local' && target.remoteInstance?.transport === 'ollama') {
    return buildOllamaControls(entries);
  }

  return {
    controls: [],
    entryDefaults: {},
  };
}

function buildPresetCatalog(
  target: ProviderTargetDescriptor,
  entries: ProviderAdvancedCatalogEntry[],
  controls: ProviderAdvancedCatalogControl[],
): ProviderAdvancedCatalogPreset[] {
  // Preset selection stays runtime-owned. We intentionally infer a small
  // normalized vocabulary from known model naming patterns instead of
  // exposing raw vendor tiers directly.
  const presets: ProviderAdvancedCatalogPreset[] = [];
  const defaultEntry = entries.find((entry) => entry.default) ?? entries[0];
  const openAiReasoningControl = controls.find((control) => control.key === 'openai.reasoning_effort');

  if (!defaultEntry) {
    return presets;
  }

  const balancedControls = openAiReasoningControl
    ? { 'openai.reasoning_effort': 'medium' as ProviderAdvancedControlValue }
    : undefined;
  presets.push({
    id: 'balanced',
    label: 'Balanced',
    availability: 'supported',
    applicableEntryIds: [defaultEntry.id],
    preferredEntryId: defaultEntry.id,
    ...(balancedControls ? { controlDefaults: balancedControls } : {}),
  });

  const fastEntry = (() => {
    switch (target.providerName) {
      case 'claude':
        return pickEntryByPatterns(entries, [/haiku/i, /sonnet/i]);
      case 'gemini':
        return pickEntryByPatterns(entries, [/flash/i, /pro/i]);
      case 'codex':
        return pickEntryByPatterns(entries, [/5\.3-codex/i, /gpt-5/i]);
      default:
        return pickEntryByPatterns(entries, [/flash/i, /haiku/i, /mini/i]);
    }
  })();
  if (fastEntry) {
    presets.push({
      id: 'fast',
      label: 'Fast',
      availability: 'supported',
      applicableEntryIds: [fastEntry.id],
      preferredEntryId: fastEntry.id,
      ...(openAiReasoningControl
        ? { controlDefaults: { 'openai.reasoning_effort': 'low' } }
        : {}),
    });
  }

  const deepReasoningEntry = (() => {
    switch (target.providerName) {
      case 'claude':
        return pickEntryByPatterns(entries, [/opus/i, /sonnet/i]);
      case 'gemini':
        return pickEntryByPatterns(entries, [/pro/i]);
      case 'codex':
        return pickEntryByPatterns(entries, [/gpt-5\.4/i, /gpt-5/i]);
      default:
        return pickEntryByPatterns(entries, [/opus/i, /pro/i, /gpt-5/i]);
    }
  })();
  if (deepReasoningEntry) {
    presets.push({
      id: 'deep_reasoning',
      label: 'Deep reasoning',
      availability: 'supported',
      applicableEntryIds: [deepReasoningEntry.id],
      preferredEntryId: deepReasoningEntry.id,
      ...(openAiReasoningControl
        ? { controlDefaults: { 'openai.reasoning_effort': 'high' } }
        : {}),
    });
  }

  return presets;
}

function buildDefaultSelection(
  entries: ProviderAdvancedCatalogEntry[],
  presets: ProviderAdvancedCatalogPreset[],
): ProviderModelSelection | null {
  const defaultEntry = entries.find((entry) => entry.default) ?? entries[0];
  if (!defaultEntry) {
    return null;
  }

  const balancedPreset = presets.find((preset) => preset.id === 'balanced');
  return {
    entryId: defaultEntry.id,
    entryMode: 'auto',
    ...(balancedPreset ? { presetId: balancedPreset.id } : {}),
    ...(balancedPreset?.controlDefaults
      ? { controls: cloneProviderControls(balancedPreset.controlDefaults) }
      : {}),
  };
}

export function buildProviderAdvancedKnowledge(
  target: ProviderTargetDescriptor,
  modelCatalog: ProviderModelCatalogResult,
): ProviderAdvancedKnowledgeContext {
  const entries = toAdvancedEntries(target, modelCatalog);
  const supportTier = inferSupportTier(target);
  const verifiedAdvancedMetadata = hasVerifiedAdvancedMetadata(target);
  const { controls, entryDefaults } = verifiedAdvancedMetadata
    ? buildControls(target, entries)
    : { controls: [], entryDefaults: {} };
  const presets = verifiedAdvancedMetadata
    ? buildPresetCatalog(target, entries, controls)
    : [];
  const defaultSelection = verifiedAdvancedMetadata
    ? buildDefaultSelection(entries, presets)
    : null;
  const catalog: ProviderAdvancedCatalogResult = {
    provider: modelCatalog.provider,
    backend: modelCatalog.backend,
    instance: modelCatalog.instance,
    defaultModel: modelCatalog.defaultModel,
    source: modelCatalog.source,
    cache: modelCatalog.cache,
    entries,
    presets,
    controls,
    defaultSelection,
    support: {
      tier: supportTier,
    },
    warnings: [...modelCatalog.warnings],
  };

  return {
    target,
    catalog,
    supportTier,
    entryDefaults,
    controlsByKey: Object.fromEntries(
      controls.map((control) => [control.key, control]),
    ),
  };
}
