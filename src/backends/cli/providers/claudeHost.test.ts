import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from './claude.js';
import { CLAUDE_INTERACTION_KINDS } from './claudeInteractions.js';
import type { ProviderServerRequestContext, ProviderSpawnOptions } from './types.js';

const host = { version: 1 as const, kinds: [...CLAUDE_INTERACTION_KINDS], timeoutMs: 60_000 };
function boot(options: Partial<ProviderSpawnOptions> = {}) {
  const provider = new ClaudeProvider();
  const args = provider.buildSpawnArgs({ cwd: '/workspace', interactionHost: host, ...options });
  return { provider, args };
}
function context(withHost = true) {
  return { signal: new AbortController().signal, ...(withHost ? { interactions: {
    request: vi.fn(() => 'runtime-id'), resolve: vi.fn(), unavailable: vi.fn() } } : {}) } satisfies ProviderServerRequestContext;
}
const frame = (request: Record<string, unknown>, id = 'cli-1') =>
  JSON.stringify({ type: 'control_request', request_id: id, request });
const reply = (line: string | null) => JSON.parse(line!).response;
const elicitation = { subtype: 'elicitation', mcp_server_name: 'fixture', message: 'Pick', mode: 'form',
  requested_schema: { type: 'object', properties: { a: { type: 'string' } } } };
const bash = { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'echo fixture' } };

describe('Claude adapter host control', () => {
  it('asks the host only when one was negotiated and keeps restricted sessions out of the user default mode', () => {
    expect(boot().args).toEqual(expect.arrayContaining(['--permission-prompt-tool', 'stdio']));
    expect(boot({ interactionHost: undefined }).args).not.toContain('--permission-prompt-tool');
    expect(boot({ interactionHost: undefined }).args).not.toContain('--permission-mode');
    const readOnly = boot({ workspaceMode: 'read_only', permissionMode: 'skip' }).args;
    expect(readOnly).toEqual(expect.arrayContaining(['--permission-mode', 'manual']));
    expect(readOnly).not.toContain('--dangerously-skip-permissions');
    expect(boot({ permissionMode: 'whitelist', allowedTools: ['Read'] }).args)
      .toEqual(expect.arrayContaining(['--permission-mode', 'manual', '--allowedTools', 'Read']));
    expect(boot({ permissionMode: 'skip' }).args).toContain('--dangerously-skip-permissions');
  });

  it('declines elicitation at once when no host was negotiated', async () => {
    const { provider } = boot({ interactionHost: undefined });
    const answer = reply(await provider.buildServerResponse(frame(elicitation), context(false)));
    expect(answer).toEqual({ subtype: 'success', request_id: 'cli-1', response: { action: 'decline' } });
  });

  it('registers a request, answers once and resolves on CLI cancellation', async () => {
    const { provider } = boot();
    const ctx = context();
    expect(await provider.buildServerResponse(frame(bash), ctx)).toBeNull();
    expect(await provider.buildServerResponse(frame(bash), ctx)).toBeNull();
    expect(ctx.interactions.request).toHaveBeenCalledOnce();
    const input = ctx.interactions.request.mock.calls[0]![0] as unknown as
      Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0];
    expect(input.prompt).toMatchObject({ kind: 'command_approval', command: 'echo fixture', cwd: '/workspace' });
    expect(reply(input.response({ action: 'accept', choice: 'accept' })).response)
      .toEqual({ behavior: 'allow', updatedInput: { command: 'echo fixture' } });
    await provider.buildServerResponse(JSON.stringify({ type: 'control_cancel_request', request_id: 'cli-1' }), ctx);
    expect(ctx.interactions.resolve).toHaveBeenCalledWith('runtime-id');
  });

  it('denies approvals a restricted or narrower host cannot grant but still relays questions', async () => {
    const restricted = boot({ workspaceMode: 'read_only' }).provider;
    const ctx = context();
    expect(reply(await restricted.buildServerResponse(frame(bash), ctx)).response).toMatchObject({ behavior: 'deny' });
    expect(ctx.interactions.unavailable).toHaveBeenCalledWith('command_approval', 'host_policy_restriction');
    const question = { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] } };
    expect(await restricted.buildServerResponse(frame(question, 'cli-2'), ctx)).toBeNull();
    const narrow = boot({ interactionHost: { ...host, kinds: ['user_input'] } }).provider;
    const other = context();
    const chrome = { subtype: 'can_use_tool', tool_name: 'mcp__claude-in-chrome__navigate', input: { url: 'https://example.com' } };
    expect(reply(await narrow.buildServerResponse(frame(chrome), other)).response).toMatchObject({ behavior: 'deny' });
    expect(other.interactions.unavailable).toHaveBeenCalledWith('tool_approval', 'kind_not_negotiated');
  });

  it('answers unknown control requests with an error and keeps control frames out of the event stream', async () => {
    const { provider } = boot();
    expect(reply(await provider.buildServerResponse(frame({ subtype: 'hook_callback' }), context())))
      .toEqual({ subtype: 'error', request_id: 'cli-1', error: 'Unsupported control request.' });
    expect(provider.parseStreamLine(frame(bash))).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'x' } }))).toBeNull();
    expect(await provider.buildServerResponse(JSON.stringify({ type: 'assistant', message: {} }), context())).toBeNull();
  });
});
