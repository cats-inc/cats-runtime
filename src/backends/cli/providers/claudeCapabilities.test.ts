import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from './claude.js';
import { CLAUDE_INTERACTION_KINDS } from './claudeInteractions.js';
import { claudeDependencies, claudeInventory, emptyClaudeInventory } from './claudeInventory.js';
import { claudeAdmitsPolicy, verifyClaudePolicy } from './claudePolicy.js';
import type { SessionExecutionPolicy } from '../../../core/interactions/policy.js';
import type { ProviderSpawnOptions } from './types.js';

const host = { version: 1 as const, kinds: [...CLAUDE_INTERACTION_KINDS], timeoutMs: 60_000 };
const explicit = (approval: 'never' | 'untrusted' | 'on-request'): SessionExecutionPolicy =>
  ({ version: 1, mode: 'explicit', access: 'full-access', network: true, approval });
const provider: SessionExecutionPolicy = { version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } };
const injected = [{ name: 'bot', url: 'http://127.0.0.1:1/mcp' }] as unknown as ProviderSpawnOptions['mcpServers'];
function boot(options: Partial<ProviderSpawnOptions> = {}) {
  const claude = new ClaudeProvider();
  const args = claude.buildSpawnArgs({ cwd: '/workspace', interactionHost: host, ...options });
  return { claude, args };
}
const admissionReply = (id: string, mode: string) => JSON.stringify({ type: 'control_response',
  response: { subtype: 'success', request_id: id, response: { current_permission_mode: mode, account: { email: 'private' } } } });

describe('Claude execution policy', () => {
  it('admits only the unrestricted ceiling and verifies the reported permission mode', () => {
    expect(claudeAdmitsPolicy(explicit('on-request'))).toBe(true);
    expect(claudeAdmitsPolicy({ version: 1, mode: 'explicit', access: 'workspace-write', network: false, approval: 'never' })).toBe(false);
    expect(claudeAdmitsPolicy({ version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: false } })).toBe(false);
    expect(verifyClaudePolicy(explicit('on-request'), 'default')).toMatchObject({ status: 'verified',
      observed: { access: 'full-access', network: true, approval: 'default', reviewer: 'user' } });
    expect(verifyClaudePolicy(explicit('never'), 'bypassPermissions')).toMatchObject({ status: 'verified', observed: { reviewer: 'none' } });
    expect(verifyClaudePolicy(explicit('never'), 'default')).toMatchObject({ status: 'mismatch' });
    expect(verifyClaudePolicy(provider, 'auto')).toMatchObject({ status: 'verified', observed: { reviewer: 'auto_classifier' } });
    expect(verifyClaudePolicy(provider, 'unknown-mode')).toMatchObject({ status: 'unsupported' });
  });

  it('launches the mode the policy needs and keeps interactive approval for injected MCP tools', () => {
    const asked = boot({ executionPolicy: explicit('on-request'), mcpServers: injected }).args;
    expect(asked).toEqual(expect.arrayContaining(['--permission-mode', 'manual']));
    expect(asked).not.toContain('--allowedTools');
    const never = boot({ executionPolicy: explicit('never'), mcpServers: injected }).args;
    expect(never).toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions', '--allowedTools', 'mcp__bot']));
    const inherited = boot({ executionPolicy: provider }).args;
    expect(inherited).not.toContain('--permission-mode');
    expect(() => boot({ executionPolicy: { version: 1, mode: 'explicit', access: 'workspace-write', network: false, approval: 'never' } }))
      .toThrow('cannot enforce');
    expect(() => boot({ executionPolicy: provider, interactionHost: undefined })).toThrow('interaction host');
  });

  it('holds the first turn until initialize confirms the mode, without exposing the reply', () => {
    const { claude } = boot({ executionPolicy: explicit('on-request') });
    const initialize = JSON.parse(claude.buildStdinMessage('first'));
    expect(initialize).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } });
    expect(claude.isSessionInitializing()).toBe(true);
    expect(claude.parseStreamLine(admissionReply(initialize.request_id, 'default'))).toBeNull();
    expect(claude.isSessionInitializing()).toBe(false);
    expect(JSON.parse(claude.getPendingControlMessages()!)).toMatchObject({ type: 'user', message: { content: expect.stringContaining('first') } });
    expect(claude.getPendingControlMessages()).toBeNull();
    expect(JSON.parse(claude.buildStdinMessage('second')).type).toBe('user');
  });

  it('ends the held turn when a managed setting changed the mode', () => {
    const { claude } = boot({ executionPolicy: explicit('never') });
    const initialize = JSON.parse(claude.buildStdinMessage('first'));
    const failed = claude.parseStreamLine(admissionReply(initialize.request_id, 'default'));
    expect(failed).toMatchObject({ type: 'error', text: expect.stringContaining('No model turn was started') });
    expect(claude.getPendingControlMessages()).toBeNull();
    expect(() => claude.buildStdinMessage('again')).toThrow('admission failed');
  });

  it('sends the turn directly without a policy', () => {
    const { claude } = boot();
    expect(JSON.parse(claude.buildStdinMessage('first')).type).toBe('user');
  });

  it('maps browser integration to Claude in Chrome flags and otherwise keeps the user default', () => {
    expect(new ClaudeProvider().capabilities.sessionCapabilities?.browserIntegration).toBe(true);
    expect(boot({ browserIntegration: true }).args).toContain('--chrome');
    expect(boot({ browserIntegration: false }).args).toContain('--no-chrome');
    const unset = boot().args;
    expect(unset).not.toContain('--chrome');
    expect(unset).not.toContain('--no-chrome');
  });
});

describe('Claude session inventory', () => {
  const status = { mcpServers: [
    { name: 'claude-in-chrome', status: 'connected', scope: 'dynamic', config: { command: 'private-path' }, tools: [{ name: 'navigate' }] },
    { name: 'claude.ai Gmail', status: 'pending', scope: 'claudeai', tools: [] },
    { name: 'bot', status: 'needs-auth', tools: [{ name: 'ask_owner' }] },
    { name: 'broken', status: 'failed', error: 'private-error', tools: [] },
  ] };

  it('maps mcp_status without configuration, errors or server details', () => {
    const inventory = claudeInventory(status, new Set(['bot']));
    expect(inventory.servers.map(server => [server.name, server.source, server.connection, server.discovery])).toEqual([
      ['claude-in-chrome', 'provider-configured', 'connected', 'advertised'],
      ['claude.ai Gmail', 'provider-configured', 'starting', 'advertised'],
      ['bot', 'session-injected', 'authenticationRequired', 'advertised'],
      ['broken', 'provider-configured', 'failed', 'failed'],
    ]);
    expect(inventory.state).toBe('partial');
    expect(inventory.servers[2]!.tools[0]!.qualifiedName).toBe('session/bot/ask_owner');
    expect(JSON.stringify(inventory)).not.toMatch(/private-path|private-error/);
  });

  it('reports a connected Chrome server as unknown and computer use as unavailable', () => {
    const [browser, computer] = claudeDependencies(claudeInventory(status, new Set()));
    expect(browser).toMatchObject({ kind: 'browser', status: 'unknown' });
    expect(computer).toMatchObject({ kind: 'computer_use', status: 'unavailable' });
    const none = claudeDependencies(claudeInventory({ mcpServers: [] }, new Set()))[0];
    expect(none).toMatchObject({ status: 'unavailable', remediation: expect.stringContaining('--chrome') });
    expect(claudeDependencies(emptyClaudeInventory())[0]).toMatchObject({ status: 'unknown' });
  });

  it('reads mcp_status through the worker without a model turn and adds built-ins after init', async () => {
    const { claude } = boot({ mcpServers: injected });
    const request = vi.fn(async (line: string) => {
      expect(JSON.parse(line)).toMatchObject({ type: 'control_request', request: { subtype: 'mcp_status' } });
      expect(JSON.parse(line).request_id).toMatch(/^cats-runtime-control-/);
      return status;
    });
    const before = await claude.readSessionCapabilities(request, false);
    expect(before.inventory.state).toBe('not_observed');
    expect(request).not.toHaveBeenCalled();
    claude.parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', tools: ['Read', 'Bash', 'mcp__bot__ask_owner'] }));
    const after = await claude.readSessionCapabilities(request, true);
    expect(after.inventory).toMatchObject({ builtins: 'observed', builtinTools: ['Read', 'Bash'] });
    expect(after.inventory.servers).toHaveLength(4);
    expect(after.interactions).toMatchObject({ supported: CLAUDE_INTERACTION_KINDS, host });
    expect(after.policy).toMatchObject({ source: 'legacy', status: 'not_observed' });
    const failing = await boot().claude.readSessionCapabilities(async () => { throw new Error('private'); }, true);
    expect(failing.inventory).toMatchObject({ state: 'unavailable', reason: 'provider_discovery_incomplete_or_unavailable' });
  });
});
