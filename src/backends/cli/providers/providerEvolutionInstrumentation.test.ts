import { describe, expect, it, vi } from 'vitest';
import { ProviderEvolutionEvidenceCollector } from '../../../core/compatibility/providerEvolution.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { CopilotProvider } from './copilot.js';
import { GeminiProvider } from './gemini.js';
import { GooseProvider } from './goose.js';
import { PiProvider } from './pi.js';
import type { GooseNativeSessionService } from '../goose/GooseNativeSessionService.js';

function createMockGooseNative(): GooseNativeSessionService {
  return {
    listAllSessions: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    getLatestSession: vi.fn(async () => null),
    canResumeSession: vi.fn(async () => true),
    loadHistory: vi.fn(async () => []),
    deleteSession: vi.fn(async () => false),
  } as unknown as GooseNativeSessionService;
}

describe('provider evolution instrumentation', () => {
  it('records normalized and raw passthrough paths for Claude', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'claude',
      instance: 'default',
      parserId: 'claude-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new ClaudeProvider(undefined, collector);

    provider.parseStreamLine('Starting Claude...');
    provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
      },
    }));

    const bundle = collector.finalize();
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.text).toBe(1);
  });

  it('records ignored bootstrap responses for Codex', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'codex',
      instance: 'default',
      parserId: 'codex-json-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CodexProvider(undefined, collector);

    provider.buildSpawnArgs({ cwd: '/tmp/test' });
    provider.buildStdinMessage('Hello');
    provider.parseStreamLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      result: { capabilities: {}, serverInfo: { name: 'codex' } },
    }));

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredCount).toBe(1);
    expect(bundle.summary.ignoredEventTypes.initialize).toBe(1);
  });

  it('records schema failures for Copilot event shapes that are missing required fields', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'copilot',
      instance: 'default',
      parserId: 'copilot-json-stream',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CopilotProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'session.start',
      data: {},
    }))).toBeNull();

    const bundle = collector.finalize();
    expect(bundle.summary.schemaFailureCount).toBe(1);
    expect(bundle.summary.schemaFailureCounts['session.start']).toBe(1);
  });

  it('records ignored user echoes and unknown Gemini event types', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'gemini',
      instance: 'default',
      parserId: 'gemini-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new GeminiProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'message',
      role: 'user',
      content: 'hello',
    }))).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'future.event',
      payload: { ok: true },
    }))).toEqual({
      type: 'raw',
      text: JSON.stringify({
        type: 'future.event',
        payload: { ok: true },
      }),
    });

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredEventTypes['message:user']).toBe(1);
    expect(bundle.summary.unknownEventTypes['future.event']).toBe(1);
  });

  it('records schema failures for Goose message events without content blocks', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'goose',
      instance: 'default',
      parserId: 'goose-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new GooseProvider(createMockGooseNative(), collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: [] },
    }))).toBeNull();

    const bundle = collector.finalize();
    expect(bundle.summary.schemaFailureCounts.message).toBe(1);
  });

  it('records ignored and unknown Pi event paths', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'pi',
      instance: 'default',
      parserId: 'pi-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new PiProvider({ evolutionObserver: collector });

    expect(provider.parseStreamLine(JSON.stringify({ type: 'response' }))).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'some_future_event',
      data: 'test',
    }))?.type).toBe('raw');

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredEventTypes.response).toBe(1);
    expect(bundle.summary.unknownEventTypes.some_future_event).toBe(1);
  });
});
