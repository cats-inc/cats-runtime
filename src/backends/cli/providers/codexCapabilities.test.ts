import { describe, expect, it, vi } from 'vitest';
import { CodexProvider } from './codex.js';
import { INTERACTION_KINDS } from '../../../core/interactions/types.js';
import type { ProviderSpawnOptions } from './types.js';

const host = { version: 1 as const, kinds: [...INTERACTION_KINDS], timeoutMs: 60_000 };
const policy = { version: 1 as const, mode: 'explicit' as const, access: 'workspace-write' as const,
  network: false, approval: 'on-request' as const };
const observed = { cwd: process.cwd(), thread: { id: 'thread' }, sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
  approvalPolicy: 'on-request', approvalsReviewer: 'user' };

function configure(options: Partial<ProviderSpawnOptions> = {}) {
  const provider = new CodexProvider();
  provider.buildSpawnArgs({ cwd: process.cwd(), interactionHost: host, executionPolicy: policy, ...options });
  return provider;
}
function bootstrap(provider: CodexProvider, pendingTurn = true, layers: unknown[] = []) {
  const frames = (pendingTurn ? provider.buildStdinMessage('fixture') : provider.buildInitialization()!)
    .trim().split('\n').map(line => JSON.parse(line));
  expect(frames.map(frame => frame.method)).toEqual(['initialize', 'initialized', 'config/read']);
  provider.parseStreamLine(JSON.stringify({ id: frames[0].id, result: {} }));
  const result = provider.parseStreamLine(JSON.stringify({ id: frames[2].id, result: { config: {}, layers } }));
  const next = provider.getPendingControlMessages();
  return { result, thread: next ? JSON.parse(next) : null };
}

describe('Codex policy and session discovery', () => {
  it('verifies effective policy before sending the queued model turn', async () => {
    const provider = configure();
    const { thread } = bootstrap(provider);
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(thread.params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
    expect(provider.parseStreamLine(JSON.stringify({ id: thread.id, result: observed }))).toMatchObject({ type: 'init' });
    expect(JSON.parse(provider.getPendingTurnStart()!).method).toBe('turn/start');
    const report = await provider.readSessionCapabilities(vi.fn(), false);
    expect(report.policy).toMatchObject({ source: 'explicit', status: 'verified', observed: { network: false } });
  });
  it('inherits provider policy without overriding it and rejects an excessive effective policy', async () => {
    const provider = configure({ executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'workspace-write', network: false } } });
    const { thread } = bootstrap(provider);
    expect(thread.params).not.toHaveProperty('sandbox'); expect(thread.params).not.toHaveProperty('approvalPolicy');
    const event = provider.parseStreamLine(JSON.stringify({ id: thread.id, result: { ...observed, sandbox: { type: 'dangerFullAccess' } } }));
    expect(event).toMatchObject({ type: 'error' });
    expect(provider.getPendingTurnStart()).toBeNull();
    expect((await provider.readSessionCapabilities(vi.fn(), false)).policy.status).toBe('mismatch');
  });
  it('blocks lower-layer and command-override MCP collisions before the thread starts', () => {
    const server = { name: 'fixture', transport: 'http' as const, url: 'http://127.0.0.1:1234/mcp' };
    const provider = configure({ mcpServers: [server] });
    const { result, thread } = bootstrap(provider, true, [{ name: { type: 'user' }, config: { mcp_servers: { fixture: {} } } }]);
    expect(result).toMatchObject({ type: 'error' }); expect(thread).toBeNull(); expect(provider.getPendingTurnStart()).toBeNull();
    const next = configure({ mcpServers: [server] });
    expect(() => next.composeLaunchArgs(['-c', 'mcp_servers.fixture.command="fixture"'], ['app-server'])).toThrow('conflicts');
    expect(next.buildSpawnArgs({ cwd: process.cwd(), interactionHost: host, executionPolicy: policy, mcpServers: [server] }).join(' ')).not.toContain('default_tools_approval_mode');
  });
  it('initializes and reads paginated top-level inventory without creating a model turn', async () => {
    const provider = configure();
    const { thread } = bootstrap(provider, false);
    provider.parseStreamLine(JSON.stringify({ id: thread.id, result: observed }));
    expect(provider.getPendingTurnStart()).toBeNull();
    const request = vi.fn(async (line: string) => {
      const frame = JSON.parse(line);
      expect(frame.method).toBe('mcpServerStatus/list'); expect(frame.params.threadId).toBe('thread');
      return frame.params.cursor ? { data: [{ name: 'cua_repl', authStatus: 'unsupported', tools: { js: {} } }], nextCursor: null }
        : { data: [{ name: 'codex_apps', authStatus: 'bearerToken', tools: { search: {} } }], nextCursor: 'next' };
    });
    const report = await provider.readSessionCapabilities(request, true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(report.inventory).toMatchObject({ state: 'observed', pages: 2, coverage: 'top-level-mcp' });
    expect(report.inventory.servers.map(server => server.name)).toEqual(['codex_apps', 'cua_repl']);
    expect(report.dependencies.every(dependency => dependency.status === 'unknown')).toBe(true);
    expect(provider.getPendingTurnStart()).toBeNull();
  });
  it('reports partial/repeated pagination and safely declines out-of-turn elicitation', async () => {
    const provider = configure(); const { thread } = bootstrap(provider, false);
    provider.parseStreamLine(JSON.stringify({ id: thread.id, result: observed }));
    const report = await provider.readSessionCapabilities(async () => ({ data: [], nextCursor: 'repeated' }), true);
    expect(report.inventory.state).toBe('partial'); expect(report.inventory.pages).toBe(2);
    const question = JSON.stringify({ id: 999, method: 'item/tool/requestUserInput', params: {} });
    expect(JSON.parse(provider.buildAutoResponse(question)!)).toHaveProperty('error');
    expect(provider.buildAutoResponse(question)).toBeNull();
  });
  it('does not offer later network/write grants that exceed a verified read-only admission', async () => {
    const provider = configure({ executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'read-only', network: false } } });
    const { thread } = bootstrap(provider);
    provider.parseStreamLine(JSON.stringify({ id: thread.id, result: { ...observed, sandbox: { type: 'readOnly', networkAccess: false } } }));
    const turn = JSON.parse(provider.getPendingTurnStart()!);
    provider.parseStreamLine(JSON.stringify({ id: turn.id, result: { turn: { id: 'turn' } } }));
    const request = vi.fn(); const unavailable = vi.fn();
    const response = await provider.buildServerResponse(JSON.stringify({ id: 'permission', method: 'item/permissions/requestApproval',
      params: { threadId: 'thread', turnId: 'turn', permissions: { network: { enabled: true }, fileSystem: { write: [process.cwd()] } } } }),
    { signal: new AbortController().signal, interactions: { request, unavailable, resolve: vi.fn() } });
    expect(JSON.parse(response!).result.permissions).toEqual({});
    expect(request).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith('permission_grant', 'host_policy_restriction');
  });
});
