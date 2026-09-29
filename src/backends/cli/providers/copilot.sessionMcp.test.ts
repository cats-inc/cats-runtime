import { describe, expect, it } from 'vitest';
import { CopilotProvider } from './copilot.js';
import {
  toSessionMcpConnection,
  toSessionMcpLaunchConfig,
} from '../../../core/sessionMcpServers.js';

const TOKEN = 'synthetic-copilot-session-mcp-secret';
const launch = toSessionMcpLaunchConfig([
  {
    name: 'cats',
    transport: 'http',
    url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
    auth: { kind: 'bearer_env', token: TOKEN },
  },
  { name: 'app-ask', transport: 'http', url: 'http://127.0.0.1:4000/mcp', auth: { kind: 'none' } },
]);

function additionalMcpConfig(args: string[]): unknown {
  const index = args.indexOf('--additional-mcp-config');
  expect(index).toBeGreaterThanOrEqual(0);
  return JSON.parse(args[index + 1]!);
}

describe('CopilotProvider session MCP servers (SPEC-035)', () => {
  it('adds the servers for this run with the bearer read from the environment', () => {
    const provider = new CopilotProvider();
    provider.prepareEphemeralTurn({ message: 'hello' });
    const args = provider.buildSpawnArgs({ cwd: '/tmp', mcpServers: launch.servers });

    expect(additionalMcpConfig(args)).toEqual({
      mcpServers: {
        cats: {
          type: 'http',
          url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
          headers: { Authorization: 'Bearer ${CATS_MCP_CATS_TOKEN}' },
          tools: ['*'],
        },
        'app-ask': { type: 'http', url: 'http://127.0.0.1:4000/mcp', tools: ['*'] },
      },
    });
    // The token travels only in the child environment, never in argv.
    expect(JSON.stringify(args)).not.toContain(TOKEN);
    expect(launch.env).toEqual({ CATS_MCP_CATS_TOKEN: TOKEN });
    // The prompt stays last, and the existing tool approval covers the servers.
    expect(args.slice(-2)).toEqual(['-p', 'hello']);
    expect(args).toContain('--allow-all-tools');
    expect(provider.capabilities.sessionMcpServers).toBe(true);
  });

  it('keeps the servers on resumed turns and under --yolo', () => {
    const provider = new CopilotProvider();
    const args = provider.buildSpawnArgs({
      cwd: '/tmp',
      resumeSessionId: 'session-1',
      permissionMode: 'skip',
      mcpServers: launch.servers,
    });
    expect(args).toContain('--yolo');
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2))
      .toEqual(['--resume', 'session-1']);
    expect(additionalMcpConfig(args)).toMatchObject({ mcpServers: { cats: { type: 'http' } } });
  });

  it('adds nothing when no servers are configured', () => {
    const args = new CopilotProvider().buildSpawnArgs({ cwd: '/tmp' });
    expect(args).not.toContain('--additional-mcp-config');
  });

  it('reports connection states for session servers only', () => {
    const provider = new CopilotProvider();
    provider.buildSpawnArgs({ cwd: '/tmp', mcpServers: launch.servers });
    const changed = (serverName: string, status: string) => provider.parseStreamLine(JSON.stringify({
      type: 'session.mcp_server_status_changed',
      data: { serverName, status },
      ephemeral: true,
    }));

    expect(changed('cats', 'connected')).toMatchObject({
      type: 'progress',
      mcpServers: [{ name: 'cats', status: 'connected' }],
      metadata: { kind: 'mcp_servers', source: 'provider', provider: 'copilot' },
    });
    expect(changed('github-mcp-server', 'connected')).toBeNull();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'session.mcp_servers_loaded',
      data: {
        servers: [
          { name: 'github-mcp-server', status: 'connected', source: 'builtin' },
          { name: 'cats', status: 'connected' },
          { name: 'app-ask', status: 'needs-auth' },
        ],
      },
    }))).toMatchObject({
      type: 'progress',
      mcpServers: [
        { name: 'cats', status: 'connected' },
        { name: 'app-ask', status: 'needs-auth' },
      ],
    });
    expect(toSessionMcpConnection('connected')).toBe('connected');
    expect(toSessionMcpConnection('needs-auth')).toBe('failed');
    expect(toSessionMcpConnection('pending')).toBe('unknown');
  });

  it('ignores MCP status events when the run has no session servers', () => {
    const provider = new CopilotProvider();
    provider.buildSpawnArgs({ cwd: '/tmp' });
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'session.mcp_server_status_changed',
      data: { serverName: 'cats', status: 'connected' },
    }))).toBeNull();
  });
});
