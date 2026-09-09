import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  PermissionMode,
  ProviderSpawnOptions,
  TurnInput,
} from './types.js';
import type {
  ErrorStreamEvent,
  InitStreamEvent,
  ProgressStreamEvent,
  RawStreamEvent,
  ResultStreamEvent,
  StreamEvent,
  StreamUsage,
  TextStreamEvent,
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
import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  method?: string;
  params?: Record<string, unknown>;
}

type CodexState = 'uninitialized' | 'initializing' | 'ready' | 'failed';

type CodexApprovalDecision = 'accept' | 'decline' | 'approved' | 'denied';

interface CodexPermissionPolicy {
  approvalPolicy: 'never' | 'untrusted';
  sandbox: 'read-only' | 'workspace-write';
}

const CODEX_TOOL_ITEM_TYPES = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'webSearch',
]);

export class CodexProvider implements Provider {
  name = 'codex';
  capabilities: ProviderCapabilities = { resume: true, fork: true, permissions: true };

  private state: CodexState = 'uninitialized';
  private threadId: string | null = null;
  private nextId = 0;
  private _lastUsage: StreamUsage | null = null;
  private _lastUsageNative: Record<string, unknown> | null = null;
  /**
   * Latest account rate-limit snapshot from `account/rateLimits/updated`. Codex emits it once
   * per turn right after `thread/tokenUsage/updated`, so `turn/completed` can carry it as
   * `metadata.runtimeUsage.quota`. The CLI holds the credentials; the runtime only reads the
   * notification it already sends.
   */
  private _lastRateLimits: Record<string, string | number | boolean> | null = null;
  private _pendingMessage: string | null = null;
  private _spawnOpts: ProviderSpawnOptions | null = null;
  private _permissionMode: PermissionMode = 'skip';
  private _allowedTools: string[] = [];

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  private makeRequest(method: string, params?: Record<string, unknown>): string {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
    };
    if (params) req.params = params;
    return JSON.stringify(req);
  }

  private makeNotification(method: string, params?: Record<string, unknown>): string {
    const req: Omit<JsonRpcRequest, 'id'> & { jsonrpc: '2.0'; method: string } = {
      jsonrpc: '2.0',
      method,
    };
    if (params) (req as Record<string, unknown>).params = params;
    return JSON.stringify(req);
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    this._spawnOpts = { ...opts };
    this._permissionMode = opts.permissionMode ?? 'skip';
    this._allowedTools = [...(opts.allowedTools || [])];

    const args = this.compatibilityProfile?.spawnBaseArgs
      ? [...this.compatibilityProfile.spawnBaseArgs]
      : ['app-server'];

    if (opts.model) {
      args.push('-c', `model="${opts.model}"`);
    }
    if (typeof opts.modelControls?.['codex.reasoning_effort'] === 'string') {
      args.push(
        '-c',
        `model_reasoning_effort="${opts.modelControls['codex.reasoning_effort']}"`,
      );
    }

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    if (this.state === 'failed') {
      throw new Error('Codex session bootstrap failed earlier. Close and recreate the session.');
    }

    const compiledInstructions = mergeRuntimeInstructionLayers(
      turn?.skills,
      turn?.sessionInstructions,
      turn?.instructions,
    );
    const effectiveContent = compiledInstructions
      ? ['Instructions:', compiledInstructions, '', 'User message:', content].join('\n')
      : content;

    if (this.state === 'uninitialized') {
      if (!this._spawnOpts) {
        throw new Error('Codex provider spawn options were not initialized');
      }

      // Pipeline: initialize + initialized + thread/start|resume|fork + turn/start
      this.state = 'initializing';

      const lines = [
        this.makeRequest('initialize', {
          clientInfo: { name: 'cats-runtime', version: '1.0.0' },
        }),
        this.makeNotification('initialized'),
        this.makeRequest(
          this.resolveThreadBootstrapMethod(this._spawnOpts),
          this.buildThreadBootstrapParams(this._spawnOpts),
        ),
      ];

      // We need the threadId for turn/start, but since we're pipelining,
      // we'll send turn/start after receiving thread/start response.
      // Store the pending message for later.
      this._pendingMessage = effectiveContent;
      return lines.join('\n') + '\n';
    }

    if (this.state === 'initializing') {
      // Still waiting for init — queue message
      this._pendingMessage = effectiveContent;
      return '';
    }

    // Ready state — send turn/start directly
    return this.makeTurnStart(effectiveContent) + '\n';
  }

  private makeTurnStart(content: string): string {
    if (!this.threadId) {
      throw new Error('Codex thread is not ready yet');
    }

    const policy = this.resolvePermissionPolicy(this._spawnOpts);
    return this.makeRequest('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: content }],
      approvalPolicy: policy.approvalPolicy,
    });
  }

  /** Returns a pending turn/start message if init completed, or null */
  getPendingTurnStart(): string | null {
    if (this.state === 'ready' && this._pendingMessage !== null) {
      const msg = this.makeTurnStart(this._pendingMessage) + '\n';
      this._pendingMessage = null;
      return msg;
    }
    return null;
  }

  buildAutoResponse(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return null;
    }

    if (!msg.method || msg.id === undefined) {
      return null;
    }

    if (msg.method === 'item/commandExecution/requestApproval') {
      const decision = this.decideCommandApproval(msg.params);
      return this.makeApprovalResponse(msg.id, decision);
    }

    if (msg.method === 'item/fileChange/requestApproval') {
      const decision = this.decideFileChangeApproval();
      return this.makeApprovalResponse(msg.id, decision);
    }

    if (msg.method === 'item/permissions/requestApproval') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          permissions: this._permissionMode === 'skip' ? this.buildGrantedPermissions(msg.params) : {},
        },
      }) + '\n';
    }

    if (msg.method === 'item/tool/requestUserInput') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { answers: {} },
      }) + '\n';
    }

    if (msg.method === 'mcpServer/elicitation/request') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          action: 'decline',
          content: null,
          _meta: null,
        },
      }) + '\n';
    }

    if (msg.method === 'applyPatchApproval') {
      const decision = this.decideFileChangeApproval() === 'accept' ? 'approved' : 'denied';
      return this.makeApprovalResponse(msg.id, decision);
    }

    if (msg.method === 'execCommandApproval') {
      const decision = this.decideCommandApproval(msg.params) === 'accept' ? 'approved' : 'denied';
      return this.makeApprovalResponse(msg.id, decision);
    }

    return null;
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return observeRawPassthrough(this.evolutionObserver, {
        reason: 'non_json_line',
        rawSample: trimmed,
      }, {
        type: 'raw',
        text: trimmed,
      } satisfies RawStreamEvent);
    }

    // JSON-RPC response (has id, no method)
    if (msg.id !== undefined && !msg.method) {
      return this.handleResponse(msg);
    }

    // JSON-RPC notification or server request (has method)
    // Server requests (approval etc.) have both id AND method — they are
    // auto-approved by buildAutoResponse before parseStreamLine is called
    if (msg.method) {
      return this.handleNotification(msg);
    }

    return observeRawPassthrough(this.evolutionObserver, {
      reason: 'unclassified_json_rpc_frame',
      rawSample: msg,
    }, {
      type: 'raw',
    } satisfies RawStreamEvent);
  }

  private handleResponse(msg: JsonRpcResponse): StreamEvent | null {
    if (msg.error) {
      if (this.state === 'initializing') {
        this.state = 'failed';
        this._pendingMessage = null;
        this.threadId = null;
      }

      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'jsonrpc:error',
        rawSample: msg,
      }, {
        type: 'error',
        text: formatJsonRpcError(msg.error),
      } satisfies ErrorStreamEvent);
    }

    const result = msg.result ?? {};

    // thread/start|resume|fork response — extract threadId (may be at result.threadId or result.thread.id)
    if (this.state === 'initializing' && !this.threadId) {
      const tid = (result.threadId as string)
        ?? ((result.thread as Record<string, unknown> | undefined)?.id as string);
      if (tid) {
        this.threadId = tid;
        this.state = 'ready';
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'thread/start',
          rawSample: msg,
        }, {
          type: 'init',
          sessionId: tid,
        } satisfies InitStreamEvent);
      }
      // No threadId — this is the initialize response, consume internally
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'initialize',
        reason: 'bootstrap_initialize_response',
        rawSample: msg,
      }, null);
    }

    // turn/start response or other — consume
    return observeIgnored(this.evolutionObserver, {
      rawEventType: 'jsonrpc:response',
      reason: 'response_consumed',
      rawSample: msg,
    }, null);
  }

  private handleNotification(msg: JsonRpcResponse): StreamEvent | StreamEvent[] | null {
    const method = msg.method!;
    const params = msg.params ?? {};

    // thread/started notification — extract threadId as fallback
    if (method === 'thread/started') {
      const thread = params.thread as Record<string, unknown> | undefined;
      if (thread?.id && !this.threadId) {
        this.threadId = thread.id as string;
        this.state = 'ready';
        return observeNormalized(this.evolutionObserver, {
          rawEventType: method,
          rawSample: msg,
        }, {
          type: 'init',
          sessionId: this.threadId,
        } satisfies InitStreamEvent);
      }
      return observeSchemaFailure(this.evolutionObserver, {
        rawEventType: method,
        reason: 'missing_thread_id',
        rawSample: msg,
      }, null);
    }

    // Streaming text delta
    if (method === 'item/agentMessage/delta') {
      if (typeof params.delta !== 'string') {
        this.evolutionObserver?.recordSchemaFailure({
          rawEventType: method,
          reason: 'missing_delta',
          rawSample: msg,
        });
      }
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, {
        type: 'text',
        text: (params.delta as string) ?? '',
      } satisfies TextStreamEvent);
    }

    // Item started — only emit tool_use for actual tool items
    if (method === 'item/started') {
      const item = params.item as Record<string, unknown> | undefined;
      const itemType = item?.type as string | undefined;
      if (itemType && CODEX_TOOL_ITEM_TYPES.has(itemType)) {
        const toolName = (item?.command as string)
          ?? (item?.tool as string)
          ?? (item?.name as string)
          ?? itemType;
        return observeNormalized(this.evolutionObserver, {
          rawEventType: `${method}:${itemType}`,
          rawSample: msg,
        }, [
          createCodexProgressEvent({
            text: formatCodexItemStartedText(itemType, toolName),
            kind: resolveCodexToolItemProgressKind(itemType),
            status: 'started',
            native: {
              sourceEvent: method,
              itemType,
              toolName,
              itemId: item?.id,
            },
          }),
          {
            type: 'tool_use',
            toolName,
            toolId: item?.id as string,
          } satisfies ToolUseStreamEvent,
        ]);
      }
      // agentMessage, reasoning, plan, etc. — consume silently
      return observeIgnored(this.evolutionObserver, {
        rawEventType: `${method}:${itemType || 'unknown'}`,
        reason: 'non_tool_item',
        rawSample: msg,
      }, null);
    }

    // Token usage arrives separately from turn/completed
    if (method === 'thread/tokenUsage/updated') {
      const tokenUsage = asRecord(params.tokenUsage);
      const last = asRecord(tokenUsage?.last);
      if (last) {
        this._lastUsage = normalizeCodexTokenUsage(last);
        this._lastUsageNative = buildCodexTokenUsageNative(tokenUsage);
      }
      return observeIgnored(this.evolutionObserver, {
        rawEventType: method,
        reason: 'token_usage_cache_update',
        rawSample: msg,
      }, null);
    }

    // Account rate limits arrive once per turn, right after token usage
    if (method === 'account/rateLimits/updated') {
      const snapshot = normalizeCodexRateLimits(asRecord(params.rateLimits));
      if (!snapshot) {
        return observeIgnored(this.evolutionObserver, {
          rawEventType: method,
          reason: 'rate_limits_without_snapshot',
          rawSample: msg,
        }, null);
      }

      this._lastRateLimits = snapshot.quota;
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: snapshot.text,
        kind: 'quota',
        status: snapshot.status,
        native: {
          sourceEvent: method,
          rateLimits: params.rateLimits,
        },
        details: {
          quota: snapshot.quota,
        },
      }));
    }

    // Turn completed — attach cached usage plus the latest quota snapshot if available
    if (method === 'turn/completed') {
      const usage = this._lastUsage ?? undefined;
      const usageNative = this._lastUsageNative;
      const quota = this._lastRateLimits;
      this._lastUsage = null;
      this._lastUsageNative = null;
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, {
        type: 'result',
        usage,
        ...(quota || usageNative
          ? {
            metadata: {
              ...(quota ? { runtimeUsage: { quota } } : {}),
              ...(usageNative ? { native: { sourceEvent: method, tokenUsage: usageNative } } : {}),
            },
          }
          : {}),
      } satisfies ResultStreamEvent);
    }

    // Turn failed
    if (method === 'turn/failed') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, {
        type: 'error',
        text: JSON.stringify(params),
      } satisfies ErrorStreamEvent);
    }

    // Auto-approve requests are handled by buildAutoResponse
    if (
      method === 'item/commandExecution/requestApproval'
      || method === 'item/fileChange/requestApproval'
      || method === 'item/permissions/requestApproval'
      || method === 'item/tool/requestUserInput'
      || method === 'mcpServer/elicitation/request'
      || method === 'applyPatchApproval'
      || method === 'execCommandApproval'
    ) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: method,
        reason: 'auto_approved_request',
        rawSample: msg,
      }, null);
    }

    if (method === 'item/completed') {
      const item = asRecord(params.item);
      const itemType = readNonEmptyString(item?.type, params.itemType);
      const progressEvent = itemType
        ? createCodexItemCompletedProgressEvent(itemType, item, method)
        : null;
      if (progressEvent) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: `${method}:${itemType}`,
          rawSample: msg,
        }, progressEvent);
      }
      return observeIgnored(this.evolutionObserver, {
        rawEventType: `${method}:${itemType || 'unknown'}`,
        reason: 'non_actionable_item_completion',
        rawSample: msg,
      }, null);
    }

    if (method === 'item/commandExecution/outputDelta') {
      const outputDelta = extractCodexDeltaText(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: outputDelta || 'Codex emitted command output.',
        kind: 'command',
        status: 'running',
        native: {
          sourceEvent: method,
          hasOutputDelta: Boolean(outputDelta),
        },
      }));
    }

    if (method === 'item/plan/delta') {
      const planDelta = extractCodexDeltaText(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: planDelta || 'Codex updated the plan.',
        kind: 'plan',
        status: 'running',
        native: {
          sourceEvent: method,
          hasPlanDelta: Boolean(planDelta),
        },
      }));
    }

    if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      const reasoningDelta = extractCodexDeltaText(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: reasoningDelta || 'Codex updated reasoning.',
        kind: 'reasoning',
        status: 'running',
        native: {
          sourceEvent: method,
          hasReasoningDelta: Boolean(reasoningDelta),
        },
      }));
    }

    if (method === 'turn/diff/updated') {
      const fileCount = countCodexDiffFiles(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: fileCount === undefined
          ? 'Codex updated proposed file changes.'
          : `Codex updated proposed file changes (${fileCount} files).`,
        kind: 'files',
        status: 'updated',
        native: {
          sourceEvent: method,
          ...(fileCount === undefined ? {} : { fileCount }),
        },
      }));
    }

    if (method === 'turn/plan/updated') {
      const stepCount = countCodexPlanSteps(params);
      const planSummary = extractCodexPlanSummary(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: planSummary
          || (stepCount === undefined
            ? 'Codex updated the plan.'
            : `Codex updated the plan (${stepCount} steps).`),
        kind: 'plan',
        status: 'updated',
        native: {
          sourceEvent: method,
          ...(stepCount === undefined ? {} : { stepCount }),
        },
      }));
    }

    if (method === 'thread/status/changed') {
      const status = extractCodexThreadStatus(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: status ? `Codex session status changed to ${status}.` : 'Codex session status changed.',
        kind: 'session',
        status: 'updated',
        native: {
          sourceEvent: method,
          ...(status ? { threadStatus: status } : {}),
        },
      }));
    }

    if (method === 'model/rerouted') {
      const reroute = extractCodexModelReroute(params);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, createCodexProgressEvent({
        text: formatCodexModelRerouteText(reroute.fromModel, reroute.toModel),
        kind: 'model_state',
        status: 'updated',
        native: {
          sourceEvent: method,
          ...(reroute.fromModel ? { fromModel: reroute.fromModel } : {}),
          ...(reroute.toModel ? { toModel: reroute.toModel } : {}),
        },
      }));
    }

    // Informational notifications — consume silently
    if (
      method === 'turn/started'
      || method === 'thread/compacted'
      || method === 'deprecationNotice'
      || method === 'configWarning'
      || method === 'error'
    ) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: method,
        reason: 'informational_notification',
        rawSample: msg,
      }, null);
    }

    // Unknown notification — pass through as raw
    return observeUnknown(this.evolutionObserver, {
      rawEventType: method,
      reason: 'unknown_codex_notification',
      rawSample: msg,
    }, {
      type: 'raw',
    } satisfies RawStreamEvent);
  }

  private resolveThreadBootstrapMethod(opts: ProviderSpawnOptions): string {
    if (opts.resumeSessionId && opts.forkSession) {
      return 'thread/fork';
    }

    if (opts.resumeSessionId) {
      return 'thread/resume';
    }

    return 'thread/start';
  }

  private buildThreadBootstrapParams(opts: ProviderSpawnOptions): Record<string, unknown> {
    const policy = this.resolvePermissionPolicy(opts);
    const params: Record<string, unknown> = {
      cwd: opts.cwd,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
    };

    if (!opts.resumeSessionId) {
      params.experimentalRawEvents = false;
    } else {
      params.threadId = opts.resumeSessionId;
    }

    if (opts.model) {
      params.model = opts.model;
    }

    return params;
  }

  private resolvePermissionPolicy(opts: ProviderSpawnOptions | null): CodexPermissionPolicy {
    const workspaceMode = opts?.workspaceMode ?? 'shared';
    const permissionMode = opts?.permissionMode ?? 'skip';

    const sandbox = workspaceMode === 'read_only' ? 'read-only' : 'workspace-write';
    if (permissionMode === 'skip') {
      return {
        approvalPolicy: 'never',
        sandbox,
      };
    }

    if (permissionMode === 'default') {
      return {
        approvalPolicy: 'never',
        sandbox,
      };
    }

    return {
      approvalPolicy: 'untrusted',
      sandbox,
    };
  }

  private decideCommandApproval(params: Record<string, unknown> | undefined): 'accept' | 'decline' {
    if (this._permissionMode === 'skip') {
      return 'accept';
    }

    if (this._permissionMode === 'default') {
      return 'decline';
    }

    const command = typeof params?.command === 'string' ? params.command : '';
    const candidates = [
      'commandExecution',
      'command',
      command,
      firstCommandToken(command),
    ];
    return this.matchesAllowedTool(candidates) ? 'accept' : 'decline';
  }

  private decideFileChangeApproval(): 'accept' | 'decline' {
    if (this._permissionMode === 'skip') {
      return 'accept';
    }

    if (this._permissionMode === 'default') {
      return 'decline';
    }

    return this.matchesAllowedTool(['fileChange', 'file_change', 'apply_patch', 'write'])
      ? 'accept'
      : 'decline';
  }

  private makeApprovalResponse(id: number, decision: CodexApprovalDecision): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: { decision },
    }) + '\n';
  }

  private buildGrantedPermissions(params: Record<string, unknown> | undefined): Record<string, unknown> {
    const permissions = params?.permissions as Record<string, unknown> | undefined;
    const granted: Record<string, unknown> = {};

    if (permissions?.network) {
      granted.network = permissions.network;
    }
    if (permissions?.fileSystem) {
      granted.fileSystem = permissions.fileSystem;
    }
    if (permissions?.macos) {
      granted.macos = permissions.macos;
    }

    return granted;
  }

  private matchesAllowedTool(candidates: Array<string | null | undefined>): boolean {
    const allowed = new Set(
      this._allowedTools
        .map(normalizeAllowedToken)
        .filter(Boolean),
    );

    if (!allowed.size) {
      return false;
    }
    if (allowed.has('*')) {
      return true;
    }

    return candidates
      .map(normalizeAllowedToken)
      .filter(Boolean)
      .some((candidate) => allowed.has(candidate));
  }
}

function firstCommandToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/, 1)[0] ?? '';
}

function normalizeAllowedToken(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9*]+/g, '');
}

function formatJsonRpcError(error: NonNullable<JsonRpcResponse['error']>): string {
  const message = typeof error.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Unknown JSON-RPC error';

  if (typeof error.code === 'number') {
    return `Codex JSON-RPC error ${error.code}: ${message}`;
  }

  return `Codex JSON-RPC error: ${message}`;
}

function createCodexProgressEvent(input: {
  text: string;
  kind: 'plan' | 'reasoning' | 'tool' | 'command' | 'files' | 'model_state' | 'quota' | 'session';
  status: 'started' | 'running' | 'updated' | 'completed' | 'blocked';
  native: Record<string, unknown>;
  details?: Record<string, unknown>;
}): ProgressStreamEvent {
  return createRuntimeProgressEvent({
    text: input.text,
    provider: 'codex',
    backend: 'cli',
    kind: input.kind,
    status: input.status,
    source: 'provider',
    native: input.native,
    ...(input.details ? { details: input.details } : {}),
  });
}

function createCodexItemCompletedProgressEvent(
  itemType: string,
  item: Record<string, unknown> | undefined,
  sourceEvent: string,
): StreamEvent | null {
  const kind = resolveCodexItemProgressKind(itemType);
  if (!kind) {
    return null;
  }

  const toolName = resolveCodexItemToolName(itemType, item);
  return createCodexProgressEvent({
    text: formatCodexItemCompletedText(itemType, toolName),
    kind,
    status: 'completed',
    native: {
      sourceEvent,
      itemType,
      ...(toolName ? { toolName } : {}),
      ...(item?.id ? { itemId: item.id } : {}),
    },
  });
}

function resolveCodexToolItemProgressKind(
  itemType: string,
): 'tool' | 'command' | 'files' {
  if (itemType === 'commandExecution') {
    return 'command';
  }
  if (itemType === 'fileChange') {
    return 'files';
  }
  return 'tool';
}

function resolveCodexItemProgressKind(
  itemType: string,
): 'tool' | 'command' | 'files' | 'reasoning' | 'plan' | null {
  if (CODEX_TOOL_ITEM_TYPES.has(itemType)) {
    return resolveCodexToolItemProgressKind(itemType);
  }
  if (itemType === 'reasoning') {
    return 'reasoning';
  }
  if (itemType === 'plan') {
    return 'plan';
  }
  return null;
}

function resolveCodexItemToolName(
  itemType: string,
  item: Record<string, unknown> | undefined,
): string | undefined {
  if (itemType === 'reasoning' || itemType === 'plan') {
    return undefined;
  }
  return readNonEmptyString(item?.command, item?.tool, item?.name, itemType);
}

function formatCodexItemStartedText(itemType: string, toolName: string): string {
  if (itemType === 'commandExecution') {
    return `Codex started command: ${toolName}`;
  }
  if (itemType === 'fileChange') {
    return `Codex started file update: ${toolName}`;
  }
  if (itemType === 'webSearch') {
    return `Codex started web search: ${toolName}`;
  }
  return `Codex started tool: ${toolName}`;
}

function formatCodexItemCompletedText(itemType: string, toolName: string | undefined): string {
  if (itemType === 'reasoning') {
    return 'Codex completed reasoning.';
  }
  if (itemType === 'plan') {
    return 'Codex completed the current plan step.';
  }
  if (itemType === 'commandExecution') {
    return toolName ? `Codex completed command: ${toolName}` : 'Codex completed a command.';
  }
  if (itemType === 'fileChange') {
    return toolName ? `Codex completed file update: ${toolName}` : 'Codex completed a file update.';
  }
  if (itemType === 'webSearch') {
    return toolName ? `Codex completed web search: ${toolName}` : 'Codex completed a web search.';
  }
  return toolName ? `Codex completed tool: ${toolName}` : 'Codex completed a tool.';
}

function extractCodexDeltaText(params: Record<string, unknown>): string | undefined {
  const delta = asRecord(params.delta);
  const output = asRecord(params.output);
  const chunk = asRecord(params.chunk);
  return readNonEmptyString(
    params.delta,
    params.text,
    params.summaryText,
    params.outputDelta,
    params.stdout,
    delta?.text,
    delta?.delta,
    output?.text,
    output?.delta,
    chunk?.text,
    chunk?.delta,
  );
}

function extractCodexPlanSummary(params: Record<string, unknown>): string | undefined {
  const plan = asRecord(params.plan);
  return readNonEmptyString(
    params.summary,
    params.title,
    plan?.summary,
    plan?.title,
    plan?.currentStep,
  );
}

function countCodexDiffFiles(params: Record<string, unknown>): number | undefined {
  const diff = asRecord(params.diff);
  return firstArrayLength(
    diff?.files,
    params.files,
    params.updatedFiles,
    params.changedFiles,
  );
}

function countCodexPlanSteps(params: Record<string, unknown>): number | undefined {
  const plan = asRecord(params.plan);
  return firstArrayLength(plan?.steps, params.steps);
}

function extractCodexThreadStatus(params: Record<string, unknown>): string | undefined {
  const thread = asRecord(params.thread);
  return readNonEmptyString(params.status, thread?.status);
}

function extractCodexModelReroute(
  params: Record<string, unknown>,
): { fromModel?: string; toModel?: string } {
  const previousModel = asRecord(params.previousModel);
  const nextModel = asRecord(params.nextModel);
  return {
    fromModel: readNonEmptyString(
      params.fromModel,
      params.previousModel,
      params.sourceModel,
      previousModel?.name,
      previousModel?.id,
    ),
    toModel: readNonEmptyString(
      params.toModel,
      params.model,
      params.targetModel,
      nextModel?.name,
      nextModel?.id,
    ),
  };
}

function formatCodexModelRerouteText(fromModel?: string, toModel?: string): string {
  if (fromModel && toModel) {
    return `Codex rerouted from ${fromModel} to ${toModel}.`;
  }
  if (toModel) {
    return `Codex rerouted to model ${toModel}.`;
  }
  if (fromModel) {
    return `Codex rerouted away from model ${fromModel}.`;
  }
  return 'Codex rerouted to a different model.';
}

function readNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function firstArrayLength(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Codex counts cached prompt tokens inside `inputTokens`, which matches the Claude adapter's
 * "full prompt" `inputTokens`; `promptInputTokens` is the uncached remainder. Observed on
 * codex-cli 0.153.4; see docs/research/2026-09-10-claude-codex-rate-limit-signal-probe.md.
 */
function normalizeCodexTokenUsage(last: Record<string, unknown>): StreamUsage {
  const inputTokens = finiteNumber(last.inputTokens) ?? 0;
  const outputTokens = finiteNumber(last.outputTokens) ?? 0;
  const cacheReadInputTokens = finiteNumber(last.cachedInputTokens);
  const cacheCreationInputTokens = finiteNumber(last.cacheWriteInputTokens);
  const totalTokens = finiteNumber(last.totalTokens);

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadInputTokens === undefined
      ? {}
      : {
        promptInputTokens: Math.max(0, inputTokens - cacheReadInputTokens),
        cacheReadInputTokens,
      }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function buildCodexTokenUsageNative(
  tokenUsage: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const total = asRecord(tokenUsage?.total);
  const modelContextWindow = finiteNumber(tokenUsage?.modelContextWindow);
  if (!total && modelContextWindow === undefined) {
    return null;
  }

  return {
    ...(total ? { total } : {}),
    ...(modelContextWindow === undefined ? {} : { modelContextWindow }),
  };
}

interface CodexQuotaSnapshot {
  quota: Record<string, string | number | boolean>;
  status: 'updated' | 'blocked';
  text: string;
}

/**
 * Flatten an app-server `RateLimitSnapshot` into the runtime quota contract. Only rate-limit
 * facts are kept: window usage, reset times, plan, credits, and reached / spend-control flags.
 * Account identifiers that ride along on the read response are deliberately not copied.
 */
function normalizeCodexRateLimits(
  rateLimits: Record<string, unknown> | undefined,
): CodexQuotaSnapshot | null {
  if (!rateLimits) {
    return null;
  }

  const quota: Record<string, string | number | boolean> = {
    source: 'codex.account/rateLimits/updated',
    observedAt: new Date().toISOString(),
  };
  const limitId = readNonEmptyString(rateLimits.limitId);
  const limitName = readNonEmptyString(rateLimits.limitName);
  const planType = readNonEmptyString(rateLimits.planType);
  const rateLimitReachedType = readNonEmptyString(rateLimits.rateLimitReachedType);
  if (limitId) {
    quota.limitId = limitId;
  }
  if (limitName) {
    quota.limitName = limitName;
  }
  if (planType) {
    quota.planType = planType;
  }
  if (rateLimitReachedType) {
    quota.rateLimitReachedType = rateLimitReachedType;
  }
  if (typeof rateLimits.spendControlReached === 'boolean') {
    quota.spendControlReached = rateLimits.spendControlReached;
  }

  const windows: string[] = [];
  for (const name of ['primary', 'secondary'] as const) {
    const window = asRecord(rateLimits[name]);
    if (!window) {
      continue;
    }
    const usedPercent = finiteNumber(window.usedPercent);
    const windowDurationMins = finiteNumber(window.windowDurationMins);
    const resetsAt = unixSecondsToIso(window.resetsAt);
    if (usedPercent !== undefined) {
      quota[`${name}.usedPercent`] = usedPercent;
    }
    if (windowDurationMins !== undefined) {
      quota[`${name}.windowDurationMins`] = windowDurationMins;
    }
    if (resetsAt) {
      quota[`${name}.resetsAt`] = resetsAt;
    }
    if (usedPercent !== undefined) {
      const windowLabel = windowDurationMins === undefined
        ? ''
        : ` of ${windowDurationMins}-minute window`;
      windows.push(
        `${name} ${usedPercent}% used${windowLabel}${resetsAt ? ` (resets ${resetsAt})` : ''}`,
      );
    }
  }

  const credits = asRecord(rateLimits.credits);
  if (credits) {
    if (typeof credits.hasCredits === 'boolean') {
      quota['credits.hasCredits'] = credits.hasCredits;
    }
    if (typeof credits.unlimited === 'boolean') {
      quota['credits.unlimited'] = credits.unlimited;
    }
    const balance = readNonEmptyString(credits.balance);
    if (balance) {
      quota['credits.balance'] = balance;
    }
  }

  // Only `source` and `observedAt` means the notification carried no rate-limit facts.
  if (Object.keys(quota).length === 2) {
    return null;
  }

  const blocked = Boolean(rateLimitReachedType) || rateLimits.spendControlReached === true;
  const headline = rateLimitReachedType
    ? `Codex rate limit reached (${rateLimitReachedType})`
    : 'Codex rate limit';
  const planLabel = planType ? `plan ${planType}` : '';
  const text = windows.length > 0
    ? `${headline}: ${windows.join(', ')}${planLabel ? `; ${planLabel}` : ''}.`
    : `${headline}${planLabel ? `: ${planLabel}` : ''}.`;

  return { quota, status: blocked ? 'blocked' : 'updated', text };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}
