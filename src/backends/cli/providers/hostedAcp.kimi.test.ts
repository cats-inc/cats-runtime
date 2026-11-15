import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { HostedAcpProvider } from './hostedAcp.js';
import type { ProviderServerRequestContext, ProviderSpawnOptions, StreamEvent } from './types.js';
import type { KimiComputerUseHost } from '../kimi/computerUse.js';

// Kimi Code 2.6.0 `kimi acp`, captured on Windows 11 on 2026-11-16 (docs/research/2026-11-16-kimi-code-cli-provider.md).
const captures = new URL('../../../../tests/fixtures/provider-captures/kimi-2.6.0/', import.meta.url);
const capture = (name: string) => readFileSync(fileURLToPath(new URL(name, captures)), 'utf8').trim();
const json = (name: string) => JSON.parse(capture(name));
const parse = (text: string) => JSON.parse(text);
const events = (parsed: StreamEvent | StreamEvent[] | null) => parsed ? Array.isArray(parsed) ? parsed : [parsed] : [];

const options: ProviderSpawnOptions = { cwd: '/workspace', interactionHost: { version: 1,
  kinds: ['command_approval', 'file_approval', 'tool_approval'], timeoutMs: 60_000 },
executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } } };

function fakeHost(overrides: Partial<KimiComputerUseHost> = {}): KimiComputerUseHost {
  return { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Local' }, exists: () => true,
    nodeVersion: async () => 'v24.15.0', ...overrides };
}
function create(extra: Partial<ProviderSpawnOptions> = {}, host = fakeHost()) {
  const provider = new HostedAcpProvider('kimi', host);
  provider.configureExecution({ localWorkspaceCwd: '/workspace', sessionMcpToken: () => 'fixture-secret' });
  return { provider, args: provider.buildSpawnArgs({ ...options, ...extra }) };
}
function reply(provider: HostedAcpProvider, request: { id: string }, result: object) {
  return provider.parseStreamLine(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}
/** The captured session/new result: mode `default`, model `kimi-code/kimi-for-coding`. */
const sessionNew = () => json('acp-session-new.success.redacted.json');
function withOption(result: { configOptions: Array<{ id: string; currentValue: string }> }, id: string, value: string) {
  return { ...result, configOptions: result.configOptions.map(option => option.id === id ? { ...option, currentValue: value } : option) };
}
function boot(extra: Partial<ProviderSpawnOptions> = {}, host = fakeHost()) {
  const { provider, args } = create(extra, host);
  reply(provider, parse(provider.buildInitialization()!), json('acp-initialize.success.redacted.json'));
  const start = parse(provider.getPendingControlMessages()!);
  const init = events(reply(provider, start, sessionNew()));
  return { provider, args, start, init };
}
const host = () => ({ signal: new AbortController().signal, interactions: {
  request: vi.fn((_input: Parameters<NonNullable<ProviderServerRequestContext['interactions']>['request']>[0]) => 'card'),
  resolve: vi.fn(),
  supersede: vi.fn(),
} });

describe('hosted Kimi ACP', () => {
  it('starts `kimi acp` only under an unrestricted provider policy and refuses approval-changing flags', () => {
    const { provider, args } = create();
    expect(args).toEqual(['acp']);
    expect(provider.composeLaunchArgs(['--add-dir', '/extra'], args)).toEqual(['--add-dir', '/extra', 'acp']);
    for (const flag of ['--yolo', '-y', '--auto', '--plan', 'acp', '--session=abc', '-c']) {
      expect(() => provider.composeLaunchArgs([flag], args)).toThrow('conflict');
    }
    expect(() => create({ executionPolicy: undefined })).toThrow('require provider configuration');
    expect(() => create({ executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'workspace-write', network: true } } }))
      .toThrow('full machine');
  });

  it('admits a turn on a captured Default-mode session without changing it', () => {
    const { provider, start, init } = boot();
    expect(start).toMatchObject({ method: 'session/new', params: { cwd: '/workspace', mcpServers: [] } });
    expect(init).toMatchObject([{ type: 'init', sessionId: 'session_fixture' }]);
    expect(provider.getPendingControlMessages()).toBeNull();
  });

  it('sets Default mode and the requested model, confirming each before admitting a prompt', () => {
    const { provider } = create({ model: 'kimi-code/k3' });
    reply(provider, parse(provider.buildStdinMessage('queued until Kimi confirms')), json('acp-initialize.success.redacted.json'));
    const start = parse(provider.getPendingControlMessages()!);
    // A user's config can start sessions in YOLO ("Auto-approve everything").
    expect(reply(provider, start, withOption(sessionNew(), 'mode', 'yolo'))).toBeNull();
    const mode = parse(provider.getPendingControlMessages()!);
    expect(mode).toMatchObject({ method: 'session/set_config_option', params: { sessionId: 'session_fixture', configId: 'mode', value: 'default' } });
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(reply(provider, mode, sessionNew())).toBeNull();
    const model = parse(provider.getPendingControlMessages()!);
    expect(model).toMatchObject({ method: 'session/set_config_option', params: { configId: 'model', value: 'kimi-code/k3' } });
    expect(events(reply(provider, model, withOption(sessionNew(), 'model', 'kimi-code/k3')))).toMatchObject([{ type: 'init' }]);
    expect(parse(provider.getPendingTurnStart()!)).toMatchObject({ method: 'session/prompt' });
  });

  it('fails instead of prompting when Kimi does not confirm Default mode', () => {
    const { provider } = create();
    reply(provider, parse(provider.buildStdinMessage('never sent')), json('acp-initialize.success.redacted.json'));
    reply(provider, parse(provider.getPendingControlMessages()!), withOption(sessionNew(), 'mode', 'yolo'));
    const mode = parse(provider.getPendingControlMessages()!);
    expect(events(reply(provider, mode, withOption(sessionNew(), 'mode', 'auto')))).toMatchObject([{ type: 'error',
      text: expect.stringContaining('Default approval mode') }]);
    expect(provider.isSessionFailed()).toBe(true);
    expect(provider.getPendingTurnStart()).toBeNull();
  });

  it('resumes with session/resume and classifies the captured unknown-session answer', () => {
    const { provider } = create({ resumeSessionId: 'session_fixture' });
    reply(provider, parse(provider.buildInitialization()!), json('acp-initialize.success.redacted.json'));
    const resume = parse(provider.getPendingControlMessages()!);
    expect(resume).toMatchObject({ method: 'session/resume', params: { sessionId: 'session_fixture', cwd: '/workspace' } });
    const missing = { ...parse(capture('acp-resume-missing.error.redacted.ndjson')), id: resume.id };
    expect(events(provider.parseStreamLine(JSON.stringify(missing)))).toMatchObject([{ type: 'error', code: 'provider_session_unavailable' }]);
  });

  it('keeps the plan error generic', () => {
    const { provider } = boot();
    const turn = parse(provider.buildStdinMessage('fixture'));
    const failure = { ...parse(capture('acp-prompt-plan-required.error.redacted.ndjson')), id: turn.id };
    const [event] = events(provider.parseStreamLine(JSON.stringify(failure)));
    expect(event).toMatchObject({ type: 'error' });
    expect(event).not.toHaveProperty('code');
  });

  it('shows the streamed JavaScript cell on the computer-use approval card and offers only one-call approval', async () => {
    const { provider } = boot(); const context = host();
    parse(provider.buildStdinMessage('fixture'));
    let card: Parameters<typeof context.interactions.request>[0] | undefined;
    for (const line of capture('acp-plugin-tool-permission.success.redacted.ndjson').split('\n')) {
      const frame = parse(line);
      if (frame.method === 'session/request_permission') {
        expect(frame.params.toolCall.rawInput).toBeUndefined();
        expect(provider.buildAutoResponse(line)).toBeNull();
        await provider.buildServerResponse(line, context);
        card = context.interactions.request.mock.calls[0]![0];
        expect(provider.isAwaitingNativeWork()).toBe(true);
        expect(parse(card.response({ action: 'accept' })).result).toEqual({ outcome: { outcome: 'selected', optionId: 'approve_once' } });
      } else {
        await provider.buildServerResponse(line, context);
        provider.parseStreamLine(line);
      }
    }
    expect(card!.prompt).toMatchObject({ kind: 'tool_approval', title: 'mcp__plugin-kimi-cu-win_win__js',
      choices: [{ id: 'approve_once', label: 'Approve once' }] });
    expect(card!.prompt.message).toContain("nodeRepl.write('probe-ok')");
    expect(card!.prompt.message).toContain('Scope: this action only');
    expect(context.interactions.resolve).toHaveBeenCalledWith('card');
    expect(provider.isAwaitingNativeWork()).toBe(false);
  });

  it('declines through the reject option and cancels when the host cannot show tool approvals', async () => {
    const { provider } = boot(); const context = host();
    provider.buildStdinMessage('fixture');
    const lines = capture('acp-plugin-tool-permission.success.redacted.ndjson').split('\n');
    const permission = lines.find(line => line.includes('session/request_permission'))!;
    for (const line of lines.slice(0, lines.indexOf(permission))) provider.parseStreamLine(line);
    await provider.buildServerResponse(permission, context);
    expect(parse(context.interactions.request.mock.calls[0]![0].response({ action: 'decline' })).result)
      .toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    const bare = boot({ interactionHost: { version: 1, kinds: ['command_approval'], timeoutMs: 60_000 } }).provider;
    bare.buildStdinMessage('fixture');
    const unavailable = vi.fn();
    expect(parse((await bare.buildServerResponse(permission, { signal: new AbortController().signal,
      interactions: { request: vi.fn(), resolve: vi.fn(), unavailable } }))!).result).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(unavailable).toHaveBeenCalledWith('tool_approval', 'no_supported_one_action_permission');
  });

  it('reports a tool result with an image as its text reference, never image bytes', () => {
    const { provider } = boot();
    provider.buildStdinMessage('fixture');
    const update = json('acp-plugin-image-result.success.redacted.json');
    provider.parseStreamLine(JSON.stringify({ ...update, params: { ...update.params, update: { ...update.params.update, status: 'in_progress' } } }));
    const [result] = events(provider.parseStreamLine(JSON.stringify(update)));
    expect(result).toMatchObject({ type: 'tool_result', isError: false });
    expect(JSON.stringify(result)).toContain('kimi-file://f_mcp_');
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('reports the computer-use plugin from the captured skill list', async () => {
    const commands = { method: 'session/update', params: { sessionId: 'session_fixture', update: json('acp-available-commands.redacted.json') } };
    const ready = boot().provider;
    expect((await ready.readSessionCapabilities(vi.fn(), false)).dependencies).toMatchObject([{ kind: 'computer_use', status: 'unknown' }]);
    ready.parseStreamLine(JSON.stringify(commands));
    const snapshot = await ready.readSessionCapabilities(vi.fn(), false);
    expect(snapshot.dependencies).toMatchObject([{ kind: 'computer_use', status: 'available' }]);
    expect(snapshot.policy).toMatchObject({ source: 'provider', status: 'verified', reason: 'unrestricted_ceiling_kimi_default_approval_mode' });
    const withoutPlugin = boot().provider;
    const update = json('acp-available-commands.redacted.json');
    withoutPlugin.parseStreamLine(JSON.stringify({ ...commands, params: { ...commands.params, update: { ...update,
      availableCommands: update.availableCommands.filter((command: { name: string }) => !command.name.startsWith('skill:kimi-cu')) } } }));
    expect((await withoutPlugin.readSessionCapabilities(vi.fn(), false)).dependencies).toMatchObject([{ status: 'unavailable',
      remediation: expect.stringContaining('/plugins') }]);
  });

  it('sends session MCP grants in the private session/new frame only', () => {
    const { provider, start, args } = boot({ mcpServers: [{ name: 'cats-bot', transport: 'http', url: 'http://127.0.0.1:12345/mcp', bearerTokenEnvVar: 'TOKEN' }] });
    expect(provider.capabilities.sessionMcpServers).toBe(true);
    expect(start.params.mcpServers).toEqual([{ type: 'http', name: 'cats-bot', url: 'http://127.0.0.1:12345/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer fixture-secret' }] }]);
    expect(JSON.stringify(args)).not.toContain('fixture-secret');
  });
});
