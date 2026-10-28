import { describe, expect, it, vi } from 'vitest';
import { CodexProvider } from './codex.js';
import { codexInteractionFallback, mapCodexInteraction } from './codexInteractions.js';
import { mcpFormFields } from './mcpElicitation.js';
import { INTERACTION_KINDS } from '../../../core/interactions/types.js';
import type { ProviderServerRequestContext, ProviderSpawnOptions } from './types.js';

// Schema provenance: codex 0.164.0 app-server generate-ts --experimental.
// Values below are synthetic; no account, file content or live URL is captured.
function boot(options: Partial<ProviderSpawnOptions> = {}) {
  const provider = new CodexProvider();
  provider.buildSpawnArgs({ cwd: '/workspace', interactionHost: {
    version: 1, kinds: [...INTERACTION_KINDS], timeoutMs: 60_000,
  }, ...options });
  const frames = provider.buildStdinMessage('fixture').trim().split('\n').map(line => JSON.parse(line));
  provider.parseStreamLine(JSON.stringify({ id: frames[2].id, result: { thread: { id: 'thread' },
    approvalPolicy: frames[2].params.approvalPolicy,
    sandbox: { type: frames[2].params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' },
  } }));
  const turn = JSON.parse(provider.getPendingTurnStart()!);
  provider.parseStreamLine(JSON.stringify({ id: turn.id, result: { turn: { id: 'turn' } } }));
  return provider;
}

const command = (extra = {}) => JSON.stringify({ id: 42, method: 'item/commandExecution/requestApproval',
  params: { threadId: 'thread', turnId: 'turn', command: 'echo fixture', cwd: '/workspace', ...extra } });
// Redacted native Codex 0.165.0 app-server request (2026-10-29).
const mcpApproval = (extra = {}) => ({ threadId: 'thread', turnId: 'turn', serverName: 'cats-desktop',
  mode: 'form', _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { window_id: 'window-1' } },
  message: 'Allow the cats-desktop MCP server to run tool "read_ui"?',
  requestedSchema: { type: 'object', properties: {} }, ...extra });
function host() {
  return { signal: new AbortController().signal,
    interactions: { request: vi.fn(() => 'runtime-id'), resolve: vi.fn(), unavailable: vi.fn() } } satisfies ProviderServerRequestContext;
}

describe('Codex native interaction mapping', () => {
  it('presents native MCP approval as Allow once and preserves accept, decline and cancel wire semantics', () => {
    const mapped = mapCodexInteraction('mcpServer/elicitation/request', mcpApproval());
    expect(mapped.prompt).toMatchObject({ kind: 'tool_approval', server: 'cats-desktop',
      choices: [{ id: 'accept', label: 'Allow once' }] });
    expect(mapped.prompt.message).toContain('read_ui');
    expect(mapped.prompt.message).toContain('window-1');
    expect(mapped.result({ action: 'accept', choice: 'accept' })).toEqual({ action: 'accept', content: {}, _meta: null });
    for (const action of ['decline', 'cancel'] as const) {
      expect(mapped.result({ action })).toEqual({ action, content: null, _meta: null });
    }
    expect(mapCodexInteraction('mcpServer/elicitation/request', mcpApproval({ _meta: {} })).prompt.kind).toBe('mcp_form');
  });

  it('does not discard changed MCP approval schemas or turn them into empty grants', () => {
    for (const extra of [
      { requestedSchema: { type: 'object', properties: { scope: { type: 'string' } } } },
      { requestedSchema: { type: 'object', properties: {}, anyOf: [] } },
      { mode: 'url', url: 'https://example.test' }, { serverName: '' }, { message: '' },
    ]) expect(() => mapCodexInteraction('mcpServer/elicitation/request', mcpApproval(extra))).toThrow('Unsupported');
  });

  it('keeps the same approval answerable as a form by a host that negotiated only forms', async () => {
    const provider = boot({ interactionHost: { version: 1, kinds: ['mcp_form'], timeoutMs: 60_000 } });
    const context = host();
    await provider.buildServerResponse(JSON.stringify({ id: 'form-consent', method: 'mcpServer/elicitation/request',
      params: mcpApproval() }), context);
    const input = context.interactions.request.mock.calls[0]![0] as unknown as
      Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0];
    expect(input.prompt.kind).toBe('mcp_form');
    expect(JSON.parse(input.response({ action: 'accept', values: {} })).result)
      .toEqual({ action: 'accept', content: {}, _meta: null });
  });

  it('holds a tool approval for its owner and fences duplicates, foreign turns and unsupported shapes', async () => {
    const provider = boot(); const context = host();
    const frame = (params = mcpApproval()) => JSON.stringify({ id: 'tool-consent', method: 'mcpServer/elicitation/request', params });
    expect(provider.buildAutoResponse(frame())).toBeNull();
    expect(await provider.buildServerResponse(frame(), context)).toBeNull();
    expect(provider.parseStreamLine(frame())).toBeNull();
    const input = context.interactions.request.mock.calls[0]![0] as unknown as
      Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0];
    expect(input.prompt.kind).toBe('tool_approval');
    expect(JSON.parse(input.response({ action: 'accept', choice: 'accept' }))).toMatchObject({
      id: 'tool-consent', result: { action: 'accept', content: {}, _meta: null },
    });
    expect(JSON.parse(input.fallback()).result.action).toBe('decline');
    await provider.buildServerResponse(frame(), context);
    expect(context.interactions.request).toHaveBeenCalledTimes(1);
    for (const params of [mcpApproval({ turnId: 'other' }), mcpApproval({ threadId: 'other' })]) {
      const other = host();
      expect(JSON.parse((await boot().buildServerResponse(frame(params), other))!).result.action).toBe('decline');
      expect(other.interactions.request).not.toHaveBeenCalled();
    }
    const invalid = host();
    await boot().buildServerResponse(frame(mcpApproval({ requestedSchema: { type: 'object', properties: { x: { type: 'string' } } } })), invalid);
    expect(invalid.interactions.unavailable).toHaveBeenCalledWith('tool_approval', 'unsupported_or_unavailable_interaction');
  });

  it('negotiates experimental methods and extended forms only for a capable host', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ cwd: '/workspace', interactionHost: { version: 1, kinds: ['user_input', 'mcp_form'], timeoutMs: 60_000 } });
    const initialize = JSON.parse(provider.buildStdinMessage('fixture').split('\n')[0]!);
    expect(initialize.params.capabilities).toEqual({ experimentalApi: true, extensions: { 'openai/form': {} } });
  });

  it('retains a declined-request tombstone and observable unsupported reason', async () => {
    const provider = boot(); const context = host();
    const frame = JSON.stringify({ id: 42, method: 'mcpServer/elicitation/request', params: {
      threadId: 'thread', turnId: 'turn', mode: 'openai/form', requestedSchema: { type: 'object', properties: { x: { type: 'object' } } },
    } });
    expect(JSON.parse((await provider.buildServerResponse(frame, context))!).result.action).toBe('decline');
    expect(await provider.buildServerResponse(frame, context)).toBeNull();
    expect(context.interactions.unavailable).toHaveBeenCalledOnce();
  });
  it('keeps legacy auto responses and negotiates callbacks only for opted-in callers', async () => {
    const legacy = boot({ interactionHost: undefined });
    expect(JSON.parse(legacy.buildAutoResponse(command())!).result.decision).toBe('accept');
    const provider = boot();
    const context = host();
    expect(provider.buildAutoResponse(command())).toBeNull();
    expect(await provider.buildServerResponse(command(), context)).toBeNull();
    const input = context.interactions.request.mock.calls[0]![0] as unknown as
      Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0];
    expect(input.prompt.command).toBe('echo fixture');
    expect(JSON.parse(input.response({ action: 'accept', choice: 'acceptForSession' })))
      .toEqual({ jsonrpc: '2.0', id: 42, result: { decision: 'acceptForSession' } });
    await provider.buildServerResponse(command(), context);
    expect(context.interactions.request).toHaveBeenCalledTimes(1);
    await provider.buildServerResponse(JSON.stringify({ method: 'serverRequest/resolved',
      params: { threadId: 'thread', requestId: 42 } }), context);
    expect(context.interactions.resolve).toHaveBeenCalledWith('runtime-id');
  });

  it('declines foreign, cancelled, read-only and non-allowlisted requests', async () => {
    for (const [provider, request] of [
      [boot(), command({ turnId: 'stale' })], [boot(), command({ threadId: 'foreign' })],
      [boot({ workspaceMode: 'read_only' }), command()],
      [boot({ permissionMode: 'whitelist', allowedTools: ['safe_command'] }), command()],
    ] as const) {
      const context = host();
      expect(JSON.parse((await provider.buildServerResponse(request, context))!).result.decision).toBe('decline');
      expect(context.interactions.request).not.toHaveBeenCalled();
    }
    const context = host();
    const controller = new AbortController(); controller.abort();
    context.signal = controller.signal;
    expect(JSON.parse((await boot().buildServerResponse(command(), context))!).result.decision).toBe('decline');
  });

  it('accepts a null MCP turn only within the current thread and excludes sensitive fields from events', async () => {
    const provider = boot();
    const context = host();
    const frame = JSON.stringify({ id: 'url', method: 'mcpServer/elicitation/request', params: {
      threadId: 'thread', turnId: null, serverName: 'fixture', mode: 'url',
      message: 'Sign in', url: 'https://example.test/one-time?private=marker', elicitationId: 'e',
    } });
    expect(await provider.buildServerResponse(frame, context)).toBeNull();
    expect(context.interactions.request).toHaveBeenCalledTimes(1);
    expect(provider.parseStreamLine(frame)).toBeNull();
  });

  it('maps typed questions and cancellation without fabricating empty successful answers', () => {
    const mapped = mapCodexInteraction('item/tool/requestUserInput', { questions: [
      { id: 'q', header: 'Question', question: 'Choose', options: [{ label: 'A', description: 'first' }], isOther: true, isSecret: true },
    ] });
    expect(mapped.prompt.fields?.[0]).toMatchObject({ id: 'q', secret: true, allowOther: true });
    expect(mapped.result({ action: 'accept', values: { q: 'A' } })).toEqual({ answers: { q: { answers: ['A'] } } });
    expect(JSON.parse(codexInteractionFallback('item/tool/requestUserInput', 1))).toHaveProperty('error');
  });

  it('grants only selected permission units and preserves turn scope', () => {
    const mapped = mapCodexInteraction('item/permissions/requestApproval', {
      permissions: { network: { enabled: true }, fileSystem: { read: ['/a', '/b'], write: ['/c'] } },
    });
    expect(mapped.result({ action: 'accept', grants: ['read-1'], scope: 'turn' }))
      .toEqual({ permissions: { fileSystem: { read: ['/b'], write: [] } }, scope: 'turn' });
    expect(() => mapCodexInteraction('item/permissions/requestApproval', {
      permissions: { fileSystem: { entries: [] } },
    })).toThrow('Unsupported');
  });

  it('rejects unknown form constraints and unsafe URL schemes instead of dropping them', () => {
    const schema = { type: 'object', required: ['count'], properties: {
      count: { type: 'integer', minimum: 1, maximum: 5 },
      tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
    } };
    expect(mcpFormFields(schema)[0]).toMatchObject({ type: 'integer', min: 1, max: 5, required: true });
    for (const property of [{ type: ['string'] }, { type: 'string', pattern: '^x' }, { type: 'object' },
      { type: 'string', enum: ['a', 'b'], oneOf: [{ const: 'a' }] },
      { type: 'string', oneOf: [{ const: 'a', maxLength: 0 }] },
      { type: 'array', enum: [['a']], items: { type: 'string', enum: ['a', 'b'] } },
      { type: 'array', anyOf: [{ minItems: 1 }], items: { type: 'string', enum: ['a', 'b'] } },
      { type: 'integer', enum: ['1', '2'] },
    ]) {
      expect(() => mcpFormFields({ type: 'object', properties: { x: property } })).toThrow('Unsupported');
    }
    expect(() => mapCodexInteraction('mcpServer/elicitation/request', { mode: 'url', url: 'file:///secret' })).toThrow('Unsupported');
  });
});
