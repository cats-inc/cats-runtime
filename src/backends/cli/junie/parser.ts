import type {
  ErrorStreamEvent,
  ProgressStreamEvent,
  RawStreamEvent,
  ResultStreamEvent,
  StreamEvent,
  TextStreamEvent,
  ToolResultStreamEvent,
  ToolUseStreamEvent,
} from '../../../core/types.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';

export interface JunieUsageTotals {
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
  currency?: string;
}

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

export interface ParsedJunieSessionEvent {
  events: StreamEvent[];
  usageDelta?: JunieUsageTotals;
  terminal?: boolean;
}

/**
 * Parse a line from Junie's stdout.
 *
 * Junie outputs the entire result as a single JSON blob on one line when
 * using --output-format json. Non-JSON lines (e.g. progress messages on
 * stderr leak) are passed through as raw.
 */
export function parseJunieStreamLine(line: string): StreamEvent | StreamEvent[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let data: JunieResult;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { type: 'raw', text: trimmed } satisfies RawStreamEvent;
  }

  // Empty object {} means no result (e.g. failed session resume)
  if (!data.sessionId && !data.result && !data.taskName) {
    return null;
  }

  const usage = aggregateJunieUsage(data.llmUsage);

  const events: StreamEvent[] = [];
  if (data.result) {
    events.push({ type: 'text', text: data.result } satisfies TextStreamEvent);
  }
  events.push({
    type: 'result',
    sessionId: data.sessionId,
    usage,
    metadata: usage ? { runtimeUsage: toJunieRuntimeUsage(usage) } : undefined,
  } satisfies ResultStreamEvent);

  return events.length === 1 ? events[0] : events;
}

export function parseJunieSessionEventLine(
  line: string,
  options: {
    sessionId?: string;
    usage?: JunieUsageTotals;
  } = {},
): ParsedJunieSessionEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (parsed.kind !== 'SessionA2uxEvent') {
    return null;
  }

  const outerEvent = asRecord(parsed.event);
  const state = readString(outerEvent?.state);
  const agentEvent = asRecord(outerEvent?.agentEvent);
  const kind = readString(agentEvent?.kind);
  if (!agentEvent || !kind) {
    return null;
  }

  switch (kind) {
    case 'AgentCurrentStatusUpdatedEvent': {
      const status = readString(agentEvent.status);
      if (!status) return null;
      return {
        events: [buildJunieProgressEvent('status', status, options.sessionId, state ?? undefined, agentEvent)],
      };
    }

    case 'TerminalBlockUpdatedEvent': {
      if (readString(agentEvent.status) !== 'IN_PROGRESS') {
        return null;
      }
      const command = readString(agentEvent.command);
      if (!command) return null;
      return {
        events: [buildJunieProgressEvent('terminal', `Running: ${command}`, options.sessionId, state ?? undefined, agentEvent)],
      };
    }

    case 'FileChangesBlockUpdatedEvent':
      if (readString(agentEvent.status) !== 'IN_PROGRESS') {
        return null;
      }
      return {
        events: [buildJunieProgressEvent('file_changes', 'Editing files', options.sessionId, state ?? undefined, agentEvent)],
      };

    case 'ViewFilesBlockUpdatedEvent':
      if (readString(agentEvent.status) !== 'IN_PROGRESS') {
        return null;
      }
      return {
        events: [buildJunieProgressEvent('view_files', 'Reviewing files', options.sessionId, state ?? undefined, agentEvent)],
      };

    case 'ToolBlockUpdatedEvent': {
      const text = readString(agentEvent.text);
      const toolEvents = buildJunieToolLifecycleEvents(agentEvent, options.sessionId, state ?? undefined);
      if (toolEvents.length > 0) {
        return {
          events: toolEvents,
        };
      }
      if (!text) return null;
      return {
        events: [buildJunieProgressEvent('tool', text, options.sessionId, state ?? undefined, agentEvent)],
      };
    }

    case 'AgentPlanUpdatedEvent': {
      const currentStep = readCurrentPlanStep(agentEvent.items);
      if (!currentStep) return null;
      return {
        events: [buildJunieProgressEvent('plan', `Plan: ${currentStep}`, options.sessionId, state ?? undefined, agentEvent)],
      };
    }

    case 'AgentThoughtBlockUpdatedEvent': {
      const thought = readString(agentEvent.text);
      if (!thought) return null;
      return {
        events: [buildJunieProgressEvent('thought', thought, options.sessionId, state ?? undefined, agentEvent)],
      };
    }

    case 'LlmResponseMetadataEvent':
      return {
        events: [],
        usageDelta: aggregateJunieUsage(agentEvent.modelUsage),
      };

    case 'ResultBlockUpdatedEvent': {
      if (agentEvent.cancelled === true) {
        return {
          events: [{
            type: 'error',
            sessionId: options.sessionId,
            text: 'Junie cancelled the task before returning a result.',
          } satisfies ErrorStreamEvent],
          terminal: true,
        };
      }

      const events: StreamEvent[] = [];
      const resultText = readString(agentEvent.result);
      if (resultText) {
        events.push({ type: 'text', text: resultText } satisfies TextStreamEvent);
      }
      events.push({
        type: 'result',
        sessionId: options.sessionId,
        usage: sanitizeUsage(options.usage),
        metadata: options.usage ? { runtimeUsage: toJunieRuntimeUsage(options.usage) } : undefined,
      } satisfies ResultStreamEvent);
      return {
        events,
        terminal: true,
      };
    }

    default:
      return null;
  }
}

function buildJunieProgressEvent(
  progressKind: string,
  text: string,
  sessionId: string | undefined,
  state: string | undefined,
  agentEvent: Record<string, unknown>,
): ProgressStreamEvent {
  return createRuntimeProgressEvent({
    text,
    sessionId,
    provider: 'junie',
    backend: 'cli',
    kind: mapJunieProgressKind(progressKind),
    status: 'running',
    source: 'provider',
    native: {
      source: 'junie-progress',
      progressKind,
      state,
    },
    raw: agentEvent,
  });
}

function buildJunieToolLifecycleEvents(
  agentEvent: Record<string, unknown>,
  sessionId: string | undefined,
  state: string | undefined,
): StreamEvent[] {
  const toolName = readString(agentEvent.toolName) ?? readString(agentEvent.name);
  const toolId = readString(agentEvent.toolId) ?? readString(agentEvent.id);
  const status = normalizeJunieToolStatus(readString(agentEvent.status));
  const text = readString(agentEvent.text);
  const resultText = stringifyJunieToolValue(
    agentEvent.result ?? agentEvent.output ?? agentEvent.response,
  );
  const isError = status === 'failed'
    || agentEvent.isError === true
    || agentEvent.error === true;

  if (!toolName && !toolId) {
    return [];
  }

  if (status === 'completed' || status === 'failed' || resultText) {
    return [
      createRuntimeProgressEvent({
        text: text
          || (toolName ? `Junie completed tool: ${toolName}` : 'Junie completed a tool call.'),
        sessionId,
        provider: 'junie',
        backend: 'cli',
        kind: 'tool',
        status: isError ? 'failed' : 'updated',
        source: 'provider',
        native: {
          source: 'junie-progress',
          progressKind: 'tool',
          state,
          ...(toolName ? { toolName } : {}),
          ...(toolId ? { toolId } : {}),
        },
        raw: agentEvent,
      }),
      {
        type: 'tool_result',
        ...(toolName ? { toolName } : {}),
        ...(toolId ? { toolId } : {}),
        ...(resultText ? { text: resultText } : {}),
        ...(isError ? { isError: true } : {}),
      } satisfies ToolResultStreamEvent,
    ];
  }

  return [
    createRuntimeProgressEvent({
      text: text || (toolName ? `Running tool: ${toolName}` : 'Junie updated tool status.'),
      sessionId,
      provider: 'junie',
      backend: 'cli',
      kind: 'tool',
      status: 'running',
      source: 'provider',
      native: {
        source: 'junie-progress',
        progressKind: 'tool',
        state,
        ...(toolName ? { toolName } : {}),
        ...(toolId ? { toolId } : {}),
      },
      raw: agentEvent,
    }),
    {
      type: 'tool_use',
      ...(toolName ? { toolName } : {}),
      ...(toolId ? { toolId } : {}),
    } satisfies ToolUseStreamEvent,
  ];
}

function readCurrentPlanStep(items: unknown): string | null {
  if (!Array.isArray(items)) return null;

  const current = items.find((item) => {
    const record = asRecord(item);
    return readString(record?.status) === 'IN_PROGRESS';
  });
  const currentRecord = asRecord(current);
  return readString(currentRecord?.description) ?? null;
}

function aggregateJunieUsage(entries: unknown): JunieUsageTotals | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCost = 0;

  for (const entry of entries) {
    const usage = asRecord(entry);
    if (!usage) continue;
    inputTokens += readNumber(usage.inputTokens);
    inputTokens += readNumber(usage.cacheInputTokens);
    inputTokens += readNumber(usage.cacheCreateTokens);
    outputTokens += readNumber(usage.outputTokens);
    estimatedCost += readNumber(usage.cost);
  }

  return sanitizeUsage({
    inputTokens,
    outputTokens,
    estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
  });
}

function sanitizeUsage(usage?: JunieUsageTotals): JunieUsageTotals | undefined {
  if (!usage) return undefined;
  if (
    usage.inputTokens <= 0
    && usage.outputTokens <= 0
    && (usage.estimatedCost ?? 0) <= 0
  ) {
    return undefined;
  }
  return usage;
}

function toJunieRuntimeUsage(usage: JunieUsageTotals): Record<string, unknown> {
  return {
    totalTokens: usage.inputTokens + usage.outputTokens,
    ...(usage.estimatedCost !== undefined ? { estimatedCost: usage.estimatedCost } : {}),
    ...(usage.estimatedCost !== undefined ? { currency: 'USD' } : {}),
    sourceConfidence: 'aggregated',
  };
}

function mapJunieProgressKind(progressKind: string) {
  switch (progressKind) {
    case 'status':
      return 'status';
    case 'plan':
      return 'plan';
    case 'thought':
      return 'reasoning';
    case 'tool':
      return 'tool';
    case 'terminal':
      return 'command';
    case 'file_changes':
    case 'view_files':
      return 'files';
    default:
      return 'status';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeJunieToolStatus(status: string | null): 'running' | 'completed' | 'failed' | null {
  switch (status) {
    case 'IN_PROGRESS':
    case 'STARTED':
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
    case 'DONE':
    case 'SUCCESS':
      return 'completed';
    case 'FAILED':
    case 'ERROR':
      return 'failed';
    default:
      return null;
  }
}

function stringifyJunieToolValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
