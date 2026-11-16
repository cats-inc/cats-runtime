import type { BackendKind } from '../../backends/cli/config.js';
import type { ProviderModelSelection } from './providerSelectionResolution.js';
import type { CatalogBasis } from '../../catalogs/types.js';

export type ProviderAdvancedCatalogSource = 'dynamic' | 'config' | 'static';
export type ProviderAdvancedCatalogSupportTier = 'full' | 'entry_only' | 'read_only';
export type ProviderAdvancedMetadataStatus = 'verified_manifest' | 'unverified_omitted';
export type ProviderAdvancedControlValue = string | number | boolean;
export type ProviderAdvancedControlKind = 'enum' | 'boolean' | 'number' | 'string';
export type ProviderAdvancedControlScope = 'session_default' | 'request' | 'both';

export interface ProviderAdvancedCatalogControlOption {
  value: ProviderAdvancedControlValue;
  label: string;
  description?: string;
  applicableEntryIds?: string[];
}

export interface ProviderAdvancedCatalogCacheMetadata {
  servedFromCache: boolean;
  cachedAt: string | null;
  ttlSec: number | null;
}

export interface ProviderAdvancedCatalogEntryLimits {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
}

export interface ProviderAdvancedCatalogEntry {
  id: string;
  label: string;
  default?: boolean;
  controlDefaults?: Record<string, ProviderAdvancedControlValue>;
  controls?: ProviderAdvancedCatalogControl[];
  status?: 'configured' | 'available' | 'running';
  capabilityTags?: string[];
  limits?: ProviderAdvancedCatalogEntryLimits;
  notes?: string[];
}

export interface ProviderAdvancedCatalogPreset {
  id: string;
  label: string;
  description?: string;
  availability: 'supported' | 'unavailable';
  applicableEntryIds?: string[];
  preferredEntryId?: string;
  controlDefaults?: Record<string, ProviderAdvancedControlValue>;
  warnings?: string[];
}

export interface ProviderAdvancedCatalogControl {
  key: string;
  label: string;
  description?: string;
  kind: ProviderAdvancedControlKind;
  scope: ProviderAdvancedControlScope;
  values?: Array<ProviderAdvancedCatalogControlOption | ProviderAdvancedControlValue>;
  minimum?: number;
  maximum?: number;
  step?: number;
  applicableEntryIds?: string[];
  semanticTags?: string[];
}

export interface ProviderAdvancedCatalogSupport {
  tier: ProviderAdvancedCatalogSupportTier;
  advancedMetadataStatus?: ProviderAdvancedMetadataStatus;
  discoveryMode?: 'manual_refresh';
  provenance?: {
    status: ProviderAdvancedMetadataStatus;
    manifestId?: string;
    manifestVersion?: string;
    evidenceRefs?: string[];
  };
}

export interface ProviderAdvancedCatalogResult {
  catalogRevision?: string;
  catalogActivationId?: string;
  provider: string;
  backend: BackendKind;
  instance: string;
  defaultModel: string | null;
  source: ProviderAdvancedCatalogSource;
  cache: ProviderAdvancedCatalogCacheMetadata | null;
  entries: ProviderAdvancedCatalogEntry[];
  presets: ProviderAdvancedCatalogPreset[];
  controls: ProviderAdvancedCatalogControl[];
  defaultSelection: ProviderModelSelection | null;
  support: ProviderAdvancedCatalogSupport;
  /** Read-only channel, region or plan the scope was captured against; absent when not recorded. */
  basis?: CatalogBasis;
  /** The returned basis, when the target has two or more; absent for an id-less first basis. */
  basisId?: string;
  /** Every basis of the target in data order, present only when there are two or more (SPEC-045). */
  bases?: ProviderAdvancedCatalogBasisOption[];
  /** CLI version and capture date of the returned scope. */
  capture?: { cliVersion?: string; lastUpdated?: string };
  warnings: string[];
}

export interface ProviderAdvancedCatalogBasisOption {
  /** Absent only for an id-less first basis, which a selection names by omitting basisId. */
  id?: string;
  /** The channel, region and plan labels joined with " · ". */
  label: string;
  channel?: CatalogBasis['channel'];
  region?: CatalogBasis['region'];
  plan?: CatalogBasis['plan'];
  cliVersion?: string;
  lastUpdated?: string;
  /** Matches the CLI sign-in on the Runtime's host; at most one basis per target. */
  detected: boolean;
}
