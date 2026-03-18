import type {
  BackendKind,
  CliRuntimeConfig,
  RemoteProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type { AgentBackendManager } from '../../backends/agent/runtime/AgentBackendManager.js';
import {
  resolveProviderTarget,
  type ProviderTargetDescriptor,
} from '../providerCatalog.js';

export interface ProviderModelCatalogEntry {
  id: string;
  label: string;
  default?: boolean;
}

export interface ProviderModelCatalogCacheMetadata {
  servedFromCache: boolean;
  cachedAt: string | null;
  ttlSec: number | null;
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

interface ProviderModelCatalogServiceOptions {
  agentBackend?: AgentBackendManager;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  ttlMs?: number;
}

interface CachedDynamicModels {
  cachedAt: number;
  models: ProviderModelCatalogEntry[];
}

const DEFAULT_TTL_MS = 60_000;

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

function resolveDefaultModel(target: ProviderTargetDescriptor): string | null {
  const configuredModel = target.remoteInstance?.model?.trim();
  if (configuredModel) {
    return configuredModel;
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

function withDefaultModel(
  models: ProviderModelCatalogEntry[],
  defaultModel: string | null,
): ProviderModelCatalogEntry[] {
  if (!defaultModel) {
    return cloneModels(models);
  }

  const cloned = cloneModels(models);
  const existing = cloned.find((model) => model.id === defaultModel);
  if (existing) {
    for (const model of cloned) {
      model.default = model.id === defaultModel;
    }
    return cloned;
  }

  return [{ id: defaultModel, label: defaultModel, default: true }, ...cloned];
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
  private readonly dynamicCache = new Map<string, CachedDynamicModels>();

  constructor(
    private readonly config: CliRuntimeConfig,
    private readonly options: ProviderModelCatalogServiceOptions = {},
  ) {
    this.fetchImpl = options.fetch || defaultFetch();
    this.env = options.env || process.env;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  async getCatalog(
    providerName: string,
    requestedInstance?: string,
  ): Promise<ProviderModelCatalogResult> {
    const target = resolveProviderTarget(this.config, providerName, requestedInstance);
    const defaultModel = resolveDefaultModel(target);
    const warnings: string[] = [];
    const dynamic = await this.tryDynamicCatalog(target, defaultModel, warnings);
    if (dynamic) {
      return dynamic;
    }

    const configCatalog = this.tryConfigCatalog(target, defaultModel, warnings);
    if (configCatalog) {
      return configCatalog;
    }

    return this.buildStaticCatalog(target, defaultModel, warnings);
  }

  private cacheKey(target: ProviderTargetDescriptor): string {
    return `${target.providerName}:${target.backend}:${target.instanceId}`;
  }

  private async tryDynamicCatalog(
    target: ProviderTargetDescriptor,
    defaultModel: string | null,
    warnings: string[],
  ): Promise<ProviderModelCatalogResult | null> {
    const key = this.cacheKey(target);
    const cached = this.dynamicCache.get(key);
    const now = Date.now();
    if (cached && now - cached.cachedAt < this.ttlMs) {
      return this.buildCatalog(target, {
        defaultModel,
        source: 'dynamic',
        cache: {
          servedFromCache: true,
          cachedAt: new Date(cached.cachedAt).toISOString(),
          ttlSec: Math.floor(this.ttlMs / 1000),
        },
        models: withDefaultModel(cached.models, defaultModel),
        warnings,
      });
    }

    try {
      const models = await this.loadDynamicModels(target);
      if (!models) {
        return null;
      }

      this.dynamicCache.set(key, {
        cachedAt: now,
        models: cloneModels(models),
      });

      return this.buildCatalog(target, {
        defaultModel,
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: new Date(now).toISOString(),
          ttlSec: Math.floor(this.ttlMs / 1000),
        },
        models: withDefaultModel(models, defaultModel),
        warnings,
      });
    } catch (error) {
      warnings.push(
        `Dynamic model discovery failed for ${target.providerName}/${target.backend}/${target.instanceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async loadDynamicModels(
    target: ProviderTargetDescriptor,
  ): Promise<ProviderModelCatalogEntry[] | null> {
    if (target.backend === 'local' && target.remoteInstance?.transport === 'ollama') {
      return this.listOllamaModels(target.remoteInstance);
    }

    if (target.backend === 'agent' && target.remoteInstance && this.options.agentBackend) {
      return this.options.agentBackend.listModels(target);
    }

    return null;
  }

  private async listOllamaModels(
    instance: RemoteProviderInstanceConfig,
  ): Promise<ProviderModelCatalogEntry[]> {
    const baseUrl = resolveBaseUrl(instance, this.env, 'http://127.0.0.1:11434').replace(/\/$/, '');
    const response = await this.fetchImpl(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama model list failed with status ${response.status}`);
    }

    const payload = await response.json() as { models?: Array<{ name?: unknown; model?: unknown }> };
    const entries = Array.isArray(payload.models) ? payload.models : [];

    return entries
      .map((entry) => readNullableString(entry.name) ?? readNullableString(entry.model))
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ id: name, label: name }));
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
        },
      ], defaultModel),
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
      models: withDefaultModel(getStaticProviderModels(target), defaultModel),
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
