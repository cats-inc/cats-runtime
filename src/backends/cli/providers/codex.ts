import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  PermissionMode,
  ProviderSpawnOptions,
  ProviderExecutionContext,
  ProviderServerRequestContext,
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
import type { SessionMcpServerLaunch } from '../../../core/sessionMcpServers.js';
import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';
import { CodexReadTools, codexReadToolError, grantedCodexReadTools } from './codexReadTools.js';
import { CODEX_INTERACTION_KINDS, CODEX_INTERACTION_METHODS, codexInteractionFallback, codexInteractionKind, mapCodexInteraction } from './codexInteractions.js';
import { assertExecutionPolicyAdmission, type EffectiveExecutionPolicy } from '../../../core/interactions/policy.js';
import type { ProviderSessionCapabilities, SessionToolInventory } from '../../../core/interactions/capabilities.js';
import { assertCodexMcpOverrideNames, codexInteractionWithinPolicy, codexPolicyParameters, inspectCodexConfiguration, verifyCodexPolicy } from './codexPolicy.js';
import { codexInventoryPage, emptyCodexInventory } from './codexInventory.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
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
  capabilities: ProviderCapabilities = {
    resume: true,
    fork: true,
    permissions: true,
    sessionMcpServers: true,
    interactions: { version: 1, kinds: [...CODEX_INTERACTION_KINDS] },
    sessionCapabilities: { version: 1, executionPolicy: true, inventory: true },
  };

  private state: CodexState = 'uninitialized';
  private threadId: string | null = null;
  private nextId = 0;
  private _lastUsage: StreamUsage | null = null;
  private _lastUsageNative: Record<string, unknown> | null = null;
  private _usageTotal: Record<string, number> | null = null;
  private _collectingUsage = true;
  private _usageTurnId: string | null = null;
  private _turnStartRequestId: number | null = null;
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
  private _executionContext: ProviderExecutionContext = {};
  private _readTools: CodexReadTools | null = null;
  private _initializeRequestId: number | null = null;
  private _threadBootstrapId: number | null = null;
  private _readTurnId: string | null = null;
  private _readCallIds = new Set<string>();
  private readonly _interactions = new Map<string, { id: string; resolve(id: string): void }>();
  private _configurationRequestId: number | null = null;
  private _deferredBootstrap: string | null = null;
  private _pendingControl: string | null = null;
  private _configurationSources: string[] = [];
  private _policyObservation: EffectiveExecutionPolicy = { source: 'legacy', status: 'not_observed',
    coverage: 'local-process-only', configurationSources: [] };
  private _inventory: SessionToolInventory = emptyCodexInventory();
  private _inventoryRefresh?: Promise<void>;
  private _capabilityEpoch = 0;

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  configureExecution(context: ProviderExecutionContext): void {
    this._executionContext = { ...context };
  }

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
    assertExecutionPolicyAdmission(opts.executionPolicy, opts);
    this.state = 'uninitialized';
    this.threadId = null;
    this._readTurnId = null;
    this._pendingMessage = null;
    this._interactions.clear();
    this._configurationRequestId = null;
    this._deferredBootstrap = null;
    this._pendingControl = null;
    this._configurationSources = [];
    this._inventory = emptyCodexInventory();
    this._capabilityEpoch++;
    this._inventoryRefresh = undefined;
    this._policyObservation = { source: opts.executionPolicy?.mode ?? 'legacy', status: 'not_observed',
      ...(opts.executionPolicy ? { requested: structuredClone(opts.executionPolicy) } : {}),
      coverage: 'local-process-only', configurationSources: [] };
    this._spawnOpts = { ...opts };
    this._collectingUsage = false;
    this._permissionMode = opts.permissionMode ?? 'skip';
    this._allowedTools = [...(opts.allowedTools || [])];
    this._readTools = grantedCodexReadTools(this._allowedTools).length > 0
      ? new CodexReadTools(opts, this._executionContext.localWorkspaceCwd) : null;

    const args = this.compatibilityProfile?.spawnBaseArgs
      ? [...this.compatibilityProfile.spawnBaseArgs]
      : ['app-server'];

    if (opts.model) {
      args.push('-c', `model=${JSON.stringify(opts.model)}`);
    }
    if (typeof opts.modelControls?.['codex.reasoning_effort'] === 'string') {
      args.push(
        '-c',
        `model_reasoning_effort=${JSON.stringify(opts.modelControls['codex.reasoning_effort'])}`,
      );
    }
    const mcpApproval = !opts.executionPolicy ? 'approve'
      : opts.executionPolicy.mode === 'explicit' ? opts.executionPolicy.approval === 'never' ? 'approve' : 'prompt'
        : null;
    args.push(...buildCodexSessionMcpOverrides(opts.mcpServers ?? [], mcpApproval));

    return args;
  }

  composeLaunchArgs(configuredArgs: readonly string[], spawnArgs: readonly string[]): string[] {
    if (this._spawnOpts?.interactionHost || this._spawnOpts?.executionPolicy) {
      assertCodexMcpOverrideNames(configuredArgs, this._spawnOpts.mcpServers?.map(server => server.name) ?? []);
    }
    const subcommand = spawnArgs.indexOf('app-server');
    if (subcommand < 0) return [...configuredArgs, ...spawnArgs];
    const globalArgs: string[] = [];
    const overrides: string[] = [];
    for (let index = 0; index < configuredArgs.length; index += 1) {
      const arg = configuredArgs[index]!;
      if (arg === '--') {
        globalArgs.push(...configuredArgs.slice(index));
        break;
      }
      if ((arg === '-c' || arg === '--config') && configuredArgs[index + 1]?.includes('=')) {
        overrides.push(arg, configuredArgs[++index]!);
      } else if (arg.startsWith('--config=') || /^-c=?[^=]+=/.test(arg)) {
        overrides.push(arg);
      } else {
        globalArgs.push(arg);
      }
    }
    // App-server does not inherit root-level -c values. Explicit session
    // model/control choices remain last, after the configured defaults.
    return [...globalArgs, ...spawnArgs.slice(0, subcommand + 1),
      ...overrides, ...spawnArgs.slice(subcommand + 1)];
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
      this._initializeRequestId = this.nextId;

      const lines = [
        this.makeRequest('initialize', {
          clientInfo: { name: 'cats-runtime', version: '1.0.0' },
          ...(this._readTools || this._spawnOpts.interactionHost ? { capabilities: {
            experimentalApi: true,
            ...(this._spawnOpts.interactionHost?.kinds.includes('mcp_form') ? { extensions: { 'openai/form': {} } } : {}),
          } } : {}),
        }),
        this.makeNotification('initialized'),
        this.makeRequest(
          this.resolveThreadBootstrapMethod(this._spawnOpts),
          this.buildThreadBootstrapParams(this._spawnOpts),
        ),
      ];

      if (this._spawnOpts.executionPolicy || this._spawnOpts.interactionHost && this._spawnOpts.mcpServers?.length) {
        // Inspect configuration layers before admitting a thread with policy/overlay overrides.
        this._deferredBootstrap = lines.pop()!;
        this._configurationRequestId = this.nextId;
        lines.push(this.makeRequest('config/read', { cwd: this._spawnOpts.cwd, includeLayers: true }));
      }

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
    this._collectingUsage = true;
    this._usageTurnId = null;
    this._lastUsage = null;
    this._lastUsageNative = null;
    this._readTurnId = null;
    this._readCallIds.clear();
    this._interactions.clear();
    this._turnStartRequestId = this.nextId;
    return this.makeRequest('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: content }],
      ...(!this._spawnOpts?.executionPolicy ? { approvalPolicy: policy.approvalPolicy }
        : this._spawnOpts.executionPolicy.mode === 'explicit' ? { approvalPolicy: this._spawnOpts.executionPolicy.approval, approvalsReviewer: 'user' } : {}),
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

  buildInitialization(): string | null {
    if (this.state !== 'uninitialized') return null;
    const message = this.buildStdinMessage('');
    this._pendingMessage = null;
    return message;
  }

  isSessionInitializing(): boolean { return this.state === 'initializing'; }

  getPendingControlMessages(): string | null {
    const message = this._pendingControl;
    this._pendingControl = null;
    return message;
  }

  async readSessionCapabilities(request: (line: string, timeoutMs?: number) => Promise<Record<string, unknown>>,
    refresh: boolean): Promise<ProviderSessionCapabilities> {
    const threadId = this.threadId;
    const epoch = this._capabilityEpoch;
    if (refresh && this.state === 'ready' && threadId && !this._inventoryRefresh) {
      this._inventoryRefresh = (async () => {
        const inventory: SessionToolInventory = { ...emptyCodexInventory(), state: 'observed',
          observedAt: new Date().toISOString(), dynamicTools: this._readTools?.definitions().map(tool => ({ name: tool.name, source: 'runtime-dynamic' })) ?? [] };
        delete inventory.reason;
        const deadline = Date.now() + 10_000;
        const cursors = new Set<string>();
        const names = new Set<string>();
        let cursor: string | undefined;
        try {
          do {
            if (inventory.pages >= 16 || Date.now() >= deadline) throw new Error('bounded discovery');
            const page = codexInventoryPage(await request(JSON.stringify({ jsonrpc: '2.0', id: `cats-runtime-control-${this.nextId++}`,
              method: 'mcpServerStatus/list', params: { threadId, limit: 64, ...(cursor ? { cursor } : {}) } }) + '\n',
            Math.min(5000, deadline - Date.now())), new Set(this._spawnOpts?.mcpServers?.map(server => server.name)));
            inventory.pages++;
            for (const server of page.servers) {
              if (names.has(server.name) || inventory.servers.length >= 128
                || inventory.servers.reduce((count, entry) => count + entry.tools.length, 0) + server.tools.length > 8192) throw new Error('bounded discovery');
              names.add(server.name); inventory.servers.push(server);
              if (server.discovery !== 'advertised') inventory.state = 'partial';
            }
            cursor = page.cursor;
            if (cursor && cursors.has(cursor)) throw new Error('repeated cursor');
            if (cursor) cursors.add(cursor);
          } while (cursor);
        } catch {
          inventory.state = inventory.pages ? 'partial' : 'unavailable';
          inventory.reason = 'provider_discovery_incomplete_or_unavailable';
        }
        if (this._capabilityEpoch === epoch && this.threadId === threadId && this.state === 'ready') this._inventory = inventory;
      })().finally(() => { if (this._capabilityEpoch === epoch) this._inventoryRefresh = undefined; });
    }
    if (refresh) await this._inventoryRefresh;
    const inventory = structuredClone(this._inventory);
    inventory.stale = inventory.observedAt !== null && Date.now() - Date.parse(inventory.observedAt) > 15_000;
    return { interactions: { version: 1, supported: [...CODEX_INTERACTION_KINDS],
      ...(this._spawnOpts?.interactionHost ? { host: structuredClone(this._spawnOpts.interactionHost) } : {}) },
    policy: structuredClone(this._policyObservation), inventory,
    dependencies: (['computer_use', 'browser'] as const).map(kind => ({ kind, status: 'unknown',
      evidence: 'MCP discovery does not verify the upstream desktop/browser helper or permission to use a target.',
      remediation: 'Use the supported Codex host setup, then verify a dedicated test window. Runtime does not own the upstream helper.' })),
    };
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

    if (this._spawnOpts?.interactionHost && CODEX_INTERACTION_METHODS.has(msg.method)) {
      if (this._readTurnId) return null;
      // Out-of-turn discovery cannot ask an unavailable turn owner for input.
      if (!(typeof msg.id === 'string' && msg.id.length > 0 && msg.id.length <= 256
        || typeof msg.id === 'number' && Number.isSafeInteger(msg.id))) throw new Error('Invalid provider interaction identifier.');
      const key = JSON.stringify(msg.id);
      if (this._interactions.has(key)) return null;
      if (this._interactions.size >= 64) throw new Error('Provider interaction request limit exceeded.');
      this._interactions.set(key, { id: '', resolve: () => {} });
      return codexInteractionFallback(msg.method, msg.id);
    }
    if (this._spawnOpts?.executionPolicy && ['applyPatchApproval', 'execCommandApproval'].includes(msg.method)) {
      return this.makeApprovalResponse(msg.id, 'denied');
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

  async buildServerResponse(
    line: string,
    context: ProviderServerRequestContext,
  ): Promise<string | null> {
    let message: Record<string, unknown> | undefined;
    try { message = asRecord(JSON.parse(line)); } catch { return null; }
    if (this._spawnOpts?.interactionHost && message) {
      const params = asRecord(message.params);
      if (message.method === 'serverRequest/resolved' && params?.threadId === this.threadId) {
        const entry = this._interactions.get(JSON.stringify(params.requestId));
        if (entry) entry.resolve(entry.id);
        return null;
      }
      if (typeof message.method === 'string' && CODEX_INTERACTION_METHODS.has(message.method)) {
        const method = message.method;
        const id = message.id;
        if (!(typeof id === 'string' && id.length > 0 && id.length <= 256
          || typeof id === 'number' && Number.isSafeInteger(id))) return null;
        const fallback = () => codexInteractionFallback(method, id);
        const key = JSON.stringify(id);
        // A retransmission shares its original callback; never write two replies.
        if (this._interactions.has(key)) return null;
        if (this._interactions.size >= 64) throw new Error('Provider interaction request limit exceeded.');
        // A handled-ID tombstone includes declined/unsupported requests.
        this._interactions.set(key, { id: '', resolve: () => {} });
        const matchingTurn = params?.turnId === this._readTurnId
          || method === 'mcpServer/elicitation/request' && params?.turnId === null;
        if (!context.interactions || context.signal.aborted || this.state !== 'ready'
          || !this._readTurnId || params?.threadId !== this.threadId || !matchingTurn
          || line.length > 65_536) return fallback();
        const toolApprovals = this._spawnOpts.interactionHost.kinds.includes('tool_approval');
        const unavailable = (reason: string) => {
          const kind = codexInteractionKind(method, params!);
          context.interactions?.unavailable?.(kind === 'tool_approval' && !toolApprovals ? 'mcp_form' : kind, reason);
          return fallback();
        };
        // A UI cannot broaden a host's read-only or whitelist execution boundary.
        const approval = method.includes('requestApproval');
        if (this._spawnOpts.executionPolicy && !codexInteractionWithinPolicy(method, params!,
          this._spawnOpts.executionPolicy, this._spawnOpts.cwd)) return unavailable('host_policy_restriction');
        if (approval && (this._spawnOpts.workspaceMode === 'read_only'
          || this._permissionMode === 'whitelist' && (
            method === 'item/permissions/requestApproval'
            || method === 'item/commandExecution/requestApproval' && this.decideCommandApproval(params) === 'decline'
            || method === 'item/fileChange/requestApproval' && this.decideFileChangeApproval() === 'decline'))) return unavailable('host_policy_restriction');
        try {
          // Older hosts can still answer the native empty form they negotiated.
          const mapped = mapCodexInteraction(method, params!, toolApprovals);
          const runtimeId = context.interactions.request({ prompt: mapped.prompt, deadlineMs: mapped.deadlineMs,
            response: answer => {
              if (answer.action === 'accept' && this._spawnOpts?.executionPolicy && !codexInteractionWithinPolicy(method, params!,
                this._spawnOpts.executionPolicy, this._spawnOpts.cwd)) throw new Error('Interaction admission changed before delivery.');
              if (approval && answer.action === 'accept' && this._spawnOpts?.executionPolicy) this._policyObservation = {
                ...this._policyObservation, status: 'not_observed', reason: 'additional_grants_not_in_bootstrap_observation',
              };
              return method.includes('requestUserInput') && answer.action !== 'accept'
                ? fallback() : JSON.stringify({ jsonrpc: '2.0', id, result: mapped.result(answer) }) + '\n';
            },
            fallback,
          });
          this._interactions.set(key, { id: runtimeId, resolve: context.interactions.resolve });
          return null;
        } catch { return unavailable('unsupported_or_unavailable_interaction'); }
      }
    }
    if (message?.method !== 'item/tool/call') return null;
    const requestId = message.id;
    const validId = (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 256)
      || (typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId >= 0);
    const respond = (result: Awaited<ReturnType<CodexReadTools['execute']>>) => JSON.stringify({
      jsonrpc: '2.0', id: validId ? requestId : null, result,
    }) + '\n';
    if (!validId || line.length > 16_384) {
      return respond(codexReadToolError('Malformed or oversized read-tool request.'));
    }
    const params = asRecord(message.params);
    const threadId = this.threadId;
    const turnId = this._readTurnId;
    if (!this._readTools || this.state !== 'ready' || context.signal.aborted || !threadId || !turnId
      || params?.threadId !== threadId || params.turnId !== turnId) {
      return respond(codexReadToolError('Read request does not belong to an active, admitted thread and turn.'));
    }
    if ((params.namespace !== undefined && params.namespace !== null)
      || typeof params.tool !== 'string' || typeof params.callId !== 'string'
      || !params.callId || params.callId.length > 256) {
      return respond(codexReadToolError('Malformed or foreign read-tool request.'));
    }
    if (this._readCallIds.size >= 64 || this._readCallIds.has(params.callId)) {
      return respond(codexReadToolError('Read request is duplicated or exceeds the per-turn call limit.'));
    }
    this._readCallIds.add(params.callId);
    const result = await this._readTools.execute({
      threadId, callId: params.callId, name: params.tool,
      arguments: params.arguments, signal: context.signal,
    });
    if (context.signal.aborted || this.threadId !== threadId || this._readTurnId !== turnId) {
      return respond(codexReadToolError('Read request is no longer active.'));
    }
    return respond(result);
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
    if (this._configurationRequestId !== null && msg.id === this._configurationRequestId) {
      this._configurationRequestId = null;
      if (msg.error) return this.failBootstrap('Codex configuration evidence is unavailable. No model turn was started.');
      try {
        this._configurationSources = inspectCodexConfiguration(asRecord(msg.result) ?? {}, this._spawnOpts?.mcpServers?.map(server => server.name) ?? []);
        this._policyObservation.configurationSources = [...this._configurationSources];
      } catch (error) {
        return this.failBootstrap(error instanceof Error ? error.message : 'Codex configuration admission failed.');
      }
      this._pendingControl = this._deferredBootstrap ? this._deferredBootstrap + '\n' : null;
      this._deferredBootstrap = null;
      return null;
    }
    if (msg.error) {
      const readBootstrapFailed = this.state === 'initializing' && this._readTools !== null;
      if (this.state === 'initializing') {
        this.state = 'failed';
        this._pendingMessage = null;
        this.threadId = null;
      }
      this._readTurnId = null;

      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'jsonrpc:error',
        rawSample: msg,
      }, {
        type: 'error',
        text: readBootstrapFailed
          ? `Codex read-tool registration failed: ${formatJsonRpcError(msg.error).slice(0, 512)}`
          : formatJsonRpcError(msg.error),
      } satisfies ErrorStreamEvent);
    }

    const result = asRecord(msg.result) ?? {};

    // thread/start|resume|fork response — extract threadId (may be at result.threadId or result.thread.id)
    if (this.state === 'initializing' && !this.threadId) {
      if (msg.id !== this._threadBootstrapId) {
        const initialize = msg.id === this._initializeRequestId;
        return observeIgnored(this.evolutionObserver, {
          rawEventType: initialize ? 'initialize' : 'jsonrpc:response',
          reason: initialize ? 'bootstrap_initialize_response' : 'unrelated_bootstrap_response',
          rawSample: msg,
        }, null);
      }
      const tid = result.threadId ?? asRecord(result.thread)?.id;
      if (typeof tid !== 'string' || !tid.trim()) {
        return this.failBootstrap(this._readTools
          ? 'Codex read-tool registration did not return a valid thread.'
          : 'Codex bootstrap did not return a valid thread. No model turn was started.');
      }
      const policy = this.resolvePermissionPolicy(this._spawnOpts);
      const expectedSandbox = policy.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite';
      const sandboxType = asRecord(result.sandbox)?.type;
      if (this._spawnOpts?.executionPolicy) {
        this._policyObservation = verifyCodexPolicy(this._spawnOpts.executionPolicy, result, this._spawnOpts.cwd, this._configurationSources);
        if (this._policyObservation.status !== 'verified') return this.failBootstrap('Codex effective execution policy does not satisfy host admission. No model turn was started.');
      } else if (sandboxType !== expectedSandbox || result.approvalPolicy !== policy.approvalPolicy) {
        // Only report known discriminants, never arbitrary provider response contents.
        const observedSandbox = sandboxType === 'readOnly' || sandboxType === 'workspaceWrite'
          || sandboxType === 'dangerFullAccess' || sandboxType === 'externalSandbox'
          ? sandboxType : 'missing/unsupported';
        const approval = result.approvalPolicy;
        const observedApproval = approval === 'never' || approval === 'untrusted'
          || approval === 'on-request' || approval === 'on-failure' ? approval : 'missing/unsupported';
        const setupHint = policy.sandbox === 'workspace-write' && sandboxType === 'readOnly'
          ? ' The selected Codex profile may need sandbox setup. On native Windows, check windows.sandbox and complete the chosen sandbox setup.'
          : '';
        return this.failBootstrap(`Codex effective permission mismatch: requested ${policy.sandbox}`
          + ` / ${policy.approvalPolicy}, received ${observedSandbox} / ${observedApproval}.`
          + ' No model turn was started. Check the provider permission configuration before recreating the session.'
          + setupHint);
      }
      if (!this._spawnOpts?.executionPolicy) this._policyObservation = { ...this._policyObservation,
        status: 'not_observed', reason: 'legacy_policy_has_partial_coverage' };
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

    if (msg.id === this._turnStartRequestId) {
      const turnId = asRecord(result.turn)?.id;
      if (typeof turnId === 'string') {
        this._usageTurnId = turnId;
        this._readTurnId = turnId;
      }
    }

    // turn/start response or other — consume
    return observeIgnored(this.evolutionObserver, {
      rawEventType: 'jsonrpc:response',
      reason: 'response_consumed',
      rawSample: msg,
    }, null);
  }

  private failBootstrap(text: string): ErrorStreamEvent {
    this.state = 'failed';
    this._pendingMessage = null;
    this.threadId = null;
    this._readTurnId = null;
    this._pendingControl = null;
    this._deferredBootstrap = null;
    if (this._policyObservation.status === 'not_observed') this._policyObservation = {
      ...this._policyObservation, status: 'unsupported', reason: 'session_admission_failed',
    };
    return { type: 'error', text };
  }

  private handleNotification(msg: JsonRpcResponse): StreamEvent | StreamEvent[] | null {
    const method = msg.method!;
    const params = msg.params ?? {};

    // Resolve in wire order, before a subsequent turn/completed aborts its signal.
    if (method === 'serverRequest/resolved' && params.threadId === this.threadId) {
      const key = JSON.stringify(params.requestId);
      const entry = this._interactions.get(key);
      if (entry) {
        entry.resolve(entry.id);
        this._interactions.set(key, { id: '', resolve: () => {} });
      }
    }

    // SPEC-035 connection evidence, reported only for this session's own servers.
    if (method === 'mcpServer/startupStatus/updated') {
      const name = typeof params.name === 'string' ? params.name : undefined;
      const status = typeof params.status === 'string' ? params.status : undefined;
      if (!name || !status || !this._spawnOpts?.mcpServers?.some((server) => server.name === name)) {
        return observeIgnored(this.evolutionObserver, {
          rawEventType: method,
          reason: 'not_a_session_mcp_server',
          rawSample: msg,
        }, null);
      }
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, {
        ...createRuntimeProgressEvent({
          text: `MCP server ${name}: ${status}`,
          kind: 'mcp_servers',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
        }),
        mcpServers: [{ name, status }],
      });
    }

    // Only the correlated bootstrap response confirms the effective permission mode.
    if (method === 'thread/started') {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: method,
        reason: 'notification_does_not_confirm_permissions',
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

    if (method === 'turn/started'
      && (!this.threadId || !params.threadId || params.threadId === this.threadId)) {
      const turnId = asRecord(params.turn)?.id;
      if (typeof turnId === 'string') {
        this._collectingUsage = true;
        this._usageTurnId = turnId;
        if (params.threadId === this.threadId && this.state === 'ready') this._readTurnId = turnId;
      }
    }

    // A native turn can make several model requests; `last` is only the newest request.
    if (method === 'thread/tokenUsage/updated') {
      const tokenUsage = asRecord(params.tokenUsage);
      const last = asRecord(tokenUsage?.last);
      const total = readCodexTokenCounters(asRecord(tokenUsage?.total));
      const differentThread = this.threadId && params.threadId && params.threadId !== this.threadId;
      const differentTurn = this._usageTurnId && params.turnId && params.turnId !== this._usageTurnId;
      if (!differentThread && !differentTurn) {
        const delta = last ? codexTokenUsageDelta(last, total, this._usageTotal) : undefined;
        this._usageTotal = total;
        // Resume/bootstrap notifications can contain historical usage. Seed the checkpoint
        // without charging it, including notifications before the new turn is acknowledged.
        const awaitingTurn = this._spawnOpts && params.turnId && !this._usageTurnId;
        if (delta && this._collectingUsage && !awaitingTurn) {
          this._lastUsage = addCodexTokenUsage(this._lastUsage, delta);
          this._lastUsageNative = buildCodexTokenUsageNative(tokenUsage);
        }
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
      this._readTurnId = null;
      const usage = this._lastUsage ?? undefined;
      const usageNative = this._lastUsageNative;
      const quota = this._lastRateLimits;
      this._lastUsage = null;
      this._lastUsageNative = null;
      this._collectingUsage = false;
      this._usageTurnId = null;
      this._turnStartRequestId = null;
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
      this._readTurnId = null;
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
      || method === 'tool/requestUserInput'
      || method === 'mcpServer/elicitation/request'
      || method === 'serverRequest/resolved'
      || method === 'applyPatchApproval'
      || method === 'execCommandApproval'
      || method === 'item/tool/call'
    ) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: method,
        reason: 'server_request_handled',
        // Questions, form values and one-time URLs must not enter evidence logs.
        rawSample: { method },
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
      const progress = createCodexProgressEvent({
        text: formatCodexModelRerouteText(reroute.fromModel, reroute.toModel),
        kind: 'model_state',
        status: 'updated',
        native: {
          sourceEvent: method,
          ...(reroute.fromModel ? { fromModel: reroute.fromModel } : {}),
          ...(reroute.toModel ? { toModel: reroute.toModel } : {}),
        },
      });
      // Codex otherwise only echoes the requested model; a reroute is the one
      // time it says another model served the turn.
      return observeNormalized(this.evolutionObserver, {
        rawEventType: method,
        rawSample: msg,
      }, reroute.toModel
        ? { ...progress, reportedModels: [{ model: reroute.toModel, matchesRequest: false }] }
        : progress);
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
    this._threadBootstrapId = this.nextId;
    const policy = this.resolvePermissionPolicy(opts);
    const params: Record<string, unknown> = {
      cwd: opts.cwd,
      ...(opts.executionPolicy ? codexPolicyParameters(opts.executionPolicy)
        : { approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox }),
    };
    if (this._readTools) {
      params.dynamicTools = this._readTools.definitions();
    }

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

  private makeApprovalResponse(id: number | string, decision: CodexApprovalDecision): string {
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
const CODEX_TOKEN_COUNTERS = [
  'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'totalTokens',
] as const;

function readCodexTokenCounters(value: Record<string, unknown> | undefined): Record<string, number> | null {
  if (!value) return null;
  const counters: Record<string, number> = {};
  for (const key of CODEX_TOKEN_COUNTERS) {
    const count = finiteNumber(value[key]);
    if (count !== undefined && count >= 0) counters[key] = count;
  }
  return counters.inputTokens !== undefined && counters.outputTokens !== undefined ? counters : null;
}

function codexTokenUsageDelta(
  last: Record<string, unknown>,
  total: Record<string, number> | null,
  previous: Record<string, number> | null,
): StreamUsage {
  // The first observed total may include a resumed/forked thread's history. Its
  // last request is the only new usage known at that boundary. A native counter
  // reset (for example after compaction) also starts a new checkpoint.
  if (!total || !previous || CODEX_TOKEN_COUNTERS.some((key) =>
    total[key] !== undefined && previous[key] !== undefined && total[key]! < previous[key]!,
  )) return normalizeCodexTokenUsage(last);
  const delta: Record<string, unknown> = {};
  for (const key of CODEX_TOKEN_COUNTERS) {
    delta[key] = total[key] !== undefined && previous[key] !== undefined
      ? total[key]! - previous[key]!
      : last[key];
  }
  return normalizeCodexTokenUsage(delta);
}

function addCodexTokenUsage(current: StreamUsage | null, delta: StreamUsage): StreamUsage {
  if (!current) return delta;
  const sum: StreamUsage = {
    inputTokens: current.inputTokens + delta.inputTokens,
    outputTokens: current.outputTokens + delta.outputTokens,
  };
  for (const key of ['promptInputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'totalTokens'] as const) {
    if (current[key] !== undefined && delta[key] !== undefined) sum[key] = current[key]! + delta[key]!;
  }
  return sum;
}

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

/**
 * SPEC-035: configure each session MCP server for app-server. The bearer is read
 * from the named environment variable. Explicit interactive policy prompts for
 * every call; legacy/never approves only the injected server's tools. Provider
 * mode leaves the native approval setting inherited (null).
 */
export function buildCodexSessionMcpOverrides(servers: readonly SessionMcpServerLaunch[], approval: 'approve' | 'prompt' | null = 'approve'): string[] {
  return servers.flatMap((server) => [
    '-c', `mcp_servers.${server.name}.url=${JSON.stringify(server.url)}`,
    ...(server.bearerTokenEnvVar
      ? ['-c', `mcp_servers.${server.name}.bearer_token_env_var=${JSON.stringify(server.bearerTokenEnvVar)}`]
      : []),
    ...(approval ? ['-c', `mcp_servers.${server.name}.default_tools_approval_mode=${JSON.stringify(approval)}`] : []),
  ]);
}
