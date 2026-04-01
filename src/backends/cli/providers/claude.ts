import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  ClaudeStreamEvent,
  TurnInput,
} from './types.js';
import type {
  InitStreamEvent,
  ProgressStreamEvent,
  RawStreamEvent,
  ResultStreamEvent,
  TextStreamEvent,
  ToolResultStreamEvent,
  ToolUseStreamEvent,
} from '../../../core/types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeNormalized,
  observeRawPassthrough,
} from '../../../core/compatibility/providerEvolution.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

export class ClaudeProvider implements Provider {
  name = 'claude';
  capabilities: ProviderCapabilities = { resume: true, fork: true, permissions: true };

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = this.compatibilityProfile?.spawnBaseArgs
      ? [...this.compatibilityProfile.spawnBaseArgs]
      : [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
      ];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (typeof opts.modelControls?.['claude.reasoning_effort'] === 'string') {
      args.push('--effort', opts.modelControls['claude.reasoning_effort']);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    if (opts.forkSession) {
      args.push('--fork-session');
    }

    switch (opts.permissionMode) {
      case 'skip':
        args.push('--dangerously-skip-permissions');
        break;
      case 'whitelist':
        if (opts.allowedTools?.length) {
          args.push('--allowedTools', opts.allowedTools.join(','));
        }
        break;
      // 'default' — no extra flags
    }

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    const msg = {
      type: 'user',
      message: {
        role: 'user',
        content: compileRuntimeTurnPrompt(content, turn),
      },
    };
    return JSON.stringify(msg) + '\n';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Non-JSON line (startup messages, etc.)
      return observeRawPassthrough(this.evolutionObserver, {
        reason: 'non_json_line',
        rawSample: trimmed,
      }, {
        type: 'raw',
        text: trimmed,
      } satisfies RawStreamEvent);
    }

    // system/init — session ID
    if (event.type === 'system' && event.subtype === 'init') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'system:init',
        rawSample: event,
      }, {
        type: 'init',
        sessionId: event.session_id,
        raw: event,
      } satisfies InitStreamEvent);
    }

    // assistant message — accumulate text content
    if (event.type === 'assistant' && event.message?.content) {
      const contentEvents = extractClaudeAssistantEvents(event.message.content);
      if (contentEvents.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'assistant',
          rawSample: event,
        }, contentEvents.length === 1 ? contentEvents[0]! : contentEvents);
      }
    }

    if (event.type === 'assistant' && event.tool_use) {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'assistant:tool_use',
        rawSample: event,
      }, createClaudeToolUseEvents({
        name: event.tool_use.name,
        id: event.tool_use.id,
        sourceEvent: 'assistant',
      }));
    }

    if (event.type === 'content_block_start' && event.content_block) {
      const blockEvents = extractClaudeContentBlockEvents(event.content_block, 'content_block_start');
      if (blockEvents.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'content_block_start',
          rawSample: event,
        }, blockEvents.length === 1 ? blockEvents[0]! : blockEvents);
      }
    }

    // content_block_delta — streaming text chunks
    if (event.type === 'content_block_delta' && event.content_block_delta) {
      const deltaEvents = extractClaudeContentBlockDeltaEvents(event.content_block_delta, event);
      if (deltaEvents.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'content_block_delta',
          rawSample: event,
        }, deltaEvents.length === 1 ? deltaEvents[0]! : deltaEvents);
      }
    }

    // result — done, with token usage
    if (event.type === 'result') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'result',
        rawSample: event,
      }, {
        type: 'result',
        sessionId: event.session_id,
        usage: event.usage ? {
          inputTokens: (event.usage.input_tokens ?? 0)
            + (event.usage.cache_read_input_tokens ?? 0)
            + (event.usage.cache_creation_input_tokens ?? 0),
          outputTokens: event.usage.output_tokens ?? 0,
          promptInputTokens: event.usage.input_tokens ?? 0,
          cacheReadInputTokens: event.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: event.usage.cache_creation_input_tokens ?? 0,
        } : undefined,
        raw: event,
      } satisfies ResultStreamEvent);
    }

    // Pass through anything else as raw
    return observeRawPassthrough(this.evolutionObserver, {
      rawEventType: event.subtype ? `${event.type}:${event.subtype}` : event.type,
      reason: 'unhandled_claude_event',
      rawSample: event,
    }, {
      type: 'raw',
      raw: event,
    } satisfies RawStreamEvent);
  }
}

function extractClaudeAssistantEvents(
  content: NonNullable<ClaudeStreamEvent['message']>['content'],
): StreamEvent[] {
  const events: StreamEvent[] = [];
  const textParts: string[] = [];

  for (const block of content ?? []) {
    if (typeof block === 'string') {
      textParts.push(block);
      continue;
    }

    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      events.push(...createClaudeToolUseEvents({
        name: block.name,
        id: block.id,
        input: block.input,
        sourceEvent: 'assistant',
      }));
      continue;
    }

    if (block.type === 'tool_result' || block.type === 'server_tool_result') {
      events.push(...createClaudeToolResultEvents({
        toolId: block.tool_use_id,
        text: stringifyClaudeContent(block.content),
        isError: block.is_error === true,
        sourceEvent: 'assistant',
      }));
      continue;
    }

    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      events.push(createClaudeReasoningEvent(
        typeof block.thinking === 'string' ? block.thinking : block.text,
        'updated',
        'assistant',
      ));
      continue;
    }

    if (typeof block.text === 'string' && block.text) {
      textParts.push(block.text);
    }
  }

  const text = textParts.join('');
  if (text) {
    events.unshift({
      type: 'text',
      text,
    } satisfies TextStreamEvent);
  }

  return events;
}

function createClaudeToolUseEvents(tool: {
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  sourceEvent: string;
}): Array<ProgressStreamEvent | ToolUseStreamEvent> {
  const toolName = tool.name ?? 'unknown';
  return [
    createRuntimeProgressEvent({
      text: `Running tool: ${toolName}`,
      provider: 'claude',
      backend: 'cli',
      kind: 'tool',
      status: 'running',
      source: 'provider',
      native: {
        sourceEvent: tool.sourceEvent,
        toolName,
      },
    }),
    {
      type: 'tool_use',
      toolName,
      toolId: tool.id,
      toolArgs: tool.input,
    } satisfies ToolUseStreamEvent,
  ];
}

function createClaudeToolResultEvents(tool: {
  toolName?: string;
  toolId?: string;
  text?: string;
  isError?: boolean;
  sourceEvent: string;
}): Array<ProgressStreamEvent | ToolResultStreamEvent> {
  if (!tool.toolName && !tool.toolId && !tool.text) {
    return [];
  }

  return [
    createRuntimeProgressEvent({
      text: tool.toolName
        ? `Claude completed tool: ${tool.toolName}`
        : 'Claude completed a tool call.',
      provider: 'claude',
      backend: 'cli',
      kind: 'tool',
      status: tool.isError ? 'failed' : 'updated',
      source: 'provider',
      native: {
        sourceEvent: tool.sourceEvent,
        ...(tool.toolName ? { toolName: tool.toolName } : {}),
        ...(tool.toolId ? { toolId: tool.toolId } : {}),
      },
    }),
    {
      type: 'tool_result',
      ...(tool.toolName ? { toolName: tool.toolName } : {}),
      ...(tool.toolId ? { toolId: tool.toolId } : {}),
      ...(tool.text ? { text: tool.text } : {}),
      ...(tool.isError === true ? { isError: true } : {}),
    } satisfies ToolResultStreamEvent,
  ];
}

function createClaudeReasoningEvent(
  text: string | undefined,
  status: 'running' | 'updated',
  sourceEvent: string,
): ProgressStreamEvent {
  return createRuntimeProgressEvent({
    text: typeof text === 'string' && text.trim() ? text : 'Claude updated reasoning.',
    provider: 'claude',
    backend: 'cli',
    kind: 'reasoning',
    status,
    source: 'provider',
    native: {
      sourceEvent,
    },
  });
}

function extractClaudeContentBlockEvents(
  block: NonNullable<ClaudeStreamEvent['content_block']>,
  sourceEvent: string,
): StreamEvent[] {
  if (block.type === 'tool_use' || block.type === 'server_tool_use') {
    return createClaudeToolUseEvents({
      name: block.name,
      id: block.id,
      input: block.input,
      sourceEvent,
    });
  }

  if (block.type === 'tool_result' || block.type === 'server_tool_result') {
    return createClaudeToolResultEvents({
      toolName: block.name,
      toolId: block.tool_use_id,
      text: stringifyClaudeContent(block.content),
      isError: block.is_error === true,
      sourceEvent,
    });
  }

  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return [createClaudeReasoningEvent(block.thinking ?? block.text, 'updated', sourceEvent)];
  }

  if (typeof block.text === 'string' && block.text) {
    return [{ type: 'text', text: block.text } satisfies TextStreamEvent];
  }

  return [];
}

function extractClaudeContentBlockDeltaEvents(
  delta: NonNullable<ClaudeStreamEvent['content_block_delta']>,
  raw: ClaudeStreamEvent,
): StreamEvent[] {
  if (delta.type === 'text_delta' && delta.text) {
    return [{
      type: 'text',
      text: delta.text,
      raw,
    } satisfies TextStreamEvent];
  }

  if (delta.type === 'thinking_delta') {
    return [createClaudeReasoningEvent(delta.thinking ?? delta.text, 'running', 'content_block_delta')];
  }

  return [];
}

function stringifyClaudeContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value || undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
