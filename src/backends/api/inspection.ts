import type { ProviderTargetDescriptor } from '../../core/providerCatalog.js';
import { readPayloadTemplateString } from './payloadTemplate.js';

const DEFAULT_GEMINI_CACHE_TTL = '3600s';

type ApiRuntimeContinuationStrategy =
  | 'runtime_transcript'
  | 'previous_response_id';

type ApiRuntimeCachingStrategy =
  | 'none'
  | 'prompt_cache'
  | 'cached_content'
  | 'keep_alive';

export interface ApiRuntimeInspection {
  family: 'api_runtime';
  transport: string;
  continuation: {
    strategy: ApiRuntimeContinuationStrategy;
    summary: string;
  };
  caching: {
    strategy: ApiRuntimeCachingStrategy;
    active: boolean;
    summary: string;
    ttl?: string;
    keepAlive?: string;
  };
  providerNativeTools: {
    state: 'runtime_local_only' | 'provider_native_configured' | 'deferred';
    summary: string;
    configuredTools?: string[];
  };
  localModelLifecycle?: {
    source: 'runtime_model_catalog';
    installedModels: 'dynamic';
    runningModels: 'dynamic';
    management: 'deferred';
    summary: string;
  };
}

function readConfiguredProviderNativeTools(
  transport: string,
  payloadTemplate: Record<string, unknown> | undefined,
): string[] {
  if (!payloadTemplate) {
    return [];
  }

  const configured = new Set<string>();
  const rawTools = Array.isArray(payloadTemplate.tools) ? payloadTemplate.tools : [];
  for (const tool of rawTools) {
    if (!tool || typeof tool !== 'object') {
      continue;
    }

    const entry = tool as Record<string, unknown>;
    if (transport === 'openai') {
      const type = typeof entry.type === 'string' ? entry.type.trim() : '';
      if (type && type !== 'function') {
        configured.add(type);
      }
      continue;
    }

    if (transport === 'google' || transport === 'gemini') {
      for (const key of ['googleSearch', 'urlContext', 'codeExecution']) {
        if (entry[key] && typeof entry[key] === 'object') {
          configured.add(key);
        }
      }
    }
  }

  return Array.from(configured);
}

export function inspectApiTarget(
  target: ProviderTargetDescriptor,
): ApiRuntimeInspection | undefined {
  if ((target.backend !== 'api' && target.backend !== 'local') || !target.remoteInstance) {
    return undefined;
  }

  const transport = target.remoteInstance.transport || 'unknown';
  const configuredProviderNativeTools = readConfiguredProviderNativeTools(
    transport,
    target.remoteInstance.payloadTemplate,
  );
  if (transport === 'anthropic') {
    return {
      family: 'api_runtime',
      transport,
      continuation: {
        strategy: 'runtime_transcript',
        summary: 'cats-runtime replays the canonical transcript and applies Anthropic prompt-cache breakpoints automatically.',
      },
      caching: {
        strategy: 'prompt_cache',
        active: true,
        summary: 'Anthropic prompt caching is runtime-managed for reusable prompt prefixes.',
      },
      providerNativeTools: {
        state: 'deferred',
        summary: 'Runtime-local tools remain primary; Anthropic server-tool follow-through is still deferred.',
      },
    };
  }

  if (transport === 'openai') {
    const providerNativeTools = configuredProviderNativeTools.length > 0
      ? {
          state: 'provider_native_configured' as const,
          configuredTools: configuredProviderNativeTools,
          summary: `Runtime-local tools remain primary, and OpenAI provider-native tools are preconfigured via payload template (${configuredProviderNativeTools.join(', ')}).`,
        }
      : {
          state: 'deferred' as const,
          summary: 'Runtime-local tools remain primary; OpenAI built-in tool follow-through is still deferred.',
        };
    return {
      family: 'api_runtime',
      transport,
      continuation: {
        strategy: 'previous_response_id',
        summary: 'cats-runtime reuses previous_response_id when available and falls back to full transcript replay if OpenAI rejects it.',
      },
      caching: {
        strategy: 'none',
        active: false,
        summary: 'No separate cache layer is configured beyond provider-managed response continuation reuse.',
      },
      providerNativeTools,
    };
  }

  if (transport === 'google' || transport === 'gemini') {
    const ttl = readPayloadTemplateString(
      target.remoteInstance.payloadTemplate,
      'cachedContentTtl',
      'cached_content_ttl',
      'contextCacheTtl',
      'context_cache_ttl',
    ) || DEFAULT_GEMINI_CACHE_TTL;
    const providerNativeTools = configuredProviderNativeTools.length > 0
      ? {
          state: 'provider_native_configured' as const,
          configuredTools: configuredProviderNativeTools,
          summary: `Runtime-local tools remain primary, and Gemini provider-native tools are preconfigured via payload template (${configuredProviderNativeTools.join(', ')}).`,
        }
      : {
          state: 'deferred' as const,
          summary: 'Runtime-local tools remain primary; selective Google Search and URL-context follow-through are still deferred.',
        };
    return {
      family: 'api_runtime',
      transport,
      continuation: {
        strategy: 'runtime_transcript',
        summary: 'cats-runtime replays the canonical transcript and reuses provider-managed cached-content state when Gemini accepts it.',
      },
      caching: {
        strategy: 'cached_content',
        active: true,
        ttl,
        summary: 'Gemini cached-content context reuse is runtime-managed for reusable prompt prefixes.',
      },
      providerNativeTools,
    };
  }

  if (transport === 'ollama') {
    const keepAlive = readPayloadTemplateString(
      target.remoteInstance.payloadTemplate,
      'keep_alive',
      'keepAlive',
    );
    return {
      family: 'api_runtime',
      transport,
      continuation: {
        strategy: 'runtime_transcript',
        summary: 'cats-runtime replays the canonical transcript against Ollama native /api/chat turns.',
      },
      caching: {
        strategy: 'keep_alive',
        active: Boolean(keepAlive),
        ...(keepAlive ? { keepAlive } : {}),
        summary: keepAlive
          ? 'An Ollama keep_alive hint is configured so the local model can stay warm between turns.'
          : 'No Ollama keep_alive hint is configured, so warm-state reuse depends on the server default.',
      },
      providerNativeTools: {
        state: 'runtime_local_only',
        summary: 'Runtime-local tools remain primary; Ollama does not add a separate hosted-tool contract here.',
      },
      localModelLifecycle: {
        source: 'runtime_model_catalog',
        installedModels: 'dynamic',
        runningModels: 'dynamic',
        management: 'deferred',
        summary: 'cats-runtime can inspect installed and running Ollama models through the runtime-owned catalog, while pull/manage operations remain deferred.',
      },
    };
  }

  return {
    family: 'api_runtime',
    transport,
    continuation: {
      strategy: 'runtime_transcript',
      summary: 'cats-runtime replays the canonical transcript for this remote transport.',
    },
    caching: {
      strategy: 'none',
      active: false,
      summary: 'No provider-specific cache optimization is currently modeled for this transport.',
    },
    providerNativeTools: {
      state: 'runtime_local_only',
      summary: 'Runtime-local tools remain primary for this transport.',
    },
  };
}
