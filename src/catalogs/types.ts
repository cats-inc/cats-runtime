/** Data contract shared by the Runtime and read-only local hosts. No server imports. */
export type CatalogValue = string | number | boolean;
export type CatalogBackend = 'cli' | 'api' | 'local' | 'agent';

export interface CatalogControl {
  key: string;
  label: string;
  kind: 'enum' | 'boolean' | 'number' | 'string';
  scope: 'session_default' | 'request' | 'both';
  description?: string;
  values?: Array<{ value: CatalogValue; label: string; description?: string }>;
  default?: CatalogValue;
  minimum?: number;
  maximum?: number;
  step?: number;
  semanticTags?: string[];
}

export interface CatalogExecution {
  model: string;
  provider?: string;
  fixed_controls?: Record<string, CatalogValue>;
  variants?: Array<{
    when: Record<string, CatalogValue>;
    model: string;
    provider?: string;
  }>;
}

export interface CatalogModel {
  id: string;
  label: string;
  default?: boolean;
  execution: CatalogExecution;
  controls?: CatalogControl[];
  limits?: { contextWindowTokens?: number; maxOutputTokens?: number };
  capabilityTags?: string[];
  notes?: string[];
  /** Retained picker spellings for the explicit schema-1 converter only. */
  source_names?: string[];
}

export interface CatalogPreset {
  id: string;
  label: string;
  description?: string;
  availability: 'supported' | 'unavailable';
  applicableEntryIds?: string[];
  preferredEntryId?: string;
  controlDefaults?: Record<string, CatalogValue>;
  warnings?: string[];
}

/** What a scope's list was captured against; shown read-only, recorded only with evidence. */
export interface CatalogBasis {
  /**
   * Identity among the bases of one target (SPEC-045). Only the target's first scope may omit
   * it; a scope, override or selection without an id means that first basis.
   */
  id?: string;
  /** Routing channel inside the CLI host that every entry runs through. */
  channel?: { id: string; label: string };
  /** Sign-in region the list was captured on, by the CLI's own region token and name. */
  region?: { id: string; label: string };
  /** Account plan the list was captured with; `id` is the CLI's own plan token, for detection. */
  plan?: { label: string; id?: string };
}

export interface CatalogScope {
  provider: string;
  backend: CatalogBackend;
  transport?: string;
  selection_mode: 'full' | 'shortlist' | 'discovery';
  source_cli?: string;
  cli_version?: string;
  last_updated?: string;
  notes?: string[];
  basis?: CatalogBasis;
  shared_controls?: CatalogControl[];
  models: CatalogModel[];
  presets?: CatalogPreset[];
}

export interface CatalogDocument {
  schema_version: 2;
  catalogs: CatalogScope[];
}

export interface CatalogSnapshot {
  schemaVersion: 2;
  catalogRevision: string;
  factoryDigest: string;
  overrideDigest: string | null;
  origins: Record<string, 'factory' | 'override'>;
  document: CatalogDocument;
}

export interface CatalogPaths {
  /** Both roots must be absolute. Relative cwd-dependent host reads are forbidden. */
  packageRoot: string;
  runtimeRoot: string;
  configPath?: string;
  overridePath?: string;
  factoryPath?: string;
}

export interface CatalogProjection {
  source: 'local_candidate' | 'last_accepted' | 'unavailable';
  snapshot?: CatalogSnapshot;
  diagnostics: string[];
}
