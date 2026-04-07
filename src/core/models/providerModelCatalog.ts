import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  BackendKind,
  CliRuntimeConfig,
  RemoteProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type { AgentBackendManager } from '../../backends/agent/runtime/AgentBackendManager.js';
import { inspectProviderActiveConfig } from '../providerActiveConfig.js';
import {
  resolveProviderTarget,
  type ProviderTargetDescriptor,
} from '../providerCatalog.js';
import {
  buildProviderAdvancedKnowledge,
  type ProviderAdvancedKnowledgeContext,
} from './providerAdvancedKnowledge.js';
import {
  discoverPiModels,
  type PiModelDiscoveryRunner,
} from '../../backends/cli/pi/models.js';
import {
  discoverOpencodeModels,
  type OpencodeModelDiscoveryRunner,
} from '../../backends/cli/opencode/models.js';
import {
  discoverKiloModels,
  type KiloModelDiscoveryRunner,
} from '../../backends/cli/kilo/models.js';
import {
  discoverCursorModels,
  type CursorModelDiscoveryRunner,
} from '../../backends/cli/cursor/models.js';
import {
  buildRemoteModelDiscoveryRequest,
  DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS,
  fetchRemoteModelDiscovery,
  RemoteModelDiscoveryAbortError,
  sanitizeRemoteModelDiscoveryUrl,
  type RemoteModelDiscoveryRequest,
  type RemoteModelDiscoveryHttpRequest,
  RemoteModelDiscoveryTimeoutError,
} from './remoteModelDiscovery.js';

export interface ProviderModelCatalogEntry {
  id: string;
  label: string;
  default?: boolean;
  status?: 'configured' | 'available' | 'running';
}

export interface ProviderModelCatalogCacheMetadata {
  servedFromCache: boolean;
  cachedAt: string | null;
  ttlSec: number | null;
  stale?: boolean;
  persisted?: boolean;
  backoff?: ProviderModelCatalogBackoffMetadata;
}

export interface ProviderModelCatalogBackoffMetadata {
  active: boolean;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  nextRefreshAllowedAt: string | null;
  reason?: string;
}

export interface ProviderModelCatalogResult {
  provider: string;
  backend: BackendKind;
  instance: string;
  defaultModel: string | null;
  source: 'dynamic' | 'config' | 'static';
  cache: ProviderModelCatalogCacheMetadata | null;
  models: ProviderModelCatalogEntry[];
  warnings: string[];
}

export interface ProviderModelCatalogStatusCounts {
  configured: number;
  available: number;
  running: number;
  unknown: number;
}

export interface ProviderModelCatalogSummary {
  source: ProviderModelCatalogResult['source'];
  defaultModel: string | null;
  defaultModelStatus?: ProviderModelCatalogEntry['status'];
  modelCount: number;
  warnings: string[];
  statusCounts: ProviderModelCatalogStatusCounts;
  cache?: ProviderModelCatalogCacheMetadata;
}

interface ProviderModelCatalogServiceOptions {
  agentBackend?: AgentBackendManager;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  ttlMs?: number;
  piModelDiscoveryRunner?: PiModelDiscoveryRunner;
  opencodeModelDiscoveryRunner?: OpencodeModelDiscoveryRunner;
  kiloModelDiscoveryRunner?: KiloModelDiscoveryRunner;
  cursorModelDiscoveryRunner?: CursorModelDiscoveryRunner;
  remoteDiscoveryTimeoutMs?: number;
}

interface ProviderModelCatalogRequestOptions {
  forceRefresh?: boolean;
}

interface CachedDynamicModels {
  cachedAt: number;
  models: ProviderModelCatalogEntry[];
  warnings: string[];
}

interface RefreshBackoffState {
  consecutiveFailures: number;
  lastFailureAt: number;
  nextRefreshAllowedAt: number;
  reason: string;
}

interface PersistedDynamicCatalogSnapshot {
  key: string;
  provider: string;
  backend: BackendKind;
  instance: string;
  source: 'dynamic';
  cachedAt: string;
  models: ProviderModelCatalogEntry[];
  warnings: string[];
}

interface PersistedDynamicCatalogBackoff {
  key: string;
  provider: string;
  backend: BackendKind;
  instance: string;
  consecutiveFailures: number;
  lastFailureAt: string;
  nextRefreshAllowedAt: string;
  reason: string;
}

interface PersistedProviderModelCatalogState {
  version: 1;
  snapshots: PersistedDynamicCatalogSnapshot[];
  backoff: PersistedDynamicCatalogBackoff[];
}

interface DynamicCatalogLoadResult {
  models: ProviderModelCatalogEntry[];
  warnings?: string[];
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_DISCOVERY_BACKOFF_MS = 60_000;
const MAX_DISCOVERY_BACKOFF_MS = 15 * 60_000;
const MAX_GEMINI_MODEL_LIST_PAGES = 5;

const KIRO_NATIVE_MODELS: ProviderModelCatalogEntry[] = [
  { id: 'claude-opus-4.6', label: 'claude-opus-4.6', default: true },
  { id: 'deepseek-3.2', label: 'deepseek-3.2' },
  { id: 'minimax-m2.1', label: 'minimax-m2.1' },
];

const KIRO_WSL_MODELS: ProviderModelCatalogEntry[] = [
  { id: 'claude-sonnet-4.5', label: 'claude-sonnet-4.5', default: true },
  { id: 'deepseek-3.2', label: 'deepseek-3.2' },
  { id: 'minimax-m2.1', label: 'minimax-m2.1' },
];

const STATIC_PROVIDER_MODELS: Record<string, ProviderModelCatalogEntry[]> = {
  claude: [
    { id: 'opus', label: 'Opus 4.6 with 1M context', default: true },
    { id: 'sonnet', label: 'Sonnet 4.6' },
    { id: 'haiku', label: 'Haiku 4.5' },
  ],
  codex: [
    { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
    { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
    { id: 'gpt-5.2', label: 'gpt-5.2' },
    { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
    { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
  ],
  gemini: [
    { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview', default: true },
    { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
    { id: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite-preview' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
  ],
  copilot: [
    { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
    { id: 'claude-opus-4-6', label: 'claude-opus-4-6' },
    { id: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
  ],
  opencode: [
    { id: 'opencode-go/glm-5', label: 'glm-5', default: true },
    { id: 'opencode-go/kimi-k2.5', label: 'kimi k2.5' },
    { id: 'opencode-go/minimax-m2.5', label: 'minimax m2.5' },
  ],
  kilo: [
    { id: 'kilo/openai/gpt-5.4', label: 'gpt-5.4', default: true },
    { id: 'kilo/openai/gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { id: 'kilo/anthropic/claude-opus-4.6', label: 'claude-opus-4.6' },
    { id: 'kilo/anthropic/claude-sonnet-4.6', label: 'claude-sonnet-4.6' },
    { id: 'kilo/google/gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
    { id: 'kilo/z-ai/glm-5', label: 'glm-5' },
  ],
  auggie: [
    { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
    { id: 'claude opus 4.6', label: 'claude opus 4.6' },
    { id: 'sonnet 4.6', label: 'sonnet 4.6' },
  ],
  pi: [
    { id: 'openai-codex/gpt-5.4', label: 'openai-codex/gpt-5.4', default: true },
  ],
  junie: [
    { id: 'gpt', label: 'gpt', default: true },
    { id: 'gpt-codex', label: 'gpt-codex' },
    { id: 'sonnet', label: 'sonnet' },
    { id: 'opus', label: 'opus' },
    { id: 'gemini-pro', label: 'gemini-pro' },
    { id: 'gemini-flash', label: 'gemini-flash' },
    { id: 'grok', label: 'grok' },
  ],
  cursor: [
    { id: 'auto', label: 'Auto', default: true },
    { id: 'composer-2-fast', label: 'Composer 2 Fast' },
    { id: 'gpt-5.4-medium', label: 'GPT-5.4 1M' },
    { id: 'claude-4.6-opus-high-thinking', label: 'Opus 4.6 1M Thinking' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  ],
  goose: [
    { id: 'openai/gpt-5-codex', label: 'openai/gpt-5-codex', default: true },
    { id: 'openai/gpt-5', label: 'openai/gpt-5' },
  ],
  ollama: [
    { id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b', default: true },
  ],
};

function cloneModels(models: ProviderModelCatalogEntry[]): ProviderModelCatalogEntry[] {
  return models.map((model) => ({ ...model }));
}

function defaultFetch(): typeof fetch {
  return fetch;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function normalizeProviderCatalogModelId(
  target: Pick<ProviderTargetDescriptor, 'providerName' | 'backend'>,
  modelId: string | null | undefined,
): string | null {
  const normalized = modelId?.trim();
  if (!normalized) {
    return null;
  }

  if (target.providerName === 'claude' && target.backend === 'cli') {
    const lower = normalized.toLowerCase();
    if (lower === 'claude-opus-4-6' || lower === 'claude-opus-4.6' || lower === 'opus') {
      return 'opus';
    }
    if (lower === 'claude-sonnet-4-6' || lower === 'claude-sonnet-4.6' || lower === 'sonnet') {
      return 'sonnet';
    }
    if (lower === 'claude-haiku-4-5' || lower === 'claude-haiku-4.5' || lower === 'haiku') {
      return 'haiku';
    }
  }

  return normalized;
}

function resolveDefaultModel(
  target: ProviderTargetDescriptor,
  env: NodeJS.ProcessEnv,
): string | null {
  const configuredModel = target.remoteInstance?.model?.trim();
  if (configuredModel) {
    return normalizeProviderCatalogModelId(target, configuredModel);
  }

  const activeConfig = inspectProviderActiveConfig(target, { env });
  const activeModel = activeConfig?.state === 'detected'
    ? activeConfig.model?.trim() || null
    : null;
  if (activeModel) {
    return normalizeProviderCatalogModelId(target, activeModel);
  }

  if (target.providerName === 'cursor' && target.backend === 'cli') {
    return null;
  }

  const staticModels = getStaticProviderModels(target);
  return normalizeProviderCatalogModelId(
    target,
    staticModels.find((model) => model.default)?.id ?? null,
  );
}

function resolveBaseUrl(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
  fallback: string,
): string {
  const fromEnv = instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined;
  return fromEnv || instance.baseUrl || fallback;
}

function filterPreferredModels(
  models: ProviderModelCatalogEntry[],
  predicate: (id: string) => boolean,
): ProviderModelCatalogEntry[] {
  const preferred = models.filter((model) => predicate(model.id));
  return preferred.length > 0 ? preferred : models;
}

function isLikelyOpenAiCatalogModel(id: string): boolean {
  const normalized = id.toLowerCase();
  return normalized.startsWith('gpt-')
    || /^o\d/.test(normalized)
    || normalized.startsWith('chatgpt-')
    || normalized.includes('codex');
}

function isLikelyAnthropicCatalogModel(id: string): boolean {
  return id.toLowerCase().startsWith('claude-');
}

function isLikelyGeminiCatalogModel(id: string): boolean {
  return id.toLowerCase().startsWith('gemini-');
}

function normalizeGeminiModelId(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

function supportsGeminiGeneration(entry: Record<string, unknown>): boolean {
  const methods = Array.isArray(entry.supportedGenerationMethods)
    ? entry.supportedGenerationMethods
    : [];
  if (methods.length === 0) {
    return true;
  }

  return methods.some((method) => typeof method === 'string'
    && (
      method === 'generateContent'
      || method === 'streamGenerateContent'
      || method.endsWith('.generateContent')
      || method.endsWith('.streamGenerateContent')
    ));
}

function withDefaultModel(
  models: ProviderModelCatalogEntry[],
  defaultModel: string | null,
): { models: ProviderModelCatalogEntry[]; defaultInjected: boolean } {
  const deduped = dedupeModels(models);
  if (!defaultModel) {
    return {
      models: deduped,
      defaultInjected: false,
    };
  }

  const existing = deduped.find((model) => model.id === defaultModel);
  if (existing) {
    for (const model of deduped) {
      model.default = model.id === defaultModel;
    }
    return {
      models: deduped,
      defaultInjected: false,
    };
  }

  return {
    models: [
      {
        id: defaultModel,
        label: defaultModel,
        default: true,
        status: 'configured',
      },
      ...deduped.map(({ default: _default, ...model }) => ({ ...model })),
    ],
    defaultInjected: true,
  };
}

function buildCacheMetadata(
  ttlMs: number,
  cachedAtMs: number,
  servedFromCache: boolean,
  options: {
    stale?: boolean;
    persisted?: boolean;
    backoff?: RefreshBackoffState | null;
  } = {},
): ProviderModelCatalogCacheMetadata {
  return {
    servedFromCache,
    cachedAt: new Date(cachedAtMs).toISOString(),
    ttlSec: Math.floor(ttlMs / 1000),
    ...(options.stale ? { stale: true } : {}),
    ...(options.persisted ? { persisted: true } : {}),
    ...(options.backoff ? { backoff: toBackoffMetadata(options.backoff) } : {}),
  };
}

function toBackoffMetadata(
  state: RefreshBackoffState,
): ProviderModelCatalogBackoffMetadata {
  return {
    active: state.nextRefreshAllowedAt > Date.now(),
    consecutiveFailures: state.consecutiveFailures,
    lastFailureAt: new Date(state.lastFailureAt).toISOString(),
    nextRefreshAllowedAt: new Date(state.nextRefreshAllowedAt).toISOString(),
    ...(state.reason ? { reason: state.reason } : {}),
  };
}

function describeBackoffState(
  target: ProviderTargetDescriptor,
  state: RefreshBackoffState,
): string {
  return `Dynamic model discovery backoff is active for ${target.providerName}/${target.backend}/${target.instanceId} `
    + `until ${new Date(state.nextRefreshAllowedAt).toISOString()} after ${state.consecutiveFailures} `
    + `failure(s): ${state.reason}`;
}

function computeBackoffState(
  previous: RefreshBackoffState | null,
  reason: string,
  now: number,
): RefreshBackoffState {
  const consecutiveFailures = Math.max(1, (previous?.consecutiveFailures ?? 0) + 1);
  const backoffMs = Math.min(
    DEFAULT_DISCOVERY_BACKOFF_MS * (2 ** Math.max(0, consecutiveFailures - 1)),
    MAX_DISCOVERY_BACKOFF_MS,
  );
  return {
    consecutiveFailures,
    lastFailureAt: now,
    nextRefreshAllowedAt: now + backoffMs,
    reason,
  };
}

function statusRank(status: ProviderModelCatalogEntry['status']): number {
  switch (status) {
    case 'running':
      return 3;
    case 'available':
      return 2;
    case 'configured':
      return 1;
    default:
      return 0;
  }
}

function dedupeModels(models: ProviderModelCatalogEntry[]): ProviderModelCatalogEntry[] {
  const deduped = new Map<string, ProviderModelCatalogEntry>();

  for (const model of cloneModels(models)) {
    const existing = deduped.get(model.id);
    if (!existing) {
      deduped.set(model.id, model);
      continue;
    }

    existing.label = existing.label || model.label;
    existing.default = existing.default === true || model.default === true;
    if (statusRank(model.status) > statusRank(existing.status)) {
      existing.status = model.status;
    }
  }

  return Array.from(deduped.values());
}

function countModelStatuses(models: ProviderModelCatalogEntry[]): ProviderModelCatalogStatusCounts {
  const counts: ProviderModelCatalogStatusCounts = {
    configured: 0,
    available: 0,
    running: 0,
    unknown: 0,
  };

  for (const model of models) {
    switch (model.status) {
      case 'configured':
        counts.configured += 1;
        break;
      case 'available':
        counts.available += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      default:
        counts.unknown += 1;
        break;
    }
  }

  return counts;
}

function appendKnownStaticCatalogWarnings(
  target: ProviderTargetDescriptor,
  warnings: string[],
): void {
  if (target.backend === 'cli' && target.providerName === 'cursor') {
    warnings.push(
      `Live model discovery is available for ${target.providerName}/${target.backend}/${target.instanceId} `
      + 'via `cursor-agent --list-models`, but this read is serving the curated static fallback '
      + 'until an explicit refresh populates the cache.',
    );
  }
  if (target.backend === 'cli' && target.providerName === 'junie') {
    warnings.push(
      'Junie CLI does not expose a live model list; serving a curated alias fallback only. '
      + "Junie's dynamic Default, BYOK, and custom models are not enumerated here.",
    );
  }
}

export function summarizeProviderModelCatalog(
  catalog: ProviderModelCatalogResult,
): ProviderModelCatalogSummary {
  const defaultModelStatus = catalog.defaultModel
    ? catalog.models.find((entry) => entry.id === catalog.defaultModel)?.status
    : undefined;
  return {
    source: catalog.source,
    defaultModel: catalog.defaultModel,
    ...(defaultModelStatus ? { defaultModelStatus } : {}),
    modelCount: catalog.models.length,
    warnings: [...catalog.warnings],
    statusCounts: countModelStatuses(catalog.models),
    ...(catalog.cache ? { cache: catalog.cache } : {}),
  };
}

export function getStaticProviderModels(
  target: Pick<ProviderTargetDescriptor, 'providerName' | 'cliInstance'>,
): ProviderModelCatalogEntry[] {
  if (target.providerName === 'kiro') {
    const runtimeMode = target.cliInstance?.commandConfig.runtime.mode;
    return cloneModels(runtimeMode === 'wsl' ? KIRO_WSL_MODELS : KIRO_NATIVE_MODELS);
  }

  return cloneModels(STATIC_PROVIDER_MODELS[target.providerName] || []);
}

function resolveProviderModelCatalogStorageFile(
  config: Pick<CliRuntimeConfig, 'dataDir' | 'sessionBaseDir'>,
): string | null {
  return typeof config.dataDir === 'string' && config.dataDir.length > 0
    ? join(config.dataDir, 'provider-model-catalog', 'snapshots.json')
    : null;
}

function isProviderModelCatalogEntry(value: unknown): value is ProviderModelCatalogEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && (record.default === undefined || typeof record.default === 'boolean')
    && (
      record.status === undefined
      || record.status === 'configured'
      || record.status === 'available'
      || record.status === 'running'
    );
}

export class ProviderModelCatalogService {
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly ttlMs: number;
  private readonly remoteDiscoveryTimeoutMs: number;
  private readonly storageFile: string | null;
  private readonly dynamicCache = new Map<string, CachedDynamicModels>();
  private readonly persistedSnapshots = new Map<string, CachedDynamicModels>();
  private readonly refreshBackoff = new Map<string, RefreshBackoffState>();

  constructor(
    private readonly config: CliRuntimeConfig,
    private readonly options: ProviderModelCatalogServiceOptions = {},
  ) {
    this.fetchImpl = options.fetch || defaultFetch();
    this.env = options.env || process.env;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.remoteDiscoveryTimeoutMs = options.remoteDiscoveryTimeoutMs
      ?? DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS;
    this.storageFile = resolveProviderModelCatalogStorageFile(config);
    this.loadPersistedState();
  }

  async getCatalog(
    providerName: string,
    requestedInstance?: string,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderModelCatalogResult> {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.getCatalogForTarget(target, options);
  }

  getImmediateCatalog(
    providerName: string,
    requestedInstance?: string,
  ): ProviderModelCatalogResult {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.getImmediateCatalogForTarget(target);
  }

  async getAdvancedKnowledge(
    providerName: string,
    requestedInstance?: string,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderAdvancedKnowledgeContext> {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.getAdvancedKnowledgeForTarget(target, options);
  }

  getImmediateAdvancedKnowledge(
    providerName: string,
    requestedInstance?: string,
  ): ProviderAdvancedKnowledgeContext {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.getImmediateAdvancedKnowledgeForTarget(target);
  }

  async getAdvancedKnowledgeForTarget(
    target: ProviderTargetDescriptor,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderAdvancedKnowledgeContext> {
    const catalog = await this.getCatalogForTarget(target, options);
    return buildProviderAdvancedKnowledge(target, catalog);
  }

  getImmediateAdvancedKnowledgeForTarget(
    target: ProviderTargetDescriptor,
  ): ProviderAdvancedKnowledgeContext {
    const catalog = this.getImmediateCatalogForTarget(target);
    return buildProviderAdvancedKnowledge(target, catalog);
  }

  async getAdvancedCatalog(
    providerName: string,
    requestedInstance?: string,
    options: ProviderModelCatalogRequestOptions = {},
  ) {
    const knowledge = await this.getAdvancedKnowledge(providerName, requestedInstance, options);
    return knowledge.catalog;
  }

  getImmediateAdvancedCatalog(
    providerName: string,
    requestedInstance?: string,
  ) {
    const knowledge = this.getImmediateAdvancedKnowledge(providerName, requestedInstance);
    return knowledge.catalog;
  }

  inspectSummary(
    providerName: string,
    requestedInstance?: string,
  ): ProviderModelCatalogSummary {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.inspectSummaryForTarget(target);
  }

  inspectSummaryForTarget(
    target: ProviderTargetDescriptor,
  ): ProviderModelCatalogSummary {
    return summarizeProviderModelCatalog(this.getImmediateCatalogForTarget(target));
  }

  private getImmediateCatalogForTarget(
    target: ProviderTargetDescriptor,
  ): ProviderModelCatalogResult {
    const defaultModel = resolveDefaultModel(target, this.env);
    const warnings: string[] = [];
    const cachedDynamic = this.getCachedDynamicCatalog(target, defaultModel, warnings);
    if (cachedDynamic) {
      return cachedDynamic;
    }

    const persistedDynamic = this.getPersistedDynamicCatalog(target, defaultModel, warnings);
    if (persistedDynamic) {
      return persistedDynamic;
    }

    this.appendActiveBackoffWarning(target, warnings);

    const discoverySkipWarning = this.getDynamicDiscoverySkipWarning(target);
    if (discoverySkipWarning) {
      warnings.push(discoverySkipWarning);
    }

    appendKnownStaticCatalogWarnings(target, warnings);
    const configCatalog = this.tryConfigCatalog(target, defaultModel, warnings);
    if (configCatalog) {
      return configCatalog;
    }

    return this.buildStaticCatalog(target, defaultModel, warnings);
  }

  private async getCatalogForTarget(
    target: ProviderTargetDescriptor,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderModelCatalogResult> {
    const defaultModel = resolveDefaultModel(target, this.env);
    const warnings: string[] = [];
    const dynamic = await this.tryDynamicCatalog(target, defaultModel, warnings, options);
    if (dynamic) {
      return dynamic;
    }

    appendKnownStaticCatalogWarnings(target, warnings);
    const configCatalog = this.tryConfigCatalog(target, defaultModel, warnings);
    if (configCatalog) {
      return configCatalog;
    }

    return this.buildStaticCatalog(target, defaultModel, warnings);
  }

  private cacheKey(target: ProviderTargetDescriptor): string {
    return `${target.providerName}:${target.backend}:${target.instanceId}`;
  }

  private getCachedDynamicCatalog(
    target: ProviderTargetDescriptor,
    defaultModel: string | null,
    warnings: string[],
  ): ProviderModelCatalogResult | null {
    const cached = this.dynamicCache.get(this.cacheKey(target));
    if (!cached) {
      return null;
    }

    const stale = Date.now() - cached.cachedAt > this.ttlMs;
    const backoff = this.getActiveBackoff(target);
    if (backoff) {
      warnings.push(describeBackoffState(target, backoff));
    }
    return this.buildCatalog(target, {
      defaultModel,
      source: 'dynamic',
      cache: buildCacheMetadata(this.ttlMs, cached.cachedAt, true, {
        stale,
        backoff,
      }),
      models: withDefaultModel(cached.models, defaultModel).models,
      warnings: [...warnings, ...cached.warnings],
    });
  }

  private getPersistedDynamicCatalog(
    target: ProviderTargetDescriptor,
    defaultModel: string | null,
    warnings: string[],
  ): ProviderModelCatalogResult | null {
    const snapshot = this.persistedSnapshots.get(this.cacheKey(target));
    if (!snapshot) {
      return null;
    }

    const stale = Date.now() - snapshot.cachedAt > this.ttlMs;
    const backoff = this.getActiveBackoff(target);
    if (backoff) {
      warnings.push(describeBackoffState(target, backoff));
    }
    return this.buildCatalog(target, {
      defaultModel,
      source: 'dynamic',
      cache: buildCacheMetadata(this.ttlMs, snapshot.cachedAt, true, {
        stale,
        persisted: true,
        backoff,
      }),
      models: withDefaultModel(snapshot.models, defaultModel).models,
      warnings: [...warnings, ...snapshot.warnings],
    });
  }

  private async tryDynamicCatalog(
    target: ProviderTargetDescriptor,
    defaultModel: string | null,
    warnings: string[],
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderModelCatalogResult | null> {
    const key = this.cacheKey(target);
    const cached = this.dynamicCache.get(key);
    const persistedSnapshot = this.persistedSnapshots.get(key);
    const now = Date.now();
    const backoff = this.getActiveBackoff(target);
    if (!options.forceRefresh && cached && now - cached.cachedAt < this.ttlMs) {
      const responseWarnings = backoff
        ? [...warnings, describeBackoffState(target, backoff), ...cached.warnings]
        : [...warnings, ...cached.warnings];
      return this.buildCatalog(target, {
        defaultModel,
        source: 'dynamic',
        cache: buildCacheMetadata(this.ttlMs, cached.cachedAt, true, {
          backoff,
        }),
        models: withDefaultModel(cached.models, defaultModel).models,
        warnings: responseWarnings,
      });
    }

    if (
      !options.forceRefresh
      && !cached
      && persistedSnapshot
      && now - persistedSnapshot.cachedAt < this.ttlMs
    ) {
      const responseWarnings = backoff
        ? [...warnings, describeBackoffState(target, backoff), ...persistedSnapshot.warnings]
        : [...warnings, ...persistedSnapshot.warnings];
      return this.buildCatalog(target, {
        defaultModel,
        source: 'dynamic',
        cache: buildCacheMetadata(this.ttlMs, persistedSnapshot.cachedAt, true, {
          persisted: true,
          backoff,
        }),
        models: withDefaultModel(persistedSnapshot.models, defaultModel).models,
        warnings: responseWarnings,
      });
    }

    if (backoff) {
      warnings.push(describeBackoffState(target, backoff));
      const snapshotFallback = this.getBestAvailableSnapshot(target);
      if (snapshotFallback) {
        return this.buildCatalog(target, {
          defaultModel,
          source: 'dynamic',
          cache: buildCacheMetadata(this.ttlMs, snapshotFallback.snapshot.cachedAt, true, {
            stale: true,
            persisted: snapshotFallback.persisted,
            backoff,
          }),
          models: withDefaultModel(snapshotFallback.snapshot.models, defaultModel).models,
          warnings: [...warnings, ...snapshotFallback.snapshot.warnings],
        });
      }
      return null;
    }

    const discoverySkipWarning = this.getDynamicDiscoverySkipWarning(target);
    if (discoverySkipWarning) {
      warnings.push(discoverySkipWarning);
      return null;
    }

    try {
      const loaded = await this.loadDynamicModels(target, options);
      if (!loaded) {
        return null;
      }

      const normalized = withDefaultModel(loaded.models, defaultModel);
      const dynamicWarnings = [...(loaded.warnings ?? [])];
      if (normalized.defaultInjected && defaultModel) {
        dynamicWarnings.push(
          `Configured default model '${defaultModel}' was not returned by dynamic discovery; `
          + 'added as configured fallback.',
        );
      }

      this.dynamicCache.set(key, {
        cachedAt: now,
        models: cloneModels(loaded.models),
        warnings: [...dynamicWarnings],
      });
      this.persistedSnapshots.set(key, {
        cachedAt: now,
        models: cloneModels(loaded.models),
        warnings: [...dynamicWarnings],
      });
      this.refreshBackoff.delete(key);
      this.persistState();

      return this.buildCatalog(target, {
        defaultModel,
        source: 'dynamic',
        cache: buildCacheMetadata(this.ttlMs, now, false),
        models: normalized.models,
        warnings: [...warnings, ...dynamicWarnings],
      });
    } catch (error) {
      const errorMessage = `Dynamic model discovery failed for ${target.providerName}/${target.backend}/${target.instanceId}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      const nextBackoff = computeBackoffState(this.refreshBackoff.get(key) ?? null, errorMessage, now);
      this.refreshBackoff.set(key, nextBackoff);
      this.persistState();
      const snapshotFallback = this.getBestAvailableSnapshot(target);
      if (snapshotFallback) {
        return this.buildCatalog(target, {
          defaultModel,
          source: 'dynamic',
          cache: buildCacheMetadata(this.ttlMs, snapshotFallback.snapshot.cachedAt, true, {
            stale: true,
            persisted: snapshotFallback.persisted,
            backoff: nextBackoff,
          }),
          models: withDefaultModel(snapshotFallback.snapshot.models, defaultModel).models,
          warnings: [
            ...warnings,
            ...snapshotFallback.snapshot.warnings,
            `${errorMessage} Serving stale cached catalog from ${new Date(snapshotFallback.snapshot.cachedAt).toISOString()}.`,
            describeBackoffState(target, nextBackoff),
          ],
        });
      }

      warnings.push(errorMessage);
      warnings.push(describeBackoffState(target, nextBackoff));
      return null;
    }
  }

  private getBestAvailableSnapshot(
    target: ProviderTargetDescriptor,
  ): { snapshot: CachedDynamicModels; persisted: boolean } | null {
    const key = this.cacheKey(target);
    const cached = this.dynamicCache.get(key);
    const persisted = this.persistedSnapshots.get(key);
    if (!cached && !persisted) {
      return null;
    }
    if (!cached && persisted) {
      return {
        snapshot: persisted,
        persisted: true,
      };
    }
    if (cached && !persisted) {
      return {
        snapshot: cached,
        persisted: false,
      };
    }

    if ((persisted?.cachedAt ?? 0) > (cached?.cachedAt ?? 0)) {
      return {
        snapshot: persisted as CachedDynamicModels,
        persisted: true,
      };
    }

    return {
      snapshot: cached as CachedDynamicModels,
      persisted: false,
    };
  }

  private appendActiveBackoffWarning(
    target: ProviderTargetDescriptor,
    warnings: string[],
  ): void {
    const backoff = this.getActiveBackoff(target);
    if (backoff) {
      warnings.push(describeBackoffState(target, backoff));
    }
  }

  private getActiveBackoff(
    target: ProviderTargetDescriptor,
  ): RefreshBackoffState | null {
    const key = this.cacheKey(target);
    const state = this.refreshBackoff.get(key);
    if (!state) {
      return null;
    }

    if (state.nextRefreshAllowedAt <= Date.now()) {
      this.refreshBackoff.delete(key);
      this.persistState();
      return null;
    }

    return state;
  }

  private getDynamicDiscoverySkipWarning(
    target: ProviderTargetDescriptor,
  ): string | null {
    if (target.backend !== 'api' || !target.remoteInstance) {
      return null;
    }

    const request = buildRemoteModelDiscoveryRequest(target.remoteInstance, this.env);
    if (!request || request.target !== 'models') {
      return null;
    }

    if (!request.auth.required || request.auth.applied) {
      return null;
    }

    const credentialHint = request.auth.credentialEnv
      ? ` via '${request.auth.credentialEnv}'`
      : '';
    return `Dynamic model discovery skipped for ${target.providerName}/${target.backend}/${target.instanceId}: required ${request.auth.mode} credentials are not configured${credentialHint}.`;
  }

  private async loadDynamicModels(
    target: ProviderTargetDescriptor,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<DynamicCatalogLoadResult | null> {
    if (target.backend === 'api' && target.remoteInstance) {
      return this.listRemoteApiModels(target.remoteInstance);
    }

    if (target.backend === 'cli' && target.providerName === 'pi' && target.cliInstance) {
      return {
        models: (await discoverPiModels(target.cliInstance, {
          cwd: this.config.sessionBaseDir,
          runner: this.options.piModelDiscoveryRunner,
        })).map((model) => ({
          ...model,
          status: 'available' as const,
        })),
      };
    }

    if (target.backend === 'cli' && target.providerName === 'opencode' && target.cliInstance) {
      return {
        models: (await discoverOpencodeModels(target.cliInstance, {
          cwd: this.config.sessionBaseDir,
          refresh: options.forceRefresh,
          runner: this.options.opencodeModelDiscoveryRunner,
        })).map((model) => ({
          ...model,
          status: 'available' as const,
        })),
      };
    }

    if (target.backend === 'cli' && target.providerName === 'kilo' && target.cliInstance) {
      return {
        models: (await discoverKiloModels(target.cliInstance, {
          cwd: this.config.sessionBaseDir,
          refresh: options.forceRefresh,
          runner: this.options.kiloModelDiscoveryRunner,
        })).map((model) => ({
          ...model,
          status: 'available' as const,
        })),
      };
    }

    if (target.backend === 'cli' && target.providerName === 'cursor' && target.cliInstance) {
      return {
        models: (await discoverCursorModels(target.cliInstance, {
          cwd: this.config.sessionBaseDir,
          runner: this.options.cursorModelDiscoveryRunner,
        })).map((model) => ({
          ...model,
          status: 'available' as const,
        })),
      };
    }

    if (target.backend === 'local' && target.remoteInstance?.transport === 'ollama') {
      return this.listOllamaModels(target.remoteInstance);
    }

    if (target.backend === 'agent' && target.remoteInstance && this.options.agentBackend) {
      return {
        models: (await this.options.agentBackend.listModels(target)).map((model) => ({
          ...model,
          status: 'available',
        })),
      };
    }

    return null;
  }

  private async listRemoteApiModels(
    instance: RemoteProviderInstanceConfig,
  ): Promise<DynamicCatalogLoadResult | null> {
    const request = buildRemoteModelDiscoveryRequest(instance, this.env);
    if (!request || request.target !== 'models') {
      return null;
    }

    if (request.auth.required && !request.auth.applied) {
      return null;
    }

    if (instance.transport === 'openai') {
      return this.listOpenAiModels(request);
    }

    if (instance.transport === 'anthropic') {
      return this.listAnthropicModels(request);
    }

    if (instance.transport === 'google' || instance.transport === 'gemini') {
      return this.listGeminiModels(request);
    }

    return null;
  }

  private async fetchRemoteDiscoveryPayload(
    request: RemoteModelDiscoveryHttpRequest,
  ): Promise<Record<string, unknown>> {
    try {
      const { response } = await fetchRemoteModelDiscovery(request, {
        fetch: this.fetchImpl,
        timeoutMs: this.remoteDiscoveryTimeoutMs,
      });
      if (!response.ok) {
        throw new Error(`Remote model list failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (!payload || typeof payload !== 'object') {
        throw new Error('Remote model list returned a non-object JSON payload');
      }

      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof RemoteModelDiscoveryTimeoutError) {
        throw new Error(`Timed out while listing models from '${request.displayUrl}'`);
      }
      if (error instanceof RemoteModelDiscoveryAbortError) {
        throw new Error(`Aborted while listing models from '${request.displayUrl}'`);
      }
      throw error;
    }
  }

  private async listOpenAiModels(
    request: RemoteModelDiscoveryRequest,
  ): Promise<DynamicCatalogLoadResult> {
    const payload = await this.fetchRemoteDiscoveryPayload(request);
    const discovered = dedupeModels(
      (Array.isArray(payload.data) ? payload.data : []).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const id = readNullableString((entry as Record<string, unknown>).id);
        if (!id) {
          return [];
        }
        return [{
          id,
          label: id,
          status: 'available' as const,
        }];
      }),
    );

    return {
      models: filterPreferredModels(discovered, isLikelyOpenAiCatalogModel),
    };
  }

  private async listAnthropicModels(
    request: RemoteModelDiscoveryRequest,
  ): Promise<DynamicCatalogLoadResult> {
    const payload = await this.fetchRemoteDiscoveryPayload(request);
    const discovered = dedupeModels(
      (Array.isArray(payload.data) ? payload.data : []).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const record = entry as Record<string, unknown>;
        const id = readNullableString(record.id);
        if (!id) {
          return [];
        }
        return [{
          id,
          label: readNullableString(record.display_name) || id,
          status: 'available' as const,
        }];
      }),
    );

    return {
      models: filterPreferredModels(discovered, isLikelyAnthropicCatalogModel),
    };
  }

  private async listGeminiModels(
    request: RemoteModelDiscoveryRequest,
  ): Promise<DynamicCatalogLoadResult> {
    const warnings: string[] = [];
    const discovered: ProviderModelCatalogEntry[] = [];
    let nextPageToken: string | null = null;

    for (let pageIndex = 0; pageIndex < MAX_GEMINI_MODEL_LIST_PAGES; pageIndex += 1) {
      const pageUrl = new URL(request.url);
      if (nextPageToken) {
        pageUrl.searchParams.set('pageToken', nextPageToken);
      }
      const pageRequest = pageUrl.toString() === request.url
        ? request
        : {
            ...request,
            url: pageUrl.toString(),
            displayUrl: sanitizeRemoteModelDiscoveryUrl(pageUrl.toString()),
          };
      const payload = await this.fetchRemoteDiscoveryPayload(pageRequest);
      const models = Array.isArray(payload.models) ? payload.models : [];
      for (const entry of models) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const record = entry as Record<string, unknown>;
        if (!supportsGeminiGeneration(record)) {
          continue;
        }
        const name = readNullableString(record.name);
        if (!name) {
          continue;
        }
        const id = normalizeGeminiModelId(name);
        discovered.push({
          id,
          label: readNullableString(record.displayName) || id,
          status: 'available',
        });
      }

      nextPageToken = readNullableString(payload.nextPageToken);
      if (!nextPageToken) {
        break;
      }

      if (pageIndex === MAX_GEMINI_MODEL_LIST_PAGES - 1) {
        warnings.push(
          `Gemini model discovery stopped after ${MAX_GEMINI_MODEL_LIST_PAGES} page(s); additional pages remain.`,
        );
      }
    }

    return {
      models: filterPreferredModels(dedupeModels(discovered), isLikelyGeminiCatalogModel),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  private async listOllamaModels(
    instance: RemoteProviderInstanceConfig,
  ): Promise<DynamicCatalogLoadResult> {
    const baseUrl = resolveBaseUrl(instance, this.env, 'http://127.0.0.1:11434').replace(/\/$/, '');
    const warnings: string[] = [];
    const tagsRequest = buildRemoteModelDiscoveryRequest(instance, this.env) || {
      url: `${baseUrl}/api/tags`,
      displayUrl: sanitizeRemoteModelDiscoveryUrl(`${baseUrl}/api/tags`),
      method: 'GET' as const,
      headers: {},
    };
    const payload = await this.fetchRemoteDiscoveryPayload(tagsRequest) as {
      models?: Array<{ name?: unknown; model?: unknown }>;
    };
    const entries = Array.isArray(payload.models) ? payload.models : [];
    const installedModels = entries
      .map((entry) => readNullableString(entry.name) ?? readNullableString(entry.model))
      .filter((name): name is string => Boolean(name));

    const runningModels = new Set<string>();
    try {
      const runningRequest: RemoteModelDiscoveryHttpRequest = {
        url: `${baseUrl}/api/ps`,
        displayUrl: sanitizeRemoteModelDiscoveryUrl(`${baseUrl}/api/ps`),
        method: 'GET',
        headers: {},
      };
      const runningPayload = await this.fetchRemoteDiscoveryPayload(runningRequest) as {
        models?: Array<{ name?: unknown; model?: unknown }>;
      };
      if (runningPayload) {
        const runningEntries = Array.isArray(runningPayload.models) ? runningPayload.models : [];
        for (const entry of runningEntries) {
          const name = readNullableString(entry.name) ?? readNullableString(entry.model);
          if (name) {
            runningModels.add(name);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusMatch = message.match(/^Remote model list failed with status (\d+)$/);
      warnings.push(
        statusMatch
          ? `Ollama running-model probe failed with status ${statusMatch[1]}`
          : `Ollama running-model probe failed: ${message}`,
      );
    }

    for (const name of runningModels) {
      if (!installedModels.includes(name)) {
        installedModels.push(name);
      }
    }

    return {
      models: installedModels.map((name) => ({
        id: name,
        label: name,
        status: runningModels.has(name) ? 'running' : 'available',
      })),
      warnings,
    };
  }

  private tryConfigCatalog(
    target: ProviderTargetDescriptor,
    defaultModel: string | null,
    warnings: string[],
  ): ProviderModelCatalogResult | null {
    if (!target.remoteInstance?.model) {
      return null;
    }

    return this.buildCatalog(target, {
      defaultModel,
      source: 'config',
      cache: null,
      models: withDefaultModel([
        {
          id: target.remoteInstance.model,
          label: target.remoteInstance.model,
          default: true,
          status: 'configured',
        },
      ], defaultModel).models,
      warnings,
    });
  }

  private buildStaticCatalog(
    target: ProviderTargetDescriptor,
    defaultModel: string | null,
    warnings: string[],
  ): ProviderModelCatalogResult {
    return this.buildCatalog(target, {
      defaultModel,
      source: 'static',
      cache: null,
      models: withDefaultModel(getStaticProviderModels(target), defaultModel).models,
      warnings,
    });
  }

  private loadPersistedState(): void {
    if (!this.storageFile || !existsSync(this.storageFile)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.storageFile, 'utf8')) as PersistedProviderModelCatalogState;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
        return;
      }

      if (Array.isArray(parsed.snapshots)) {
        for (const snapshot of parsed.snapshots) {
          if (!snapshot || typeof snapshot !== 'object') {
            continue;
          }
          const cachedAtMs = Date.parse(snapshot.cachedAt);
          if (
            typeof snapshot.key !== 'string'
            || (snapshot.source !== undefined && snapshot.source !== 'dynamic')
            || Number.isNaN(cachedAtMs)
            || !Array.isArray(snapshot.models)
            || snapshot.models.some((entry) => !isProviderModelCatalogEntry(entry))
          ) {
            continue;
          }
          this.persistedSnapshots.set(snapshot.key, {
            cachedAt: cachedAtMs,
            models: cloneModels(snapshot.models),
            warnings: Array.isArray(snapshot.warnings)
              ? snapshot.warnings.filter((warning): warning is string => typeof warning === 'string')
              : [],
          });
        }
      }

      if (Array.isArray(parsed.backoff)) {
        for (const record of parsed.backoff) {
          if (!record || typeof record !== 'object') {
            continue;
          }
          const lastFailureAt = Date.parse(record.lastFailureAt);
          const nextRefreshAllowedAt = Date.parse(record.nextRefreshAllowedAt);
          if (
            typeof record.key !== 'string'
            || typeof record.reason !== 'string'
            || typeof record.consecutiveFailures !== 'number'
            || !Number.isFinite(record.consecutiveFailures)
            || Number.isNaN(lastFailureAt)
            || Number.isNaN(nextRefreshAllowedAt)
          ) {
            continue;
          }
          this.refreshBackoff.set(record.key, {
            consecutiveFailures: Math.max(1, Math.trunc(record.consecutiveFailures)),
            lastFailureAt,
            nextRefreshAllowedAt,
            reason: record.reason,
          });
        }
      }
    } catch {
      // Ignore corrupt persisted state; the runtime can rebuild snapshots from live refreshes.
    }
  }

  private persistState(): void {
    if (!this.storageFile) {
      return;
    }

    const payload: PersistedProviderModelCatalogState = {
      version: 1,
      snapshots: Array.from(this.persistedSnapshots.entries()).map(([key, snapshot]) => {
        const [provider, backend, instance] = key.split(':');
        return {
          key,
          provider: provider || 'unknown',
          backend: (backend || 'cli') as BackendKind,
          instance: instance || 'default',
          source: 'dynamic',
          cachedAt: new Date(snapshot.cachedAt).toISOString(),
          models: cloneModels(snapshot.models),
          warnings: [...snapshot.warnings],
        };
      }),
      backoff: Array.from(this.refreshBackoff.entries()).map(([key, state]) => {
        const [provider, backend, instance] = key.split(':');
        return {
          key,
          provider: provider || 'unknown',
          backend: (backend || 'cli') as BackendKind,
          instance: instance || 'default',
          consecutiveFailures: state.consecutiveFailures,
          lastFailureAt: new Date(state.lastFailureAt).toISOString(),
          nextRefreshAllowedAt: new Date(state.nextRefreshAllowedAt).toISOString(),
          reason: state.reason,
        };
      }),
    };

    mkdirSync(dirname(this.storageFile), { recursive: true });
    const nextContent = `${JSON.stringify(payload, null, 2)}\n`;
    const tempFile = `${this.storageFile}.tmp`;
    writeFileSync(tempFile, nextContent, 'utf8');
    renameSync(tempFile, this.storageFile);
  }

  private buildCatalog(
    target: ProviderTargetDescriptor,
    input: {
      defaultModel: string | null;
      source: 'dynamic' | 'config' | 'static';
      cache: ProviderModelCatalogCacheMetadata | null;
      models: ProviderModelCatalogEntry[];
      warnings: string[];
    },
  ): ProviderModelCatalogResult {
    const effectiveDefaultModel = input.defaultModel
      ?? input.models.find((entry) => entry.default)?.id
      ?? null;
    return {
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
      defaultModel: effectiveDefaultModel,
      source: input.source,
      cache: input.cache,
      models: input.models,
      warnings: [...input.warnings],
    };
  }
}
