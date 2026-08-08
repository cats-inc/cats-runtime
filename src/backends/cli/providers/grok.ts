import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';
import type { RawStreamEvent, ResultStreamEvent, TextStreamEvent } from '../../../core/types.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';

interface GrokNativeUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  total_tokens?: unknown;
}

interface GrokNativeStreamEvent {
  type?: unknown;
  data?: unknown;
  sessionId?: unknown;
  stopReason?: unknown;
  total_cost_usd?: unknown;
  usage?: GrokNativeUsage;
}

export class GrokProvider implements Provider {
  name = 'grok';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: false };

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Grok CLI execution is not enabled yet. Authenticated success-stream fixtures are '
      + 'verified, but tool, error, cancellation, and resume lifecycle contracts still need '
      + 'live probes before Grok sessions can be started safely.',
    );
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | null {
    const text = line.trim();
    if (!text) return null;

    let event: GrokNativeStreamEvent;
    try {
      event = JSON.parse(text) as GrokNativeStreamEvent;
    } catch {
      return { type: 'raw', text } satisfies RawStreamEvent;
    }

    if (event.type === 'available_commands' || event.type === 'usage') {
      return null;
    }

    if (event.type === 'thought' && typeof event.data === 'string' && event.data) {
      return createRuntimeProgressEvent({
        text: event.data,
        provider: 'grok',
        backend: 'cli',
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        native: { sourceEvent: 'thought' },
      });
    }

    if (event.type === 'text' && typeof event.data === 'string' && event.data) {
      return {
        type: 'text',
        text: event.data,
        raw: event,
      } satisfies TextStreamEvent;
    }

    if (event.type === 'end') {
      return {
        type: 'result',
        ...(typeof event.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
        ...(event.usage ? { usage: normalizeGrokUsage(event.usage, event.total_cost_usd) } : {}),
        raw: event,
      } satisfies ResultStreamEvent;
    }

    return {
      type: 'raw',
      raw: event,
    } satisfies RawStreamEvent;
  }
}

function normalizeGrokUsage(usage: GrokNativeUsage, totalCostUsd: unknown) {
  const promptInputTokens = finiteNumber(usage.input_tokens);
  const cacheReadInputTokens = finiteNumber(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = finiteNumber(usage.cache_creation_input_tokens);
  const outputTokens = finiteNumber(usage.output_tokens);
  const computedTotal = promptInputTokens
    + cacheReadInputTokens
    + cacheCreationInputTokens
    + outputTokens;

  return {
    inputTokens: promptInputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    outputTokens,
    promptInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens: numberOrUndefined(usage.total_tokens) ?? computedTotal,
    ...(typeof totalCostUsd === 'number' && Number.isFinite(totalCostUsd)
      ? { estimatedCost: totalCostUsd, currency: 'USD' }
      : {}),
  };
}

function finiteNumber(value: unknown): number {
  return numberOrUndefined(value) ?? 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
