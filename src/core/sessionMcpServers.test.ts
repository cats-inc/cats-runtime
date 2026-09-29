import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_MCP_SERVERS,
  SessionMcpServerStore,
  parseSessionMcpServers,
  sessionMcpTokenEnvVar,
  toSessionMcpLaunchConfig,
  type SessionMcpServer,
} from './sessionMcpServers.js';

const TOKEN = 'synthetic-session-mcp-secret';

function server(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'cats',
    transport: 'http',
    url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
    auth: { kind: 'bearer_env', token: TOKEN },
    ...overrides,
  };
}

function parsedServers(value: unknown): SessionMcpServer[] {
  const parsed = parseSessionMcpServers(value);
  if (!parsed.ok || !parsed.servers) throw new Error('expected servers');
  return parsed.servers;
}

describe('parseSessionMcpServers', () => {
  it('keeps the current set when omitted and clears it with an empty list', () => {
    expect(parseSessionMcpServers(undefined)).toEqual({ ok: true, servers: undefined });
    expect(parseSessionMcpServers([])).toEqual({ ok: true, servers: [] });
  });

  it('accepts loopback http(s) servers with bearer_env or none auth', () => {
    expect(parsedServers([
      server(),
      server({ name: 'app-ask', url: 'https://localhost:4443/mcp', auth: { kind: 'none' } }),
      server({ name: 'agency-agents', url: 'http://[::1]:9000/mcp' }),
    ]).map((entry) => [entry.name, entry.url, entry.auth.kind])).toEqual([
      ['cats', 'http://127.0.0.1:3000/api/code/agent-tools/mcp', 'bearer_env'],
      ['app-ask', 'https://localhost:4443/mcp', 'none'],
      ['agency-agents', 'http://[::1]:9000/mcp', 'bearer_env'],
    ]);
  });

  it.each([
    ['a non-array', { name: 'cats' }],
    ['too many servers', Array.from({ length: MAX_SESSION_MCP_SERVERS + 1 }, (_, index) => server({ name: `s${index}` }))],
    ['an unknown entry key', [server({ headers: { Authorization: `Bearer ${TOKEN}` } })]],
    ['an invalid name', [server({ name: 'Cats_Tools' })]],
    ['a duplicate name', [server(), server()]],
    ['the reserved stdio transport', [server({ transport: 'stdio' })]],
    ['a non-loopback host', [server({ url: 'http://example.com/mcp' })]],
    ['URL credentials', [server({ url: `http://user:${TOKEN}@127.0.0.1/mcp` })]],
    ['a URL fragment', [server({ url: 'http://127.0.0.1/mcp#frag' })]],
    ['a non-http scheme', [server({ url: 'ws://127.0.0.1/mcp' })]],
    ['the reserved oauth_ref auth', [server({ auth: { kind: 'oauth_ref', ref: 'x' } })]],
    ['a token with whitespace', [server({ auth: { kind: 'bearer_env', token: `${TOKEN} extra` } })]],
    ['an empty token', [server({ auth: { kind: 'bearer_env', token: '' } })]],
    ['extra auth keys', [server({ auth: { kind: 'bearer_env', token: TOKEN, header: 'X' } })]],
  ])('rejects %s without echoing the token', (_label, value) => {
    const parsed = parseSessionMcpServers(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/^mcpServers: /);
      expect(parsed.error).not.toContain(TOKEN);
    }
  });
});

describe('session MCP launch configuration', () => {
  it('passes secrets only as environment contributions', () => {
    const launch = toSessionMcpLaunchConfig(parsedServers([
      server({ name: 'app-ask' }),
      server({ name: 'plain', auth: { kind: 'none' } }),
    ]));
    expect(launch.servers).toEqual([
      {
        name: 'app-ask',
        transport: 'http',
        url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
        bearerTokenEnvVar: 'CATS_MCP_APP_ASK_TOKEN',
      },
      { name: 'plain', transport: 'http', url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp' },
    ]);
    expect(JSON.stringify(launch.servers)).not.toContain(TOKEN);
    expect(launch.env).toEqual({ CATS_MCP_APP_ASK_TOKEN: TOKEN });
    expect(sessionMcpTokenEnvVar('cats')).toBe('CATS_MCP_CATS_TOKEN');
  });
});

describe('SessionMcpServerStore', () => {
  it('reports delivery against what the live worker was launched with', () => {
    const store = new SessionMcpServerStore();
    expect(store.report('s1', true)).toBeUndefined();

    const servers = parsedServers([server()]);
    store.apply('s1', servers);
    expect(store.report('s1', false)).toEqual({
      status: 'unsupported',
      servers: [{ name: 'cats', connection: 'unknown' }],
    });
    // A supporting worker that never received this set is not running it.
    expect(store.report('s1', true)?.status).toBe('failed');

    store.recordLaunch('s1', servers);
    expect(store.report('s1', true)?.status).toBe('delivered');

    store.apply('s1', undefined);
    expect(store.report('s1', true)?.status).toBe('delivered');

    store.apply('s1', parsedServers([server({ auth: { kind: 'bearer_env', token: `${TOKEN}-rotated` } })]));
    expect(store.report('s1', true)?.status).toBe('failed');

    store.recordLaunch('s1', []);
    expect(store.report('s1', true)?.status).toBe('failed');
    expect(store.report('s1', false)?.status).toBe('unsupported');
  });

  it('clears on an empty list or session removal and never reports secrets', () => {
    const store = new SessionMcpServerStore();
    store.apply('s1', parsedServers([server()]));
    store.recordLaunch('s1', store.get('s1'));
    expect(JSON.stringify(store.report('s1', true))).not.toContain(TOKEN);

    store.apply('s1', []);
    expect(store.get('s1')).toEqual([]);
    expect(store.report('s1', true)).toBeUndefined();

    store.apply('s2', parsedServers([server()]));
    store.remove('s2');
    expect(store.get('s2')).toEqual([]);
  });
});
