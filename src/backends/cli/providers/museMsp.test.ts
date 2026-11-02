import { describe, expect, it, vi } from 'vitest';
import { MuseMspProvider } from './museMsp.js';
import { mapMuseApproval, mapMuseUserInput } from './museInteractions.js';
import { validateAnswer } from '../../../core/interactions/validation.js';
import type { ProviderServerRequestContext, ProviderSpawnOptions } from './types.js';

const options: ProviderSpawnOptions = { cwd: '/workspace', interactionHost: {
  version: 1, kinds: ['command_approval', 'file_approval', 'tool_approval', 'user_input'], timeoutMs: 60_000,
}, executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } } };
const session = { sessionId: 'native-session', workspaceRoot: '/workspace', activeTurnId: null,
  approvalMode: { mode: 'onRequest' }, permissionState: { profileId: ':ask-me', reviewerAuthority: 'human',
    reviewerAttached: true, axes: { filesystem: 'sandboxed', network: 'off', approval: 'onRequest', reviewer: 'human' } } };
const parse = (value: string) => value.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

function create(extra: Partial<ProviderSpawnOptions> = {}) {
  const provider = new MuseMspProvider();
  provider.configureExecution({ localWorkspaceCwd: '/workspace', sessionMcpToken: key => key === 'FIXTURE_TOKEN' ? 'fixture-secret' : undefined });
  const args = provider.buildSpawnArgs({ ...options, ...extra });
  return { provider, args };
}

function reply(provider: MuseMspProvider, request: Record<string, unknown>, result: Record<string, unknown>) {
  return provider.parseStreamLine(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}

function boot(extra: Partial<ProviderSpawnOptions> = {}) {
  const { provider, args } = create(extra);
  const init = parse(provider.buildInitialization()!)[0]!;
  reply(provider, init, { experimentalApi: true, grantedCapabilities: ['sessionMcp'], sandboxAvailability: 'available' });
  const handshake = parse(provider.getPendingControlMessages()!);
  expect(handshake[0]!.method).toBe('initialized');
  reply(provider, handshake[1]!, { profiles: [{ profileId: ':ask-me', available: true, reviewerAuthority: 'human' }] });
  let start = parse(provider.getPendingControlMessages()!)[0]!;
  if (start.method === 'mcpServer/list') { reply(provider, start, { servers: [] }); start = parse(provider.getPendingControlMessages()!)[0]!; }
  expect(reply(provider, start, { session, pendingRequests: [] })).toMatchObject({ type: 'init', sessionId: 'native-session' });
  return { provider, args, start };
}

function turn(provider: MuseMspProvider) {
  const request = parse(provider.buildStdinMessage('fixture prompt'))[0]!;
  const commandId = (request.params as Record<string, unknown>).commandId;
  expect(commandId).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);
  reply(provider, request, { commandId, disposition: 'started', status: 'accepted', turnId: 'native-turn' });
  return request;
}

const notify = (provider: MuseMspProvider, method: string, params: Record<string, unknown>) =>
  provider.parseStreamLine(JSON.stringify({ jsonrpc: '2.0', method, params: { sessionId: 'native-session', ...params } }));

function approval(sourceIndex = 1) {
  return { sessionId: 'native-session', turnId: 'native-turn', approvalId: 'approval-1',
    currentRequirementId: { approvalId: 'approval-1', sourceIndex }, toolName: 'shell',
    subject: { kind: 'shell', command: 'printf fixture' }, availableChoices: [
      { choiceId: 'once', decision: 'approved', scope: 'once', label: 'Allow once' },
      { choiceId: 'session', decision: 'approvedForSession', scope: 'session', label: 'Allow for this session' },
      { choiceId: 'persist', decision: 'approvedPolicyAmendment', scope: 'localPersistent', label: 'Save a rule' },
      { choiceId: 'deny', decision: 'denied', scope: 'once', label: 'Deny' },
    ] };
}
function host() {
  let next = 0;
  return { signal: new AbortController().signal, interactions: {
    request: vi.fn((_input: Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0]) => `card-${++next}`),
    resolve: vi.fn(), supersede: vi.fn(), unavailable: vi.fn(),
  } } satisfies ProviderServerRequestContext;
}

describe('Muse native MSP host', () => {
  it('rejects narrower ceilings and explicit overrides instead of implying sandbox confinement', () => {
    expect(() => create({ executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'workspace-write', network: true } } })).toThrow('cannot enforce');
    expect(() => create({ executionPolicy: { version: 1, mode: 'explicit', access: 'full-access', network: true, approval: 'never' } })).toThrow('inherit native');
  });
  it('keeps native multi-select bounds and free text limits in the host validation', () => {
    const mapped = mapMuseUserInput({ sessionId: 's', userInputId: 'q', questions: [{ id: 'q1', header: 'Choose', question: 'Which?',
      selection: { mode: 'multiple', minSelections: 2, maxSelections: 2 }, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] });
    expect(() => validateAnswer(mapped.prompt, { action: 'accept', values: { q1: ['A'] } })).toThrow();
    expect(() => validateAnswer(mapped.prompt, { action: 'accept', values: { q1: ['A', 'A'] } })).toThrow();
    expect(mapped.params({ action: 'accept', values: { q1: ['A', 'B'] } })).toMatchObject({ answers: [{ selectedLabels: ['A', 'B'] }] });
    const single = mapMuseUserInput({ sessionId: 's', userInputId: 'q', questions: [{ id: 'q1', selection: { mode: 'single' }, options: [] }] });
    expect(() => validateAnswer(single.prompt, { action: 'accept', values: { q1: 'x'.repeat(501) } })).toThrow();
  });
  it('shows network and filesystem scope in the approval card', () => {
    const tool = mapMuseApproval({ ...approval(), subject: { kind: 'tool' },
      rawArgs: { recipient: 'fixture@example.test', api_key: 'secret' } }, '/workspace').prompt;
    expect(tool.message).toContain('fixture@example.test');
    expect(tool.message).toContain('Scopes: once, session');
    expect(tool.message).not.toContain('secret');
    expect(mapMuseApproval({ ...approval(), subject: { kind: 'network', host: 'example.test', protocol: 'https', port: 443 } }, '/workspace').prompt.message)
      .toContain('https://example.test:443');
    expect(mapMuseApproval({ ...approval(), subject: { kind: 'fileAccess', access: 'write', path: '/outside/file' } }, '/workspace').prompt.message)
      .toContain('write\n/outside/file');
  });
  it('requires policy admission rather than interpreting an interaction host as permission to write', () => {
    expect(() => create({ executionPolicy: undefined })).toThrow('policy admission');
    expect(() => create({ permissionMode: 'whitelist', allowedTools: ['read_file'] })).toThrow('allowlists');
    expect(() => create({ workspaceMode: 'read_only' })).toThrow('read-only');
  });
  it('refuses a resumed workspace mismatch before dispatching a prompt', () => {
    const { provider } = create({ resumeSessionId: 'native-session' });
    const init = parse(provider.buildInitialization()!)[0]!;
    reply(provider, init, { experimentalApi: true, grantedCapabilities: [], sandboxAvailability: 'available' });
    reply(provider, parse(provider.getPendingControlMessages()!)[1]!, { profiles: [] });
    expect(reply(provider, parse(provider.getPendingControlMessages()!)[0]!, { session: { ...session, workspaceRoot: '/elsewhere' } }))
      .toMatchObject({ type: 'error' });
    expect(provider.isSessionFailed()).toBe(true); expect(provider.getPendingTurnStart()).toBeNull();
  });
  it('refuses a native configured MCP name before transmitting the session credential', () => {
    const { provider } = create({ mcpServers: [{ name: 'cats', transport: 'http', url: 'http://localhost/mcp', bearerTokenEnvVar: 'FIXTURE_TOKEN' }] });
    reply(provider, parse(provider.buildInitialization()!)[0]!, { experimentalApi: true, grantedCapabilities: ['sessionMcp'], sandboxAvailability: 'available' });
    reply(provider, parse(provider.getPendingControlMessages()!)[1]!, { profiles: [] });
    expect(reply(provider, parse(provider.getPendingControlMessages()!)[0]!, { servers: [{ name: 'cats' }] })).toMatchObject({ type: 'error' });
    expect(provider.getPendingControlMessages()).toBeNull();
  });

  it('initializes and discovers permission profiles without creating a model turn', () => {
    const { provider, start } = boot();
    expect(start.method).toBe('session/start');
    expect(start.params).toMatchObject({ workspaceRoots: ['/workspace'] });
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(provider.getPendingControlMessages()).toBeNull();
  });

  it('delivers session credentials in private stdin only, never argv or normalized events', () => {
    const { args, start, provider } = boot({ mcpServers: [{ name: 'cats-fixture', transport: 'http',
      url: 'http://127.0.0.1:12345/mcp', bearerTokenEnvVar: 'FIXTURE_TOKEN' }] });
    expect(JSON.stringify(args)).not.toContain('fixture-secret');
    expect(start.params).toMatchObject({ config: { mcpServers: { 'cats-fixture': {
      transport: 'streamableHttp', headers: { Authorization: 'Bearer fixture-secret' },
    } } } });
    expect(provider.parseStreamLine(JSON.stringify({ method: 'unknown', params: { token: 'fixture-secret' } }))).toBeNull();
  });

  it('resumes the exact native identity without asking for or streaming historical items', () => {
    const { provider, start } = boot({ resumeSessionId: 'native-session', model: 'muse-wonder-1.0' });
    expect(start.method).toBe('session/resume');
    expect(start.params).toMatchObject({ sessionId: 'native-session', excludeItems: true, modelId: 'muse-wonder-1.0' });
    expect(notify(provider, 'item/completed', { item: { itemId: 'old', kind: 'agentMessage', turnId: 'old-turn', text: 'old answer' } })).toBeNull();
  });

  it('streams deltas once and ignores other sessions, old turns and duplicate terminal items', () => {
    const { provider } = boot({ modelControls: { 'muse.reasoning_effort': 'xhigh' } });
    expect(turn(provider).params).toMatchObject({ reasoningEffort: 'xhigh' });
    const item = { itemId: 'answer', kind: 'agentMessage', turnId: 'native-turn', revision: 1, text: '' };
    expect(notify(provider, 'item/started', { item })).toBeNull();
    expect(notify(provider, 'item/delta', { itemId: 'answer', delta: 'fixture', field: 'text' })).toEqual({ type: 'text', text: 'fixture' });
    expect(notify(provider, 'item/completed', { item: { ...item, text: 'fixture', revision: 2 } })).toBeNull();
    expect(notify(provider, 'item/completed', { item: { ...item, text: 'fixture', revision: 2 } })).toBeNull();
    expect(notify(provider, 'turn/completed', { turnId: 'old-turn', terminal: 'completed' })).toBeNull();
    expect(notify(provider, 'turn/completed', { turnId: 'native-turn', terminal: 'completed' })).toMatchObject({ type: 'result' });
    expect(notify(provider, 'turn/completed', { turnId: 'native-turn', terminal: 'completed' })).toBeNull();
  });

  it('refuses a native queued/steered turn rather than claiming a new execution was admitted', () => {
    const { provider } = boot();
    const request = parse(provider.buildStdinMessage('fixture'))[0]!;
    expect(reply(provider, request, { commandId: (request.params as Record<string, unknown>).commandId,
      status: 'accepted', disposition: 'queued', turnId: 'other-turn' })).toMatchObject({ type: 'error' });
  });

  it('acknowledges receipt separately, deduplicates cards, and sends the offered decision and current requirement', async () => {
    const { provider } = boot(); turn(provider); const context = host();
    const input = JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'approval/request', params: approval() });
    expect(parse((await provider.buildServerResponse(input, context))!)).toEqual([{ jsonrpc: '2.0', id: 17, result: {} }]);
    await provider.buildServerResponse(input, context);
    expect(context.interactions.request).toHaveBeenCalledTimes(1);
    const card = context.interactions.request.mock.calls[0]![0];
    expect(card.prompt.choices?.map(choice => choice.id)).toEqual(['once', 'session']);
    const decision = parse(card.response({ action: 'accept', choice: 'once' }))[0]!;
    expect(decision.method).toBe('approval/decide');
    expect(decision.params).toMatchObject({ choiceId: 'once', requirementId: { approvalId: 'approval-1', sourceIndex: 1 } });
    expect(context.interactions.resolve).not.toHaveBeenCalled();
    expect(parse(card.fallback('deadline_exceeded'))[0]!.params).toMatchObject({ choiceId: 'deny' });
  });

  it('invalidates the prior requirement without recording provider confirmation and rejects its stale closure', async () => {
    const { provider } = boot(); turn(provider); const context = host();
    await provider.buildServerResponse(JSON.stringify({ id: 1, method: 'approval/request', params: approval() }), context);
    const old = context.interactions.request.mock.calls[0]![0];
    await provider.buildServerResponse(JSON.stringify({ method: 'approval/updated', params: approval(2) }), context);
    expect(context.interactions.supersede).toHaveBeenCalledWith('card-1');
    expect(context.interactions.resolve).not.toHaveBeenCalled();
    expect(() => old.response({ action: 'accept' })).toThrow('requirement changed');
    const current = context.interactions.request.mock.calls[1]![0];
    expect(parse(current.response({ action: 'decline' }))[0]!.params)
      .toMatchObject({ choiceId: 'deny', requirementId: { sourceIndex: 2 } });
    await provider.buildServerResponse(JSON.stringify({ method: 'approval/resolved', params: { sessionId: 'native-session', approvalId: 'approval-1' } }), context);
    expect(context.interactions.resolve).toHaveBeenCalledWith('card-2');
  });

  it('does not turn an unknown native choice or malformed requirement into an approval', () => {
    expect(() => mapMuseApproval({ ...approval(), currentRequirementId: { approvalId: 'foreign', sourceIndex: 1 } }, '/workspace')).toThrow('Unsupported');
    expect(() => mapMuseApproval(approval(), '/workspace').params({ action: 'accept', choice: 'persist' })).toThrow('Unsupported');
  });
});
