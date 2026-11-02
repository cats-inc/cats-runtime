import { randomBytes } from 'node:crypto';
import type { Provider, ProviderCapabilities, ProviderExecutionContext, ProviderServerRequestContext,
  ProviderSpawnOptions, StreamEvent, TurnInput } from './types.js';
import type { ProviderSessionCapabilities } from '../../../core/interactions/capabilities.js';
import type { EffectiveExecutionPolicy } from '../../../core/interactions/policy.js';
import { record } from '../../../core/interactions/validation.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { compileRuntimeTurnPrompt } from './prompt.js';
import { mapMuseApproval, mapMuseUserInput, MUSE_INTERACTION_KINDS } from './museInteractions.js';
import { museHostedPolicy, MUSE_ADMISSIBLE_CEILINGS, observeMusePolicy } from './musePolicy.js';
import { sameHostedWorkspace } from './hostedWorkspace.js';

/** MSP command ids are UUIDv7, separate from connection-scoped JSON-RPC ids. */
function commandId(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function frame(line: string): Record<string, unknown> | undefined {
  try { return record(JSON.parse(line)); } catch { return undefined; }
}

interface PendingRequest { method: string; commandId?: string; }
interface PendingInteraction { input: Record<string, unknown>; interactionId: string; key: string; }
interface Item { kind: string; tool?: string; text: string; revision: number; completed: boolean; }

/** Stable MSP over a single owned `muse serve` process; profile observation is feature negotiated. */
export class MuseMspProvider implements Provider {
  name = 'muse';
  readonly sessionMcpTransport = 'stdin' as const;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true,
    sessionMcpServers: true, interactions: { version: 1, kinds: MUSE_INTERACTION_KINDS },
    sessionCapabilities: { version: 1, executionPolicy: true, inventory: true, admissibleCeilings: MUSE_ADMISSIBLE_CEILINGS } };
  private options!: ProviderSpawnOptions;
  private context: ProviderExecutionContext = {};
  private state: 'uninitialized' | 'initializing' | 'ready' | 'failed' = 'uninitialized';
  private sessionId?: string;
  private turnId?: string;
  private nextId = 1;
  private pendingPrompt: string | null = null;
  private pendingControl: string | null = null;
  private pendingTurn = false;
  private sandboxAvailable = false;
  private policy!: EffectiveExecutionPolicy;
  private requests = new Map<string, PendingRequest>();
  private interactions = new Map<string, PendingInteraction>();
  private settledInteractions = new Set<string>();
  private items = new Map<string, Item>();

  configureExecution(context: ProviderExecutionContext): void { this.context = context; }

  buildSpawnArgs(options: ProviderSpawnOptions): string[] {
    const policy = museHostedPolicy(options);
    if (options.forkSession) throw new Error('Muse hosted session fork is not implemented.');
    if (!this.context.localWorkspaceCwd) throw new Error('Muse hosted execution requires a native local workspace.');
    this.options = structuredClone(options);
    this.state = 'uninitialized'; this.sessionId = undefined; this.turnId = undefined;
    this.pendingPrompt = null; this.pendingControl = null; this.pendingTurn = false;
    this.requests.clear(); this.interactions.clear(); this.settledInteractions.clear(); this.items.clear();
    this.policy = { source: options.executionPolicy!.mode, requested: structuredClone(options.executionPolicy!),
      status: 'not_observed', coverage: 'local-process-only', configurationSources: [] };
    return ['serve', ...(options.model ? ['--model', options.model] : []), ...policy.args];
  }

  composeLaunchArgs(configuredArgs: readonly string[], spawnArgs: readonly string[]): string[] {
    const prefix: string[] = [];
    const overrides: string[] = [];
    for (let index = 0; index < configuredArgs.length; index++) {
      const arg = configuredArgs[index]!;
      if (/^--(?:disable-sandbox|sandbox-network|disable-write|disable-shell|no-session-log|listen|join|client-started|trust-workspace)(?:=|$)/u.test(arg)) {
        throw new Error('Configured Muse arguments conflict with the admitted hosted execution policy.');
      }
      if (['--provider', '--preset', '-c', '--config'].includes(arg)) {
        const value = configuredArgs[++index];
        if (!value) throw new Error('Configured Muse option requires a value.');
        overrides.push(arg, value);
      } else {
        prefix.push(arg);
      }
    }
    return [...prefix, 'serve', ...overrides, ...spawnArgs.slice(1)];
  }

  private request(method: string, params: Record<string, unknown> = {}, command = false): string {
    const id = `cats-muse-${this.nextId++}`;
    const handle = command ? commandId() : undefined;
    this.requests.set(id, { method, ...(handle ? { commandId: handle } : {}) });
    return JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, ...(handle ? { commandId: handle } : {}) } }) + '\n';
  }

  buildInitialization(): string | null {
    if (this.state !== 'uninitialized') return null;
    this.state = 'initializing';
    return this.request('initialize', { clientInfo: { name: 'cats_runtime', version: '1.0.0' },
      capabilities: { requestedCapabilities: ['sessionMcp'], experimentalApi: true,
        userInputDialogs: this.options.interactionHost?.kinds.includes('user_input') === true } });
  }

  isSessionInitializing(): boolean { return this.state === 'initializing'; }
  isSessionFailed(): boolean { return this.state === 'failed'; }
  getPendingControlMessages(): string | null {
    const message = this.pendingControl; this.pendingControl = null; return message;
  }
  getPendingTurnStart(): string | null {
    if (this.state !== 'ready' || this.pendingPrompt === null) return null;
    const prompt = this.pendingPrompt; this.pendingPrompt = null; return this.startTurn(prompt);
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    if (this.state === 'failed') throw new Error('Muse session initialization failed; close and recreate it.');
    const prompt = compileRuntimeTurnPrompt(content, turn);
    if (this.state !== 'ready') {
      if (this.pendingPrompt !== null) throw new Error('Muse initialization already has a pending turn.');
      this.pendingPrompt = prompt;
      return this.buildInitialization() ?? '';
    }
    return this.startTurn(prompt);
  }

  private startTurn(prompt: string): string {
    if (this.pendingTurn || this.turnId) throw new Error('Muse session already has an active turn.');
    this.items.clear(); this.interactions.clear(); this.settledInteractions.clear(); this.pendingTurn = true;
    const effort = this.options.modelControls?.['muse.reasoning_effort'];
    return this.request('turn/start', { sessionId: this.sessionId, ifBusy: 'queue',
      input: [{ type: 'text', text: prompt }], ...(typeof effort === 'string' ? { reasoningEffort: effort } : {}) }, true);
  }

  private sessionParams(): Record<string, unknown> {
    const mcpServers = Object.fromEntries((this.options.mcpServers ?? []).map(server => {
      const token = server.bearerTokenEnvVar ? this.context.sessionMcpToken?.(server.bearerTokenEnvVar) : undefined;
      if (server.bearerTokenEnvVar && !token) throw new Error('Muse session MCP authentication is unavailable.');
      return [server.name, { transport: 'streamableHttp', url: server.url,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), mode: 'required' }];
    }));
    return { ...(this.options.resumeSessionId ? { sessionId: this.options.resumeSessionId, excludeItems: true }
      : { workspaceRoots: [this.options.cwd] }), ...(this.options.model ? { modelId: this.options.model } : {}),
      config: { mcpServers } };
  }

  private fail(reason: string): StreamEvent {
    this.state = 'failed'; this.pendingPrompt = null; this.pendingControl = null; this.pendingTurn = false;
    this.turnId = undefined;
    return { type: 'error', text: reason };
  }

  private reply(id: string, result: Record<string, unknown> | undefined, error: unknown): StreamEvent | null {
    const pending = this.requests.get(id);
    if (!pending) return null;
    this.requests.delete(id);
    if (error || !result) return this.fail(`Muse rejected ${pending.method}; no action was retried.`);
    if (pending.commandId && ['turn/start', 'session/setApprovalMode', 'approval/decide', 'userInput/answer', 'userInput/cancel'].includes(pending.method)
      && result.commandId !== pending.commandId) return this.fail('Muse returned a mismatched command identity.');
    switch (pending.method) {
      case 'initialize':
        if (result.experimentalApi !== true || !Array.isArray(result.grantedCapabilities)
          || this.options.mcpServers?.length && !result.grantedCapabilities.includes('sessionMcp')) {
          return this.fail('Muse does not expose the required session tools and permission-profile capabilities.');
        }
        this.sandboxAvailable = result.sandboxAvailability === 'available';
        this.pendingControl = JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n'
          + this.request('permissionProfile/list');
        return null;
      case 'permissionProfile/list': {
        this.pendingControl = this.options.mcpServers?.length ? this.request('mcpServer/list')
          : this.request(this.options.resumeSessionId ? 'session/resume' : 'session/start', this.sessionParams(), true);
        return null;
      }
      case 'mcpServer/list':
        if (!Array.isArray(result.servers) || result.servers.some(value => {
          const server = record(value);
          return !server || typeof server.name !== 'string' || this.options.mcpServers?.some(injected => injected.name === server.name);
        })) return this.fail('Session MCP names conflict with native Muse configuration or could not be inspected.');
        this.pendingControl = this.request(this.options.resumeSessionId ? 'session/resume' : 'session/start', this.sessionParams(), true);
        return null;
      case 'session/start':
      case 'session/resume': {
        const session = record(result.session);
        if (!session || typeof session.sessionId !== 'string' || !sameHostedWorkspace(this.options.cwd, session.workspaceRoot) || session.activeTurnId != null
          || this.options.resumeSessionId && session.sessionId !== this.options.resumeSessionId
          || Array.isArray(result.pendingRequests) && result.pendingRequests.length) {
          return this.fail('Muse could not attach an idle native session; the previous work was not replayed.');
        }
        this.sessionId = session.sessionId;
        return this.ready(session);
      }
      case 'turn/start':
        if (result.disposition !== 'started' || result.status !== 'accepted' || typeof result.turnId !== 'string'
          || this.turnId && this.turnId !== result.turnId) return this.fail('Muse did not admit exactly one new turn.');
        this.turnId = result.turnId; this.pendingTurn = false; return null;
      default: return null; // Decision acknowledgements are not provider resolution.
    }
  }

  private ready(session: Record<string, unknown>): StreamEvent {
    this.policy = observeMusePolicy(this.options, session, this.sandboxAvailable);
    if (this.policy.status !== 'verified') return this.fail('Muse effective permissions do not match the admitted policy; no prompt was sent.');
    this.state = 'ready';
    return { type: 'init', sessionId: this.sessionId,
      mcpServers: (this.options.mcpServers ?? []).map(server => ({ name: server.name, status: 'unknown' })) };
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const input = frame(line);
    if (!input) return null;
    if (typeof input.id === 'string' && !input.method) return this.reply(input.id, record(input.result), input.error);
    const params = record(input.params);
    if (!params || params.sessionId !== this.sessionId) return null;
    if (input.method === 'turn/started' && this.pendingTurn && typeof params.turnId === 'string') {
      this.turnId = params.turnId; return null;
    }
    if (!this.turnId) return null;
    if (input.method === 'turn/completed' && params.turnId === this.turnId) {
      this.turnId = undefined; this.pendingTurn = false;
      if (params.terminal !== 'completed') return { type: 'error', text: params.terminal === 'cancelled' ? 'Muse turn cancelled.' : 'Muse turn failed.' };
      const usage = record(params.usage);
      return { type: 'result', sessionId: this.sessionId, ...(usage ? { usage: {
        inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
        outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
      } } : {}) };
    }
    if (input.method === 'item/delta' && typeof params.itemId === 'string' && typeof params.delta === 'string') {
      const item = this.items.get(params.itemId);
      if (!item || item.completed || params.field !== undefined && params.field !== 'text') return null;
      item.text += params.delta;
      return item.kind === 'agentMessage' ? { type: 'text', text: params.delta }
        : item.kind === 'reasoning' ? createRuntimeProgressEvent({ text: params.delta, provider: 'muse', backend: 'cli',
          kind: 'reasoning', status: 'running', source: 'provider' }) : null;
    }
    if (!['item/started', 'item/updated', 'item/completed'].includes(String(input.method))) return null;
    const item = record(params.item);
    if (!item || item.turnId !== this.turnId || typeof item.itemId !== 'string' || typeof item.kind !== 'string') return null;
    const previous = this.items.get(item.itemId);
    if (previous?.completed || this.items.size >= 8192 && !previous) return null;
    const completed = input.method === 'item/completed';
    const text = typeof item.text === 'string' ? item.text : previous?.text ?? '';
    const tool = typeof item.tool === 'string' ? item.tool : previous?.tool;
    this.items.set(item.itemId, { kind: item.kind, tool, text, revision: Number(item.revision) || 0, completed });
    if (item.kind === 'agentMessage') {
      const suffix = text.startsWith(previous?.text ?? '') ? text.slice(previous?.text.length ?? 0) : '';
      return suffix ? { type: 'text', text: suffix } : null;
    }
    if (item.kind === 'toolCall' && tool) {
      const toolId = typeof item.callId === 'string' ? item.callId : item.itemId;
      if (completed) return { type: 'tool_result', toolName: tool, toolId,
        text: typeof item.visibleOutput === 'string' ? item.visibleOutput : text, isError: item.status === 'failed' };
      if (!previous) {
        let args: Record<string, unknown> | undefined;
        if (typeof item.args === 'string') { try { args = record(JSON.parse(item.args)); } catch { /* Unknown tool inputs stay unclaimed. */ } }
        return { type: 'tool_use', toolName: tool, toolId, ...(args ? { toolArgs: args } : {}) };
      }
    }
    return null; // Never forward raw configuration, MCP headers or historical frames.
  }

  buildAutoResponse(line: string): string | null {
    const input = frame(line);
    if (!input?.method || input.id === undefined) return null;
    const params = record(input.params);
    const key = typeof params?.approvalId === 'string' ? `approval:${params.approvalId}`
      : typeof params?.userInputId === 'string' ? `input:${params.userInputId}` : undefined;
    if (this.turnId && record(input.params)?.sessionId === this.sessionId
      && record(input.params)?.turnId === this.turnId && (!key || !this.settledInteractions.has(key))
      && ['approval/request', 'userInput/request'].includes(String(input.method))) return null;
    // Requests reissued during resume cannot be rebound to a new Runtime turn.
    return JSON.stringify({ jsonrpc: '2.0', id: input.id,
      error: { code: -32601, message: 'No active Runtime turn can handle this request.' } }) + '\n';
  }

  async buildServerResponse(line: string, context: ProviderServerRequestContext): Promise<string | null> {
    const input = frame(line);
    const params = record(input?.params);
    if (!input || !params || params.sessionId !== this.sessionId) return null;
    const method = input.method;
    const approval = method === 'approval/request' || method === 'approval/updated';
    const key = typeof params.approvalId === 'string' ? `approval:${params.approvalId}`
      : typeof params.userInputId === 'string' ? `input:${params.userInputId}` : undefined;
    if (!key) return null;
    const previous = this.interactions.get(key);
    if (method === 'approval/resolved' || method === 'userInput/settled') {
      if (previous) context.interactions?.resolve(previous.interactionId);
      this.settledInteractions.add(key); this.interactions.delete(key);
      return null;
    }
    if (!approval && method !== 'userInput/request') return null;
    if (!this.turnId || context.signal.aborted || this.settledInteractions.has(key)) return null;
    const merged = method === 'approval/updated' && previous ? { ...previous.input, ...params } : params;
    if (merged.turnId !== this.turnId) return null;
    const acknowledgement = input.id !== undefined
      ? JSON.stringify({ jsonrpc: '2.0', id: input.id, result: {} }) + '\n' : '';
    const identity = approval ? JSON.stringify(merged.currentRequirementId) : key;
    if (previous?.key === identity) return acknowledgement || null;
    if (previous) {
      if (!context.interactions?.supersede) throw new Error('Muse approval supersession is unavailable.');
      context.interactions.supersede(previous.interactionId);
    }
    const mapped = approval ? mapMuseApproval(merged, this.options.cwd) : mapMuseUserInput(merged);
    const fallback = () => this.request(mapped.fallback.method, mapped.fallback.params, true);
    if (!context.interactions || !this.options.interactionHost?.kinds.includes(mapped.prompt.kind)) {
      context.interactions?.unavailable?.(mapped.prompt.kind, 'unsupported_or_unavailable_interaction');
      return acknowledgement + fallback();
    }
    const interactionId = context.interactions.request({ prompt: mapped.prompt,
      response: answer => {
        if (this.interactions.get(key)?.key !== identity) throw new Error('Muse approval requirement changed.');
        return !approval && answer.action !== 'accept' ? fallback() : this.request(mapped.method, mapped.params(answer), true);
      }, fallback });
    this.interactions.set(key, { key: identity, input: structuredClone(merged), interactionId });
    return acknowledgement || null;
  }

  async readSessionCapabilities(): Promise<ProviderSessionCapabilities> {
    return { interactions: { version: 1, supported: [...MUSE_INTERACTION_KINDS],
      ...(this.options?.interactionHost ? { host: structuredClone(this.options.interactionHost) } : {}) },
    policy: structuredClone(this.policy), inventory: { state: 'not_observed', observedAt: null, stale: false,
      coverage: 'top-level-mcp', pages: 0, servers: [], dynamicTools: [], builtins: 'not_exposed_by_provider',
      reason: 'native_session_protocol_does_not_expose_tool_inventory' }, dependencies: [] };
  }
}
