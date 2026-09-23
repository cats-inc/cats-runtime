import { parseDocument } from 'yaml';
import { assertCatalogBinding, CATALOG_BINDINGS } from './bindings.js';
import type {
  CatalogControl, CatalogDocument, CatalogModel, CatalogScope, CatalogValue,
} from './types.js';

export const CATALOG_SCHEMA_VERSION = 2;

export function catalogScopeKey(scope: Pick<CatalogScope, 'provider' | 'backend' | 'transport'>): string {
  return `${scope.provider}/${scope.backend}/${scope.transport ?? ''}`;
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be a mapping`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], at: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${at}: unknown field '${key}'`);
  }
}

function text(value: unknown, at: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || /[\u0000-\u001f]/.test(value)) throw new Error(`${at} must be a nonempty single-line string`);
}

function array(value: unknown, at: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
}

function unique(values: string[], at: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${at} contains duplicates`);
}

function strings(value: unknown, at: string): void {
  if (value === undefined) return;
  array(value, at);
  value.forEach((item, i) => text(item, `${at}[${i}]`));
}

function controlValue(value: unknown, at: string): asserts value is CatalogValue {
  if (typeof value !== 'string' && typeof value !== 'boolean'
    && !(typeof value === 'number' && Number.isFinite(value))) throw new Error(`${at} must be a scalar`);
  if (typeof value === 'string') text(value, at);
}

function controls(value: unknown, scope: CatalogScope, at: string): void {
  if (value === undefined) return;
  array(value, at);
  for (const [i, raw] of value.entries()) {
    const c = record(raw, `${at}[${i}]`);
    keys(c, ['key', 'label', 'kind', 'scope', 'description', 'values', 'default', 'minimum', 'maximum', 'step', 'semanticTags'], at);
    text(c.key, at); text(c.label, at);
    assertCatalogBinding(scope, c.key);
    if (typeof c.kind !== 'string' || !['enum', 'boolean', 'number', 'string'].includes(c.kind)) throw new Error(`${at}: invalid control kind`);
    if ((c.kind === 'enum' ? 'string' : c.kind) !== CATALOG_BINDINGS[c.key].type) throw new Error(`${at}: binding type mismatch`);
    if (typeof c.scope !== 'string' || !['session_default', 'request', 'both'].includes(c.scope)) throw new Error(`${at}: invalid control scope`);
    if (c.description !== undefined) text(c.description, at);
    strings(c.semanticTags, at);
    if (c.kind === 'enum') {
      array(c.values, `${at}.values`);
      if (!c.values.length) throw new Error(`${at}: enum values must not be empty`);
    }
    if (c.values !== undefined) {
      array(c.values, at);
      for (const rawOption of c.values) {
        const option = record(rawOption, at);
        keys(option, ['value', 'label', 'description'], at);
        controlValue(option.value, at); text(option.label, at);
        if (option.description !== undefined) text(option.description, at);
        assertCatalogBinding(scope, c.key, option.value);
      }
      unique(c.values.map(v => JSON.stringify(record(v, at).value)), at);
    }
    for (const key of ['minimum', 'maximum', 'step']) {
      if (c[key] !== undefined && (typeof c[key] !== 'number' || !Number.isFinite(c[key]))) throw new Error(`${at}.${key} must be finite`);
    }
    if (typeof c.minimum === 'number' && typeof c.maximum === 'number' && c.minimum > c.maximum) throw new Error(`${at}: invalid range`);
    if (typeof c.step === 'number' && c.step <= 0) throw new Error(`${at}: step must be positive`);
    if (c.default !== undefined) {
      controlValue(c.default, at);
      assertControlValue(c as unknown as CatalogControl, c.default);
      assertCatalogBinding(scope, c.key, c.default);
    }
  }
  unique(value.map(c => String(record(c, at).key)), at);
}

export function assertControlValue(control: CatalogControl, value: CatalogValue): void {
  if ((control.kind === 'enum' ? 'string' : control.kind) !== typeof value) throw new Error(`Invalid value for '${control.key}'`);
  if (control.values && !control.values.some(v => v.value === value)) throw new Error(`Unsupported value for '${control.key}'`);
  if (typeof value === 'number' && (control.minimum !== undefined && value < control.minimum
    || control.maximum !== undefined && value > control.maximum)) throw new Error(`Value outside range for '${control.key}'`);
}

export function effectiveModelControls(scope: CatalogScope, model: CatalogModel): CatalogControl[] {
  if (model.controls?.length === 0) return [];
  const merged = new Map((scope.shared_controls ?? []).map(c => [c.key, c]));
  for (const control of model.controls ?? []) merged.set(control.key, control);
  return [...merged.values()];
}

function validateScope(raw: unknown, at: string): CatalogScope {
  const data = record(raw, at);
  keys(data, ['provider', 'backend', 'transport', 'selection_mode', 'source_cli', 'cli_version', 'last_updated', 'notes', 'shared_controls', 'models', 'presets'], at);
  text(data.provider, at);
  if (!/^[a-z][a-z0-9_-]*$/.test(data.provider)) throw new Error(`${at}: invalid provider family`);
  if (typeof data.backend !== 'string' || !['cli', 'api', 'local', 'agent'].includes(data.backend)) throw new Error(`${at}: invalid backend`);
  if (data.backend === 'cli' && data.transport !== undefined) throw new Error(`${at}: CLI scope has no transport`);
  if (data.backend !== 'cli') text(data.transport, `${at}.transport`);
  if (typeof data.selection_mode !== 'string' || !['full', 'shortlist', 'discovery'].includes(data.selection_mode)) throw new Error(`${at}: invalid selection_mode`);
  for (const key of ['source_cli', 'cli_version', 'last_updated']) if (data[key] !== undefined) text(data[key], `${at}.${key}`);
  strings(data.notes, at);
  array(data.models, `${at}.models`);
  if (data.selection_mode === 'shortlist' && data.models.length > 6) throw new Error(`${at}: shortlist exceeds six entries`);
  const scope = data as unknown as CatalogScope;
  controls(data.shared_controls, scope, `${at}.shared_controls`);
  for (const [i, rawModel] of data.models.entries()) {
    const label = `${at}.models[${i}]`;
    const model = record(rawModel, label);
    keys(model, ['id', 'label', 'default', 'execution', 'controls', 'limits', 'capabilityTags', 'notes', 'source_names'], label);
    text(model.id, `${label}.id`); text(model.label, `${label}.label`);
    if (model.default !== undefined && typeof model.default !== 'boolean') throw new Error(`${label}.default must be boolean`);
    strings(model.notes, label); strings(model.capabilityTags, label); strings(model.source_names, label);
    if (model.limits !== undefined) {
      const limits = record(model.limits, label);
      keys(limits, ['contextWindowTokens', 'maxOutputTokens'], label);
      for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label}: invalid token limit`);
    }
    controls(model.controls, scope, `${label}.controls`);
    const execution = record(model.execution, `${label}.execution`);
    keys(execution, ['model', 'provider', 'fixed_controls', 'variants'], label);
    text(execution.model, `${label}.execution.model`);
    if (execution.provider !== undefined) {
      text(execution.provider, label);
      if (scope.backend !== 'cli' || !['pi', 'goose', 'cline'].includes(scope.provider)) throw new Error(`${label}: executable provider binding is unsupported`);
    }
    const editable = effectiveModelControls(scope, model as unknown as CatalogModel);
    if (execution.fixed_controls !== undefined) {
      for (const [key, value] of Object.entries(record(execution.fixed_controls, label))) {
        controlValue(value, label); assertCatalogBinding(scope, key, value);
        if (editable.some(c => c.key === key)) throw new Error(`${label}: '${key}' is both fixed and editable`);
        if (CATALOG_BINDINGS[key].modelVariant) throw new Error(`${label}: fixed combinations must store the exact execution model instead of '${key}'`);
      }
    }
    if (execution.variants !== undefined) {
      array(execution.variants, label);
      const seen: Array<Record<string, unknown>> = [];
      for (const rawVariant of execution.variants) {
        const variant = record(rawVariant, label);
        keys(variant, ['when', 'model', 'provider'], label); text(variant.model, label);
        if (variant.provider !== undefined) {
          text(variant.provider, label);
          if (!execution.provider) throw new Error(`${label}: variant provider requires a base provider binding`);
        }
        const when = record(variant.when, label);
        if (!Object.keys(when).length) throw new Error(`${label}: variant condition is empty`);
        for (const [key, value] of Object.entries(when)) {
          const control = editable.find(c => c.key === key);
          if (!control || control.scope === 'request') throw new Error(`${label}: variant needs a session control '${key}'`);
          controlValue(value, label); assertControlValue(control, value);
        }
        if (seen.some(previous => Object.entries(previous).every(([key, value]) => when[key] === undefined || when[key] === value))) throw new Error(`${label}: ambiguous variants`);
        seen.push(when);
      }
      const variantKeys = [...new Set(seen.flatMap(when => Object.keys(when)))];
      let combinations: Array<Record<string, CatalogValue>> = [{}];
      for (const key of variantKeys) {
        const control = editable.find(c => c.key === key)!;
        const values = control.values?.map(v => v.value) ?? (control.kind === 'boolean' ? [false, true] : undefined);
        if (!values) throw new Error(`${label}: variant control '${key}' must have a finite set of values`);
        combinations = combinations.flatMap(combo => values.map(value => ({ ...combo, [key]: value })));
        if (combinations.length > 4096) throw new Error(`${label}: variant space exceeds 4096 combinations`);
      }
      if (combinations.some(combo => !seen.some(when => Object.entries(when).every(([key, value]) => combo[key] === value)))) {
        throw new Error(`${label}: execution variants do not cover every selectable combination`);
      }
    }
    for (const control of editable.filter(c => CATALOG_BINDINGS[c.key].modelVariant)) {
      if (!Array.isArray(execution.variants) || !execution.variants.length
        || execution.variants.some(v => !Object.hasOwn(record(record(v, label).when, label), control.key))) {
        throw new Error(`${label}: '${control.key}' requires complete executable model variants`);
      }
    }
  }
  unique(scope.models.map(m => m.id), `${at}.models`);
  if (scope.models.filter(m => m.default).length > 1) throw new Error(`${at}: multiple model defaults`);
  if (data.presets !== undefined) {
    array(data.presets, `${at}.presets`);
    for (const rawPreset of data.presets) {
      const p = record(rawPreset, at);
      keys(p, ['id', 'label', 'description', 'availability', 'applicableEntryIds', 'preferredEntryId', 'controlDefaults', 'warnings'], at);
      text(p.id, at); text(p.label, at);
      if (typeof p.availability !== 'string' || !['supported', 'unavailable'].includes(p.availability)) throw new Error(`${at}: invalid preset availability`);
      if (p.description !== undefined) text(p.description, at);
      strings(p.warnings, at); strings(p.applicableEntryIds, at);
      const ids = p.applicableEntryIds as string[] | undefined;
      if (p.preferredEntryId !== undefined) text(p.preferredEntryId, at);
      if (ids?.length && p.preferredEntryId && !ids.includes(String(p.preferredEntryId))) throw new Error(`${at}: preferred preset entry is not applicable`);
      for (const id of [...ids ?? [], ...p.preferredEntryId ? [String(p.preferredEntryId)] : []]) {
        if (!scope.models.some(m => m.id === id)) throw new Error(`${at}: preset references unknown entry '${id}'`);
      }
      for (const [key, value] of Object.entries(p.controlDefaults === undefined ? {} : record(p.controlDefaults, at))) {
        controlValue(value, at); assertCatalogBinding(scope, key, value);
        for (const model of scope.models.filter(m => !ids?.length || ids.includes(m.id))) {
          const control = effectiveModelControls(scope, model).find(c => c.key === key);
          if (!control) throw new Error(`${at}: preset control '${key}' not editable on '${model.id}'`);
          assertControlValue(control, value);
        }
      }
    }
    unique(data.presets.map(p => String(record(p, at).id)), `${at}.presets`);
  }
  return scope;
}

export function validateCatalogDocument(value: unknown): CatalogDocument {
  const doc = record(value, 'catalog');
  keys(doc, ['schema_version', 'catalogs'], 'catalog');
  if (doc.schema_version !== CATALOG_SCHEMA_VERSION) throw new Error(`Unsupported catalog schema '${String(doc.schema_version)}'; expected 2. Use the explicit converter for schema 1.`);
  array(doc.catalogs, 'catalogs');
  const catalogs = doc.catalogs.map((scope, i) => validateScope(scope, `catalogs[${i}]`));
  unique(catalogs.map(catalogScopeKey), 'catalog scopes');
  return structuredClone({ schema_version: 2, catalogs });
}

export function parseCatalogDocument(source: string): CatalogDocument {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`Invalid catalog YAML: ${doc.errors[0].message}`);
  return validateCatalogDocument(doc.toJS({ maxAliasCount: 100 }));
}
