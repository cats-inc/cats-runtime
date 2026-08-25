import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderLaunchFailureInput,
  ProviderSpawnOptions,
  RuntimeProviderRefusal,
  StreamEvent,
  TurnInput,
} from './types.js';
import type {
  ErrorStreamEvent,
  InitStreamEvent,
  RawStreamEvent,
  ResultStreamEvent,
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
  observeUnknown,
} from '../../../core/compatibility/providerEvolution.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

export const ANTIGRAVITY_STREAM_JSON_PROFILE_ID = 'antigravity-cli-stream-json-1.1.20';

export const ANTIGRAVITY_STREAM_JSON_BASE_ARGS = [
  '--output-format', 'stream-json',
  // Runtime prompts are compiled text. Without this, agy expands leading slash
  // commands and skills in print mode, so the turn stops being a faithful
  // replay of what the caller asked for.
  '--disable-slash-commands',
] as const;

interface AntigravityNativeUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  thinking_tokens?: unknown;
  cache_read_tokens?: unknown;
  total_tokens?: unknown;
}

interface AntigravityNativeError {
  type?: unknown;
  message?: unknown;
}

interface AntigravityNativeToolInfo {
  name?: unknown;
  parameters?: unknown;
  error?: AntigravityNativeError;
}

interface AntigravityNativeStepUpdate {
  conversation_id?: unknown;
  step_index?: unknown;
  state?: unknown;
  step_type?: unknown;
  text_delta?: unknown;
  duration_seconds?: unknown;
  usage?: AntigravityNativeUsage;
  tool_name?: unknown;
  tool_info?: AntigravityNativeToolInfo;
}

interface AntigravityNativeInit {
  cwd?: unknown;
  tools?: unknown;
  permission_mode?: unknown;
}

interface AntigravityNativeResult {
  conversation_id?: unknown;
  status?: unknown;
  response?: unknown;
  error?: unknown;
  duration_seconds?: unknown;
  num_turns?: unknown;
  usage?: AntigravityNativeUsage;
}

interface AntigravityNativeEvent {
  event?: unknown;
  conversation_id?: unknown;
  init?: AntigravityNativeInit;
  step_update?: AntigravityNativeStepUpdate;
  result?: AntigravityNativeResult;
}

export class AntigravityProvider implements Provider {
  name = 'antigravity';
  ephemeral = true;
  // `--conversation <id>` replays the prior turns and keeps the same
  // conversation id (probed live: num_turns went 1 -> 2 and the agent recalled
  // its earlier answer). agy 1.1.20 exposes no fork flag, so a branch would
  // have to replay the whole transcript and would not be a fork.
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true };

  private pendingPrompt: string | null = null;
  private readonly pendingTools = new Map<string, string>();

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.pendingTools.clear();
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const prompt = this.pendingPrompt;
    if (!prompt) {
      throw new Error(
        'Antigravity CLI requires prepareEphemeralTurn before building spawn arguments.',
      );
    }
    this.pendingPrompt = null;

    if (opts.forkSession) {
      throw new Error('Antigravity CLI 1.1.20 has no session fork mechanism.');
    }

    const args = [
      '-p',
      prompt,
      ...(this.compatibilityProfile?.spawnBaseArgs ?? ANTIGRAVITY_STREAM_JSON_BASE_ARGS),
      // agy reports the process cwd in its init event but does not treat it as
      // the workspace. Without --add-dir the agent silently works inside
      // ~/.gemini/antigravity-cli/scratch instead of the session workspace,
      // which was reproduced live before this flag was added.
      '--add-dir',
      opts.cwd,
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.resumeSessionId) {
      args.push('--conversation', opts.resumeSessionId);
    }

    appendAntigravityPermissionArgs(args, opts);
    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  classifyLaunchFailure(input: ProviderLaunchFailureInput): RuntimeProviderRefusal | null {
    const evidenceSummary = [input.line, ...input.stderrLines]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' | ');
    const normalized = evidenceSummary.toLowerCase();

    if (
      normalized.includes('not signed in')
      || normalized.includes('authentication required')
      || normalized.includes('please sign in')
    ) {
      return {
        category: 'auth_required',
        message: 'Antigravity CLI is not signed in. Run agy and complete the sign-in flow.',
        statusCode: 401,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    // agy exits 0 and reports result.status SUCCESS even when every tool was
    // auto-denied and the response came back empty, so this stderr line is the
    // only signal that the permission boundary gutted the turn.
    if (normalized.includes('headless mode cannot prompt for')) {
      return {
        category: 'provider_rejected',
        message: 'Antigravity CLI auto-denied a tool because headless mode cannot prompt for '
          + 'permission.',
        statusCode: 403,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    // No model-rejection branch here on purpose: agy reports an invalid --model
    // on stdout as a `result` envelope with status ERROR and the reason in
    // `error`, not on stderr, so parseResult is what surfaces it.
    return null;
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const text = line.trim();
    if (!text) return null;

    let event: AntigravityNativeEvent;
    try {
      event = JSON.parse(text) as AntigravityNativeEvent;
    } catch {
      return observeRawPassthrough(this.evolutionObserver, {
        rawEventType: 'non_json_line',
        reason: 'stdout_passthrough',
        rawSample: text,
      }, {
        type: 'raw',
        text,
      } satisfies RawStreamEvent);
    }

    if (event.event === 'init') {
      return this.parseInit(event);
    }

    if (event.event === 'step_update') {
      return this.parseStepUpdate(event);
    }

    if (event.event === 'result') {
      return this.parseResult(event);
    }

    return observeUnknown(this.evolutionObserver, {
      rawEventType: typeof event.event === 'string' ? event.event : 'unknown_json',
      rawSample: event,
    }, {
      type: 'raw',
      raw: event,
    } satisfies RawStreamEvent);
  }

  private parseInit(event: AntigravityNativeEvent): StreamEvent {
    const conversationId = asString(event.conversation_id);
    const init = event.init ?? {};
    const cwd = asString(init.cwd);
    const permissionMode = asString(init.permission_mode);
    const toolCount = Array.isArray(init.tools) ? init.tools.length : undefined;

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'init',
      rawSample: event,
    }, {
      type: 'init',
      // The CLI worker reads session identity off `sessionId` on init/result
      // events; `providerSessionId` is the agent-backend field and would leave
      // the worker unable to resume the conversation on a later turn.
      ...(conversationId ? { sessionId: conversationId } : {}),
      metadata: {
        ...(cwd ? { cwd } : {}),
        // Reported, but not trustworthy on its own: with --mode accept-edits agy
        // still reports "request-review" here while writing files without ever
        // asking. The runtime never passes --mode, so this stays descriptive.
        ...(permissionMode ? { reportedPermissionMode: permissionMode } : {}),
        ...(toolCount === undefined ? {} : { toolCount }),
      },
      raw: event,
    } satisfies InitStreamEvent);
  }

  private parseStepUpdate(event: AntigravityNativeEvent): StreamEvent | StreamEvent[] | null {
    const step = event.step_update;
    if (!step) {
      return observeUnknown(this.evolutionObserver, {
        rawEventType: 'step_update:missing_payload',
        rawSample: event,
      }, {
        type: 'raw',
        raw: event,
      } satisfies RawStreamEvent);
    }

    const stepType = asString(step.step_type);

    // Lifecycle bookkeeping. The runtime already tracks turn start and
    // checkpoints itself, so replaying these would double-report.
    // `system_message` only appears on a resumed turn, marking the injected
    // system context; it carries no text, just a step index and a duration.
    if (stepType === 'user_input' || stepType === 'checkpoint' || stepType === 'system_message') {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: `step_update:${stepType}`,
        reason: 'stream_metadata',
        rawSample: event,
      }, null);
    }

    if (stepType === 'agent_response') {
      return this.parseAgentResponse(event, step);
    }

    if (stepType === 'tool') {
      return this.parseToolStep(event, step);
    }

    return observeUnknown(this.evolutionObserver, {
      rawEventType: stepType ? `step_update:${stepType}` : 'step_update:unknown',
      rawSample: event,
    }, {
      type: 'raw',
      raw: event,
    } satisfies RawStreamEvent);
  }

  private parseAgentResponse(
    event: AntigravityNativeEvent,
    step: AntigravityNativeStepUpdate,
  ): StreamEvent | null {
    // text_delta is a true delta: the deltas carried by one step_index
    // concatenate to result.response exactly, so they must never be treated as
    // cumulative snapshots.
    const delta = asString(step.text_delta);
    if (!delta) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'step_update:agent_response',
        reason: 'empty_text_delta',
        rawSample: event,
      }, null);
    }

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'step_update:agent_response',
      rawSample: event,
    }, {
      type: 'text',
      text: delta,
      raw: event,
    } satisfies TextStreamEvent);
  }

  private parseToolStep(
    event: AntigravityNativeEvent,
    step: AntigravityNativeStepUpdate,
  ): StreamEvent[] | null {
    // agy issues no tool call id. The ACTIVE update and the terminal update for
    // one call share a step_index, which is the only stable correlation key.
    const toolId = asString(step.step_index) ?? numberAsString(step.step_index);
    const state = asString(step.state);
    const toolInfo = step.tool_info ?? {};
    const toolName = asString(step.tool_name) ?? asString(toolInfo.name) ?? 'unknown';

    if (state === 'ACTIVE') {
      if (toolId) {
        this.pendingTools.set(toolId, toolName);
      }
      const toolArgs = asRecord(toolInfo.parameters);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'step_update:tool:ACTIVE',
        rawSample: event,
      }, [
        createRuntimeProgressEvent({
          text: `Running Antigravity tool: ${toolName}`,
          provider: 'antigravity',
          backend: 'cli',
          kind: toolName === 'run_command' ? 'command' : 'tool',
          status: 'running',
          source: 'provider',
          native: {
            sourceEvent: 'step_update:tool',
            toolName,
            ...(toolId ? { toolId } : {}),
          },
        }),
        {
          type: 'tool_use',
          toolName,
          ...(toolId ? { toolId } : {}),
          ...(toolArgs ? { toolArgs } : {}),
          raw: event,
        } satisfies ToolUseStreamEvent,
      ]);
    }

    if (state !== 'DONE' && state !== 'ERROR') {
      return observeUnknown(this.evolutionObserver, {
        rawEventType: `step_update:tool:${state ?? 'unknown'}`,
        rawSample: event,
      }, [{
        type: 'raw',
        raw: event,
      } satisfies RawStreamEvent]);
    }

    const resolvedName = (toolId ? this.pendingTools.get(toolId) : undefined) ?? toolName;
    if (toolId) {
      this.pendingTools.delete(toolId);
    }
    const isError = state === 'ERROR';
    // agy 1.1.20 reports no tool output payload on a successful call: the
    // terminal update repeats name and parameters only. A failure carries a
    // message, which is the one piece of result text that can be recovered.
    const errorText = asString(toolInfo.error?.message);

    return observeNormalized(this.evolutionObserver, {
      rawEventType: `step_update:tool:${state}`,
      rawSample: event,
    }, [
      createRuntimeProgressEvent({
        text: isError
          ? `Antigravity tool failed: ${resolvedName}`
          : `Antigravity tool completed: ${resolvedName}`,
        provider: 'antigravity',
        backend: 'cli',
        kind: resolvedName === 'run_command' ? 'command' : 'tool',
        status: isError ? 'failed' : 'completed',
        source: 'provider',
        native: {
          sourceEvent: 'step_update:tool',
          toolName: resolvedName,
          ...(toolId ? { toolId } : {}),
        },
      }),
      {
        type: 'tool_result',
        toolName: resolvedName,
        ...(toolId ? { toolId } : {}),
        ...(errorText ? { text: errorText } : {}),
        ...(isError ? { isError: true } : {}),
        raw: event,
      } satisfies ToolResultStreamEvent,
    ]);
  }

  private parseResult(event: AntigravityNativeEvent): StreamEvent {
    const result = event.result ?? {};
    const conversationId = asString(result.conversation_id) ?? asString(event.conversation_id);
    const status = asString(result.status);
    const response = asString(result.response);
    const usage = result.usage ? normalizeAntigravityUsage(result.usage) : undefined;

    if (status && status !== 'SUCCESS') {
      // A rejected turn still arrives as a `result` envelope on stdout, but with
      // an empty conversation_id, zeroed usage, and the reason in `error` — an
      // invalid --model, for instance, reports the failure plus the list of
      // models it would have accepted. Surfacing it as a terminal error keeps
      // that text instead of reporting an empty successful answer.
      const message = asString(result.error)
        ?? response
        ?? `Antigravity CLI turn ended with status ${status}.`;
      return observeNormalized(this.evolutionObserver, {
        rawEventType: `result:${status}`,
        rawSample: event,
      }, {
        type: 'error',
        text: message,
        ...(conversationId ? { sessionId: conversationId } : {}),
        raw: event,
      } satisfies ErrorStreamEvent);
    }

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'result',
      rawSample: event,
    }, {
      type: 'result',
      ...(conversationId ? { sessionId: conversationId } : {}),
      ...(response ? { text: response } : {}),
      ...(usage ? { usage } : {}),
      raw: event,
    } satisfies ResultStreamEvent);
  }
}

function appendAntigravityPermissionArgs(args: string[], opts: ProviderSpawnOptions): void {
  // agy 1.1.20 offers exactly three permission surfaces, and only two of them
  // are safe to drive from the runtime:
  //
  //   --dangerously-skip-permissions -> permission_mode "always-proceed"
  //   no flag                        -> permission_mode "request-review", which
  //                                     headless auto-denies every tool
  //   --mode accept-edits            -> writes files with no permission request
  //                                     while still reporting "request-review"
  //
  // The third is a silent-write trap, so --mode is never passed.
  if (opts.permissionMode === 'skip') {
    args.push('--dangerously-skip-permissions');
    return;
  }

  if (opts.permissionMode === 'whitelist') {
    // agy's allow-rules live in the shared user settings.json
    // (permissions.allow, e.g. `command(<target>)`). That is process-wide state
    // every concurrent session would read, so the runtime must not rewrite it
    // for one turn. Refuse instead of silently downgrading to skip or default.
    throw new Error(
      'Antigravity CLI 1.1.20 has no per-invocation tool allowlist. Its allow-rules live in '
      + 'the shared user settings.json, which the runtime does not mutate. Use permission '
      + 'mode "skip" or "default" for Antigravity sessions.',
    );
  }

  // "default" leaves agy in request-review, which is fail-safe under headless:
  // every tool is auto-denied and the denial is reported as a TOOL_ERROR step.
}

function normalizeAntigravityUsage(usage: AntigravityNativeUsage): StreamUsage {
  const promptInputTokens = finiteNumber(usage.input_tokens);
  const outputTokens = finiteNumber(usage.output_tokens);
  const cacheReadInputTokens = finiteNumber(usage.cache_read_tokens);

  // Verified across six live turns: total_tokens === input_tokens +
  // output_tokens, and cache_read_tokens is an independent counter that can
  // exceed input_tokens. Folding the cache figure into inputTokens the way the
  // Grok adapter does would overstate every Antigravity turn. thinking_tokens
  // is a subset of output_tokens, so it is not added either.
  return {
    inputTokens: promptInputTokens,
    outputTokens,
    promptInputTokens,
    ...(cacheReadInputTokens ? { cacheReadInputTokens } : {}),
    totalTokens: numberOrUndefined(usage.total_tokens) ?? promptInputTokens + outputTokens,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberAsString(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

function finiteNumber(value: unknown): number {
  return numberOrUndefined(value) ?? 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
