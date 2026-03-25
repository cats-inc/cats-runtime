import type { ApiToolCallPart } from '../../types.js';

export interface RepeatedToolCallState {
  signature?: string;
  consecutiveCount: number;
  stuck: boolean;
}

export function createToolCallBatchSignature(
  toolCalls: ApiToolCallPart[],
): string | undefined {
  if (toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls
    .map((toolCall) => `${toolCall.name}:${stableStringify(toolCall.arguments)}`)
    .join('|');
}

export function updateRepeatedToolCallState(
  previous: RepeatedToolCallState | undefined,
  toolCalls: ApiToolCallPart[],
  threshold: number,
): RepeatedToolCallState {
  const signature = createToolCallBatchSignature(toolCalls);
  if (!signature) {
    return {
      consecutiveCount: 0,
      stuck: false,
    };
  }

  const consecutiveCount = previous?.signature === signature
    ? previous.consecutiveCount + 1
    : 1;

  return {
    signature,
    consecutiveCount,
    stuck: threshold > 0 && consecutiveCount >= threshold,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
