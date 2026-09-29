import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp, type AppContext } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { ProviderSpawnOptions } from '../core/types.js';

const TOKEN = 'synthetic-session-mcp-secret';
const MCP_SERVERS = [{
  name: 'cats',
  transport: 'http',
  url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
  auth: { kind: 'bearer_env', token: TOKEN },
}];

describe('session MCP servers HTTP contract (SPEC-035)', () => {
  let rootDir: string;
  let dataDir: string;
  let sessionBaseDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let context: AppContext;

  function instance(providerName: string, id: string, mode: 'native' | 'wsl') {
    return {
      id,
      providerName,
      commandConfig: {
        path: providerName,
        runner: 'auto',
        runtime: mode === 'wsl' ? { mode, distro: 'Ubuntu' } : { mode },
      },
    };
  }

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3100,
      apiKey: '',
      sessionBaseDir,
      claudePath: 'claude',
      codexPath: 'codex',
      providerCommands: {
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
        codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: { claude: 'default', codex: 'default' },
      providerInstances: {
        claude: {
          default: instance('claude', 'default', 'native'),
          wsl: instance('claude', 'wsl', 'wsl'),
        },
        codex: { default: instance('codex', 'default', 'native') },
      },
      maxSessions: 10,
    } as unknown as CliRuntimeConfig;
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-session-mcp-'));
    dataDir = join(rootDir, 'data');
    sessionBaseDir = join(rootDir, 'sessions');
    mkdirSync(join(rootDir, 'repo'), { recursive: true });
    mkdirSync(sessionBaseDir, { recursive: true });
    registry = new SessionRegistry(dataDir, sessionBaseDir);
    pool = {
      // Only Claude opts in, so both outcomes are exercised without a real adapter.
      getCapabilities: vi.fn((providerName: string) => ({
        resume: true,
        fork: true,
        permissions: true,
        sessionMcpServers: providerName === 'claude',
      })),
      get: vi.fn(() => undefined),
      isAttached: vi.fn(() => false),
      spawn: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
    context = {
      config: makeConfig(),
      registry,
      pool,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
    } as AppContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(rootDir, { recursive: true, force: true });
  });

  async function createSession(body: Record<string, unknown>) {
    const app = createApp(context);
    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: join(rootDir, 'repo'), workspaceMode: 'shared', ...body }),
    });
    return { app, response, text: await response.text() };
  }

  function lastSpawn(): { opts: ProviderSpawnOptions; env: unknown } {
    const call = vi.mocked(pool.spawn).mock.calls.at(-1)!;
    return { opts: call[2] as ProviderSpawnOptions, env: call[4] };
  }

  it('configures a supporting native adapter without exposing the token', async () => {
    const { app, response, text } = await createSession({ provider: 'claude', mcpServers: MCP_SERVERS });
    expect(response.status, text).toBe(201);
    const created = JSON.parse(text) as { id: string; mcpServers: unknown };
    expect(created.mcpServers).toEqual({
      status: 'delivered',
      servers: [{ name: 'cats', connection: 'unknown' }],
    });
    expect(text).not.toContain(TOKEN);

    const { opts, env } = lastSpawn();
    expect(opts.mcpServers).toEqual([{
      name: 'cats',
      transport: 'http',
      url: 'http://127.0.0.1:3000/api/code/agent-tools/mcp',
      bearerTokenEnvVar: 'CATS_MCP_CATS_TOKEN',
    }]);
    expect(JSON.stringify(opts)).not.toContain(TOKEN);
    expect(env).toEqual({ CATS_MCP_CATS_TOKEN: TOKEN });

    const list = await (await app.request('/sessions')).text();
    const detail = await (await app.request(`/sessions/${created.id}`)).text();
    registry.flush(true);
    const persisted = readFileSync(join(dataDir, 'sessions.json'), 'utf8');
    for (const output of [list, detail, persisted]) {
      expect(output).toContain(created.id);
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain('agent-tools/mcp');
    }
  });

  it('reports unsupported and passes nothing for adapters without support', async () => {
    const { response, text } = await createSession({ provider: 'codex', mcpServers: MCP_SERVERS });
    expect(response.status, text).toBe(201);
    expect(JSON.parse(text).mcpServers).toMatchObject({ status: 'unsupported' });
    const { opts, env } = lastSpawn();
    expect(opts.mcpServers).toBeUndefined();
    expect(env).toBeUndefined();
  });

  it('reports unsupported for a non-native runtime even when the adapter supports it', async () => {
    const { response, text } = await createSession({
      provider: 'claude', instance: 'wsl', mcpServers: MCP_SERVERS,
    });
    expect(response.status, text).toBe(201);
    expect(JSON.parse(text).mcpServers).toMatchObject({ status: 'unsupported' });
    expect(lastSpawn().env).toBeUndefined();
  });

  it('omits the report when no servers are configured', async () => {
    const { response, text } = await createSession({ provider: 'claude' });
    expect(response.status, text).toBe(201);
    expect(JSON.parse(text)).not.toHaveProperty('mcpServers');
    expect(lastSpawn().opts.mcpServers).toBeUndefined();
  });

  it('rejects invalid descriptors with 400 and no token in the error', async () => {
    const { response, text } = await createSession({
      provider: 'claude',
      mcpServers: [{ ...MCP_SERVERS[0], url: 'https://example.com/mcp' }],
    });
    expect(response.status).toBe(400);
    expect(text).toContain('mcpServers');
    expect(text).not.toContain(TOKEN);
    expect(pool.spawn).not.toHaveBeenCalled();
  });

  it('lets resume resupply descriptors after the in-memory set was lost', async () => {
    const { app, text } = await createSession({ provider: 'claude' });
    const { id } = JSON.parse(text) as { id: string };
    registry.setProviderSessionId(id, 'native-claude-session');
    registry.updateStatus(id, 'closed');

    const invalid = await app.request(`/sessions/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: 'cats' }),
    });
    expect(invalid.status).toBe(400);

    const resumed = await app.request(`/sessions/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: MCP_SERVERS }),
    });
    const resumedText = await resumed.text();
    expect(resumed.status, resumedText).toBe(200);
    expect(JSON.parse(resumedText).mcpServers).toMatchObject({ status: 'delivered' });
    expect(resumedText).not.toContain(TOKEN);
    expect(lastSpawn().env).toEqual({ CATS_MCP_CATS_TOKEN: TOKEN });
  });

  it('recycles a live supporting worker through resume when a send changes the set', async () => {
    const { app, text } = await createSession({ provider: 'claude' });
    const { id } = JSON.parse(text) as { id: string };
    registry.setProviderSessionId(id, 'native-claude-session');
    registry.updateStatus(id, 'ready');
    const streamMessage = vi.fn(async function* () { yield { type: 'result' as const }; });
    vi.mocked(pool.get).mockReturnValue({ alive: true, busy: false, streamMessage } as never);
    vi.mocked(pool.spawn).mockClear();

    const response = await app.request(`/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ message: 'hello', mcpServers: MCP_SERVERS }),
    });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).not.toContain(TOKEN);
    expect(pool.kill).toHaveBeenCalledWith(id);
    const { opts, env } = lastSpawn();
    expect(opts).toMatchObject({ resumeSessionId: 'native-claude-session' });
    expect(opts.mcpServers).toEqual([expect.objectContaining({ name: 'cats', bearerTokenEnvVar: 'CATS_MCP_CATS_TOKEN' })]);
    expect(env).toEqual({ CATS_MCP_CATS_TOKEN: TOKEN });
    expect(JSON.parse(body.split('\n')[0]!)).toMatchObject({
      type: 'progress',
      metadata: { kind: 'mcp_servers', mcpServers: { status: 'delivered' } },
    });

    // An unchanged set on the next turn does not restart the worker again.
    vi.mocked(pool.kill).mockClear();
    await (await app.request(`/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ message: 'again', mcpServers: MCP_SERVERS }),
    })).text();
    expect(pool.kill).not.toHaveBeenCalled();
  });

  it('closes the session and returns 500 when the recycle cannot start a worker', async () => {
    const { app, text } = await createSession({ provider: 'claude' });
    const { id } = JSON.parse(text) as { id: string };
    registry.updateStatus(id, 'ready');
    const streamMessage = vi.fn(async function* () { yield { type: 'result' as const }; });
    vi.mocked(pool.get).mockReturnValue({ alive: true, busy: false, streamMessage } as never);
    vi.mocked(pool.spawn).mockImplementationOnce(() => { throw new Error('synthetic spawn failure'); });

    const response = await app.request(`/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ message: 'hello', mcpServers: MCP_SERVERS }),
    });
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).toContain('Failed to apply session MCP servers');
    expect(body).not.toContain(TOKEN);
    expect(registry.get(id)?.status).toBe('closed');
    expect(streamMessage).not.toHaveBeenCalled();
  });

  it('reports failed on resume when a live worker runs an older set', async () => {
    const { app, text } = await createSession({ provider: 'claude' });
    const { id } = JSON.parse(text) as { id: string };
    vi.mocked(pool.get).mockReturnValue({ alive: true, busy: false } as never);

    const resumed = await app.request(`/sessions/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: MCP_SERVERS }),
    });
    const resumedText = await resumed.text();
    expect(resumed.status, resumedText).toBe(200);
    expect(JSON.parse(resumedText).mcpServers).toMatchObject({ status: 'failed' });
  });

  it('reports provider connection evidence for a delivered set', async () => {
    const connections = new Map([['cats', 'connected']]);
    (pool as unknown as { getSessionMcpConnections: unknown }).getSessionMcpConnections = vi.fn(() => connections);
    const { text } = await createSession({ provider: 'claude', mcpServers: MCP_SERVERS });
    expect(JSON.parse(text).mcpServers).toEqual({
      status: 'delivered',
      servers: [{ name: 'cats', connection: 'connected' }],
    });
    connections.set('cats', 'needs-auth');
    const { id } = JSON.parse(text) as { id: string };
    expect(context.runtime!.mcpServerReport(id)?.servers).toEqual([{ name: 'cats', connection: 'failed' }]);
  });

  it('drops descriptors when the session leaves the registry', async () => {
    const { text } = await createSession({ provider: 'claude', mcpServers: MCP_SERVERS });
    const { id } = JSON.parse(text) as { id: string };
    expect(context.runtime!.mcpServers.get(id)).toHaveLength(1);
    registry.updateStatus(id, 'closed');
    expect(registry.unregister(id)).toBe(true);
    expect(context.runtime!.mcpServers.get(id)).toEqual([]);
  });
});
