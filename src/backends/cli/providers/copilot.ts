import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeIgnored,
  observeNormalized,
  observeRawPassthrough,
  observeSchemaFailure,
  observeUnknown,
} from '../../../core/compatibility/providerEvolution.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

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

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.cleanupPendingPromptFile();
    this._pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this._lastOutputTokens = 0;
    this._sawMessageDelta = false;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = this.compatibilityProfile?.spawnBaseArgs
      ? [...this.compatibilityProfile.spawnBaseArgs]
      : [
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
      return observeRawPassthrough(this.evolutionObserver, {
        reason: 'non_json_line',
        rawSample: clean,
      }, {
        type: 'raw',
        text: clean,
      });
    }

    const eventType = parsed.type as string | undefined;
    // Copilot nests event payloads inside a "data" wrapper
    const inner = parsed.data as Record<string, unknown> | undefined;

    switch (eventType) {
      case 'session.start':
        this._sessionId = inner?.sessionId as string | undefined;
        if (!this._sessionId) {
          return observeSchemaFailure(this.evolutionObserver, {
            rawEventType: 'session.start',
            reason: 'missing_session_id',
            rawSample: parsed,
          }, null);
        }
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'session.start',
          rawSample: parsed,
        }, {
          type: 'init',
          sessionId: this._sessionId,
        });

      case 'assistant.turn_start':
        if (!this._sessionId) {
          this.evolutionObserver?.recordSchemaFailure({
            rawEventType: 'assistant.turn_start',
            reason: 'missing_session_id',
            rawSample: parsed,
          });
        }
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'assistant.turn_start',
          rawSample: parsed,
        }, {
          type: 'init',
          sessionId: this._sessionId,
        });

      case 'assistant.message_delta':
        this._sawMessageDelta = true;
        if (typeof inner?.deltaContent !== 'string') {
          this.evolutionObserver?.recordSchemaFailure({
            rawEventType: 'assistant.message_delta',
            reason: 'missing_delta_content',
            rawSample: parsed,
          });
        }
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'assistant.message_delta',
          rawSample: parsed,
        }, {
          type: 'text',
          text: (inner?.deltaContent as string) ?? '',
        });

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
          return observeNormalized(this.evolutionObserver, {
            rawEventType: 'assistant.message',
            rawSample: parsed,
            details: {
              toolRequestCount: toolRequests.length,
            },
          }, [
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
          ]);
        }

        // Copilot CLI 1.0.2 emits the final answer as a full assistant.message,
        // often without any assistant.message_delta chunks.
        if (content && !this._sawMessageDelta) {
          return observeNormalized(this.evolutionObserver, {
            rawEventType: 'assistant.message',
            rawSample: parsed,
          }, {
            type: 'text',
            text: content,
          });
        }
        return observeIgnored(this.evolutionObserver, {
          rawEventType: 'assistant.message',
          reason: this._sawMessageDelta
            ? 'final_message_already_streamed'
            : 'assistant_message_without_text_or_tool',
          rawSample: parsed,
        }, null);
      }

      case 'result':
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'result',
          rawSample: parsed,
        }, {
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
        });

      case 'session.shutdown': {
        const usage = extractUsageFromShutdown(inner, this._lastOutputTokens);
        const runtimeUsage = extractRuntimeUsageFromShutdown(inner, usage);
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'session.shutdown',
          rawSample: parsed,
        }, {
          type: 'result',
          sessionId: this._sessionId,
          usage,
          metadata: runtimeUsage ? { runtimeUsage } : undefined,
        });
      }

      case 'session.model_change':
        return observeNormalized(this.evolutionObserver, {
          rawEventType: eventType,
          rawSample: parsed,
        }, createRuntimeProgressEvent({
          text: typeof inner?.newModel === 'string' && inner.newModel
            ? `Copilot switched to model ${inner.newModel}.`
            : 'Copilot switched models.',
          provider: 'copilot',
          backend: 'cli',
          kind: 'model_state',
          status: 'updated',
          source: 'provider',
          native: {
            sourceEvent: eventType,
            ...(typeof inner?.newModel === 'string' && inner.newModel
              ? { newModel: inner.newModel }
              : {}),
          },
        }));

      // Skip these event types
      case 'user.message':
      case 'assistant.turn_end':
        return observeIgnored(this.evolutionObserver, {
          rawEventType: eventType,
          reason: 'known_ignored_event',
          rawSample: parsed,
        }, null);

      case 'assistant.reasoning_delta':
        return observeNormalized(this.evolutionObserver, {
          rawEventType: eventType,
          rawSample: parsed,
        }, createRuntimeProgressEvent({
          text: typeof inner?.deltaContent === 'string' ? inner.deltaContent : '',
          provider: 'copilot',
          backend: 'cli',
          kind: 'reasoning',
          status: 'running',
          source: 'provider',
          native: {
            sourceEvent: eventType,
          },
        }));

      case 'assistant.reasoning':
        return observeNormalized(this.evolutionObserver, {
          rawEventType: eventType,
          rawSample: parsed,
        }, createRuntimeProgressEvent({
          text: extractContent(inner?.content) || 'Copilot updated reasoning state.',
          provider: 'copilot',
          backend: 'cli',
          kind: 'reasoning',
          status: 'updated',
          source: 'provider',
          native: {
            sourceEvent: eventType,
          },
        }));

      default:
        return observeUnknown(this.evolutionObserver, {
          rawEventType: eventType || 'unknown',
          reason: 'unknown_copilot_event',
          rawSample: parsed,
        }, null);
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
