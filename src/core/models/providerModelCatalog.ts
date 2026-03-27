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

interface DynamicCatalogLoadResult {
  models: ProviderModelCatalogEntry[];
  warnings?: string[];
}

const DEFAULT_TTL_MS = 60_000;
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
    { id: 'claude-opus-4-6', label: 'opus 4.6', default: true },
    { id: 'claude-sonnet-4-6', label: 'sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'haiku 4.5' },
  ],
  codex: [
    { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
  ],
  gemini: [
    { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview', default: true },
    { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
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
  ],
  cursor: [
    { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
    { id: 'claude-opus-4-6', label: 'claude-opus-4-6' },
    { id: 'gemini-3.1-pro', label: 'gemini-3.1-pro' },
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

function resolveDefaultModel(
  target: ProviderTargetDescriptor,
  env: NodeJS.ProcessEnv,
): string | null {
  const configuredModel = target.remoteInstance?.model?.trim();
  if (configuredModel) {
    return configuredModel;
  }

  const activeConfig = inspectProviderActiveConfig(target, { env });
  const activeModel = activeConfig?.state === 'detected'
    ? activeConfig.model?.trim() || null
    : null;
  if (activeModel) {
    return activeModel;
  }

  const staticModels = getStaticProviderModels(target);
  return staticModels.find((model) => model.default)?.id ?? null;
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
  stale = false,
): ProviderModelCatalogCacheMetadata {
  return {
    servedFromCache,
    cachedAt: new Date(cachedAtMs).toISOString(),
    ttlSec: Math.floor(ttlMs / 1000),
    ...(stale ? { stale: true } : {}),
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
      `Dynamic model discovery is not available for ${target.providerName}/${target.backend}/${target.instanceId} `
      + 'because Cursor does not currently expose a stable model-listing seam to the runtime.',
    );
  }
}

export function summarizeProviderModelCatalog(
  catalog: ProviderModelCatalogResult,
): ProviderModelCatalogSummary {
  return {
    source: catalog.source,
    defaultModel: catalog.defaultModel,
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

export class ProviderModelCatalogService {
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly ttlMs: number;
  private readonly remoteDiscoveryTimeoutMs: number;
  private readonly dynamicCache = new Map<string, CachedDynamicModels>();

  constructor(
    private readonly config: CliRuntimeConfig,
    private readonly options: ProviderModelCatalogServiceOptions = {},
  ) {
    this.fetchImpl = options.fetch || defaultFetch();
    this.env = options.env || process.env;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.remoteDiscoveryTimeoutMs = options.remoteDiscoveryTimeoutMs
      ?? DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS;
  }

  async getCatalog(
    providerName: string,
    requestedInstance?: string,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderModelCatalogResult> {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.getCatalogForTarget(target, options);
  }

  async getAdvancedKnowledge(
    providerName: string,
    requestedInstance?: string,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderAdvancedKnowledgeContext> {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    return this.getAdvancedKnowledgeForTarget(target, options);
  }

  async getAdvancedKnowledgeForTarget(
    target: ProviderTargetDescriptor,
    options: ProviderModelCatalogRequestOptions = {},
  ): Promise<ProviderAdvancedKnowledgeContext> {
    const catalog = await this.getCatalogForTarget(target, options);
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
    const defaultModel = resolveDefaultModel(target, this.env);
    const warnings: string[] = [];
    const cachedDynamic = this.getCachedDynamicCatalog(target, defaultModel, warnings);
    if (cachedDynamic) {
      return summarizeProviderModelCatalog(cachedDynamic);
    }

    const discoverySkipWarning = this.getDynamicDiscoverySkipWarning(target);
    if (discoverySkipWarning) {
      warnings.push(discoverySkipWarning);
    }

    appendKnownStaticCatalogWarnings(target, warnings);
    const configCatalog = this.tryConfigCatalog(target, defaultModel, warnings);
    if (configCatalog) {
      return summarizeProviderModelCatalog(configCatalog);
    }

    return summarizeProviderModelCatalog(this.buildStaticCatalog(target, defaultModel, warnings));
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
    return this.buildCatalog(target, {
      defaultModel,
      source: 'dynamic',
      cache: buildCacheMetadata(this.ttlMs, cached.cachedAt, true, stale),
      models: withDefaultModel(cached.models, defaultModel).models,
      warnings: [...warnings, ...cached.warnings],
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
    const now = Date.now();
    if (!options.forceRefresh && cached && now - cached.cachedAt < this.ttlMs) {
      return this.buildCatalog(target, {
        defaultModel,
        source: 'dynamic',
        cache: buildCacheMetadata(this.ttlMs, cached.cachedAt, true),
        models: withDefaultModel(cached.models, defaultModel).models,
        warnings: [...warnings, ...cached.warnings],
      });
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
      if (cached) {
        return this.buildCatalog(target, {
          defaultModel,
          source: 'dynamic',
          cache: buildCacheMetadata(this.ttlMs, cached.cachedAt, true, true),
          models: withDefaultModel(cached.models, defaultModel).models,
          warnings: [
            ...warnings,
            ...cached.warnings,
            `${errorMessage} Serving stale cached catalog from ${new Date(cached.cachedAt).toISOString()}.`,
          ],
        });
      }

      warnings.push(errorMessage);
      return null;
    }
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
    return {
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
      defaultModel: input.defaultModel,
      source: input.source,
      cache: input.cache,
      models: input.models,
      warnings: [...input.warnings],
    };
  }
}
