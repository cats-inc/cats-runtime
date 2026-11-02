import { describe, expect, it, vi } from 'vitest';
import { HostedAcpProvider } from './hostedAcp.js';
import { mapAcpPermission, mapGrokInput } from './hostedAcpInteractions.js';
import type { ProviderServerRequestContext, ProviderSpawnOptions } from './types.js';

const options: ProviderSpawnOptions = { cwd: '/workspace', interactionHost: { version: 1,
  kinds: ['command_approval', 'file_approval', 'tool_approval', 'user_input'], timeoutMs: 60_000 },
executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } } };
const parse = (text: string) => JSON.parse(text);
function create(name: 'grok' | 'antigravity' = 'grok', extra: Partial<ProviderSpawnOptions> = {}) {
  const provider = new HostedAcpProvider(name);
  provider.configureExecution({ localWorkspaceCwd: '/workspace', sessionMcpToken: () => 'fixture-secret' });
  const args = provider.buildSpawnArgs({ ...options, ...extra });
  return { provider, args };
}
function reply(provider: HostedAcpProvider, request: { id: string }, result: object) {
  return provider.parseStreamLine(JSON.stringify({ id: request.id, result }));
}
function boot(name: 'grok' | 'antigravity' = 'grok', extra: Partial<ProviderSpawnOptions> = {}) {
  const { provider, args } = create(name, extra);
  const init = parse(provider.buildInitialization()!);
  reply(provider, init, { protocolVersion: 1, agentCapabilities: { loadSession: true,
    mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } }, _meta: { 'x.ai/mcp/sdk': true, mcpServers: [] } });
  const start = parse(provider.getPendingControlMessages()!);
  expect(reply(provider, start, { sessionId: 'native-session', _meta: { currentWorkingDirectory: '/workspace' } })).toMatchObject({ type: 'init' });
  return { provider, args, init, start };
}
const permission = { sessionId: 'native-session', toolCall: { toolCallId: 'tool-1', kind: 'execute',
  title: 'Run fixture', rawInput: { command: 'printf fixture' } }, options: [
    { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
    { optionId: 'no', name: 'Deny', kind: 'reject_once' },
  ] };
const host = () => ({ signal: new AbortController().signal, interactions: {
  request: vi.fn((_input: Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0]) => 'card'),
  resolve: vi.fn(),
  supersede: vi.fn(),
} });

describe('native hosted ACP', () => {
  it.each(['grok', 'antigravity'] as const)('requires explicit target and policy admission for %s', name => {
    expect(() => create(name, { executionPolicy: undefined })).toThrow('require provider configuration');
    expect(() => create(name, { permissionMode: 'whitelist' })).toThrow('allowlists');
    expect(() => create(name, { workspaceMode: 'read_only' })).toThrow('read-only');
    expect(() => create(name, { executionPolicy: { version: 1, mode: 'explicit', access: 'full-access', network: true, approval: 'on-request' } })).toThrow('Native approval rules');
    expect(() => create(name, { executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'workspace-write', network: true } } })).toThrow('full machine');
  });

  it('negotiates provider-owned IO without sending any model prompt during inspection', () => {
    const { provider, init, args } = boot();
    expect(args).toEqual(['agent', '--no-leader', 'stdio']);
    expect(init.params.clientCapabilities).toEqual({});
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(provider.getPendingControlMessages()).toBeNull();
  });

  it.each([true, false])('sets and checks resumed Grok effort before admitting a turn (matches=%s)', matches => {
    const { provider } = create('grok', { resumeSessionId: 'native-session', model: 'fixture-model',
      modelControls: { 'grok.reasoning_effort': 'xhigh' } });
    provider.buildStdinMessage('queued until controls match');
    reply(provider, { id: 'cats-acp-1' }, { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } });
    const resume = parse(provider.getPendingControlMessages()!);
    reply(provider, resume, { sessionId: 'native-session', models: { currentModelId: 'fixture-model' },
      configOptions: [{ id: 'reasoning_effort', currentValue: 'low' }] });
    const setter = parse(provider.getPendingControlMessages()!);
    expect(setter).toMatchObject({ method: 'session/set_config_option', params: {
      sessionId: 'native-session', configId: 'reasoning_effort', value: 'xhigh' } });
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(reply(provider, setter, { configOptions: [{ id: 'reasoning_effort', currentValue: matches ? 'xhigh' : 'low' }] }))
      .toMatchObject({ type: matches ? 'init' : 'error' });
    expect(Boolean(provider.getPendingTurnStart())).toBe(matches);
  });

  it('sends MCP grants privately and resumes the exact session without historical output', () => {
    const { provider, start, args } = boot('grok', { resumeSessionId: 'native-session', mcpServers: [{ name: 'cats-fixture', transport: 'http', url: 'http://127.0.0.1:12345/mcp', bearerTokenEnvVar: 'TOKEN' }] });
    expect(start.method).toBe('session/resume');
    expect(start.params).toMatchObject({ sessionId: 'native-session', mcpServers: [{ headers: [{ name: 'Authorization', value: 'Bearer fixture-secret' }] }] });
    expect(JSON.stringify(args)).not.toContain('fixture-secret');
    expect(provider.parseStreamLine(JSON.stringify({ method: 'session/update', params: { sessionId: 'native-session',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'history' } } } }))).toBeNull();
  });

  it('fails missing MCP capabilities before sending a session grant', () => {
    const { provider } = create('grok', { mcpServers: [{ name: 'cats', transport: 'http', url: 'http://localhost/mcp' }] });
    expect(reply(provider, parse(provider.buildInitialization()!), { protocolVersion: 1, agentCapabilities: {} })).toMatchObject({ type: 'error' });
    expect(provider.isSessionFailed()).toBe(true);
    expect(provider.getPendingControlMessages()).toBeNull();
  });

  it('admits Antigravity local tools while gating unverified session credential delivery', () => {
    expect(boot('antigravity').provider.capabilities.sessionMcpServers).toBe(false);
    expect(() => create('antigravity', { mcpServers: [{ name: 'cats', transport: 'http', url: 'http://localhost/mcp', bearerTokenEnvVar: 'TOKEN' }] }))
      .toThrow('credential persistence');
  });

  it('closes an unanswered approval when its native tool ends and rejects a late grant', async () => {
    const { provider } = boot(); provider.buildStdinMessage('fixture'); const context = host();
    await provider.buildServerResponse(JSON.stringify({ id: 7, method: 'session/request_permission', params: permission }), context);
    const card = context.interactions.request.mock.calls[0]![0];
    await provider.buildServerResponse(JSON.stringify({ method: 'session/update', params: { sessionId: 'native-session',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'failed' } } }), context);
    expect(context.interactions.supersede).toHaveBeenCalledWith('card');
    expect(context.interactions.resolve).not.toHaveBeenCalled();
    expect(() => card.response({ action: 'accept' })).toThrow('stale');
  });

  it('shows a bounded input target and scope while redacting credential fields', () => {
    const mapped = mapAcpPermission({ ...permission, toolCall: { ...permission.toolCall, kind: 'other',
      rawInput: { target: 'mail@example.test', authorization: 'private-value', body: 'x'.repeat(6000) } } }, '/workspace');
    expect(mapped.prompt.message).toContain('mail@example.test');
    expect(mapped.prompt.message).toContain('Scope: this action only');
    expect(mapped.prompt.message).toContain('[truncated]');
    expect(mapped.prompt.message).not.toContain('private-value');
  });

  it('routes only one-action permissions and confirms only after correlated tool progress', async () => {
    const { provider } = boot(); const context = host();
    const turn = parse(provider.buildStdinMessage('fixture'));
    const request = JSON.stringify({ id: 7, method: 'session/request_permission', params: permission });
    expect(provider.buildAutoResponse(request)).toBeNull();
    await provider.buildServerResponse(request, context); await provider.buildServerResponse(request, context);
    expect(context.interactions.request).toHaveBeenCalledOnce();
    const card = context.interactions.request.mock.calls[0]![0];
    expect(card.prompt.choices).toEqual([{ id: 'once', label: 'Allow once' }]);
    expect(() => card.response({ action: 'accept', choice: 'always' })).toThrow();
    expect(parse(card.response({ action: 'accept', choice: 'once' })).result).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });
    expect(context.interactions.resolve).not.toHaveBeenCalled();
    await provider.buildServerResponse(JSON.stringify({ method: 'session/update', params: { sessionId: 'native-session',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'in_progress' } } }), context);
    expect(context.interactions.resolve).toHaveBeenCalledWith('card');
    reply(provider, turn, { stopReason: 'end_turn' });
    expect(() => card.response({ action: 'accept', choice: 'once' })).toThrow('stale');
    expect(parse(provider.buildAutoResponse(request)!).result).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('cancels requests from another native session and after completion', () => {
    const { provider } = boot(); provider.buildStdinMessage('fixture');
    const request = JSON.stringify({ id: 9, method: 'session/request_permission', params: { ...permission, sessionId: 'other' } });
    expect(parse(provider.buildAutoResponse(request)!).result).toEqual({ outcome: { outcome: 'cancelled' } });
    const mapped = mapAcpPermission(permission, '/workspace');
    expect(mapped.result({ action: 'decline' })).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });

  it('projects actual Grok discovery separately from an invocation claim', async () => {
    const { provider } = boot('grok', { mcpServers: [{ name: 'cats', transport: 'http', url: 'http://localhost/mcp', bearerTokenEnvVar: 'TOKEN' }] });
    const request = vi.fn(async () => ({ result: { sessionMcpResolved: true, servers: [{ name: 'cats', session: {
      enabled: true, status: 'ready', tools: [{ name: 'ping', enabled: true }, { name: 'disabled', enabled: false }] } }] } }));
    const snapshot = await provider.readSessionCapabilities(request, true);
    expect(parse(request.mock.calls[0]![0]).method).toBe('_x.ai/mcp/list');
    expect(snapshot.policy.observed).toBeUndefined();
    expect(snapshot.inventory.servers).toMatchObject([{ source: 'session-injected', connection: 'connected', auth: 'bearerToken', invocation: 'not_verified', tools: [{ name: 'ping' }] }]);
    expect(JSON.stringify(snapshot)).not.toContain('fixture-secret');
  });

  it('keeps native questions and plan review interactive instead of auto-approving plans', async () => {
    const { provider } = boot(); provider.buildStdinMessage('fixture'); const context = host();
    await provider.buildServerResponse(JSON.stringify({ id: 8, method: '_x.ai/ask_user_question', params: {
      sessionId: 'native-session', toolCallId: 'question', questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } }), context);
    const card = context.interactions.request.mock.calls[0]![0];
    expect(parse(card.response({ action: 'accept', values: { 'question-0': 'custom answer' } })).result)
      .toEqual({ result: { outcome: 'accepted', answers: { 'Which?': ['Other'] }, annotations: { 'Which?': { notes: 'custom answer' } } } });
    expect(mapGrokInput({ toolCallId: 'plan', planContent: 'Create a file' }, true).result({ action: 'decline' })).toEqual({ outcome: 'cancelled' });
  });
});
