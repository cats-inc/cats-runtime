import { describe, expect, it } from 'vitest';
import { inspectApiTarget } from './inspection.js';
import type { ProviderTargetDescriptor } from '../../core/providerCatalog.js';

function createTarget(
  transport: 'anthropic' | 'openai' | 'google' | 'ollama',
  payloadTemplate?: Record<string, unknown>,
): ProviderTargetDescriptor {
  return {
    providerName: transport === 'google' ? 'gemini' : transport === 'ollama' ? 'ollama' : transport === 'openai' ? 'codex' : 'claude',
    backend: transport === 'ollama' ? 'local' : 'api',
    instanceId: 'default',
    defaultTarget: true,
    remoteInstance: {
      id: 'default',
      providerName: transport === 'google' ? 'gemini' : transport === 'ollama' ? 'ollama' : transport === 'openai' ? 'codex' : 'claude',
      transport,
      model: 'model-1',
      ...(payloadTemplate ? { payloadTemplate } : {}),
    },
  };
}

describe('inspectApiTarget', () => {
  it('describes OpenAI continuation reuse explicitly', () => {
    const inspection = inspectApiTarget(createTarget('openai'));
    expect(inspection).toEqual(expect.objectContaining({
      transport: 'openai',
      continuation: expect.objectContaining({
        strategy: 'previous_response_id',
      }),
      caching: expect.objectContaining({
        strategy: 'none',
        active: false,
      }),
      providerNativeTools: expect.objectContaining({
        state: 'deferred',
      }),
    }));
  });

  it('surfaces configured OpenAI and Gemini provider-native tools from payload templates', () => {
    const openai = inspectApiTarget(createTarget('openai', {
      tools: [
        { type: 'web_search_preview' },
        { type: 'function', name: 'ignored_runtime_local_tool' },
      ],
    }));
    expect(openai).toEqual(expect.objectContaining({
      transport: 'openai',
      providerNativeTools: expect.objectContaining({
        state: 'provider_native_configured',
        configuredTools: ['web_search_preview'],
      }),
    }));

    const gemini = inspectApiTarget(createTarget('google', {
      tools: [
        { googleSearch: {} },
        { urlContext: {} },
      ],
    }));
    expect(gemini).toEqual(expect.objectContaining({
      transport: 'google',
      providerNativeTools: expect.objectContaining({
        state: 'provider_native_configured',
        configuredTools: ['googleSearch', 'urlContext'],
      }),
    }));
  });

  it('describes Gemini cache TTL and Ollama keep_alive hints', () => {
    const gemini = inspectApiTarget(createTarget('google', {
      context_cache_ttl: '1800s',
    }));
    expect(gemini).toEqual(expect.objectContaining({
      transport: 'google',
      caching: expect.objectContaining({
        strategy: 'cached_content',
        active: true,
        ttl: '1800s',
      }),
    }));

    const ollama = inspectApiTarget(createTarget('ollama', {
      keep_alive: '30m',
    }));
    expect(ollama).toEqual(expect.objectContaining({
      transport: 'ollama',
      caching: expect.objectContaining({
        strategy: 'keep_alive',
        active: true,
        keepAlive: '30m',
      }),
      localModelLifecycle: expect.objectContaining({
        source: 'runtime_model_catalog',
        installedModels: 'dynamic',
        runningModels: 'dynamic',
        management: 'deferred',
      }),
      providerNativeTools: expect.objectContaining({
        state: 'runtime_local_only',
      }),
    }));
  });
});
