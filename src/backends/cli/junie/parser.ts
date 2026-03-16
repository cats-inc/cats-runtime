import type { StreamEvent } from '../../../core/types.js';

/**
 * Junie outputs a single JSON blob after task completion (not streaming JSONL).
 * Format:
 *   {
 *     "sessionId": "session-260317-...",
 *     "taskName": "...",
 *     "result": "markdown summary",
 *     "changes": [...],
 *     "llmUsage": [{ "model": "...", "inputTokens": N, "outputTokens": N, "cost": N, ... }]
 *   }
 */
export interface JunieResult {
  sessionId?: string;
  taskName?: string;
  result?: string;
  changes?: unknown[];
  llmUsage?: Array<{
    model?: string;
    calls?: number;
    cost?: number;
    inputTokens?: number;
    cacheInputTokens?: number;
    outputTokens?: number;
  }>;
}

/**
 * Parse a line from Junie's stdout.
 *
 * Junie outputs the entire result as a single JSON blob on one line when
 * using --output-format json. Non-JSON lines (e.g. progress messages on
 * stderr leak) are passed through as raw.
 */
export function parseJunieStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let data: JunieResult;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { type: 'raw', text: trimmed };
  }

  // Empty object {} means no result (e.g. failed session resume)
  if (!data.sessionId && !data.result && !data.taskName) {
    return null;
  }

  // Aggregate token usage across all models
  let totalInput = 0;
  let totalOutput = 0;
  if (Array.isArray(data.llmUsage)) {
    for (const usage of data.llmUsage) {
      totalInput += (usage.inputTokens ?? 0) + (usage.cacheInputTokens ?? 0);
      totalOutput += usage.outputTokens ?? 0;
    }
  }

  // Emit text from result if present
  const events: StreamEvent[] = [];
  if (data.result) {
    events.push({ type: 'text', text: data.result });
  }

  // Always emit result with sessionId and usage
  return {
    type: 'result',
    sessionId: data.sessionId,
    usage: totalInput > 0 || totalOutput > 0
      ? { inputTokens: totalInput, outputTokens: totalOutput }
      : undefined,
  };
}
