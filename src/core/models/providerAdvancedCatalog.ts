import type { BackendKind } from '../../backends/cli/config.js';
import type { ProviderModelSelection } from './providerSelectionResolution.js';

export type ProviderAdvancedCatalogSource = 'dynamic' | 'config' | 'static';
export type ProviderAdvancedCatalogSupportTier = 'full' | 'entry_only' | 'read_only';
export type ProviderAdvancedControlValue = string | number | boolean;
export type ProviderAdvancedControlKind = 'enum' | 'boolean' | 'number' | 'string';
export type ProviderAdvancedControlScope = 'session_default' | 'request' | 'both';

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
  values?: string[];
  minimum?: number;
  maximum?: number;
  step?: number;
  applicableEntryIds?: string[];
  semanticTags?: string[];
}

export interface ProviderAdvancedCatalogSupport {
  tier: ProviderAdvancedCatalogSupportTier;
}

export interface ProviderAdvancedCatalogResult {
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
  warnings: string[];
}
