import { describe, expect, it, vi } from 'vitest';
import { CodexProvider } from './codex.js';
import { codexFormFields, codexInteractionFallback, mapCodexInteraction } from './codexInteractions.js';
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
function host() {
  return { signal: new AbortController().signal,
    interactions: { request: vi.fn(() => 'runtime-id'), resolve: vi.fn(), unavailable: vi.fn() } } satisfies ProviderServerRequestContext;
}

describe('Codex native interaction mapping', () => {
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
    expect(codexFormFields(schema)[0]).toMatchObject({ type: 'integer', min: 1, max: 5, required: true });
    for (const property of [{ type: ['string'] }, { type: 'string', pattern: '^x' }, { type: 'object' },
      { type: 'string', enum: ['a', 'b'], oneOf: [{ const: 'a' }] },
      { type: 'string', oneOf: [{ const: 'a', maxLength: 0 }] },
      { type: 'array', enum: [['a']], items: { type: 'string', enum: ['a', 'b'] } },
      { type: 'array', anyOf: [{ minItems: 1 }], items: { type: 'string', enum: ['a', 'b'] } },
      { type: 'integer', enum: ['1', '2'] },
    ]) {
      expect(() => codexFormFields({ type: 'object', properties: { x: property } })).toThrow('Unsupported');
    }
    expect(() => mapCodexInteraction('mcpServer/elicitation/request', { mode: 'url', url: 'file:///secret' })).toThrow('Unsupported');
  });
});
