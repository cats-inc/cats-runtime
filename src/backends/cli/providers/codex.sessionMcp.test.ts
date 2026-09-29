import { describe, expect, it } from 'vitest';
import { CodexProvider } from './codex.js';
import { toSessionMcpConnection } from '../../../core/sessionMcpServers.js';

const mcpServers = [
  {
    name: 'cats',
    transport: 'http' as const,
    url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
    bearerTokenEnvVar: 'CATS_MCP_CATS_TOKEN',
  },
  { name: 'app-ask', transport: 'http' as const, url: 'http://127.0.0.1:4000/mcp' },
];

describe('CodexProvider session MCP servers (SPEC-035)', () => {
  it('configures each server after app-server with a bearer variable and scoped approval', () => {
    const provider = new CodexProvider();
    const spawn = provider.buildSpawnArgs({ cwd: '/tmp', model: 'gpt-test', mcpServers });
    expect(spawn).toEqual([
      'app-server',
      '-c', 'model="gpt-test"',
      '-c', 'mcp_servers.cats.url="http://127.0.0.1:3000/api/code/agent-tools/mcp"',
      '-c', 'mcp_servers.cats.bearer_token_env_var="CATS_MCP_CATS_TOKEN"',
      '-c', 'mcp_servers.cats.default_tools_approval_mode="approve"',
      '-c', 'mcp_servers.app-ask.url="http://127.0.0.1:4000/mcp"',
      '-c', 'mcp_servers.app-ask.default_tools_approval_mode="approve"',
    ]);
    // Configured instance overrides still precede the session's own values.
    expect(provider.composeLaunchArgs(['-c', 'features.apps=false'], spawn).slice(0, 3))
      .toEqual(['app-server', '-c', 'features.apps=false']);
    expect(provider.capabilities.sessionMcpServers).toBe(true);
  });

  it('adds nothing when no servers are configured', () => {
    expect(new CodexProvider().buildSpawnArgs({ cwd: '/tmp' })).toEqual(['app-server']);
  });

  it('reports startup status for session servers only', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ cwd: '/tmp', mcpServers });
    const status = (name: string, value: string) => provider.parseStreamLine(JSON.stringify({
      jsonrpc: '2.0',
      method: 'mcpServer/startupStatus/updated',
      params: { threadId: 't1', name, status: value, error: null, failureReason: null },
    }));

    expect(status('cats', 'ready')).toMatchObject({
      type: 'progress',
      mcpServers: [{ name: 'cats', status: 'ready' }],
      metadata: { kind: 'mcp_servers', source: 'provider' },
    });
    expect(status('node_repl', 'ready')).toBeNull();
    expect(toSessionMcpConnection('ready')).toBe('connected');
    expect(toSessionMcpConnection('starting')).toBe('unknown');
    expect(toSessionMcpConnection('error')).toBe('failed');
  });

  it('keeps declining MCP elicitations', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ cwd: '/tmp', mcpServers });
    const response = provider.buildAutoResponse?.(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'mcpServer/elicitation/request',
      params: { serverName: 'cats' },
    }));
    expect(JSON.parse(response!)).toMatchObject({ id: 7, result: { action: 'decline' } });
  });
});
