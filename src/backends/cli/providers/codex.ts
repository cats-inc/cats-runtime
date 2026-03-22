import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  PermissionMode,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import { mergeRuntimeSkillInstructions } from '../../../core/skills/catalog.js';

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
  approvalPolicy: 'never' | 'untrusted' | { reject: {
    sandbox_approval: boolean;
    rules: boolean;
    mcp_elicitations: boolean;
  } };
  sandbox: 'read-only' | 'workspace-write';
}

export class CodexProvider implements Provider {
  name = 'codex';
  capabilities: ProviderCapabilities = { resume: true, fork: true, permissions: true };

  private state: CodexState = 'uninitialized';
  private threadId: string | null = null;
  private nextId = 0;
  private _lastUsage: { inputTokens: number; outputTokens: number } | null = null;
  private _pendingMessage: string | null = null;
  private _spawnOpts: ProviderSpawnOptions | null = null;
  private _permissionMode: PermissionMode = 'skip';
  private _allowedTools: string[] = [];

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
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

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    if (this.state === 'failed') {
      throw new Error('Codex session bootstrap failed earlier. Close and recreate the session.');
    }

    const compiledInstructions = mergeRuntimeSkillInstructions(turn?.instructions, turn?.skills);
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

  parseStreamLine(line: string): StreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return { type: 'raw', text: trimmed };
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

    return { type: 'raw' };
  }

  private handleResponse(msg: JsonRpcResponse): StreamEvent | null {
    if (msg.error) {
      if (this.state === 'initializing') {
        this.state = 'failed';
        this._pendingMessage = null;
        this.threadId = null;
      }

      return {
        type: 'error',
        text: formatJsonRpcError(msg.error),
      };
    }

    const result = msg.result ?? {};

    // thread/start|resume|fork response — extract threadId (may be at result.threadId or result.thread.id)
    if (this.state === 'initializing' && !this.threadId) {
      const tid = (result.threadId as string)
        ?? ((result.thread as Record<string, unknown> | undefined)?.id as string);
      if (tid) {
        this.threadId = tid;
        this.state = 'ready';
        return { type: 'init', sessionId: tid };
      }
      // No threadId — this is the initialize response, consume internally
      return null;
    }

    // turn/start response or other — consume
    return null;
  }

  private handleNotification(msg: JsonRpcResponse): StreamEvent | null {
    const method = msg.method!;
    const params = msg.params ?? {};

    // thread/started notification — extract threadId as fallback
    if (method === 'thread/started') {
      const thread = params.thread as Record<string, unknown> | undefined;
      if (thread?.id && !this.threadId) {
        this.threadId = thread.id as string;
        this.state = 'ready';
        return { type: 'init', sessionId: this.threadId };
      }
      return null;
    }

    // Streaming text delta
    if (method === 'item/agentMessage/delta') {
      return {
        type: 'text',
        text: (params.delta as string) ?? '',
      };
    }

    // Item started — only emit tool_use for actual tool items
    if (method === 'item/started') {
      const item = params.item as Record<string, unknown> | undefined;
      const itemType = item?.type as string | undefined;

      const toolTypes = [
        'commandExecution', 'fileChange', 'mcpToolCall',
        'dynamicToolCall', 'collabAgentToolCall', 'webSearch',
      ];
      if (itemType && toolTypes.includes(itemType)) {
        const toolName = (item?.command as string)
          ?? (item?.tool as string)
          ?? (item?.name as string)
          ?? itemType;
        return { type: 'tool_use', toolName, toolId: item?.id as string };
      }
      // agentMessage, reasoning, plan, etc. — consume silently
      return null;
    }

    // Token usage arrives separately from turn/completed
    if (method === 'thread/tokenUsage/updated') {
      const tokenUsage = params.tokenUsage as Record<string, unknown> | undefined;
      const last = tokenUsage?.last as Record<string, unknown> | undefined;
      if (last) {
        this._lastUsage = {
          inputTokens: (last.inputTokens as number) ?? 0,
          outputTokens: (last.outputTokens as number) ?? 0,
        };
      }
      return null;
    }

    // Turn completed — attach cached usage if available
    if (method === 'turn/completed') {
      const usage = this._lastUsage ?? undefined;
      this._lastUsage = null;
      return { type: 'result', usage };
    }

    // Turn failed
    if (method === 'turn/failed') {
      return { type: 'error', text: JSON.stringify(params) };
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
      return null;
    }

    // Informational notifications — consume silently
    if (
      method === 'turn/started'
      || method === 'item/completed'
      || method === 'item/commandExecution/outputDelta'
      || method === 'item/plan/delta'
      || method === 'item/reasoning/summaryTextDelta'
      || method === 'item/reasoning/textDelta'
      || method === 'turn/diff/updated'
      || method === 'turn/plan/updated'
      || method === 'thread/status/changed'
      || method === 'thread/compacted'
      || method === 'model/rerouted'
      || method === 'deprecationNotice'
      || method === 'configWarning'
      || method === 'error'
    ) {
      return null;
    }

    // Unknown notification — pass through as raw
    return { type: 'raw' };
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
        approvalPolicy: {
          reject: {
            sandbox_approval: true,
            rules: true,
            mcp_elicitations: true,
          },
        },
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
