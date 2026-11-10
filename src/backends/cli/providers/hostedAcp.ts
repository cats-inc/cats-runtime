import type { Provider, ProviderCapabilities, ProviderExecutionContext, ProviderLaunchFailureInput,
  ProviderServerRequestContext, ProviderSpawnOptions, RuntimeProviderRefusal, StreamEvent, TurnInput } from './types.js';
import { assertExecutionPolicyAdmission, type EffectiveExecutionPolicy, type ExecutionAccess } from '../../../core/interactions/policy.js';
import type { ProviderSessionCapabilities, SessionToolInventory, SessionToolServer } from '../../../core/interactions/capabilities.js';
import { record } from '../../../core/interactions/validation.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { providerSessionUnavailableEvent } from '../../../core/runtime/providerSessionUnavailable.js';
import { compileRuntimeTurnPrompt } from './prompt.js';
import { ACP_INTERACTION_KINDS, GROK_INTERACTION_KINDS, acpReply, mapAcpPermission, mapGrokInput } from './hostedAcpInteractions.js';
import { sameHostedWorkspace } from './hostedWorkspace.js';

export const ACP_ADMISSIBLE_CEILINGS: Array<{ access: ExecutionAccess; network: boolean }> = [
  { access: 'full-access', network: true },
];

function frame(line: string): Record<string, unknown> | undefined {
  try { return record(JSON.parse(line)); } catch { return undefined; }
}
function textContent(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.slice(0, 256).map(record).flatMap(item => {
    const content = record(item?.content);
    return content?.type === 'text' && typeof content.text === 'string' ? [content.text] : [];
  }).join('\n');
}
const emptyInventory = (): SessionToolInventory => ({ state: 'not_observed', observedAt: null, stale: false,
  coverage: 'top-level-mcp', pages: 0, servers: [], dynamicTools: [], builtins: 'not_exposed_by_provider',
  reason: 'native_protocol_does_not_expose_tool_inventory' });

/** Native Grok ACP and Google's official Antigravity ACP, hosted by the CLI worker lifecycle. */
export class HostedAcpProvider implements Provider {
  readonly sessionMcpTransport = 'stdin' as const;
  readonly capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true,
    sessionMcpServers: true, interactions: { version: 1, kinds: ACP_INTERACTION_KINDS },
    sessionCapabilities: { version: 1, executionPolicy: true, inventory: true, admissibleCeilings: ACP_ADMISSIBLE_CEILINGS } };
  private context: ProviderExecutionContext = {};
  private options!: ProviderSpawnOptions;
  private state: 'uninitialized' | 'initializing' | 'ready' | 'failed' = 'uninitialized';
  private sessionId?: string;
  private sequence = 0;
  private promptId?: string;
  private pendingPrompt: string | null = null;
  private pendingControl: string | null = null;
  private requests = new Map<string, string>();
  private supportsMcpInventory = false;
  private inventory = emptyInventory();
  private builtinTools: string[] = [];
  private policy!: EffectiveExecutionPolicy;
  private tools = new Map<string, { name: string; completed: boolean }>();
  private permissions = new Map<string | number, { toolId: string; interactionId: string; answered: boolean }>();
  private completedPermissions = new Set<string | number>();

  constructor(readonly name: 'grok' | 'antigravity') {
    if (name === 'grok') this.capabilities.interactions = { version: 1, kinds: GROK_INTERACTION_KINDS };
    // Native credential persistence is not yet verified for Google's executable.
    if (name === 'antigravity') this.capabilities.sessionMcpServers = false;
  }
  private handles(method: unknown): boolean {
    return method === 'session/request_permission' || this.name === 'grok'
      && ['_x.ai/ask_user_question', '_x.ai/exit_plan_mode'].includes(String(method));
  }
  configureExecution(context: ProviderExecutionContext): void { this.context = context; }

  buildSpawnArgs(options: ProviderSpawnOptions): string[] {
    assertExecutionPolicyAdmission(options.executionPolicy, options);
    const policy = options.executionPolicy;
    if (!policy || policy.mode !== 'provider' || policy.constraints.maxAccess !== 'full-access' || !policy.constraints.network) {
      throw new Error(`${this.name} hosted tools require provider configuration with full machine and network access. Native approval rules are inherited.`);
    }
    if (!this.context.localWorkspaceCwd || options.forkSession) throw new Error('Hosted ACP requires a native workspace and does not support fork.');
    if (this.name === 'antigravity' && options.mcpServers?.length) {
      throw new Error('Antigravity session MCP is unavailable until native credential persistence is verified.');
    }
    this.options = structuredClone(options);
    this.state = 'uninitialized'; this.sessionId = undefined; this.promptId = undefined;
    this.pendingPrompt = null; this.pendingControl = null; this.requests.clear(); this.tools.clear();
    this.permissions.clear(); this.completedPermissions.clear(); this.builtinTools = []; this.inventory = emptyInventory();
    this.supportsMcpInventory = false;
    this.policy = { source: policy.mode, requested: structuredClone(policy), status: 'not_observed',
      coverage: 'local-process-only', configurationSources: ['native-provider-configuration'] };
    if (this.name === 'antigravity') return process.platform === 'linux' ? ['--uid='] : [];
    const effort = options.modelControls?.['grok.reasoning_effort'];
    return ['agent', '--no-leader', ...(options.model ? ['--model', options.model] : []),
      ...(typeof effort === 'string' ? ['--reasoning-effort', effort] : []), 'stdio'];
  }

  composeLaunchArgs(configuredArgs: readonly string[], spawnArgs: readonly string[]): string[] {
    if (configuredArgs.some(arg => /^(?:agent|stdio|--leader|--output-format|--resume|--continue|--fork|--session-id|--prompt|-p)(?:=|$)/u.test(arg))) {
      throw new Error('Configured arguments conflict with the hosted ACP lifecycle.');
    }
    if (this.name !== 'grok') return [...configuredArgs, ...spawnArgs];
    const prefix: string[] = []; const agent: string[] = [];
    for (let index = 0; index < configuredArgs.length; index++) {
      const value = configuredArgs[index]!;
      if (['--xai-api-base-url', '--agent-profile', '--plugin-dir'].includes(value)) {
        const argument = configuredArgs[++index];
        if (!argument) throw new Error('Configured Grok option requires a value.');
        agent.push(value, argument);
      } else if (/^--(?:xai-api-base-url|agent-profile|plugin-dir)=/u.test(value) || value === '--always-approve') agent.push(value);
      else prefix.push(value);
    }
    return [...prefix, 'agent', ...agent, ...spawnArgs.slice(1)];
  }

  private request(method: string, params: Record<string, unknown>): string {
    const id = `cats-acp-${++this.sequence}`;
    this.requests.set(id, method);
    if (method === 'session/prompt') this.promptId = id;
    return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  }
  buildInitialization(): string | null {
    if (this.state !== 'uninitialized') return null;
    this.state = 'initializing';
    // Native agents own their filesystem and terminal. We never advertise client IO we cannot enforce.
    return this.request('initialize', { protocolVersion: 1, clientInfo: { name: 'cats-runtime', version: '1.0.0' }, clientCapabilities: {} });
  }
  isSessionInitializing(): boolean { return this.state === 'initializing'; }
  isSessionFailed(): boolean { return this.state === 'failed'; }
  getPendingControlMessages(): string | null { const value = this.pendingControl; this.pendingControl = null; return value; }
  getPendingTurnStart(): string | null {
    if (this.state !== 'ready' || this.pendingPrompt === null) return null;
    const prompt = this.pendingPrompt; this.pendingPrompt = null; return this.startTurn(prompt);
  }
  buildStdinMessage(content: string, turn?: TurnInput): string {
    if (this.state === 'failed') throw new Error('Hosted ACP session failed; close and recreate it.');
    const prompt = compileRuntimeTurnPrompt(content, turn);
    if (this.state !== 'ready') {
      if (this.pendingPrompt !== null) throw new Error('Hosted ACP initialization already has a pending turn.');
      this.pendingPrompt = prompt; return this.buildInitialization() ?? '';
    }
    return this.startTurn(prompt);
  }
  private startTurn(prompt: string): string {
    if (this.promptId) throw new Error('Hosted ACP already has an active turn.');
    this.tools.clear(); this.permissions.clear(); this.completedPermissions.clear();
    return this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: prompt }] });
  }
  private mcpServers(): Record<string, unknown>[] {
    return (this.options.mcpServers ?? []).map(server => {
      const token = server.bearerTokenEnvVar ? this.context.sessionMcpToken?.(server.bearerTokenEnvVar) : undefined;
      if (server.bearerTokenEnvVar && !token) throw new Error('Session MCP authentication is unavailable.');
      return { type: 'http', name: server.name, url: server.url,
        headers: token ? [{ name: 'Authorization', value: `Bearer ${token}` }] : [] };
    });
  }
  private fail(message: string, resumeMissing = false): StreamEvent {
    this.state = 'failed'; this.pendingPrompt = null; this.pendingControl = null; this.promptId = undefined;
    this.policy = { ...this.policy, status: 'unsupported', reason: 'native_session_initialization_failed' };
    return resumeMissing ? providerSessionUnavailableEvent(message) : { type: 'error', text: message };
  }
  private ready(): StreamEvent {
    this.state = 'ready';
    // This verifies only the unrestricted admission ceiling. ACP does not report an effective
    // approval policy, so no observed approval/reviewer or narrower sandbox is invented.
    this.policy = { ...this.policy, status: 'verified', reason: 'unrestricted_ceiling_native_approval_rules_inherited' };
    return { type: 'init', sessionId: this.sessionId,
      mcpServers: (this.options.mcpServers ?? []).map(server => ({ name: server.name, status: 'unknown' })) };
  }

  private configured(result: Record<string, unknown>): StreamEvent | null {
    const effort = this.options.modelControls?.['grok.reasoning_effort'];
    if (this.name !== 'grok' || typeof effort !== 'string' || this.effortMatches(result, effort)) return this.ready();
    // Grok retains effort in resumed sessions; a spawn flag does not override it.
    this.pendingControl = this.request('session/set_config_option', { sessionId: this.sessionId,
      configId: 'reasoning_effort', value: effort });
    return null;
  }

  private effortMatches(result: Record<string, unknown>, effort: unknown): boolean {
    return Array.isArray(result.configOptions) && result.configOptions.some(value => {
      const option = record(value);
      return option?.id === 'reasoning_effort' && option.currentValue === effort;
    });
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const input = frame(line);
    if (!input) return null;
    if (typeof input.id === 'string' && !input.method) {
      const method = this.requests.get(input.id);
      if (!method) return null;
      this.requests.delete(input.id);
      const result = record(input.result);
      if (input.error && hostedResumeMissing(this.name, method, input.error)) {
        return this.fail(`${this.name} has no saved session to ${method === 'session/load' ? 'load' : 'resume'}; no action was retried. Continue in a new session.`, true);
      }
      if (input.error || !result) return this.fail(`${this.name} rejected ${method}; no action was retried. Check the native provider sign-in and settings.`);
      if (method === 'initialize') {
        const capabilities = record(result.agentCapabilities);
        if (result.protocolVersion !== 1 || !capabilities) return this.fail('Unsupported native ACP handshake.');
        if (this.options.mcpServers?.length && record(capabilities.mcpCapabilities)?.http !== true) return this.fail('Native ACP does not support session HTTP MCP servers.');
        this.supportsMcpInventory = this.name === 'grok' && record(result._meta)?.['x.ai/mcp/sdk'] === true;
        if (this.name === 'grok' && this.options.mcpServers?.length) {
          const configured = record(result._meta)?.mcpServers;
          if (!Array.isArray(configured) || configured.some(value => {
            const name = typeof value === 'string' ? value : record(value)?.name;
            return typeof name !== 'string' || this.options.mcpServers?.some(server => server.name === name);
          })) return this.fail('Session MCP names conflict with native Grok configuration or could not be inspected.');
        }
        const resume = this.options.resumeSessionId;
        const supportsResume = record(capabilities.sessionCapabilities)?.resume !== undefined;
        if (resume && !supportsResume && capabilities.loadSession !== true) return this.fail('Native ACP cannot resume this conversation.');
        this.sessionId = resume;
        this.pendingControl = this.request(resume ? supportsResume ? 'session/resume' : 'session/load' : 'session/new',
          { cwd: this.options.cwd, mcpServers: this.mcpServers(), ...(resume ? { sessionId: resume } : {}) });
        return null;
      }
      if (['session/new', 'session/load', 'session/resume'].includes(method)) {
        if (method === 'session/new' && (typeof result.sessionId !== 'string' || !result.sessionId)
          || this.sessionId && result.sessionId !== undefined && result.sessionId !== this.sessionId) return this.fail('Native ACP returned a mismatched session.');
        this.sessionId ??= String(result.sessionId);
        const cwd = record(result._meta)?.currentWorkingDirectory;
        if (cwd !== undefined && !sameHostedWorkspace(this.options.cwd, cwd)) return this.fail('Native ACP returned a different workspace.');
        if (this.options.model && record(result.models)?.currentModelId !== this.options.model) {
          this.pendingControl = this.request('session/set_model', { sessionId: this.sessionId, modelId: this.options.model });
          return null;
        }
        return this.configured(result);
      }
      if (method === 'session/set_model') return this.configured(result);
      if (method === 'session/set_config_option') {
        return this.effortMatches(result, this.options.modelControls?.['grok.reasoning_effort']) ? this.ready()
          : this.fail('Grok did not confirm the requested reasoning effort; no prompt was sent.');
      }
      if (method === 'session/prompt' && input.id === this.promptId) {
        this.promptId = undefined;
        return result.stopReason === 'end_turn' ? { type: 'result', sessionId: this.sessionId }
          : { type: 'error', text: result.stopReason === 'cancelled' ? 'Provider turn cancelled.' : 'Provider turn stopped before completion.' };
      }
      return null;
    }
    const params = record(input.params);
    if (!params || params.sessionId !== this.sessionId || input.method !== 'session/update') return null;
    const update = record(params.update);
    if (!update) return null;
    if (update.sessionUpdate === 'available_commands_update') {
      const tools = record(update._meta)?.tools;
      if (this.name === 'grok' && Array.isArray(tools)) this.builtinTools = tools.filter((tool): tool is string => typeof tool === 'string' && tool.length <= 256).slice(0, 512);
      return null;
    }
    if (this.state !== 'ready' || !this.promptId) return null; // Load-history notifications never become a new answer.
    const content = record(update.content);
    if (content?.type === 'text' && typeof content.text === 'string') {
      if (update.sessionUpdate === 'agent_message_chunk') return { type: 'text', text: content.text };
      if (update.sessionUpdate === 'agent_thought_chunk') return createRuntimeProgressEvent({ text: content.text,
        provider: this.name, backend: 'cli', kind: 'reasoning', status: 'running', source: 'provider' });
    }
    if (!['tool_call', 'tool_call_update'].includes(String(update.sessionUpdate)) || typeof update.toolCallId !== 'string') return null;
    const previous = this.tools.get(update.toolCallId);
    if (previous?.completed || this.tools.size >= 8192 && !previous) return null;
    const name = previous?.name ?? (typeof update.title === 'string' ? update.title.slice(0, 256) : 'provider_tool');
    const completed = update.status === 'completed' || update.status === 'failed';
    this.tools.set(update.toolCallId, { name, completed });
    if (completed) return { type: 'tool_result', toolId: update.toolCallId, toolName: name,
      text: textContent(update.content), isError: update.status === 'failed' };
    return previous ? null : { type: 'tool_use', toolId: update.toolCallId, toolName: name,
      ...(record(update.rawInput) ? { toolArgs: record(update.rawInput) } : {}) };
  }

  buildAutoResponse(line: string): string | null {
    const input = frame(line);
    if (!input?.method || typeof input.id !== 'string' && typeof input.id !== 'number') return null;
    if (this.promptId && this.state === 'ready' && this.handles(input.method)
      && record(input.params)?.sessionId === this.sessionId) return null;
    if (input.method === 'session/request_permission') return acpReply(input.id, { outcome: { outcome: 'cancelled' } });
    if (this.handles(input.method)) return acpReply(input.id, { result: { outcome: 'cancelled' } });
    return JSON.stringify({ jsonrpc: '2.0', id: input.id, error: { code: -32601, message: 'Unsupported host method.' } }) + '\n';
  }

  async buildServerResponse(line: string, context: ProviderServerRequestContext): Promise<string | null> {
    const input = frame(line); const params = record(input?.params);
    if (!input || !params || params.sessionId !== this.sessionId || this.state !== 'ready' || !this.promptId || context.signal.aborted) return null;
    if (input.method === 'session/update') {
      const update = record(params.update);
      if (update?.sessionUpdate === 'tool_call_update' && ['in_progress', 'completed', 'failed'].includes(String(update.status))) {
        const terminal = update.status === 'completed' || update.status === 'failed';
        for (const [id, pending] of this.permissions) if (pending.toolId === update.toolCallId && (pending.answered || terminal)) {
          if (pending.answered) context.interactions?.resolve(pending.interactionId);
          else context.interactions?.supersede?.(pending.interactionId);
          this.permissions.delete(id); this.completedPermissions.add(id);
        }
      }
      return null;
    }
    if (!this.handles(input.method) || typeof input.id !== 'string' && typeof input.id !== 'number') return null;
    const id = input.id;
    if (this.permissions.has(id) || this.completedPermissions.has(id)) return null;
    const extension = input.method !== 'session/request_permission';
    const mapped = extension ? mapGrokInput(params, input.method === '_x.ai/exit_plan_mode') : mapAcpPermission(params, this.options.cwd);
    const reply = (result: Record<string, unknown>) => acpReply(id, extension ? { result } : result);
    const fallback = () => reply(mapped.result({ action: 'cancel' }));
    if (!context.interactions || !this.options.interactionHost?.kinds.includes(mapped.prompt.kind)
      || mapped.prompt.kind !== 'user_input' && !mapped.prompt.choices?.length) {
      context.interactions?.unavailable?.(mapped.prompt.kind, 'no_supported_one_action_permission'); return fallback();
    }
    const promptId = this.promptId;
    const interactionId = context.interactions.request({ prompt: mapped.prompt, fallback,
      response: answer => {
        if (this.promptId !== promptId || !this.permissions.has(id)) throw new Error('ACP permission request is stale.');
        const result = mapped.result(answer); this.permissions.get(id)!.answered = true;
        return reply(result);
      } });
    this.permissions.set(id, { toolId: mapped.toolId, interactionId, answered: false });
    return null;
  }

  async readSessionCapabilities(request: (line: string, timeoutMs?: number) => Promise<Record<string, unknown>>,
    refresh: boolean): Promise<ProviderSessionCapabilities> {
    if (this.state === 'ready' && this.supportsMcpInventory && (refresh || this.inventory.state === 'not_observed')) {
      try {
        const response = await request(JSON.stringify({ jsonrpc: '2.0', id: `cats-acp-inventory-${++this.sequence}`,
          method: '_x.ai/mcp/list', params: { sessionId: this.sessionId, cache: !refresh } }) + '\n');
        // Grok's extension result is itself wrapped in { result }.
        const result = record(response.result);
        if (!Array.isArray(result?.servers)) throw new Error('Unsupported inventory.');
        const servers: SessionToolServer[] = result.servers.slice(0, 128).flatMap(value => {
          const server = record(value); const session = record(server?.session);
          if (!server || typeof server.name !== 'string' || server.name.length > 256) return [];
          const injected = this.options.mcpServers?.some(item => item.name === server.name) === true;
          const tools = Array.isArray(session?.tools) ? session.tools.slice(0, 512).map(record)
            .flatMap(tool => typeof tool?.name === 'string' && tool.name.length <= 256 && tool.enabled !== false
              ? [{ name: tool.name, qualifiedName: `${server.name}/${tool.name}` }] : []) : [];
          return [{ name: server.name, source: injected ? 'session-injected' : 'provider-configured',
            connection: session?.enabled === false ? 'disabled' : session?.authRequired === true ? 'authenticationRequired'
              : session?.status === 'ready' ? 'connected' : session?.status === 'initializing' ? 'starting'
                : session?.status === 'unavailable' ? 'failed' : 'unknown',
            auth: injected && this.options.mcpServers?.find(item => item.name === server.name)?.bearerTokenEnvVar ? 'bearerToken' : 'unknown',
            tools, discovery: Array.isArray(session?.tools) && session.tools.length > 512 ? 'truncated' : 'advertised', invocation: 'not_verified' }];
        });
        this.inventory = { ...emptyInventory(), state: result.sessionMcpResolved === true && result.servers.length <= 128 ? 'observed' : 'partial',
          observedAt: new Date().toISOString(), pages: 1, servers, reason: undefined };
      } catch { this.inventory = { ...this.inventory, state: 'unavailable', stale: true, reason: 'native_mcp_inventory_unavailable' }; }
    }
    return { interactions: { version: 1, supported: [...this.capabilities.interactions!.kinds], host: structuredClone(this.options.interactionHost!) },
      policy: structuredClone(this.policy), inventory: { ...structuredClone(this.inventory),
        ...(this.builtinTools.length ? { builtins: 'observed', builtinTools: [...this.builtinTools] } : {}) }, dependencies: [] };
  }

  classifyLaunchFailure(input: ProviderLaunchFailureInput): RuntimeProviderRefusal | null {
    if (this.name !== 'antigravity' || !input.stderrLines.some(line => /Compile-time page size does not match runtime page size/u.test(line))) return null;
    return { category: 'provider_unavailable', message: 'The official Antigravity ACP binary does not support this operating system page size. Install a compatible official build.',
      retryable: false, source: input.source, evidenceSummary: 'Native ACP exited before initialization: page size mismatch.' };
  }
}

/**
 * Grok 1.0.77 `agent stdio` answers `session/resume` for a session it has no local
 * directory for with JSON-RPC -32603 `Path not found.` and `data.code: FS_NOT_FOUND`
 * (capture: grok-1.0.77/acp-resume-missing.error.redacted.ndjson). Other hosted
 * providers and other rejections stay generic until a capture shows their shape.
 */
export function hostedResumeMissing(provider: string, method: string, error: unknown): boolean {
  if (provider !== 'grok' || (method !== 'session/resume' && method !== 'session/load')) return false;
  return record(record(error)?.data)?.code === 'FS_NOT_FOUND';
}
