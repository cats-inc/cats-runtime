import type {
  ErrorStreamEvent,
  RawStreamEvent,
  ReportedModel,
  ResultStreamEvent,
  StreamEvent,
  StreamUsage,
  TextStreamEvent,
  ToolResultStreamEvent,
  ToolUseStreamEvent,
} from '../../../core/types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeIgnored,
  observeNormalized,
  observeRawPassthrough,
  observeSchemaFailure,
  observeUnknown,
} from '../../../core/compatibility/providerEvolution.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';

/**
 * One stdout line of `kimi -p <prompt> --output-format stream-json`.
 *
 * Kimi Code writes OpenAI-style chat messages, not Claude stream-json events
 * (prompt-render.ts `PromptJsonWriter` in Kimi Code 2.5.3):
 *  - `{"role":"meta","type":"system.version","version":"2.5.3"}` first;
 *  - `{"role":"assistant","content":"...","tool_calls":[...]}` once per model
 *    step, flushed when the step ends or its first tool result arrives, so the
 *    text is not streamed token by token and thinking is never written;
 *  - `{"role":"tool","tool_call_id":"...","content":"..."}` per tool result;
 *  - `{"role":"meta","type":"turn.step.retrying",...}` before a retried request;
 *  - `{"role":"meta","type":"session.resume_hint","session_id":"..."}` only
 *    after the turn completed;
 *  - `{"type":"error","code":"...","message":"..."}` when the session is busy
 *    in another client (exit code 4).
 * Other failures write `error: failed to run prompt: <message>` to stderr and
 * exit 1; see {@link parseKimiFailure}.
 */
export interface KimiStreamFrame {
  role?: string;
  type?: string;
  version?: string;
  content?: unknown;
  tool_calls?: Array<{
    type?: string;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  session_id?: string;
  code?: string;
  message?: string;
  failed_attempt?: number;
  next_attempt?: number;
  max_attempts?: number;
  error_message?: string;
}

/** Tool names by call id, so results can name the tool their call used. */
export interface KimiParseState {
  toolNames: Map<string, string>;
}

export function createKimiParseState(): KimiParseState {
  return { toolNames: new Map() };
}

export function parseKimiStreamLine(
  line: string,
  observer?: ProviderEvolutionEvidenceObserver,
  state: KimiParseState = createKimiParseState(),
): StreamEvent | StreamEvent[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let frame: KimiStreamFrame;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    frame = parsed as KimiStreamFrame;
  } catch {
    return observeRawPassthrough(observer, { reason: 'non_json_line', rawSample: trimmed },
      { type: 'raw', text: trimmed } satisfies RawStreamEvent);
  }

  if (frame.role === 'meta') return parseMetaFrame(frame, observer);
  if (frame.role === 'assistant') return parseAssistantFrame(frame, observer, state);
  if (frame.role === 'tool') return parseToolFrame(frame, observer, state);
  if (frame.type === 'error') {
    const text = typeof frame.message === 'string' && frame.message.trim()
      ? frame.message.trim()
      : 'Kimi Code reported an error.';
    return observeNormalized(observer, { rawEventType: 'error', rawSample: frame },
      { type: 'error', text, raw: frame } satisfies ErrorStreamEvent);
  }
  if (frame.type === 'goal.summary') {
    return observeIgnored(observer, { rawEventType: 'goal.summary', rawSample: frame }, null);
  }
  return observeUnknown(observer, {
    rawEventType: `${frame.role ?? ''}:${frame.type ?? ''}`,
    rawSample: frame,
  }, null);
}

function parseMetaFrame(
  frame: KimiStreamFrame,
  observer?: ProviderEvolutionEvidenceObserver,
): StreamEvent | StreamEvent[] | null {
  const rawEventType = `meta:${frame.type ?? ''}`;
  switch (frame.type) {
    case 'system.version': {
      const version = typeof frame.version === 'string' ? frame.version : '';
      return observeNormalized(observer, { rawEventType, rawSample: frame }, createRuntimeProgressEvent({
        text: version ? `Kimi Code ${version} started` : 'Kimi Code started',
        provider: 'kimi',
        backend: 'cli',
        kind: 'status',
        status: 'started',
        source: 'provider',
        native: { sourceEvent: frame.type, ...(version ? { version } : {}) },
      }));
    }
    case 'turn.step.retrying': {
      const attempt = typeof frame.next_attempt === 'number' && typeof frame.max_attempts === 'number'
        ? ` (attempt ${frame.next_attempt} of ${frame.max_attempts})`
        : '';
      const reason = typeof frame.error_message === 'string' && frame.error_message.trim()
        ? `: ${frame.error_message.trim()}`
        : '';
      return observeNormalized(observer, { rawEventType, rawSample: frame }, createRuntimeProgressEvent({
        text: `Retrying the model request${attempt}${reason}`,
        provider: 'kimi',
        backend: 'cli',
        kind: 'status',
        status: 'running',
        source: 'provider',
        native: { sourceEvent: frame.type },
      }));
    }
    case 'session.resume_hint': {
      if (typeof frame.session_id !== 'string' || !frame.session_id.trim()) {
        return observeSchemaFailure(observer, {
          rawEventType, reason: 'missing_session_id', rawSample: frame,
        }, null);
      }
      return observeNormalized(observer, { rawEventType, rawSample: frame },
        { type: 'result', sessionId: frame.session_id.trim() } satisfies ResultStreamEvent);
    }
    default:
      return observeUnknown(observer, { rawEventType, rawSample: frame }, null);
  }
}

function parseAssistantFrame(
  frame: KimiStreamFrame,
  observer: ProviderEvolutionEvidenceObserver | undefined,
  state: KimiParseState,
): StreamEvent | StreamEvent[] | null {
  const events: StreamEvent[] = [];
  const text = messageText(frame.content);
  if (text) events.push({ type: 'text', text } satisfies TextStreamEvent);
  for (const call of Array.isArray(frame.tool_calls) ? frame.tool_calls : []) {
    const toolName = typeof call?.function?.name === 'string' && call.function.name
      ? call.function.name
      : 'unknown';
    const toolId = typeof call?.id === 'string' && call.id ? call.id : undefined;
    if (toolId) state.toolNames.set(toolId, toolName);
    const toolArgs = parseToolArguments(call?.function?.arguments);
    events.push(createRuntimeProgressEvent({
      text: `Running tool: ${toolName}`,
      provider: 'kimi',
      backend: 'cli',
      kind: 'tool',
      status: 'running',
      source: 'provider',
      native: { sourceEvent: 'assistant.tool_calls', toolName, ...(toolId ? { toolId } : {}) },
    }));
    events.push({
      type: 'tool_use',
      toolName,
      ...(toolId ? { toolId } : {}),
      ...(toolArgs ? { toolArgs } : {}),
    } satisfies ToolUseStreamEvent);
  }
  if (events.length === 0) {
    return observeIgnored(observer, { rawEventType: 'assistant:empty', rawSample: frame }, null);
  }
  return observeNormalized(observer, {
    rawEventType: frame.tool_calls?.length ? 'assistant:tool_calls' : 'assistant:text',
    rawSample: frame,
  }, events.length === 1 ? events[0] : events);
}

function parseToolFrame(
  frame: KimiStreamFrame,
  observer: ProviderEvolutionEvidenceObserver | undefined,
  state: KimiParseState,
): StreamEvent | null {
  const toolId = typeof frame.tool_call_id === 'string' && frame.tool_call_id
    ? frame.tool_call_id
    : undefined;
  if (!toolId) {
    return observeSchemaFailure(observer, {
      rawEventType: 'tool', reason: 'missing_tool_call_id', rawSample: frame,
    }, null);
  }
  const toolName = state.toolNames.get(toolId);
  return observeNormalized(observer, { rawEventType: 'tool', rawSample: frame }, {
    type: 'tool_result',
    toolId,
    ...(toolName ? { toolName } : {}),
    text: messageText(frame.content),
  } satisfies ToolResultStreamEvent);
}

/** Kimi writes plain strings; array content parts are accepted defensively. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return [(part as { text: string }).text];
    }
    return [];
  }).join('');
}

function parseToolArguments(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export interface KimiFailure {
  message: string;
  /** The resumed session no longer exists, or Kimi bound it to another directory. */
  sessionUnavailable: boolean;
}

const FAILURE_PREFIX = 'error: failed to run prompt: ';
const SESSION_NOT_FOUND = /^Session "[^"]+" not found\.$/u;
const SESSION_OTHER_DIRECTORY = /^Session "[^"]+" was created under a different directory\.$/u;

/**
 * The failure Kimi reported on stderr before exiting non-zero. Kimi writes
 * `error: failed to run prompt: <message>` and then `See log: <path>`; the
 * log line names a local path and is left out of the message.
 */
export function parseKimiFailure(stderrLines: readonly string[]): KimiFailure | null {
  for (let index = stderrLines.length - 1; index >= 0; index -= 1) {
    const line = stderrLines[index].trim();
    if (!line.startsWith(FAILURE_PREFIX)) continue;
    const message = line.slice(FAILURE_PREFIX.length).trim();
    if (!message) continue;
    return {
      message,
      sessionUnavailable: SESSION_NOT_FOUND.test(message) || SESSION_OTHER_DIRECTORY.test(message),
    };
  }
  return null;
}

export interface KimiTurnTelemetry {
  usage?: StreamUsage;
  reportedModels?: ReportedModel[];
}

interface KimiWireUsage {
  inputOther?: number;
  inputCacheRead?: number;
  inputCacheCreation?: number;
  output?: number;
}

/**
 * Usage and served models of the newest turn in a Kimi session's main-agent
 * wire journal (`<KIMI_CODE_HOME>/sessions/<workdir>/<session>/agents/main/wire.jsonl`,
 * protocol 1.5 on Kimi Code 2.5.3). The turn starts at the last `turn.prompt`;
 * `usage.record` lines with `usageScope: "turn"` carry per-step token counts
 * and `llm.request` lines name the model and alias each step used. Subagents
 * keep their own journals and are not counted.
 */
export function readKimiTurnTelemetry(
  wireText: string,
  requestedModelAlias?: string,
): KimiTurnTelemetry {
  const lines = wireText.split(/\r?\n/u);
  let start = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes('"turn.prompt"') && wireRecord(lines[index])?.type === 'turn.prompt') {
      start = index;
      break;
    }
  }

  const totals = { inputOther: 0, inputCacheRead: 0, inputCacheCreation: 0, output: 0 };
  let sawUsage = false;
  const models = new Map<string, ReportedModel>();
  for (const line of lines.slice(start)) {
    const record = wireRecord(line);
    if (!record) continue;
    if (record.type === 'usage.record' && record.usageScope === 'turn') {
      const usage = record.usage as KimiWireUsage | undefined;
      if (!usage || typeof usage !== 'object') continue;
      sawUsage = true;
      totals.inputOther += count(usage.inputOther);
      totals.inputCacheRead += count(usage.inputCacheRead);
      totals.inputCacheCreation += count(usage.inputCacheCreation);
      totals.output += count(usage.output);
    } else if (record.type === 'llm.request' && typeof record.model === 'string' && record.model) {
      const alias = typeof record.modelAlias === 'string' ? record.modelAlias : undefined;
      if (models.has(record.model)) continue;
      models.set(record.model, {
        model: record.model,
        ...(requestedModelAlias && alias ? { matchesRequest: alias === requestedModelAlias } : {}),
      });
    }
  }

  return {
    ...(sawUsage ? {
      usage: {
        inputTokens: totals.inputOther,
        outputTokens: totals.output,
        ...(totals.inputCacheRead ? { cacheReadInputTokens: totals.inputCacheRead } : {}),
        ...(totals.inputCacheCreation ? { cacheCreationInputTokens: totals.inputCacheCreation } : {}),
        totalTokens: totals.inputOther + totals.inputCacheRead + totals.inputCacheCreation + totals.output,
        sourceConfidence: 'reported',
      } satisfies StreamUsage,
    } : {}),
    ...(models.size ? { reportedModels: [...models.values()] } : {}),
  };
}

function wireRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
