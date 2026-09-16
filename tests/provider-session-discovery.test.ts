import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createDiscoveryController, createRuntimeServer } from '../src/server.js';
import { MuseSessionScanner, readMuseTranscript } from '../src/backends/cli/discovery/MuseSessionScanner.js';
import { ClineSessionScanner } from '../src/backends/cli/discovery/ClineSessionScanner.js';
import { GrokSessionScanner } from '../src/backends/cli/discovery/GrokSessionScanner.js';
import { cleanupTempDirWithRetriesAsync } from './tempCleanup.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from './support/runtimeTestPaths.js';
import { FakeAcpProcess, startFakeAcpServer } from './support/fakeAcpProcess.js';
import { museRecords, writeProviderSession } from './support/providerSessionFixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

function fixture(agent = false) {
  const root = mkdtempSync(join(tmpdir(), 'cats-provider-discovery-'));
  const paths = createRuntimeTestPaths(root);
  ensureRuntimeTestDirs(paths);
  const sessionDirs = {
    cline: join(root, 'cline'), grok: join(root, 'grok'), muse: join(root, 'muse'),
  };
  writeFileSync(paths.configPath, `
version: 1
environments:
  native:
    kind: native
backends:
  cli:
    providers:
${Object.entries(sessionDirs).map(([provider, dir]) => `      ${provider}:
        instances:
          native:
            environment: native
            command: unused-${provider}
            sessions_dir: ${JSON.stringify(dir)}`).join('\n')}
${agent ? `  agent:
    providers:
      devin:
        transport: acp_stdio
        instances:
          acp:
            command: fake-devin
            args: ['acp']
            cwd: ${JSON.stringify(root)}
` : ''}`);
  const env = createRuntimeTestEnv(root, { CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '40' });
  const config = loadConfig(env);
  const methods: string[] = [];
  let providerIds = ['devin-existing'];
  const runtime = createRuntimeServer(config, {
    agentBackend: {
      env,
      acpProcessSpawner: () => {
        const process = new FakeAcpProcess();
        startFakeAcpServer(process, (message) => {
          methods.push(String(message.method));
          const result = message.method === 'initialize' ? {
            protocolVersion: 1, agentCapabilities: { sessionCapabilities: { list: {}, delete: {} } },
          } : { sessions: providerIds.map((id) => ({ sessionId: id, cwd: root, title: id })) };
          process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
        });
        return process;
      },
    },
  });
  const discovery = createDiscoveryController(runtime.context);
  cleanups.push(async () => {
    discovery.stop();
    await runtime.close();
    await cleanupTempDirWithRetriesAsync(root);
  });
  return {
    root, config, runtime, discovery, sessionDirs, methods,
    setProviderIds: (ids: string[]) => { providerIds = ids; },
  };
}

describe('automatic provider session discovery', () => {
  it('loads Cline, Grok and Muse at startup with readable history and durable deletion', async () => {
    const { root, runtime, discovery, sessionDirs } = fixture();
    for (const provider of ['cline', 'grok', 'muse'] as const) {
      writeProviderSession(provider, sessionDirs[provider], `${provider}-existing`, root);
    }
    discovery.start();
    await vi.waitFor(() => expect(runtime.context.registry.list()).toHaveLength(3));

    for (const provider of ['cline', 'grok', 'muse'] as const) {
      const list = await (await runtime.app.request(`/sessions?provider=${provider}`)).json();
      expect(list.sessions).toHaveLength(1);
      const session = list.sessions[0];
      expect(session).toMatchObject({
        providerSessionId: `${provider}-existing`, cwd: root, summary: 'Check this workspace',
      });
      const history = await (await runtime.app.request(`/sessions/${session.id}/history`)).json();
      expect(history.messages.map(({ role, text }: { role: string; text: string }) => ({ role, text })))
        .toEqual([
          { role: 'user', text: 'Check this workspace' },
          { role: 'assistant', text: 'Workspace checked.' },
        ]);
      const response = await runtime.app.request(`/sessions/${session.id}`, { method: 'DELETE' });
      expect(response.status).toBe(200);
      expect(existsSync(session.sourcePath)).toBe(false);
    }
    expect(await new ClineSessionScanner(sessionDirs.cline).scan()).toEqual([]);
    expect(await new GrokSessionScanner(sessionDirs.grok).scan()).toEqual([]);
    expect(await new MuseSessionScanner(sessionDirs.muse).scan()).toEqual([]);
  });

  it('notices new Cline, Grok and Muse sessions while the runtime remains open', async () => {
    const { root, runtime, discovery, sessionDirs } = fixture();
    for (const provider of ['cline', 'grok', 'muse'] as const) {
      writeProviderSession(provider, sessionDirs[provider], `${provider}-first`, root);
    }
    discovery.start();
    await vi.waitFor(() => expect(runtime.context.registry.list()).toHaveLength(3));
    for (const provider of ['cline', 'grok', 'muse'] as const) {
      writeProviderSession(provider, sessionDirs[provider], `${provider}-second`, root);
    }
    await vi.waitFor(() => expect(runtime.context.registry.list()).toHaveLength(6), { timeout: 8000 });
  }, 10000);

  it('imports Devin on startup and subsequent scans without creating sessions or duplicates', async () => {
    const { runtime, discovery, methods, setProviderIds } = fixture(true);
    discovery.start();
    await vi.waitFor(() => expect(runtime.context.registry.list({ provider: 'devin' })).toHaveLength(1));
    setProviderIds(['devin-existing', 'devin-new']);
    await vi.waitFor(() => expect(runtime.context.registry.list({ provider: 'devin' })).toHaveLength(2));
    setProviderIds(['devin-new']);
    await vi.waitFor(() => expect(runtime.context.registry.list({ provider: 'devin' })
      .map((session) => session.providerSessionId)).toEqual(['devin-new']));
    expect(methods).toContain('session/list');
    expect(methods).not.toContain('session/new');
    discovery.stop();
    const requests = methods.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(methods).toHaveLength(requests);
  });

  it('honours disabled background agent discovery', async () => {
    const { runtime, discovery, config, methods } = fixture(true);
    config.nativeDiscoveryIntervalMs = 0;
    discovery.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(methods).toEqual([]);
    expect(runtime.context.registry.list({ provider: 'devin' })).toEqual([]);
  });

  it('discovers every agent instance even when the provider defaults to a CLI target', async () => {
    const { runtime, discovery, config } = fixture(true);
    const agents = config.remoteProviderCatalog!.agent.devin;
    agents.native = { ...agents.acp, id: 'native' };
    config.providerInstances!.devin = {
      native: { id: 'native', providerName: 'devin', commandConfig: config.providerCommands.devin },
    };
    config.providerDefaultTargets!.devin = { backend: 'cli', instance: 'native' };
    discovery.start();
    await vi.waitFor(() => expect(runtime.context.registry.list({ provider: 'devin' })
      .map((session) => session.providerInstanceId).sort()).toEqual(['acp', 'native']));
    const response = await runtime.app.request('/sessions/discover', { method: 'POST' });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.agentTargets.map((target: { instanceId: string }) => target.instanceId).sort())
      .toEqual(['acp', 'native']);
    expect(runtime.context.registry.list({ provider: 'devin' })).toHaveLength(2);
  });

  it('does not overlap agent scans or import a result after shutdown', async () => {
    const { runtime, discovery } = fixture(true);
    let finish!: (value: { supported: boolean; summary: string; sessions: Array<{ providerSessionId: string }> }) => void;
    const listing = vi.spyOn(runtime.context.agentBackend!, 'listSessions')
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    discovery.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(listing).toHaveBeenCalledTimes(1);
    discovery.stop();
    finish({ supported: true, summary: '', sessions: [{ providerSessionId: 'too-late' }] });
    await Promise.resolve();
    expect(runtime.context.registry.list({ provider: 'devin' })).toEqual([]);
  });

  it.each(['background', 'manual'] as const)('holds selection through %s agent enumeration', async (mode) => {
    const { runtime, discovery } = fixture(true);
    let finish!: (value: { supported: boolean; summary: string; sessions: [] }) => void;
    const listing = vi.spyOn(runtime.context.agentBackend!, 'listSessions')
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const request = mode === 'manual'
      ? runtime.app.request('/sessions/discover', { method: 'POST' })
      : undefined;
    if (mode === 'background') discovery.start();
    await vi.waitFor(() => expect(listing).toHaveBeenCalledTimes(1));
    const selection = runtime.context.bootstrapService!.selection.getSnapshot();
    const saveEmpty = () => runtime.app.request('/setup-selection', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: selection.revision, targets: [] }),
    });
    expect((await saveEmpty()).status).toBe(409);
    discovery.stop();
    finish({ supported: false, summary: 'Finished', sessions: [] });
    await request;
    await vi.waitFor(async () => expect((await saveEmpty()).status).toBe(200));
  });

  it('retains known sessions on errors and retries, but stops polling unsupported agents', async () => {
    const { runtime, discovery } = fixture(true);
    runtime.context.registry.upsertDiscovered('known', {
      providerName: 'devin', providerBackend: 'agent', providerInstanceId: 'acp', cwd: '',
    });
    const listing = vi.spyOn(runtime.context.agentBackend!, 'listSessions')
      .mockRejectedValueOnce(new Error('Temporary list failure'))
      .mockResolvedValue({ supported: false, summary: 'Unsupported', sessions: [] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    discovery.start();
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(listing).toHaveBeenCalledTimes(2);
    expect(runtime.context.registry.list({ provider: 'devin' })
      .map((session) => session.providerSessionId)).toEqual(['known']);
  });

  it('does not revive a deleted Devin session from an older in-flight listing', async () => {
    const { runtime, discovery, root } = fixture(true);
    const session = runtime.context.registry.upsertDiscovered('deleted', {
      providerName: 'devin', providerBackend: 'agent', providerInstanceId: 'acp', cwd: root,
    })!;
    let finish!: (value: { supported: boolean; summary: string; sessions: Array<{ providerSessionId: string }> }) => void;
    vi.spyOn(runtime.context.agentBackend!, 'listSessions')
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ supported: true, summary: '', sessions: [] });
    discovery.start();
    const response = await runtime.app.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    finish({ supported: true, summary: '', sessions: [{ providerSessionId: 'deleted' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.context.registry.list({ provider: 'devin' })).toEqual([]);
  });
});

describe('Muse durable transcripts', () => {
  it('reads framed records and partial logs without duplicating turns or exposing tool/reasoning text', async () => {
    const { root, sessionDirs } = fixture();
    const dir = writeProviderSession('muse', sessionDirs.muse, 'muse-framed', root);
    const records = museRecords('muse-framed', root);
    writeFileSync(join(dir, 'session.jsonl'), [
      JSON.stringify({ retained_frame: 'session_permission_transaction', children: records
        .slice(0, 3).map((record) => ({ record_json: JSON.stringify(record) })) }),
      ...records.slice(3).map((record) => JSON.stringify(record)),
      JSON.stringify(records[5]),
      '{"unfinished":',
    ].join('\n'));
    const scan = await new MuseSessionScanner(sessionDirs.muse).scan();
    expect(scan).toEqual([expect.objectContaining({
      providerSessionId: 'muse-framed', cwd: root, model: 'muse-spark-1.3', messageCount: 2,
      lastActivity: new Date((1_788_545_200_000_000 + 7_000_000) / 1000).toISOString(),
    })]);
    const history = await readMuseTranscript(join(dir, 'session.jsonl'), true);
    expect(history.messages.map((message) => message.text))
      .toEqual(['Check this workspace', 'Workspace checked.']);
  });
});
