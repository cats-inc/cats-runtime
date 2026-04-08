import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type {
  ProviderAdvancedCatalogControl,
  ProviderAdvancedCatalogControlOption,
  ProviderAdvancedCatalogEntry,
  ProviderAdvancedCatalogEntryLimits,
  ProviderAdvancedMetadataStatus,
  ProviderAdvancedCatalogPreset,
  ProviderAdvancedCatalogResult,
  ProviderAdvancedCatalogSupportTier,
  ProviderAdvancedControlValue,
} from './providerAdvancedCatalog.js';
import type { ProviderModelCatalogResult } from './providerModelCatalog.js';
import { cloneProviderControls } from './providerControlUtils.js';
import type { ProviderModelSelection } from './providerSelectionResolution.js';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';
import {
  findCuratedCliCatalog,
  loadCuratedModelCatalog,
  resolveCuratedCatalogScope,
  resolveEffectiveCuratedModelOptions,
  type CuratedModelCatalogDocument,
  type CuratedModelCatalogModel,
  type CuratedModelCatalogOption,
} from './curatedModelCatalog.js';

export interface ProviderAdvancedKnowledgeContext {
  target: ProviderTargetDescriptor;
  catalog: ProviderAdvancedCatalogResult;
  supportTier: ProviderAdvancedCatalogSupportTier;
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
  controlsByKey: Record<string, ProviderAdvancedCatalogControl>;
}

export interface ProviderAdvancedKnowledgeBuildOptions {
  runtimeConfig?: Partial<Pick<CliRuntimeConfig, 'configPath'>>;
  env?: NodeJS.ProcessEnv;
}

interface CuratedEntryMetadata {
  label?: string;
  default?: boolean;
  limits?: ProviderAdvancedCatalogEntryLimits;
  capabilityTags?: string[];
  notes?: string[];
  deprecated?: boolean;
}

interface CuratedCatalogOverlay {
  entriesById: Record<string, CuratedEntryMetadata>;
  controls?: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
  warnings: string[];
}

interface VerifiedAdvancedManifestBuildResult {
  controls: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
  presets: ProviderAdvancedCatalogPreset[];
  defaultSelection: ProviderModelSelection | null;
}

interface VerifiedAdvancedManifest {
  id: string;
  version: string;
  supportTier: ProviderAdvancedCatalogSupportTier;
  evidenceRefs: string[];
  matches: (target: ProviderTargetDescriptor) => boolean;
  build: (
    target: ProviderTargetDescriptor,
    entries: ProviderAdvancedCatalogEntry[],
  ) => VerifiedAdvancedManifestBuildResult;
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
      case 'opus':
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
      case 'gpt-5.3-codex-spark':
        return ['Ultra-fast coding model.'];
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

function mergeCapabilityTags(
  runtimeTags: string[] | undefined,
  curatedTags: string[] | undefined,
): string[] | undefined {
  const merged = new Set<string>();
  for (const tag of runtimeTags || []) {
    merged.add(tag);
  }
  for (const tag of curatedTags || []) {
    merged.add(tag);
  }
  return merged.size > 0 ? Array.from(merged) : undefined;
}

function normalizeClaudeCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (
      normalized === 'opus'
      || normalized.includes('claude-opus')
      || normalized.includes('opus 4.6')
    ) {
      return 'opus';
    }
    if (
      normalized === 'sonnet'
      || normalized.includes('claude-sonnet')
      || normalized.includes('sonnet 4.6')
    ) {
      return 'sonnet';
    }
    if (
      normalized === 'haiku'
      || normalized.includes('claude-haiku')
      || normalized.includes('haiku 4.5')
    ) {
      return 'haiku';
    }
  }

  return null;
}

function normalizeClaudeEffortValue(
  value: string | undefined,
): ProviderAdvancedControlValue | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'max':
      return 'max';
    default:
      return null;
  }
}

function fallbackClaudeEffortDescription(
  value: ProviderAdvancedControlValue,
): string | undefined {
  switch (value) {
    case 'low':
      return 'Lighter reasoning for faster responses.';
    case 'medium':
      return 'Balanced effort for most work.';
    case 'high':
      return 'Greater depth for complex tasks.';
    case 'max':
      return 'Maximum effort for the most complex work.';
    default:
      return undefined;
  }
}

function normalizeCodexCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  const knownIds = new Set([
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
  ]);

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (knownIds.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

function normalizeCodexEffortValue(
  value: string | undefined,
): ProviderAdvancedControlValue | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'extra high':
    case 'extra-high':
    case 'xhigh':
      return 'xhigh';
    default:
      return null;
  }
}

function fallbackCodexEffortDescription(
  value: ProviderAdvancedControlValue,
): string | undefined {
  switch (value) {
    case 'low':
      return 'Fast responses with lighter reasoning.';
    case 'medium':
      return 'Balances speed and reasoning depth for everyday tasks.';
    case 'high':
      return 'Greater reasoning depth for complex problems.';
    case 'xhigh':
      return 'Extra high reasoning depth for complex problems.';
    default:
      return undefined;
  }
}

function buildCuratedEntryMetadata(
  model: CuratedModelCatalogModel,
): CuratedEntryMetadata {
  const limits: ProviderAdvancedCatalogEntryLimits = {};
  if (model.context) {
    limits.contextWindowTokens = model.context;
  }
  if (model.maxOutput) {
    limits.maxOutputTokens = model.maxOutput;
  }

  const notes = model.notes ? [...model.notes] : undefined;
  if (model.deprecated) {
    if (!notes) {
      return {
        ...(model.label ? { label: model.label } : {}),
        ...(model.default !== undefined ? { default: model.default } : {}),
        ...(Object.keys(limits).length > 0 ? { limits } : {}),
        ...(model.tags ? { capabilityTags: [...model.tags] } : {}),
        deprecated: true,
        notes: ['Marked deprecated in curated catalog.'],
      };
    }
    notes.push('Marked deprecated in curated catalog.');
  }

  return {
    ...(model.label ? { label: model.label } : {}),
    ...(model.default !== undefined ? { default: model.default } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(model.tags ? { capabilityTags: [...model.tags] } : {}),
    ...(notes ? { notes } : {}),
    ...(model.deprecated ? { deprecated: true } : {}),
  };
}

function buildCuratedEnumControl(
  optionsByEntryId: Map<string, CuratedModelCatalogOption>,
  control: {
    key: string;
    label: string;
    description: string;
    normalizeValue: (value: string | undefined) => ProviderAdvancedControlValue | null;
    fallbackDescription: (value: ProviderAdvancedControlValue) => string | undefined;
  },
): {
  controls?: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  if (optionsByEntryId.size === 0) {
    return {
      entryDefaults: {},
    };
  }

  const controlOptions: ProviderAdvancedCatalogControlOption[] = [];
  const optionIndex = new Map<string, ProviderAdvancedCatalogControlOption>();
  const entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>> = {};

  for (const [entryId, option] of optionsByEntryId.entries()) {
    const defaultValue = control.normalizeValue(option.default);
    if (defaultValue !== null) {
      entryDefaults[entryId] = {
        [control.key]: defaultValue,
      };
    }

    for (const value of option.values || []) {
      const normalizedValue = control.normalizeValue(value.name);
      if (normalizedValue === null) {
        continue;
      }
      const description = value.notes?.[0] || control.fallbackDescription(normalizedValue);
      const label = normalizedValue === defaultValue
        ? `${value.name} (default)`
        : value.name;
      const optionKey = [
        String(normalizedValue),
        label,
        description || '',
      ].join('|');
      const existing = optionIndex.get(optionKey);
      if (existing) {
        const applicableEntryIds = existing.applicableEntryIds || [];
        if (!applicableEntryIds.includes(entryId)) {
          applicableEntryIds.push(entryId);
          existing.applicableEntryIds = applicableEntryIds;
        }
        continue;
      }

      const nextOption: ProviderAdvancedCatalogControlOption = {
        value: normalizedValue,
        label,
        ...(description ? { description } : {}),
        applicableEntryIds: [entryId],
      };
      controlOptions.push(nextOption);
      optionIndex.set(optionKey, nextOption);
    }
  }

  if (controlOptions.length === 0) {
    return {
      entryDefaults,
    };
  }

  return {
    controls: [{
      key: control.key,
      label: control.label,
      description: control.description,
      kind: 'enum',
      scope: 'both',
      values: controlOptions,
      applicableEntryIds: Array.from(optionsByEntryId.keys()),
      semanticTags: ['reasoning_intensity'],
    }],
    entryDefaults,
  };
}

function buildCuratedClaudeCliControls(
  optionsByEntryId: Map<string, CuratedModelCatalogOption>,
): {
  controls?: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  return buildCuratedEnumControl(optionsByEntryId, {
    key: 'claude.reasoning_effort',
    label: 'Reasoning effort',
    description: 'Controls Claude Code effort for supported models.',
    normalizeValue: normalizeClaudeEffortValue,
    fallbackDescription: fallbackClaudeEffortDescription,
  });
}

function buildCuratedCodexCliControls(
  optionsByEntryId: Map<string, CuratedModelCatalogOption>,
): {
  controls?: ProviderAdvancedCatalogControl[];
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
} {
  return buildCuratedEnumControl(optionsByEntryId, {
    key: 'codex.reasoning_effort',
    label: 'Reasoning effort',
    description: 'Controls Codex CLI reasoning depth for supported models.',
    normalizeValue: normalizeCodexEffortValue,
    fallbackDescription: fallbackCodexEffortDescription,
  });
}

function buildCuratedClaudeCliOverlay(
  document: CuratedModelCatalogDocument | undefined,
): CuratedCatalogOverlay | null {
  const catalog = findCuratedCliCatalog(document, 'claude');
  if (!catalog) {
    return null;
  }

  const scope = resolveCuratedCatalogScope(catalog, 'claude');
  if (!scope) {
    return null;
  }

  const entriesById: Record<string, CuratedEntryMetadata> = {};
  const effortOptions = new Map<string, CuratedModelCatalogOption>();
  for (const model of scope.models) {
    const entryId = normalizeClaudeCuratedModelId(model);
    if (!entryId) {
      continue;
    }
    entriesById[entryId] = buildCuratedEntryMetadata(model);

    const effectiveOptions = resolveEffectiveCuratedModelOptions(scope.sharedOptions, model);
    const effortOption = effectiveOptions.find((option) => option.name.trim().toLowerCase() === 'effort');
    if (effortOption) {
      effortOptions.set(entryId, effortOption);
    }
  }

  const controlResult = buildCuratedClaudeCliControls(effortOptions);
  return {
    entriesById,
    ...(controlResult.controls ? { controls: controlResult.controls } : {}),
    entryDefaults: controlResult.entryDefaults,
    warnings: [],
  };
}

function buildCuratedCodexCliOverlay(
  document: CuratedModelCatalogDocument | undefined,
): CuratedCatalogOverlay | null {
  const catalog = findCuratedCliCatalog(document, 'codex');
  if (!catalog) {
    return null;
  }

  const scope = resolveCuratedCatalogScope(catalog, 'codex');
  if (!scope) {
    return null;
  }

  const entriesById: Record<string, CuratedEntryMetadata> = {};
  const effortOptions = new Map<string, CuratedModelCatalogOption>();
  for (const model of scope.models) {
    const entryId = normalizeCodexCuratedModelId(model);
    if (!entryId) {
      continue;
    }
    entriesById[entryId] = buildCuratedEntryMetadata(model);

    const effectiveOptions = resolveEffectiveCuratedModelOptions(scope.sharedOptions, model);
    const effortOption = effectiveOptions.find((option) => option.name.trim().toLowerCase() === 'effort');
    if (effortOption) {
      effortOptions.set(entryId, effortOption);
    }
  }

  const controlResult = buildCuratedCodexCliControls(effortOptions);
  return {
    entriesById,
    ...(controlResult.controls ? { controls: controlResult.controls } : {}),
    entryDefaults: controlResult.entryDefaults,
    warnings: [],
  };
}

function toAdvancedEntries(
  target: ProviderTargetDescriptor,
  catalog: ProviderModelCatalogResult,
  curatedEntriesById: Record<string, CuratedEntryMetadata> = {},
): ProviderAdvancedCatalogEntry[] {
  return catalog.models.map((entry) => ({
    id: entry.id,
    label: curatedEntriesById[entry.id]?.label || entry.label,
    ...((curatedEntriesById[entry.id]?.default ?? entry.default) !== undefined
      ? { default: curatedEntriesById[entry.id]?.default ?? entry.default }
      : {}),
    ...(entry.status ? { status: entry.status } : {}),
    ...(mergeCapabilityTags(
      buildEntryCapabilityTags(target, entry.id),
      curatedEntriesById[entry.id]?.capabilityTags,
    )
      ? {
          capabilityTags: mergeCapabilityTags(
            buildEntryCapabilityTags(target, entry.id),
            curatedEntriesById[entry.id]?.capabilityTags,
          ),
        }
      : {}),
    ...(curatedEntriesById[entry.id]?.limits
      ? { limits: curatedEntriesById[entry.id]?.limits }
      : {}),
    ...((curatedEntriesById[entry.id]?.notes ?? buildEntryNotes(target, entry.id))
      ? { notes: curatedEntriesById[entry.id]?.notes ?? buildEntryNotes(target, entry.id) }
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

function buildVerifiedSupportMetadata(
  supportTier: ProviderAdvancedCatalogSupportTier,
  metadataStatus: ProviderAdvancedMetadataStatus,
  manifest: VerifiedAdvancedManifest | null,
) {
  return {
    tier: supportTier,
    advancedMetadataStatus: metadataStatus,
    discoveryMode: 'manual_refresh' as const,
    provenance: {
      status: metadataStatus,
      ...(manifest ? {
        manifestId: manifest.id,
        manifestVersion: manifest.version,
        evidenceRefs: [...manifest.evidenceRefs],
      } : {}),
    },
  };
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

  const sparkEntryIds = applicableEntryIds.filter((entryId) => entryId === 'gpt-5.3-codex-spark');
  const nonSparkEntryIds = applicableEntryIds.filter((entryId) => entryId !== 'gpt-5.3-codex-spark');
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
          applicableEntryIds: nonSparkEntryIds,
        },
        {
          value: 'medium',
          label: 'Medium',
          description: 'Balances speed and reasoning depth for everyday tasks.',
          applicableEntryIds: sparkEntryIds,
        },
        {
          value: 'high',
          label: 'High',
          description: 'Greater reasoning depth for complex problems.',
          applicableEntryIds: nonSparkEntryIds,
        },
        {
          value: 'high',
          label: 'High (default)',
          description: 'Greater reasoning depth for complex problems.',
          applicableEntryIds: sparkEntryIds,
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
        {
          'codex.reasoning_effort': entryId === 'gpt-5.3-codex-spark'
            ? 'high' as ProviderAdvancedControlValue
            : 'medium' as ProviderAdvancedControlValue,
        },
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
    .filter((entry) => entry.id === 'opus' || entry.id === 'sonnet')
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
          applicableEntryIds: ['opus'],
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

function buildGenericManifestResult(
  target: ProviderTargetDescriptor,
  entries: ProviderAdvancedCatalogEntry[],
  controls: ProviderAdvancedCatalogControl[],
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>,
): VerifiedAdvancedManifestBuildResult {
  const presets = buildPresetCatalog(target, entries, controls);
  return {
    controls,
    entryDefaults,
    presets,
    defaultSelection: buildDefaultSelection(entries, presets, entryDefaults),
  };
}

const VERIFIED_ADVANCED_MANIFESTS: VerifiedAdvancedManifest[] = [
  {
    id: 'codex-api-openai-v1',
    version: '2026-04-07',
    supportTier: 'full',
    evidenceRefs: [
      'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-api-openai-v1',
    ],
    matches: (target) => target.providerName === 'codex'
      && target.backend === 'api'
      && target.remoteInstance?.transport === 'openai',
    build: (target, entries) => {
      const { controls, entryDefaults } = buildOpenAiControls(entries);
      return buildGenericManifestResult(target, entries, controls, entryDefaults);
    },
  },
  {
    id: 'codex-cli-v1',
    version: '2026-04-07',
    supportTier: 'full',
    evidenceRefs: [
      'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#codex-cli-v1',
    ],
    matches: (target) => target.providerName === 'codex' && target.backend === 'cli',
    build: (_target, entries) => {
      const { controls, entryDefaults } = buildCodexCliControls(entries);
      return {
        controls,
        entryDefaults,
        presets: [],
        defaultSelection: buildDefaultSelection(entries, [], entryDefaults),
      };
    },
  },
  {
    id: 'claude-cli-v1',
    version: '2026-04-07',
    supportTier: 'full',
    evidenceRefs: [
      'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#claude-cli-v1',
    ],
    matches: (target) => target.providerName === 'claude' && target.backend === 'cli',
    build: (_target, entries) => {
      const { controls, entryDefaults } = buildClaudeCliControls(entries);
      return {
        controls,
        entryDefaults,
        presets: [],
        defaultSelection: buildDefaultSelection(entries, [], entryDefaults),
      };
    },
  },
  {
    id: 'ollama-local-v1',
    version: '2026-04-07',
    supportTier: 'full',
    evidenceRefs: [
      'docs/research/2026-04-07-advanced-provider-manifest-baseline.md#ollama-local-v1',
    ],
    matches: (target) => target.providerName === 'ollama'
      && target.backend === 'local'
      && target.remoteInstance?.transport === 'ollama',
    build: (target, entries) => {
      const { controls, entryDefaults } = buildOllamaControls(entries);
      return buildGenericManifestResult(target, entries, controls, entryDefaults);
    },
  },
];

function resolveVerifiedAdvancedManifest(
  target: ProviderTargetDescriptor,
): VerifiedAdvancedManifest | null {
  return VERIFIED_ADVANCED_MANIFESTS.find((manifest) => manifest.matches(target)) || null;
}

function loadCuratedOverlay(
  target: ProviderTargetDescriptor,
  options: ProviderAdvancedKnowledgeBuildOptions,
): CuratedCatalogOverlay | null {
  if (
    target.backend !== 'cli'
    || (target.providerName !== 'claude' && target.providerName !== 'codex')
    || (!options.runtimeConfig && !options.env)
  ) {
    return null;
  }

  const result = loadCuratedModelCatalog({
    runtimeConfig: options.runtimeConfig,
    env: options.env,
  });
  const overlay = target.providerName === 'claude'
    ? buildCuratedClaudeCliOverlay(result.document)
    : buildCuratedCodexCliOverlay(result.document);
  if (!overlay) {
    return result.warnings.length > 0
      ? {
          entriesById: {},
          entryDefaults: {},
          warnings: result.warnings,
        }
      : null;
  }

  return {
    ...overlay,
    warnings: [...result.warnings, ...overlay.warnings],
  };
}

export function buildProviderAdvancedKnowledge(
  target: ProviderTargetDescriptor,
  modelCatalog: ProviderModelCatalogResult,
  options: ProviderAdvancedKnowledgeBuildOptions = {},
): ProviderAdvancedKnowledgeContext {
  const curatedOverlay = loadCuratedOverlay(target, options);
  const entries = toAdvancedEntries(
    target,
    modelCatalog,
    curatedOverlay?.entriesById,
  );
  const manifest = resolveVerifiedAdvancedManifest(target);
  const supportTier = manifest?.supportTier ?? 'entry_only';
  let manifestCatalog = manifest
    ? manifest.build(target, entries)
    : {
        controls: [],
        entryDefaults: {},
        presets: [],
        defaultSelection: null,
      };
  if (curatedOverlay) {
    const entryDefaults = Object.keys(curatedOverlay.entryDefaults).length > 0
      ? curatedOverlay.entryDefaults
      : manifestCatalog.entryDefaults;
    manifestCatalog = {
      ...manifestCatalog,
      controls: curatedOverlay.controls || manifestCatalog.controls,
      entryDefaults,
      defaultSelection: buildDefaultSelection(entries, manifestCatalog.presets, entryDefaults),
    };
  }
  const catalog: ProviderAdvancedCatalogResult = {
    provider: modelCatalog.provider,
    backend: modelCatalog.backend,
    instance: modelCatalog.instance,
    defaultModel: modelCatalog.defaultModel,
    source: modelCatalog.source,
    cache: modelCatalog.cache,
    entries,
    presets: manifestCatalog.presets,
    controls: manifestCatalog.controls,
    defaultSelection: manifestCatalog.defaultSelection,
    support: buildVerifiedSupportMetadata(
      supportTier,
      manifest ? 'verified_manifest' : 'unverified_omitted',
      manifest,
    ),
    warnings: [...modelCatalog.warnings, ...(curatedOverlay?.warnings || [])],
  };

  return {
    target,
    catalog,
    supportTier,
    entryDefaults: manifestCatalog.entryDefaults,
    controlsByKey: Object.fromEntries(
      manifestCatalog.controls.map((control) => [control.key, control]),
    ),
  };
}
