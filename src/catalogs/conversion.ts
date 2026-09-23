import { parseDocument } from 'yaml';
import { validateCatalogDocument } from './schema.js';
import type { CatalogControl, CatalogDocument, CatalogModel, CatalogScope, CatalogValue } from './types.js';

export interface LegacyMigrationEntry {
  name: string;
  provider?: string;
  model: CatalogModel;
  options: Array<{ name: string; key: string; fixed: boolean; values: Record<string, CatalogValue> }>;
}
export interface LegacyMigrationScope {
  cli: string;
  scope: CatalogScope;
  entries: LegacyMigrationEntry[];
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a mapping');
  return value as ObjectValue;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected a nonempty string');
  return value;
}
function allowKeys(value: ObjectValue, keys: string[]): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unresolved field '${key}'`);
}

/** Offline explicit conversion against frozen, reviewed label-to-binding evidence; never guesses tokens. */
export function convertLegacyCatalog(source: string, mapping: LegacyMigrationScope[]): CatalogDocument {
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => error.message).join('; '));
  const raw = object(parsed.toJS({ maxAliasCount: 100 }));
  allowKeys(raw, ['schema_version', 'catalogs']);
  if (raw.schema_version !== 1) throw new Error('Conversion requires schema_version: 1');
  const catalogs: CatalogScope[] = [];
  const unresolved: string[] = [];
  for (const value of list(raw.catalogs)) {
    const legacy = object(value);
    try {
      allowKeys(legacy, ['cli', 'version', 'last_updated', 'selection_mode', 'notes', 'shared_options', 'models', 'providers']);
      const evidence = mapping.find(item => item.cli === legacy.cli);
      if (!evidence) throw new Error(`Unknown CLI '${legacy.cli}' requires reviewed migration bindings`);
      const scope = structuredClone(evidence.scope);
      if (legacy.selection_mode !== undefined) scope.selection_mode = legacy.selection_mode as CatalogScope['selection_mode'];
      scope.models = [];
      delete scope.presets;
      delete scope.shared_controls;
      scope.source_cli = string(legacy.cli);
      scope.cli_version = legacy.version === undefined ? undefined : string(legacy.version);
      scope.last_updated = legacy.last_updated === undefined ? undefined : string(legacy.last_updated);
      scope.notes = legacy.notes as string[] | undefined;
      const groups = [{ name: undefined, models: legacy.models ?? [], shared_options: legacy.shared_options },
        ...list(legacy.providers ?? []).map(item => object(item))];
      for (const group of groups) {
        allowKeys(group, ['name', 'models', 'shared_options']);
        for (const row of list(group.models ?? [])) {
          const model = object(row);
          allowKeys(model, ['name', 'label', 'default', 'context', 'max_output', 'notes', 'tags', 'deprecated', 'options']);
          const known = evidence.entries.find(entry => entry.name === model.name && entry.provider === group.name);
          if (!known) throw new Error(`Unresolved model '${model.name}' in '${String(group.name ?? '')}'`);
          const converted = structuredClone(known.model);
          converted.label = string(model.label ?? model.name);
          if (model.default !== undefined && typeof model.default !== 'boolean') throw new Error('Invalid default');
          converted.default = model.default as boolean | undefined;
          converted.notes = model.notes as string[] | undefined;
          if (model.deprecated !== undefined) {
            if (typeof model.deprecated !== 'boolean') throw new Error('Invalid deprecated flag');
            converted.notes = [...converted.notes ?? [], `Legacy deprecated: ${model.deprecated}`];
          }
          converted.capabilityTags = model.tags as string[] | undefined;
          converted.limits = model.context !== undefined || model.max_output !== undefined ? {
            ...(model.context !== undefined ? { contextWindowTokens: model.context as number } : {}),
            ...(model.max_output !== undefined ? { maxOutputTokens: model.max_output as number } : {}),
          } : undefined;
          const inherited = new Map(list(legacy.shared_options ?? []).map(item => { const option = object(item); return [string(option.name), option]; }));
          for (const item of list(group.shared_options ?? [])) { const option = object(item); inherited.set(string(option.name), { ...inherited.get(string(option.name)), ...option }); }
          if (Array.isArray(model.options) && !model.options.length) inherited.clear();
          for (const item of list(model.options ?? [])) { const option = object(item); inherited.set(string(option.name), { ...inherited.get(string(option.name)), ...option }); }
          const controls: CatalogControl[] = [];
          converted.execution.fixed_controls = {};
          for (const option of inherited.values()) {
            allowKeys(option, ['name', 'values', 'default', 'notes']);
            const binding = known.options.find(item => item.name === option.name);
            if (!binding) throw new Error(`Unresolved option '${option.name}' on '${model.name}'`);
            const values = list(option.values).map(item => {
              const oldValue = typeof item === 'string' ? { name: item } : object(item); allowKeys(oldValue, ['name', 'notes']);
              const token = binding.values[string(oldValue.name)];
              if (token === undefined) throw new Error(`Unresolved option value '${oldValue.name}' on '${model.name}'`);
              return { value: token, label: string(oldValue.name), ...(oldValue.notes ? { description: list(oldValue.notes).map(string).join(' ') } : {}) };
            });
            if (binding.fixed) {
              if (values.length !== 1 || option.default !== undefined && option.default !== values[0].label) throw new Error('Fixed combination changed; review its bindings');
              converted.execution.fixed_controls[binding.key] = values[0].value;
              converted.notes = [...converted.notes ?? [],
                `${string(option.name)}: ${values[0].label}${values[0].description ? ` — ${values[0].description}` : ''}`,
                ...list(option.notes ?? []).map(string),
              ];
            } else {
              const template = known.model.controls?.find(item => item.key === binding.key);
              if (!template) throw new Error('Missing reviewed control binding');
              const control: CatalogControl = { ...template, values, default: undefined };
              if (option.default !== undefined) {
                const selected = values.find(item => item.label === option.default);
                if (!selected) throw new Error(`Unresolved option default '${option.default}'`);
                control.default = selected.value;
              }
              if (option.notes !== undefined) control.description = list(option.notes).map(string).join(' ');
              controls.push(control);
            }
          }
          converted.controls = controls;
          scope.models.push(converted);
        }
      }
      catalogs.push(scope);
    } catch (error) { unresolved.push(`${String(legacy.cli)}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (unresolved.length) throw new Error(`Conversion requires explicit mapping review:\n${unresolved.join('\n')}`);
  return validateCatalogDocument({ schema_version: 2, catalogs });
}
