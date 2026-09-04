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

export const MUSE_EXEC_JSON_PROFILE_ID = 'muse-cli-exec-json-1.0.3';

/**
 * `muse exec` is the only headless entry point: the bare `muse` command opens
 * the TUI, and `muse resume` opens the session picker. `--json` turns stdout
 * into the MSP record stream this adapter parses.
 */
export const MUSE_EXEC_JSON_BASE_ARGS = [
  'exec',
  '--json',
] as const;

/**
 * The tool roster muse 1.0.3 can expose to a run, grouped by the only three
 * capability switches the CLI actually enforces. Read tools have no switch at
 * all, which is why they are always reachable and never need an allowlist
 * entry to stay on.
 */
const MUSE_ALWAYS_ON_TOOLS = [
  'read_file',
  'read_memory',
  'read_skill',
  'search',
  'tool_search',
] as const;

const MUSE_WRITE_TOOLS = [
  'add_memory',
  'apply_patch',
  'artifact',
  'edit_file',
  'edit_memory',
  'write_file',
] as const;

const MUSE_SHELL_TOOLS = [
  'bash',
  'bash_input',
  'exec_command',
  'monitor',
  'powershell',
  'powershell_input',
  'shell',
  'write_stdin',
] as const;

const MUSE_WEB_TOOLS = [
  'web_fetch',
  'web_search',
] as const;

const MUSE_TOOL_GROUPS = {
  write: { tools: MUSE_WRITE_TOOLS, disableFlag: '--disable-write' },
  shell: { tools: MUSE_SHELL_TOOLS, disableFlag: '--disable-shell' },
  web: { tools: MUSE_WEB_TOOLS, disableFlag: '--disable-web-tools' },
} as const;

type MuseToolGroupName = keyof typeof MUSE_TOOL_GROUPS;

const MUSE_TOOL_GROUP_BY_TOOL = new Map<string, MuseToolGroupName>(
  (Object.keys(MUSE_TOOL_GROUPS) as MuseToolGroupName[]).flatMap(
    (group) => MUSE_TOOL_GROUPS[group].tools.map((tool) => [tool, group] as const),
  ),
);

const MUSE_ALWAYS_ON_TOOL_SET = new Set<string>(MUSE_ALWAYS_ON_TOOLS);

const MUSE_TOOL_ALIASES: Record<string, string> = {
  bash_tool: 'bash',
  edit: 'edit_file',
  fetch: 'web_fetch',
  glob: 'search',
  grep: 'search',
  patch: 'apply_patch',
  read: 'read_file',
  run_terminal_command: 'shell',
  terminal: 'shell',
  websearch: 'web_search',
  write: 'write_file',
};

/**
 * `--reasoning-effort` is a run-wide argument on both `muse` and `muse exec`;
 * the accepted levels do not vary per model the way Grok's do.
 */
export const MUSE_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;

const MUSE_REASONING_EFFORT_SET = new Set<string>(MUSE_REASONING_EFFORTS);

interface MuseStreamRef {
  kind?: unknown;
  id?: unknown;
}

interface MuseTaskLifecycleEvent {
  kind?: unknown;
  task_id?: unknown;
  task_kind?: unknown;
  operation?: unknown;
  idempotency_key?: unknown;
  message?: unknown;
  chunk?: unknown;
  reason?: unknown;
}

interface MuseToolCorrelationFacts {
  tool_name?: unknown;
  outcome?: unknown;
}

interface MuseRecordPayload {
  kind?: unknown;
  text?: unknown;
  prompt?: unknown;
  terminal?: unknown;
  reason?: unknown;
  call_id?: unknown;
  correlation_facts?: MuseToolCorrelationFacts;
  task_id?: unknown;
  event?: MuseTaskLifecycleEvent;
  model_id?: unknown;
  display_label?: unknown;
  provider_id?: unknown;
}

interface MuseRecord {
  payload_type?: unknown;
  record_type?: unknown;
  sequence?: unknown;
  stream?: MuseStreamRef;
  payload?: MuseRecordPayload;
}

interface PendingMuseTool {
  name: string;
  callId?: string;
  output?: string;
}

export class MuseProvider implements Provider {
  name = 'muse';
  ephemeral = true;
  // `muse exec --session-id <uuid>` replays the prior turns of that session, so
  // resume is a plain argument rather than a separate subcommand. There is no
  // fork counterpart: `session/fork` exists only on the MSP `muse serve` plane,
  // which this adapter does not drive.
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true };

  private pendingPrompt: string | null = null;
  private sessionId: string | null = null;
  private sessionAnnounced = false;
  private readonly pendingTools = new Map<string, PendingMuseTool>();

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.pendingTools.clear();
    this.sessionId = null;
    this.sessionAnnounced = false;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const prompt = this.pendingPrompt;
    if (!prompt) {
      throw new Error('Meta Muse CLI requires prepareEphemeralTurn before building spawn arguments.');
    }
    this.pendingPrompt = null;

    if (opts.forkSession) {
      throw new Error(
        'Meta Muse CLI cannot fork a session: muse exec has no fork argument, and session/fork '
        + 'is only reachable over the MSP host that muse serve exposes.',
      );
    }

    // muse roots the workspace at the process cwd, which the runtime already
    // sets (and translates for the WSL and Docker runners). Passing
    // `--workspace` as well would send an untranslated host path into those.
    const args = [...(this.compatibilityProfile?.spawnBaseArgs ?? MUSE_EXEC_JSON_BASE_ARGS)];

    if (opts.resumeSessionId) {
      args.push('--session-id', opts.resumeSessionId);
    }

    const model = normalizeMuseModelId(opts.model);
    if (model) {
      args.push('--model', model);
    }

    const effort = opts.modelControls?.['muse.reasoning_effort'];
    if (typeof effort === 'string' && effort.trim()) {
      const normalized = effort.trim().toLowerCase();
      if (!MUSE_REASONING_EFFORT_SET.has(normalized)) {
        throw new Error(
          `Unsupported Meta Muse reasoning effort: ${effort}. `
          + `Accepted levels: ${MUSE_REASONING_EFFORTS.join(', ')}.`,
        );
      }
      args.push('--reasoning-effort', normalized);
    }

    appendMusePermissionArgs(args, opts);
    // The prompt is positional, and muse rejects one that starts with `-` as an
    // unknown option ("unknown option -leading dash prompt", exit 0 with a usage
    // line). `--` ends option parsing and is the only thing that makes an
    // arbitrary runtime prompt safe to pass.
    args.push('--', prompt);
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
      normalized.includes('muse login')
      || normalized.includes('not logged in')
      || normalized.includes('no stored credentials')
      || normalized.includes('authentication required')
    ) {
      return {
        category: 'auth_required',
        message: 'Meta Muse CLI is not signed in. Run muse login to authenticate this host.',
        statusCode: 401,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    if (normalized.includes('workspace trust') && normalized.includes('denied')) {
      return {
        category: 'provider_rejected',
        message: 'Meta Muse CLI refused to run in this workspace because trust was denied.',
        statusCode: 400,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    return null;
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const text = line.trim();
    if (!text) return null;

    let record: MuseRecord;
    try {
      record = JSON.parse(text) as MuseRecord;
    } catch {
      // muse writes its startup banner ("workspace root: ...") to stderr, so a
      // non-JSON stdout line is genuinely unexpected and worth surfacing.
      return observeRawPassthrough(this.evolutionObserver, {
        rawEventType: 'non_json_line',
        reason: 'stdout_passthrough',
        rawSample: text,
      }, {
        type: 'raw',
        text,
      } satisfies RawStreamEvent);
    }

    const sessionEvents = this.captureSessionIdentity(record);
    const payloadType = typeof record.payload_type === 'string' ? record.payload_type : '';
    const parsed = this.parseRecord(payloadType, record);

    if (sessionEvents.length === 0) {
      return parsed;
    }
    if (!parsed) {
      return sessionEvents;
    }
    return [...sessionEvents, ...(Array.isArray(parsed) ? parsed : [parsed])];
  }

  /**
   * Every record carries the session it belongs to in its top-level `stream`
   * ref, including the first one. Announcing it as an `init` event means a run
   * that fails halfway still leaves the runtime with an id it can resume.
   */
  private captureSessionIdentity(record: MuseRecord): StreamEvent[] {
    if (this.sessionAnnounced) {
      return [];
    }
    if (record.stream?.kind !== 'session' || typeof record.stream.id !== 'string') {
      return [];
    }

    this.sessionId = record.stream.id;
    this.sessionAnnounced = true;
    return [{
      type: 'init',
      sessionId: record.stream.id,
      raw: record,
    } satisfies InitStreamEvent];
  }

  private parseRecord(payloadType: string, record: MuseRecord): StreamEvent | StreamEvent[] | null {
    const payload = record.payload ?? {};

    switch (payloadType) {
      case 'run.output.delta': {
        const text = typeof payload.text === 'string' ? payload.text : '';
        if (!text) return null;
        return observeNormalized(this.evolutionObserver, {
          rawEventType: payloadType,
          rawSample: record,
        }, {
          type: 'text',
          text,
          raw: record,
        } satisfies TextStreamEvent);
      }

      case 'run.terminal.completed':
        return observeNormalized(this.evolutionObserver, {
          rawEventType: payloadType,
          rawSample: record,
        }, {
          type: 'result',
          // muse repeats the whole answer in the terminal record after having
          // streamed it as deltas. Carrying it again would duplicate the turn
          // text, so only the session identity travels with the result.
          ...(this.sessionId ? { sessionId: this.sessionId } : {}),
          raw: record,
        } satisfies ResultStreamEvent);

      case 'run.terminal.failed':
      case 'run.terminal.cancelled': {
        const reason = typeof payload.reason === 'string' && payload.reason.trim()
          ? payload.reason
          : typeof payload.text === 'string' && payload.text.trim()
            ? payload.text
            : payloadType === 'run.terminal.cancelled'
              ? 'Meta Muse CLI cancelled the run.'
              : 'Meta Muse CLI run failed.';
        return observeNormalized(this.evolutionObserver, {
          rawEventType: payloadType,
          rawSample: record,
        }, {
          type: 'error',
          text: reason,
          raw: record,
        } satisfies ErrorStreamEvent);
      }

      case 'run.model.configured': {
        const label = typeof payload.display_label === 'string'
          ? payload.display_label
          : typeof payload.model_id === 'string'
            ? payload.model_id
            : null;
        if (!label) return null;
        return observeNormalized(this.evolutionObserver, {
          rawEventType: payloadType,
          rawSample: record,
        }, createRuntimeProgressEvent({
          text: `Meta Muse model: ${label}`,
          provider: 'muse',
          backend: 'cli',
          kind: 'status',
          status: 'running',
          source: 'provider',
          native: { sourceEvent: payloadType },
        }));
      }

      case 'task.lifecycle.proposed':
      case 'task.lifecycle.side_effect_intent':
      case 'task.lifecycle.started':
      case 'task.lifecycle.status':
      case 'task.lifecycle.output':
      case 'task.lifecycle.failed':
      case 'task.lifecycle.cancelled':
      case 'task.lifecycle.timed_out':
        return this.parseTaskLifecycle(payloadType, record);

      case 'tool.result':
        return this.parseToolResult(record);

      // Bookkeeping records that carry no turn content: the command intake
      // acknowledgement, the run/task stream links, the echo of the prompt the
      // runtime just sent, and the accepted/scheduled/completed halves of the
      // task lifecycle whose payload adds nothing past what is already emitted.
      case 'runtime.command.accepted':
      case 'session.run.linked':
      case 'task.stream.linked':
      case 'turn.input.user':
      case 'run.lifecycle.started':
      case 'task.lifecycle.accepted':
      case 'task.lifecycle.scheduled':
      case 'task.lifecycle.rejected':
      case 'task.lifecycle.completed':
      case 'task.lifecycle.tool_delta':
      case 'task.lifecycle.tool_output_ref':
      case 'todo.snapshot.updated':
      case 'mcp.startup.diagnostic':
      case 'mcp.startup.task_handle':
      case 'mcp.tool_display_catalog':
        return observeIgnored(this.evolutionObserver, {
          rawEventType: payloadType,
          reason: 'stream_metadata',
          rawSample: record,
        }, null);

      default:
        return observeUnknown(this.evolutionObserver, {
          rawEventType: payloadType || 'unknown_record',
          rawSample: record,
        }, {
          type: 'raw',
          raw: record,
        } satisfies RawStreamEvent);
    }
  }

  /**
   * A muse tool call arrives as a task: `proposed` names it (`tool.<name>`),
   * `side_effect_intent` is the first record carrying the `call_id` that
   * `tool.result` will later quote, and `output` carries the text. Model
   * responses are tasks too (`model.<provider>.response`); those are not tool
   * calls and only their status messages are worth surfacing.
   */
  private parseTaskLifecycle(
    payloadType: string,
    record: MuseRecord,
  ): StreamEvent | StreamEvent[] | null {
    const event = record.payload?.event ?? {};
    const taskId = typeof event.task_id === 'string' ? event.task_id : undefined;

    if (payloadType === 'task.lifecycle.proposed') {
      const toolName = parseMuseToolTaskName(event.task_kind);
      if (!toolName || !taskId) {
        return observeIgnored(this.evolutionObserver, {
          rawEventType: payloadType,
          reason: 'stream_metadata',
          rawSample: record,
        }, null);
      }
      this.pendingTools.set(taskId, { name: toolName });
      return observeNormalized(this.evolutionObserver, {
        rawEventType: payloadType,
        rawSample: record,
      }, createRuntimeProgressEvent({
        text: `Running Meta Muse tool: ${toolName}`,
        provider: 'muse',
        backend: 'cli',
        kind: MUSE_SHELL_TOOLS.includes(toolName as typeof MUSE_SHELL_TOOLS[number])
          ? 'command'
          : 'tool',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: payloadType,
          toolName,
          toolId: taskId,
        },
      }));
    }

    const pending = taskId ? this.pendingTools.get(taskId) : undefined;

    if (payloadType === 'task.lifecycle.side_effect_intent') {
      const callId = parseMuseToolCallId(event.idempotency_key);
      if (pending && callId) {
        pending.callId = callId;
      }
      return observeIgnored(this.evolutionObserver, {
        rawEventType: payloadType,
        reason: 'stream_metadata',
        rawSample: record,
      }, null);
    }

    if (payloadType === 'task.lifecycle.output') {
      const chunk = typeof event.chunk === 'string' ? event.chunk : '';
      if (pending && chunk) {
        pending.output = pending.output ? `${pending.output}${chunk}` : chunk;
      }
      return observeIgnored(this.evolutionObserver, {
        rawEventType: payloadType,
        reason: 'stream_metadata',
        rawSample: record,
      }, null);
    }

    if (payloadType === 'task.lifecycle.status') {
      const message = typeof event.message === 'string' ? event.message.trim() : '';
      if (!message) return null;
      return observeNormalized(this.evolutionObserver, {
        rawEventType: payloadType,
        rawSample: record,
      }, createRuntimeProgressEvent({
        text: message,
        provider: 'muse',
        backend: 'cli',
        kind: pending ? 'tool' : 'reasoning',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: payloadType,
          ...(pending ? { toolName: pending.name } : {}),
          ...(taskId ? { toolId: taskId } : {}),
        },
      }));
    }

    // `started` carries no payload past the task id: the tool was already named
    // by `proposed`, and its result arrives on `tool.result`.
    if (payloadType === 'task.lifecycle.started') {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: payloadType,
        reason: 'stream_metadata',
        rawSample: record,
      }, null);
    }

    // failed / cancelled / timed_out. A tool task that ends this way never
    // reaches `tool.result`, so the failure has to be reported from here or it
    // is lost.
    const outcome = payloadType.slice('task.lifecycle.'.length);
    if (!pending) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: payloadType,
        reason: 'stream_metadata',
        rawSample: record,
      }, null);
    }
    if (taskId) {
      this.pendingTools.delete(taskId);
    }
    const reason = typeof event.reason === 'string' && event.reason.trim()
      ? event.reason.trim()
      : typeof event.message === 'string' && event.message.trim()
        ? event.message.trim()
        : `Meta Muse tool ${outcome}: ${pending.name}`;

    return observeNormalized(this.evolutionObserver, {
      rawEventType: payloadType,
      rawSample: record,
    }, [
      createRuntimeProgressEvent({
        text: reason,
        provider: 'muse',
        backend: 'cli',
        kind: 'tool',
        status: 'failed',
        source: 'provider',
        native: {
          sourceEvent: payloadType,
          toolName: pending.name,
          ...(pending.callId ? { toolId: pending.callId } : {}),
        },
      }),
      {
        type: 'tool_result',
        toolName: pending.name,
        ...(pending.callId ? { toolId: pending.callId } : {}),
        text: reason,
        isError: true,
        raw: record,
      } satisfies ToolResultStreamEvent,
    ]);
  }

  /**
   * `tool.result` is the only record that names the tool and its outcome side
   * by side, so the `tool_use` / `tool_result` pair is emitted here rather than
   * split across the lifecycle records — muse never puts the call arguments on
   * the wire, and emitting `tool_use` earlier would leave it permanently
   * without a name for a task whose `proposed` record was dropped.
   */
  private parseToolResult(record: MuseRecord): StreamEvent[] {
    const payload = record.payload ?? {};
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    const facts = payload.correlation_facts ?? {};
    const toolName = typeof facts.tool_name === 'string' && facts.tool_name
      ? facts.tool_name
      : findPendingToolNameByCallId(this.pendingTools, callId) ?? 'unknown';
    const isError = typeof facts.outcome === 'string' && facts.outcome !== 'success';
    const resultText = typeof payload.text === 'string' && payload.text ? payload.text : undefined;

    for (const [taskId, pending] of this.pendingTools) {
      if (pending.callId && pending.callId === callId) {
        this.pendingTools.delete(taskId);
        break;
      }
    }

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'tool.result',
      rawSample: record,
    }, [
      {
        type: 'tool_use',
        toolName,
        ...(callId ? { toolId: callId } : {}),
        raw: record,
      } satisfies ToolUseStreamEvent,
      {
        type: 'tool_result',
        toolName,
        ...(callId ? { toolId: callId } : {}),
        ...(resultText ? { text: resultText } : {}),
        ...(isError ? { isError: true } : {}),
        raw: record,
      } satisfies ToolResultStreamEvent,
      createRuntimeProgressEvent({
        text: isError
          ? `Meta Muse tool failed: ${toolName}`
          : `Meta Muse tool completed: ${toolName}`,
        provider: 'muse',
        backend: 'cli',
        kind: MUSE_SHELL_TOOLS.includes(toolName as typeof MUSE_SHELL_TOOLS[number])
          ? 'command'
          : 'tool',
        status: isError ? 'failed' : 'completed',
        source: 'provider',
        native: {
          sourceEvent: 'tool.result',
          toolName,
          ...(callId ? { toolId: callId } : {}),
        },
      }),
    ]);
  }
}

/**
 * Approval mode is not an enforcement boundary in `muse exec`: a probe on
 * 1.0.3 wrote a file under `--approval-mode untrusted` exactly as it did under
 * `never`, because a headless run has no reviewer to prompt and resolves its
 * own approvals. The three `--disable-*` switches are what actually removes a
 * capability, so every runtime permission mode is expressed with those and the
 * approval flags only suppress prompting.
 */
function appendMusePermissionArgs(args: string[], opts: ProviderSpawnOptions): void {
  if (opts.permissionMode === 'skip') {
    args.push('--approval-mode', 'never', '--disable-approval');
    return;
  }

  if (opts.permissionMode !== 'whitelist') {
    args.push(
      '--approval-mode', 'never',
      '--disable-approval',
      '--disable-write',
      '--disable-shell',
      '--disable-web-tools',
    );
    return;
  }

  const requested = normalizeMuseAllowedTools(opts.allowedTools ?? []);
  args.push('--approval-mode', 'never', '--disable-approval');
  for (const group of Object.keys(MUSE_TOOL_GROUPS) as MuseToolGroupName[]) {
    const { tools, disableFlag } = MUSE_TOOL_GROUPS[group];
    const enabled = tools.filter((tool) => requested.has(tool));
    if (enabled.length === 0) {
      args.push(disableFlag);
      continue;
    }
    if (enabled.length !== tools.length) {
      throw new Error(
        `Meta Muse CLI 1.0.3 cannot enforce a partial ${group} tool allowlist: ${disableFlag} `
        + `gates ${tools.join(', ')} as one group. Allow all of them or none of them.`,
      );
    }
  }
}

function normalizeMuseAllowedTools(tools: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const tool of tools) {
    const candidate = tool.trim().toLowerCase().replace(/[ -]+/g, '_');
    if (!candidate) continue;
    const resolved = MUSE_TOOL_ALIASES[candidate] ?? candidate;
    if (MUSE_ALWAYS_ON_TOOL_SET.has(resolved)) {
      // Read tools have no switch; naming one is allowed but changes nothing.
      continue;
    }
    if (!MUSE_TOOL_GROUP_BY_TOOL.has(resolved)) {
      throw new Error(`Unsupported Meta Muse tool allowlist entry: ${tool}`);
    }
    normalized.add(resolved);
  }
  return normalized;
}

/**
 * muse silently falls back to the account default when `--model` names an id
 * its catalog does not know (probed on 1.0.3: an invented id produced a normal
 * completed run with `profile_id: null`). Sending the runtime's own
 * "no selection" sentinel would therefore look like a successful selection.
 */
function normalizeMuseModelId(model?: string): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === 'muse-default') {
    return undefined;
  }
  return trimmed;
}

function parseMuseToolTaskName(taskKind: unknown): string | null {
  if (typeof taskKind !== 'string' || !taskKind.startsWith('tool.')) {
    return null;
  }
  const name = taskKind.slice('tool.'.length).trim();
  return name || null;
}

function parseMuseToolCallId(idempotencyKey: unknown): string | null {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.startsWith('tool:')) {
    return null;
  }
  const callId = idempotencyKey.slice('tool:'.length).trim();
  return callId || null;
}

function findPendingToolNameByCallId(
  pendingTools: Map<string, PendingMuseTool>,
  callId: string | undefined,
): string | null {
  if (!callId) return null;
  for (const pending of pendingTools.values()) {
    if (pending.callId === callId) {
      return pending.name;
    }
  }
  return null;
}
