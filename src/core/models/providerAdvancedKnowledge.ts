import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type {
  ProviderAdvancedCatalogControl,
  ProviderAdvancedCatalogControlOption,
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

function buildEntryNotes(
  target: ProviderTargetDescriptor,
  entryId: string,
): string[] | undefined {
  if (target.providerName === 'claude' && target.backend === 'cli') {
    switch (entryId) {
      case 'default':
        return ['Most capable for complex work.'];
      case 'sonnet':
        return ['Best for everyday tasks.'];
      case 'haiku':
        return ['Fastest for quick answers.'];
      default:
        return undefined;
    }
  }

  if (target.providerName === 'codex' && target.backend === 'cli') {
    switch (entryId) {
      case 'gpt-5.4':
        return ['Latest frontier agentic coding model.'];
      case 'gpt-5.4-mini':
        return ['Smaller frontier agentic coding model.'];
      case 'gpt-5.3-codex':
        return ['Frontier Codex-optimized agentic coding model.'];
      case 'gpt-5.2-codex':
        return ['Frontier agentic coding model.'];
      case 'gpt-5.2':
        return ['Optimized for professional work and long-running agents.'];
      case 'gpt-5.1-codex-max':
        return ['Codex-optimized model for deep and fast reasoning.'];
      case 'gpt-5.1-codex-mini':
        return ['Optimized for codex. Cheaper, faster, but less capable.'];
      default:
        return undefined;
    }
  }

  return undefined;
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
    ...(buildEntryNotes(target, entry.id)
      ? { notes: buildEntryNotes(target, entry.id) }
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
  if (
    target.backend === 'cli'
    && (target.providerName === 'codex' || target.providerName === 'claude')
  ) {
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
      values: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
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

function buildControlOptions(
  values: Array<{
    value: ProviderAdvancedControlValue;
    label: string;
    description?: string;
    applicableEntryIds?: string[];
  }>,
): ProviderAdvancedCatalogControlOption[] {
  return values.map((value) => ({
    value: value.value,
    label: value.label,
    ...(value.description ? { description: value.description } : {}),
    ...(value.applicableEntryIds?.length
      ? { applicableEntryIds: value.applicableEntryIds }
      : {}),
  }));
}

function buildCodexCliControls(
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

  const nonMiniEntryIds = applicableEntryIds.filter((entryId) => entryId !== 'gpt-5.1-codex-mini');

  return {
    controls: [{
      key: 'codex.reasoning_effort',
      label: 'Reasoning effort',
      description: 'Controls Codex CLI reasoning depth for supported models.',
      kind: 'enum',
      scope: 'both',
      values: buildControlOptions([
        {
          value: 'low',
          label: 'Low',
          description: 'Fast responses with lighter reasoning.',
          applicableEntryIds: nonMiniEntryIds,
        },
        {
          value: 'medium',
          label: 'Medium (default)',
          description: 'Balances speed and reasoning depth for everyday tasks.',
          applicableEntryIds,
        },
        {
          value: 'high',
          label: 'High',
          description: 'Greater reasoning depth for complex problems.',
          applicableEntryIds,
        },
        {
          value: 'xhigh',
          label: 'Extra high',
          description: 'Extra high reasoning depth for complex problems.',
          applicableEntryIds: nonMiniEntryIds,
        },
      ]),
      applicableEntryIds,
      semanticTags: ['reasoning_intensity'],
    }],
    entryDefaults: Object.fromEntries(
      applicableEntryIds.map((entryId) => [
        entryId,
        { 'codex.reasoning_effort': 'medium' as ProviderAdvancedControlValue },
      ]),
    ),
  };
}

function buildClaudeCliControls(
  entries: ProviderAdvancedCatalogEntry[],
): {
  controls: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  const effortEntryIds = entries
    .filter((entry) => entry.id === 'default' || entry.id === 'sonnet')
    .map((entry) => entry.id);
  if (effortEntryIds.length === 0) {
    return {
      controls: [],
      entryDefaults: {},
    };
  }

  return {
    controls: [{
      key: 'claude.reasoning_effort',
      label: 'Reasoning effort',
      description: 'Controls Claude Code effort for supported models.',
      kind: 'enum',
      scope: 'both',
      values: buildControlOptions([
        {
          value: 'low',
          label: 'Low',
          description: 'Lighter reasoning for faster responses.',
          applicableEntryIds: effortEntryIds,
        },
        {
          value: 'medium',
          label: 'Medium (default)',
          description: 'Balanced effort for most work.',
          applicableEntryIds: effortEntryIds,
        },
        {
          value: 'high',
          label: 'High',
          description: 'Greater depth for complex tasks.',
          applicableEntryIds: effortEntryIds,
        },
        {
          value: 'max',
          label: 'Max',
          description: 'Maximum effort for the most complex work.',
          applicableEntryIds: ['default'],
        },
      ]),
      applicableEntryIds: effortEntryIds,
      semanticTags: ['reasoning_intensity'],
    }],
    entryDefaults: Object.fromEntries(
      effortEntryIds.map((entryId) => [
        entryId,
        { 'claude.reasoning_effort': 'medium' as ProviderAdvancedControlValue },
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
  if (target.backend === 'cli' && target.providerName === 'codex') {
    return buildCodexCliControls(entries);
  }
  if (target.backend === 'cli' && target.providerName === 'claude') {
    return buildClaudeCliControls(entries);
  }
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
  if (
    target.backend === 'cli'
    && (target.providerName === 'codex' || target.providerName === 'claude')
  ) {
    return [];
  }

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
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>,
): ProviderModelSelection | null {
  const defaultEntry = entries.find((entry) => entry.default) ?? entries[0];
  if (!defaultEntry) {
    return null;
  }

  const balancedPreset = presets.find((preset) => preset.id === 'balanced');
  return {
    entryId: defaultEntry.id,
    entryMode: balancedPreset ? 'auto' : 'explicit',
    ...(balancedPreset ? { presetId: balancedPreset.id } : {}),
    ...(balancedPreset?.controlDefaults || entryDefaults[defaultEntry.id]
      ? {
          controls: cloneProviderControls(
            balancedPreset?.controlDefaults ?? entryDefaults[defaultEntry.id],
          ),
        }
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
    ? buildDefaultSelection(entries, presets, entryDefaults)
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
