import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { ProviderAdvancedKnowledgeContext } from './providerAdvancedKnowledge.js';
import type { ProviderAdvancedControlValue } from './providerAdvancedCatalog.js';
import { cloneProviderControls } from './providerControlUtils.js';

export type ProviderModelSelectionEntryMode = 'auto' | 'explicit';

export interface ProviderModelSelection {
  entryId?: string;
  entryMode: ProviderModelSelectionEntryMode;
  presetId?: string;
  controls?: Record<string, ProviderAdvancedControlValue>;
}

export interface ProviderModelResolution {
  entryId: string;
  model: string;
  entryMode: ProviderModelSelectionEntryMode;
  presetId?: string;
  controls?: Record<string, ProviderAdvancedControlValue>;
  supportTier: ProviderAdvancedKnowledgeContext['supportTier'];
  warnings: string[];
}

export interface ProviderSelectionExecutionDetails {
  model: string;
  requestBodyPatch?: Record<string, unknown>;
}

export interface ResolvedProviderSelection {
  selection: ProviderModelSelection;
  resolution: ProviderModelResolution;
  execution: ProviderSelectionExecutionDetails;
}

interface ResolveProviderSelectionOptions {
  requestControls?: Record<string, ProviderAdvancedControlValue>;
  mode?: 'session' | 'request';
}

function mergeControls(
  ...layers: Array<Record<string, ProviderAdvancedControlValue> | undefined>
): Record<string, ProviderAdvancedControlValue> | undefined {
  const merged: Record<string, ProviderAdvancedControlValue> = {};

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer || {})) {
      merged[key] = value;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function trimOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isControlValue(value: unknown): value is ProviderAdvancedControlValue {
  return typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function mergeRequestPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target };

  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    if (
      existing
      && typeof existing === 'object'
      && !Array.isArray(existing)
      && value
      && typeof value === 'object'
      && !Array.isArray(value)
    ) {
      merged[key] = mergeRequestPatch(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function validateControlValue(
  key: string,
  value: ProviderAdvancedControlValue,
  control: ProviderAdvancedKnowledgeContext['controlsByKey'][string],
): void {
  switch (control.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new Error(`Control '${key}' must be a boolean`);
      }
      return;
    case 'string':
      if (typeof value !== 'string') {
        throw new Error(`Control '${key}' must be a string`);
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Control '${key}' must be a number`);
      }
      if (control.minimum !== undefined && value < control.minimum) {
        throw new Error(`Control '${key}' must be >= ${control.minimum}`);
      }
      if (control.maximum !== undefined && value > control.maximum) {
        throw new Error(`Control '${key}' must be <= ${control.maximum}`);
      }
      return;
    case 'enum':
      if (typeof value !== 'string') {
        throw new Error(`Control '${key}' must be one of: ${(control.values || []).join(', ')}`);
      }
      if (control.values && !control.values.includes(value)) {
        throw new Error(`Control '${key}' must be one of: ${control.values.join(', ')}`);
      }
      return;
  }
}

function ensureControlsAreAllowed(
  knowledge: ProviderAdvancedKnowledgeContext,
  controls: Record<string, ProviderAdvancedControlValue> | undefined,
  mode: 'session' | 'request',
): void {
  for (const [key, value] of Object.entries(controls || {})) {
    const control = knowledge.controlsByKey[key];
    if (!control) {
      throw new Error(
        `Control '${key}' is not supported for `
        + `${knowledge.target.providerName}/${knowledge.target.backend}/${knowledge.target.instanceId}`,
      );
    }

    if (mode === 'session' && control.scope === 'request') {
      throw new Error(`Control '${key}' is request-scoped only and cannot be stored on the session`);
    }

    validateControlValue(key, value, control);
  }
}

function ensureControlApplicability(
  knowledge: ProviderAdvancedKnowledgeContext,
  entryId: string,
  controls: Record<string, ProviderAdvancedControlValue> | undefined,
): void {
  for (const key of Object.keys(controls || {})) {
    const control = knowledge.controlsByKey[key];
    if (!control) {
      continue;
    }
    if (
      control.applicableEntryIds
      && control.applicableEntryIds.length > 0
      && !control.applicableEntryIds.includes(entryId)
    ) {
      throw new Error(`Control '${key}' is not applicable to entry '${entryId}'`);
    }
  }
}

function resolveBaseEntryId(
  knowledge: ProviderAdvancedKnowledgeContext,
  selection: ProviderModelSelection,
): string {
  if (selection.entryMode === 'explicit') {
    if (!selection.entryId) {
      throw new Error('Structured model selection with entryMode=explicit must include entryId');
    }
    return selection.entryId;
  }

  return selection.entryId
    ?? knowledge.catalog.defaultSelection?.entryId
    ?? knowledge.catalog.entries.find((entry) => entry.default)?.id
    ?? knowledge.catalog.entries[0]?.id
    ?? (() => {
      throw new Error(
        `No advanced catalog entries are available for `
        + `${knowledge.target.providerName}/${knowledge.target.backend}/${knowledge.target.instanceId}`,
      );
    })();
}

export function parseProviderModelSelection(
  value: unknown,
): { selection?: ProviderModelSelection; error?: string } {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: 'modelSelection must be an object',
    };
  }

  const record = value as Record<string, unknown>;
  const entryId = trimOptionalString(record.entryId);
  const presetId = trimOptionalString(record.presetId);
  const rawEntryMode = record.entryMode;
  const entryMode = rawEntryMode === 'auto' || rawEntryMode === 'explicit'
    ? rawEntryMode
    : rawEntryMode === undefined
      ? (entryId ? 'explicit' : 'auto')
      : undefined;
  if (!entryMode) {
    return {
      error: 'modelSelection.entryMode must be "auto" or "explicit"',
    };
  }
  if (entryMode === 'explicit' && !entryId) {
    return {
      error: 'modelSelection.entryId is required when entryMode is "explicit"',
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(record, 'controls')
    && (
      !record.controls
      || typeof record.controls !== 'object'
      || Array.isArray(record.controls)
    )
  ) {
    return {
      error: 'modelSelection.controls must be an object when provided',
    };
  }

  const controls: Record<string, ProviderAdvancedControlValue> = {};
  for (const [key, rawValue] of Object.entries(
    (record.controls as Record<string, unknown> | undefined) || {},
  )) {
    if (!isControlValue(rawValue)) {
      return {
        error: `modelSelection.controls.${key} must be a string, number, or boolean`,
      };
    }
    controls[key] = rawValue;
  }

  return {
    selection: {
      ...(entryId ? { entryId } : {}),
      entryMode,
      ...(presetId ? { presetId } : {}),
      ...(Object.keys(controls).length > 0 ? { controls } : {}),
    },
  };
}

export function createLegacyModelSelection(
  model: string,
): ProviderModelSelection {
  return {
    entryId: model,
    entryMode: 'explicit',
  };
}

export function canonicalizeProviderModelSelection(
  selection: ProviderModelSelection,
): ProviderModelSelection {
  return {
    ...(selection.entryId ? { entryId: selection.entryId } : {}),
    entryMode: selection.entryMode,
    ...(selection.presetId ? { presetId: selection.presetId } : {}),
    ...(selection.controls ? { controls: cloneProviderControls(selection.controls) } : {}),
  };
}

export function sameProviderModelSelection(
  left: ProviderModelSelection | undefined,
  right: ProviderModelSelection | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return JSON.stringify(canonicalizeProviderModelSelection(left))
    === JSON.stringify(canonicalizeProviderModelSelection(right));
}

export function isLegacyCompatibleExplicitSelection(
  selection: ProviderModelSelection | undefined,
  model: string | undefined,
): boolean {
  if (!selection || !model) {
    return false;
  }

  return selection.entryMode === 'explicit'
    && selection.entryId === model
    && !selection.presetId
    && Object.keys(selection.controls || {}).length === 0;
}

export function buildProviderExecutionRequestPatch(
  target: Pick<ProviderTargetDescriptor, 'backend' | 'remoteInstance'>,
  controls: Record<string, ProviderAdvancedControlValue> | undefined,
): Record<string, unknown> | undefined {
  let patch: Record<string, unknown> | undefined;

  const mergePatch = (nextPatch: Record<string, unknown>) => {
    patch = patch ? mergeRequestPatch(patch, nextPatch) : nextPatch;
  };

  if (
    target.backend === 'api'
    && target.remoteInstance?.transport === 'openai'
    && typeof controls?.['openai.reasoning_effort'] === 'string'
  ) {
    mergePatch({
      reasoning: {
        effort: controls['openai.reasoning_effort'],
      },
    });
  }

  if (target.backend === 'local' && target.remoteInstance?.transport === 'ollama') {
    if (typeof controls?.['ollama.temperature'] === 'number') {
      mergePatch({
        options: {
          temperature: controls['ollama.temperature'],
        },
      });
    }
    if (typeof controls?.['ollama.keep_alive'] === 'string') {
      mergePatch({
        keep_alive: controls['ollama.keep_alive'],
      });
    }
  }

  return patch;
}

export function resolveProviderSelection(
  knowledge: ProviderAdvancedKnowledgeContext,
  selection: ProviderModelSelection,
  options: ResolveProviderSelectionOptions = {},
): ResolvedProviderSelection {
  const mode = options.mode ?? 'session';
  const normalizedSelection = canonicalizeProviderModelSelection(selection);
  const preset = normalizedSelection.presetId
    ? knowledge.catalog.presets.find((entry) => entry.id === normalizedSelection.presetId)
    : undefined;
  if (normalizedSelection.presetId && !preset) {
    throw new Error(`Unknown preset '${normalizedSelection.presetId}'`);
  }

  ensureControlsAreAllowed(knowledge, normalizedSelection.controls, mode);
  ensureControlsAreAllowed(knowledge, options.requestControls, 'request');

  let entryId = resolveBaseEntryId(knowledge, normalizedSelection);
  const pinned = normalizedSelection.entryMode === 'explicit';
  const preferredEntryId = preset?.preferredEntryId;
  if (preferredEntryId && !pinned) {
    entryId = preferredEntryId;
  }

  const entry = knowledge.catalog.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw new Error(`Unknown catalog entry '${entryId}'`);
  }

  if (
    preset?.applicableEntryIds
    && preset.applicableEntryIds.length > 0
    && !preset.applicableEntryIds.includes(entry.id)
  ) {
    throw new Error(
      `Preset '${preset.id}' is not applicable to entry '${entry.id}'`,
    );
  }

  const mergedControls = mergeControls(
    knowledge.entryDefaults[entry.id],
    cloneProviderControls(preset?.controlDefaults),
    cloneProviderControls(normalizedSelection.controls),
    cloneProviderControls(options.requestControls),
  );
  ensureControlApplicability(knowledge, entry.id, mergedControls);

  const requestBodyPatch = buildProviderExecutionRequestPatch(knowledge.target, mergedControls);
  const resolution: ProviderModelResolution = {
    entryId: entry.id,
    model: entry.id,
    entryMode: normalizedSelection.entryMode,
    ...(preset ? { presetId: preset.id } : {}),
    ...(mergedControls ? { controls: mergedControls } : {}),
    supportTier: knowledge.supportTier,
    warnings: [],
  };

  return {
    selection: normalizedSelection,
    resolution,
    execution: {
      model: resolution.model,
      ...(requestBodyPatch ? { requestBodyPatch } : {}),
    },
  };
}
