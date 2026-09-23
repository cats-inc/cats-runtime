import { effectiveModelControls } from '../../catalogs/schema.js';
import { findCatalogScope } from '../../catalogs/resolver.js';
import type { CatalogControl, CatalogModel, CatalogScope, CatalogSnapshot } from '../../catalogs/types.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { ProviderModelCatalogResult } from './providerModelCatalog.js';
import type {
  ProviderAdvancedCatalogControl, ProviderAdvancedCatalogEntry,
  ProviderAdvancedCatalogResult, ProviderAdvancedCatalogSupportTier, ProviderAdvancedControlValue,
} from './providerAdvancedCatalog.js';

export interface ProviderAdvancedKnowledgeContext {
  target: ProviderTargetDescriptor;
  catalog: ProviderAdvancedCatalogResult;
  supportTier: ProviderAdvancedCatalogSupportTier;
  entryDefaults: Record<string, Record<string, ProviderAdvancedControlValue>>;
  controlsByKey: Record<string, ProviderAdvancedCatalogControl>;
  scope?: CatalogScope;
  modelsById: Record<string, CatalogModel>;
}

export interface ProviderAdvancedKnowledgeBuildOptions {
  snapshot?: CatalogSnapshot;
}

function projectControl(control: CatalogControl, entryId: string): ProviderAdvancedCatalogControl {
  const { default: defaultValue, ...base } = control;
  return {
    ...base, applicableEntryIds: [entryId],
    ...(control.values ? { values: control.values.map(value => ({
      ...value,
      label: value.label.replace(/\s*\(default\)/giu, '') + (value.value === defaultValue ? ' (default)' : ''),
      applicableEntryIds: [entryId],
    })) } : {}),
  };
}

export function buildProviderAdvancedKnowledge(
  target: ProviderTargetDescriptor,
  modelCatalog: ProviderModelCatalogResult,
  options: ProviderAdvancedKnowledgeBuildOptions = {},
): ProviderAdvancedKnowledgeContext {
  const scope = findCatalogScope(options.snapshot, target);
  const modelsById = Object.fromEntries((scope?.models ?? []).map(model => [model.id, model]));
  const entryDefaults: ProviderAdvancedKnowledgeContext['entryDefaults'] = {};
  const combined = new Map<string, ProviderAdvancedCatalogControl>();
  const entries: ProviderAdvancedCatalogEntry[] = modelCatalog.models.map(entry => {
    const model = modelsById[entry.id];
    const controls = scope ? effectiveModelControls(scope, model ?? {
      id: entry.id, label: entry.label, execution: { model: entry.id },
    }) : [];
    const defaults = Object.fromEntries(controls.filter(c => c.default !== undefined)
      .map(c => [c.key, c.default!])) as Record<string, ProviderAdvancedControlValue>;
    entryDefaults[entry.id] = { ...model?.execution.fixed_controls, ...defaults };
    const projected = controls.map(control => projectControl(control, entry.id));
    for (const control of projected) {
      const previous = combined.get(control.key);
      if (!previous) combined.set(control.key, structuredClone(control));
      else {
        previous.applicableEntryIds!.push(entry.id);
        if (control.values) previous.values = [...previous.values ?? [], ...control.values];
      }
    }
    return {
      ...entry,
      ...(model ? {
        label: model.label,
        ...(model.limits ? { limits: structuredClone(model.limits) } : {}),
        ...(model.notes ? { notes: [...model.notes] } : {}),
        ...(model.capabilityTags ? { capabilityTags: [...model.capabilityTags] } : {}),
      } : {}),
      controls: projected,
      ...(Object.keys(defaults).length ? { controlDefaults: defaults } : {}),
    };
  });
  const controls = [...combined.values()];
  const presets = (scope?.presets ?? []).filter(preset =>
    !preset.preferredEntryId || entries.some(entry => entry.id === preset.preferredEntryId));
  const supportTier = controls.length ? 'full' : 'entry_only';
  const defaultEntry = entries.find(entry => entry.default) ?? entries[0];
  const catalog: ProviderAdvancedCatalogResult = {
    provider: modelCatalog.provider, backend: modelCatalog.backend, instance: modelCatalog.instance,
    catalogRevision: modelCatalog.catalogRevision,
    catalogActivationId: modelCatalog.catalogActivationId,
    defaultModel: modelCatalog.defaultModel, source: modelCatalog.source, cache: modelCatalog.cache,
    entries, controls, presets: structuredClone(presets),
    defaultSelection: defaultEntry ? {
      entryId: defaultEntry.id, entryMode: 'explicit',
      ...(modelCatalog.catalogRevision ? { catalogRevision: modelCatalog.catalogRevision } : {}),
      ...(defaultEntry.controlDefaults ? { controls: { ...defaultEntry.controlDefaults } } : {}),
    } : null,
    support: {
      tier: supportTier, advancedMetadataStatus: scope ? 'verified_manifest' : 'unverified_omitted',
      discoveryMode: 'manual_refresh',
      ...(scope ? { provenance: { status: 'verified_manifest',
        manifestId: `${scope.provider}/${scope.backend}/${scope.transport ?? ''}`,
        manifestVersion: modelCatalog.catalogRevision } } : {}),
    },
    warnings: [...modelCatalog.warnings],
  };
  return { target, catalog, supportTier, entryDefaults, scope, modelsById,
    controlsByKey: Object.fromEntries(controls.map(control => [control.key, control])) };
}
