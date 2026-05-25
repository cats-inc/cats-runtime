import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';
import {
  resolveBundledRuntimeConfigExamplePath,
  resolveRuntimeCuratedModelCatalogPath,
  resolveRuntimeRoot,
} from '../../shared/runtimePaths.js';

const SUPPORTED_SCHEMA_VERSION = 1;

const CURATED_CLI_ALIASES: Record<string, string[]> = {
  claude: ['claude', 'claude code'],
  codex: ['codex'],
  antigravity: ['antigravity', 'agy'],
  kilo: ['kilo'],
  kiro: ['kiro'],
  junie: ['junie', 'junie by jetbrains'],
  copilot: ['copilot', 'github copilot'],
  cursor: ['cursor'],
};

const CURATED_PROVIDER_ALIASES: Record<string, string[]> = {
  claude: ['anthropic', 'claude'],
  codex: ['openai', 'codex'],
  antigravity: ['antigravity', 'agy', 'google', 'gemini'],
  kilo: ['kilo'],
  kiro: ['kiro'],
  junie: ['junie', 'jetbrains ai', 'jetbrains'],
  copilot: ['copilot', 'github copilot'],
  cursor: ['cursor'],
};

export interface CuratedModelCatalogOptionValue {
  name: string;
  notes?: string[];
}

export interface CuratedModelCatalogOption {
  name: string;
  default?: string;
  values?: CuratedModelCatalogOptionValue[];
  notes?: string[];
}

export interface CuratedModelCatalogModel {
  name: string;
  label?: string;
  default?: boolean;
  deprecated?: boolean;
  context?: number;
  maxOutput?: number;
  tags?: string[];
  notes?: string[];
  options?: CuratedModelCatalogOption[];
}

export interface CuratedModelCatalogProvider {
  name: string;
  sharedOptions?: CuratedModelCatalogOption[];
  models: CuratedModelCatalogModel[];
}

export interface CuratedModelCatalogEntry {
  cli: string;
  version?: string;
  lastUpdated?: string;
  notes?: string[];
  sharedOptions?: CuratedModelCatalogOption[];
  models?: CuratedModelCatalogModel[];
  providers?: CuratedModelCatalogProvider[];
}

export interface CuratedModelCatalogDocument {
  schemaVersion: number;
  catalogs: CuratedModelCatalogEntry[];
}

export interface CuratedModelCatalogScope {
  catalog: CuratedModelCatalogEntry;
  provider?: CuratedModelCatalogProvider;
  sharedOptions: CuratedModelCatalogOption[];
  models: CuratedModelCatalogModel[];
}

export interface LoadCuratedModelCatalogOptions {
  runtimeConfig?: Partial<Pick<CliRuntimeConfig, 'configPath'>>;
  env?: NodeJS.ProcessEnv;
}

export interface LoadCuratedModelCatalogResult {
  path: string;
  document?: CuratedModelCatalogDocument;
  warnings: string[];
}

export function resolveCuratedModelCatalogPath(
  options: LoadCuratedModelCatalogOptions = {},
): string {
  const configPath = options.runtimeConfig?.configPath?.trim();
  if (configPath) {
    return resolveSiblingCuratedPath(configPath);
  }

  const runtimeRoot = resolveRuntimeRoot(options.env || process.env);
  return resolveRuntimeCuratedModelCatalogPath(runtimeRoot);
}

export function loadCuratedModelCatalog(
  options: LoadCuratedModelCatalogOptions = {},
): LoadCuratedModelCatalogResult {
  const primaryPath = resolveCuratedModelCatalogPath(options);
  const bundledExamplePath = resolveBundledRuntimeConfigExamplePath(
    'curated-model-catalogs.yaml',
    options.env || process.env,
  );
  const path = existsSync(primaryPath)
    ? primaryPath
    : bundledExamplePath;
  if (!existsSync(path)) {
    return {
      path: primaryPath,
      warnings: [],
    };
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      path,
      warnings: [
        `Curated model catalog at '${path}' could not be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      path,
      warnings: [
        `Curated model catalog at '${path}' must be a YAML mapping.`,
      ],
    };
  }

  const warnings: string[] = [];
  const doc = raw as Record<string, unknown>;
  const schemaVersion = readPositiveInt(doc.schema_version);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return {
      path,
      warnings: [
        `Curated model catalog at '${path}' has unsupported schema_version '${
          String(doc.schema_version)
        }'. Expected ${SUPPORTED_SCHEMA_VERSION}.`,
      ],
    };
  }

  const catalogs = parseCatalogs(doc.catalogs, warnings, 'catalogs');
  return {
    path,
    document: {
      schemaVersion,
      catalogs,
    },
    warnings,
  };
}

export function findCuratedCliCatalog(
  document: CuratedModelCatalogDocument | undefined,
  providerName: string,
): CuratedModelCatalogEntry | undefined {
  if (!document) {
    return undefined;
  }

  const aliases = CURATED_CLI_ALIASES[providerName] || [providerName];
  const candidates = document.catalogs.filter((catalog) => matchesAlias(catalog.cli, aliases));
  if (candidates.length === 0) {
    return undefined;
  }

  let best = candidates[0];
  let bestTimestamp = parseOptionalTimestamp(best.lastUpdated);
  for (const candidate of candidates.slice(1)) {
    const candidateTimestamp = parseOptionalTimestamp(candidate.lastUpdated);
    if (candidateTimestamp !== null && (bestTimestamp === null || candidateTimestamp >= bestTimestamp)) {
      best = candidate;
      bestTimestamp = candidateTimestamp;
      continue;
    }
    if (candidateTimestamp === null && bestTimestamp === null) {
      best = candidate;
    }
  }

  return best;
}

export function resolveCuratedCatalogScope(
  catalog: CuratedModelCatalogEntry,
  providerName: string,
): CuratedModelCatalogScope | undefined {
  if (catalog.models) {
    return {
      catalog,
      sharedOptions: cloneOptions(catalog.sharedOptions),
      models: cloneModels(catalog.models),
    };
  }

  if (!catalog.providers?.length) {
    return undefined;
  }

  const aliases = CURATED_PROVIDER_ALIASES[providerName] || [providerName];
  const provider = catalog.providers.find((entry) => matchesAlias(entry.name, aliases));
  if (!provider) {
    return undefined;
  }

  return {
    catalog,
    provider,
    sharedOptions: mergeOptions(catalog.sharedOptions, provider.sharedOptions),
    models: cloneModels(provider.models),
  };
}

export function resolveEffectiveCuratedModelOptions(
  sharedOptions: CuratedModelCatalogOption[] | undefined,
  model: CuratedModelCatalogModel,
): CuratedModelCatalogOption[] {
  const base = cloneOptions(sharedOptions);
  if (!Object.prototype.hasOwnProperty.call(model, 'options')) {
    return base;
  }
  if (!model.options || model.options.length === 0) {
    return [];
  }
  return mergeOptions(base, model.options);
}

function resolveSiblingCuratedPath(configPath: string): string {
  return join(dirname(configPath), 'curated-model-catalogs.yaml');
}

function parseCatalogs(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogEntry[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      warnings.push(`Curated model catalog field '${label}' must be an array.`);
    }
    return [];
  }

  return value.flatMap((entry, index) => {
    const parsed = parseCatalogEntry(entry, warnings, `${label}[${index}]`);
    return parsed ? [parsed] : [];
  });
}

function parseCatalogEntry(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogEntry | undefined {
  const doc = asRecord(value);
  if (!doc) {
    warnings.push(`Curated model catalog entry '${label}' must be a mapping.`);
    return undefined;
  }

  const cli = readNonEmptyString(doc.cli);
  if (!cli) {
    warnings.push(`Curated model catalog entry '${label}' is missing required field 'cli'.`);
    return undefined;
  }

  const modelsFieldPresent = Object.prototype.hasOwnProperty.call(doc, 'models');
  const providersFieldPresent = Object.prototype.hasOwnProperty.call(doc, 'providers');
  const models = modelsFieldPresent
    ? parseModels(doc.models, warnings, `${label}.models`)
    : undefined;
  const providers = providersFieldPresent
    ? parseProviders(doc.providers, warnings, `${label}.providers`)
    : undefined;
  const sharedOptions = parseOptionsField(doc, warnings, `${label}.shared_options`);
  const version = readNonEmptyString(doc.version);
  const lastUpdated = readNonEmptyString(doc.last_updated);
  const notes = readStringList(doc.notes);

  return {
    cli,
    ...(version ? { version } : {}),
    ...(lastUpdated ? { lastUpdated } : {}),
    ...(notes ? { notes } : {}),
    ...(sharedOptions !== undefined ? { sharedOptions } : {}),
    ...(models ? { models } : {}),
    ...(providers ? { providers } : {}),
  };
}

function parseProviders(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogProvider[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`Curated model catalog field '${label}' must be an array.`);
    return undefined;
  }

  const providers = value.flatMap((entry, index) => {
    const parsed = parseProvider(entry, warnings, `${label}[${index}]`);
    return parsed ? [parsed] : [];
  });
  return providers.length > 0 ? providers : undefined;
}

function parseProvider(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogProvider | undefined {
  const doc = asRecord(value);
  if (!doc) {
    warnings.push(`Curated model catalog provider '${label}' must be a mapping.`);
    return undefined;
  }

  const name = readNonEmptyString(doc.name);
  if (!name) {
    warnings.push(`Curated model catalog provider '${label}' is missing required field 'name'.`);
    return undefined;
  }

  const models = parseModels(doc.models, warnings, `${label}.models`);
  if (!models || models.length === 0) {
    warnings.push(`Curated model catalog provider '${label}' must define at least one model.`);
    return undefined;
  }
  const sharedOptions = parseOptionsField(doc, warnings, `${label}.shared_options`);

  return {
    name,
    ...(sharedOptions !== undefined ? { sharedOptions } : {}),
    models,
  };
}

function parseModels(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogModel[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`Curated model catalog field '${label}' must be an array.`);
    return undefined;
  }

  const models = value.flatMap((entry, index) => {
    const parsed = parseModel(entry, warnings, `${label}[${index}]`);
    return parsed ? [parsed] : [];
  });
  return models.length > 0 ? models : undefined;
}

function parseModel(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogModel | undefined {
  const doc = asRecord(value);
  if (!doc) {
    warnings.push(`Curated model catalog model '${label}' must be a mapping.`);
    return undefined;
  }

  const name = readNonEmptyString(doc.name);
  if (!name) {
    warnings.push(`Curated model catalog model '${label}' is missing required field 'name'.`);
    return undefined;
  }

  const options = parseModelOptions(doc, warnings, `${label}.options`);
  const modelLabel = readNonEmptyString(doc.label);
  const notes = readStringList(doc.notes);
  const tags = readStringList(doc.tags);
  const context = readPositiveInt(doc.context);
  const maxOutput = readPositiveInt(doc.max_output);

  return {
    name,
    ...(modelLabel ? { label: modelLabel } : {}),
    ...(typeof doc.default === 'boolean' ? { default: doc.default } : {}),
    ...(typeof doc.deprecated === 'boolean' ? { deprecated: doc.deprecated } : {}),
    ...(context ? { context } : {}),
    ...(maxOutput ? { maxOutput } : {}),
    ...(tags ? { tags } : {}),
    ...(notes ? { notes } : {}),
    ...(options !== undefined ? { options } : {}),
  };
}

function parseModelOptions(
  doc: Record<string, unknown>,
  warnings: string[],
  label: string,
): CuratedModelCatalogOption[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(doc, 'options')) {
    return undefined;
  }

  return parseOptions(doc.options, warnings, label) || [];
}

function parseOptionsField(
  doc: Record<string, unknown>,
  warnings: string[],
  label: string,
): CuratedModelCatalogOption[] | undefined {
  const key = label.split('.').at(-1);
  if (!key || !Object.prototype.hasOwnProperty.call(doc, key)) {
    return undefined;
  }

  const raw = doc[key];
  return parseOptions(raw, warnings, label) || [];
}

function parseOptions(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogOption[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`Curated model catalog field '${label}' must be an array.`);
    return undefined;
  }

  const options = value.flatMap((entry, index) => {
    const parsed = parseOption(entry, warnings, `${label}[${index}]`);
    return parsed ? [parsed] : [];
  });
  return options.length > 0 ? options : [];
}

function parseOption(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogOption | undefined {
  const doc = asRecord(value);
  if (!doc) {
    warnings.push(`Curated model catalog option '${label}' must be a mapping.`);
    return undefined;
  }

  const name = readNonEmptyString(doc.name);
  if (!name) {
    warnings.push(`Curated model catalog option '${label}' is missing required field 'name'.`);
    return undefined;
  }
  const defaultValue = readNonEmptyString(doc.default);
  const values = parseOptionValues(doc.values, warnings, `${label}.values`);
  const notes = readStringList(doc.notes);

  return {
    name,
    ...(defaultValue ? { default: defaultValue } : {}),
    ...(values !== undefined ? { values } : {}),
    ...(notes ? { notes } : {}),
  };
}

function parseOptionValues(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogOptionValue[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`Curated model catalog field '${label}' must be an array.`);
    return undefined;
  }

  const values = value.flatMap((entry, index) => {
    const parsed = parseOptionValue(entry, warnings, `${label}[${index}]`);
    return parsed ? [parsed] : [];
  });
  return values.length > 0 ? values : [];
}

function parseOptionValue(
  value: unknown,
  warnings: string[],
  label: string,
): CuratedModelCatalogOptionValue | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { name: value.trim() };
  }

  const doc = asRecord(value);
  if (!doc) {
    warnings.push(`Curated model catalog option value '${label}' must be a string or mapping.`);
    return undefined;
  }

  const name = readNonEmptyString(doc.name);
  if (!name) {
    warnings.push(`Curated model catalog option value '${label}' is missing required field 'name'.`);
    return undefined;
  }
  const notes = readStringList(doc.notes);

  return {
    name,
    ...(notes ? { notes } : {}),
  };
}

function mergeOptions(
  base: CuratedModelCatalogOption[] | undefined,
  override: CuratedModelCatalogOption[] | undefined,
): CuratedModelCatalogOption[] {
  const merged = new Map<string, CuratedModelCatalogOption>();

  for (const option of cloneOptions(base)) {
    merged.set(normalizeToken(option.name), option);
  }

  for (const option of cloneOptions(override)) {
    const key = normalizeToken(option.name);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeOption(existing, option) : option);
  }

  return Array.from(merged.values());
}

function mergeOption(
  base: CuratedModelCatalogOption,
  override: CuratedModelCatalogOption,
): CuratedModelCatalogOption {
  return {
    name: override.name || base.name,
    default: override.default ?? base.default,
    values: override.values ?? base.values,
    notes: override.notes ?? base.notes,
  };
}

function cloneModels(
  models: CuratedModelCatalogModel[] | undefined,
): CuratedModelCatalogModel[] {
  return (models || []).map((model) => ({
    ...model,
    ...(model.tags ? { tags: [...model.tags] } : {}),
    ...(model.notes ? { notes: [...model.notes] } : {}),
    ...(Object.prototype.hasOwnProperty.call(model, 'options')
      ? { options: cloneOptions(model.options) }
      : {}),
  }));
}

function cloneOptions(
  options: CuratedModelCatalogOption[] | undefined,
): CuratedModelCatalogOption[] {
  return (options || []).map((option) => ({
    ...option,
    ...(option.notes ? { notes: [...option.notes] } : {}),
    ...(option.values
      ? {
          values: option.values.map((value) => ({
            ...value,
            ...(value.notes ? { notes: [...value.notes] } : {}),
          })),
        }
      : {}),
  }));
}

function matchesAlias(value: string, aliases: string[]): boolean {
  const normalizedValue = normalizeToken(value);
  return aliases.some((alias) => normalizeToken(alias) === normalizedValue);
}

function parseOptionalTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
