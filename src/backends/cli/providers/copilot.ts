import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

/** Regex to strip ANSI escape sequences from Copilot CLI output */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const COPILOT_INLINE_PROMPT_LIMIT = 2000;

export class CopilotProvider implements Provider {
  name = 'copilot';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private _pendingPrompt: string | null = null;
  private _pendingPromptFilePath: string | null = null;
  private _sessionId: string | undefined;
  private _lastOutputTokens = 0;
  private _sawMessageDelta = false;

  prepareEphemeralTurn(content: string): void {
    this.cleanupPendingPromptFile();
    this._pendingPrompt = content;
    this._lastOutputTokens = 0;
    this._sawMessageDelta = false;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      '--output-format', 'json',
      '--stream', 'on',
    ];

    // Permission handling
    if (opts.permissionMode === 'skip') {
      args.push('--yolo');
    } else {
      args.push('--allow-all-tools');
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    if (this._pendingPrompt) {
      const prompt = this._pendingPrompt;
      args.push(
        '-p',
        shouldExternalizePrompt(prompt)
          ? buildPromptFileInstruction(this.writePendingPromptFile(prompt))
          : prompt,
      );
      this._pendingPrompt = null;
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return ''; // prompt already in args via prepareEphemeralTurn
  }

  async afterTurn(_opts: ProviderSpawnOptions): Promise<StreamEvent | null> {
    this.cleanupPendingPromptFile();
    return null;
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Try parsing as JSON (JSONL from --output-format json)
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON line — strip ANSI and emit as raw text
      const clean = trimmed.replace(ANSI_RE, '').trim();
      if (!clean) return null;
      return { type: 'raw', text: clean };
    }

    const eventType = parsed.type as string | undefined;
    // Copilot nests event payloads inside a "data" wrapper
    const inner = parsed.data as Record<string, unknown> | undefined;

    switch (eventType) {
      case 'session.start':
        this._sessionId = inner?.sessionId as string | undefined;
        return this._sessionId
          ? { type: 'init', sessionId: this._sessionId }
          : null;

      case 'assistant.turn_start':
        return { type: 'init', sessionId: this._sessionId };

      case 'assistant.message_delta':
        this._sawMessageDelta = true;
        return { type: 'text', text: (inner?.deltaContent as string) ?? '' };

      case 'assistant.message': {
        // Capture outputTokens for usage tracking
        if (inner?.outputTokens) {
          this._lastOutputTokens = inner.outputTokens as number;
        }

        const content = extractContent(inner?.content);
        // Full message — check for tool requests
        const toolRequests = inner?.toolRequests as Array<{ name?: string; id?: string }> | undefined;
        if (toolRequests && toolRequests.length > 0) {
          const tool = toolRequests[0];
          return [
            createRuntimeProgressEvent({
              text: `Running tool: ${tool.name ?? 'unknown'}`,
              provider: 'copilot',
              backend: 'cli',
              kind: 'tool',
              status: 'running',
              source: 'provider',
              native: {
                sourceEvent: eventType,
                toolName: tool.name,
              },
            }),
            { type: 'tool_use', toolName: tool.name, toolId: tool.id },
          ];
        }

        // Copilot CLI 1.0.2 emits the final answer as a full assistant.message,
        // often without any assistant.message_delta chunks.
        if (content && !this._sawMessageDelta) {
          return { type: 'text', text: content };
        }
        return null;
      }

      case 'result':
        return {
          type: 'result',
          sessionId: (parsed.sessionId as string | undefined) ?? this._sessionId,
          usage: {
            inputTokens: 0,
            outputTokens: this._lastOutputTokens,
          },
          metadata: this._lastOutputTokens > 0
            ? {
                runtimeUsage: {
                  totalTokens: this._lastOutputTokens,
                  sourceConfidence: 'estimated',
                },
              }
            : undefined,
        };

      case 'session.shutdown': {
        const usage = extractUsageFromShutdown(inner, this._lastOutputTokens);
        const runtimeUsage = extractRuntimeUsageFromShutdown(inner, usage);
        return {
          type: 'result',
          sessionId: this._sessionId,
          usage,
          metadata: runtimeUsage ? { runtimeUsage } : undefined,
        };
      }

      // Skip these event types
      case 'user.message':
      case 'session.model_change':
      case 'assistant.turn_end':
        return null;

      case 'assistant.reasoning_delta':
        return createRuntimeProgressEvent({
          text: typeof inner?.deltaContent === 'string' ? inner.deltaContent : '',
          provider: 'copilot',
          backend: 'cli',
          kind: 'reasoning',
          status: 'running',
          source: 'provider',
          native: {
            sourceEvent: eventType,
          },
        });

      case 'assistant.reasoning':
        return createRuntimeProgressEvent({
          text: extractContent(inner?.content) || 'Copilot updated reasoning state.',
          provider: 'copilot',
          backend: 'cli',
          kind: 'reasoning',
          status: 'updated',
          source: 'provider',
          native: {
            sourceEvent: eventType,
          },
        });

      default:
        // Unknown event type — skip
        return null;
    }
  }

  private writePendingPromptFile(prompt: string): string {
    if (this._pendingPromptFilePath) {
      return normalizePromptPath(this._pendingPromptFilePath);
    }

    const filePath = join(tmpdir(), `cats-runtime-copilot-${randomUUID()}.txt`);
    writeFileSync(filePath, prompt, 'utf8');
    this._pendingPromptFilePath = filePath;
    return normalizePromptPath(filePath);
  }

  private cleanupPendingPromptFile(): void {
    if (!this._pendingPromptFilePath) {
      return;
    }

    try {
      unlinkSync(this._pendingPromptFilePath);
    } catch {
      // Best-effort cleanup only.
    }

    this._pendingPromptFilePath = null;
  }
}

function shouldExternalizePrompt(prompt: string): boolean {
  return prompt.length > COPILOT_INLINE_PROMPT_LIMIT;
}

function buildPromptFileInstruction(filePath: string): string {
  return `Read the full user request from the temp file "${filePath}". `
    + 'Treat the file contents as the complete prompt, follow it exactly, '
    + 'and do not mention this indirection unless it matters to the task.';
}

function normalizePromptPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item && 'text' in item && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}

function extractUsageFromShutdown(
  data: Record<string, unknown> | undefined,
  fallbackOutputTokens: number,
): { inputTokens: number; outputTokens: number } {
  const modelMetrics = data?.modelMetrics as Record<string, unknown> | undefined;
  const currentModel = data?.currentModel as string | undefined;

  const currentMetrics = (currentModel && modelMetrics?.[currentModel])
    ? modelMetrics[currentModel] as Record<string, unknown>
    : Object.values(modelMetrics ?? {})[0] as Record<string, unknown> | undefined;

  const usage = currentMetrics?.usage as Record<string, unknown> | undefined;

  return {
    inputTokens: (usage?.inputTokens as number) ?? 0,
    outputTokens: (usage?.outputTokens as number) ?? fallbackOutputTokens,
  };
}

function extractRuntimeUsageFromShutdown(
  data: Record<string, unknown> | undefined,
  usage: { inputTokens: number; outputTokens: number },
): Record<string, unknown> | undefined {
  const modelMetrics = data?.modelMetrics as Record<string, unknown> | undefined;
  const currentModel = data?.currentModel as string | undefined;

  const currentMetrics = (currentModel && modelMetrics?.[currentModel])
    ? modelMetrics[currentModel] as Record<string, unknown>
    : Object.values(modelMetrics ?? {})[0] as Record<string, unknown> | undefined;
  const quotaUsage = currentMetrics?.usage as Record<string, unknown> | undefined;
  const premiumRequests = typeof quotaUsage?.premiumRequests === 'number'
    ? quotaUsage.premiumRequests
    : undefined;
  const totalApiDurationMs = typeof quotaUsage?.totalApiDurationMs === 'number'
    ? quotaUsage.totalApiDurationMs
    : undefined;

  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (totalTokens <= 0 && premiumRequests === undefined && totalApiDurationMs === undefined) {
    return undefined;
  }

  return {
    totalTokens,
    ...(totalApiDurationMs !== undefined ? { latencyMs: totalApiDurationMs } : {}),
    sourceConfidence: 'reported',
    ...(premiumRequests !== undefined ? { quota: { premiumRequests } } : {}),
  };
}
