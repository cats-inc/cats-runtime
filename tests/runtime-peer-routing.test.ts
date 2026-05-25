import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';
import { parseCoreNdjson as parseNdjson } from './streamEventTestUtils.js';
import { cleanupTempDirWithRetriesAsync } from './tempCleanup.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from './support/runtimeTestPaths.js';

const PEER_ROUTING_TEST_TIMEOUT_MS = 20_000;

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .map((frame) => frame
      .split('\n')
      .find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

function createTestConfig(
  overrides: {
    env?: Record<string, string>;
    config?: Record<string, unknown>;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-peer-routing-'));
  const paths = createRuntimeTestPaths(root);
  const env = createRuntimeTestEnv(root, {
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
    ...(overrides.env || {}),
  });

  ensureRuntimeTestDirs(paths);
  for (const dir of [
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.PI_SESSIONS_DIR,
    join(root, '.junie', 'sessions'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    ...loadConfig(env),
    host: '127.0.0.1',
    port: 0,
    providerDefaultTargets: {
      codex: { backend: 'api', instance: 'main' },
    },
    remoteProviderCatalog: {
      api: {
        codex: {
          main: {
            id: 'main',
            providerName: 'codex',
            backend: 'api',
            transport: 'openai',
            apiKeyEnv: 'OPENAI_API_KEY',
            baseUrl: 'https://example.test',
            model: 'gpt-5.4',
          },
        },
      },
      local: {},
      agent: {},
    },
    ...(overrides.config || {}),
  };

  return {
    root,
    env,
    config,
    cleanup: () => cleanupTempDirWithRetriesAsync(root),
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('runtime peer routing integration', () => {
  it('routes a message to a trusted peer over NDJSON and preserves caller-owned session state', async () => {
    const calleeConfig = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_ID: 'callee-peer',
        CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
        CATS_RUNTIME_PEER_TRUSTED_IDS: 'caller-peer',
      },
    });
    const calleeFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.endsWith('/v1/responses')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      return new Response(JSON.stringify({
        id: 'peer-provider-session-1',
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'peer hello',
          }],
        }],
        usage: {
          input_tokens: 4,
          output_tokens: 3,
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });
    const callee = createRuntimeServer(calleeConfig.config, {
      apiBackend: {
        env: {
          ...calleeConfig.env,
          OPENAI_API_KEY: 'openai-test-key',
        },
        fetch: calleeFetch,
      },
    });

    const calleeAddress = await callee.start();
    const callerConfig = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_ID: 'caller-peer',
        CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
        CATS_RUNTIME_PEER_TRUSTED_IDS: 'callee-peer',
        CATS_RUNTIME_PEER_STATIC_PEERS: JSON.stringify([{
          peerId: 'callee-peer',
          displayName: 'callee',
          advertisedUrl: `http://${calleeAddress.host}:${calleeAddress.port}`,
          providers: ['codex'],
          targets: [{
            provider: 'codex',
            backend: 'api',
            instance: 'main',
            default: true,
          }],
          trust: {
            state: 'trusted',
            reason: 'configured_static_peer',
          },
        }]),
      },
    });
    const caller = createRuntimeServer(callerConfig.config);

    try {
      await caller.start();
      const session = caller.context.registry.create({
        id: 'caller-session',
        providerName: 'codex',
        providerBackend: 'api',
        providerInstanceId: 'main',
        cwd: caller.context.config.sessionBaseDir,
        model: 'gpt-5.4',
        instructions: 'Caller instructions.',
      });
      caller.context.registry.updateStatus(session.id, 'ready');

      const response = await fetch(`http://${caller.context.startup.address!.host}:${caller.context.startup.address!.port}/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello peer',
          routing: {
            mode: 'peer',
            peerId: 'callee-peer',
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        expect.objectContaining({
          type: 'init',
          metadata: expect.objectContaining({
            peerRouting: expect.objectContaining({
              peerId: 'callee-peer',
              strategy: 'explicit',
            }),
          }),
        }),
        expect.objectContaining({
          type: 'text',
          text: 'peer hello',
        }),
        expect.objectContaining({
          type: 'result',
          usage: {
            inputTokens: 4,
            outputTokens: 3,
          },
        }),
      ]);

      expect(caller.context.registry.get(session.id)?.providerSessionId).toBeUndefined();

      const observeResponse = await caller.app.request(`/sessions/${session.id}/observe`);
      expect(observeResponse.status).toBe(200);
      expect(await observeResponse.json()).toEqual(expect.objectContaining({
        session: expect.objectContaining({
          inspection: expect.objectContaining({
            lastRun: expect.objectContaining({
              status: 'succeeded',
              progress: expect.objectContaining({
                metadata: expect.objectContaining({
                  peerRouting: expect.objectContaining({
                    peerId: 'callee-peer',
                  }),
                }),
              }),
            }),
          }),
        }),
      }));
      expect(calleeFetch).toHaveBeenCalledTimes(1);
    } finally {
      await caller.close();
      await callee.close();
      await callerConfig.cleanup();
      await calleeConfig.cleanup();
    }
  }, PEER_ROUTING_TEST_TIMEOUT_MS);

  it('surfaces peer trust failures as streamed caller-visible errors', async () => {
    const calleeConfig = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_ID: 'callee-peer',
        CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
        CATS_RUNTIME_PEER_TRUSTED_IDS: 'other-peer',
      },
    });
    const callee = createRuntimeServer(calleeConfig.config, {
      apiBackend: {
        env: {
          ...calleeConfig.env,
          OPENAI_API_KEY: 'openai-test-key',
        },
        fetch: vi.fn(),
      },
    });
    const calleeAddress = await callee.start();

    const callerConfig = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_ID: 'caller-peer',
        CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
        CATS_RUNTIME_PEER_TRUSTED_IDS: 'callee-peer',
        CATS_RUNTIME_PEER_STATIC_PEERS: JSON.stringify([{
          peerId: 'callee-peer',
          displayName: 'callee',
          advertisedUrl: `http://${calleeAddress.host}:${calleeAddress.port}`,
          providers: ['codex'],
          targets: [{
            provider: 'codex',
            backend: 'api',
            instance: 'main',
            default: true,
          }],
          trust: {
            state: 'trusted',
            reason: 'configured_static_peer',
          },
        }]),
      },
    });
    const caller = createRuntimeServer(callerConfig.config);

    try {
      await caller.start();
      const session = caller.context.registry.create({
        id: 'caller-session',
        providerName: 'codex',
        providerBackend: 'api',
        providerInstanceId: 'main',
        cwd: caller.context.config.sessionBaseDir,
      });
      caller.context.registry.updateStatus(session.id, 'ready');

      const response = await caller.app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'hello peer',
          routing: {
            mode: 'peer',
            peerId: 'callee-peer',
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(parseNdjson(await response.text())).toEqual([
        expect.objectContaining({
          type: 'error',
          text: 'Peer execution caller is not allowed.',
          metadata: expect.objectContaining({
            peerRoutingFailure: expect.objectContaining({
              code: 'peer_untrusted',
            }),
          }),
        }),
      ]);
    } finally {
      await caller.close();
      await callee.close();
      await callerConfig.cleanup();
      await calleeConfig.cleanup();
    }
  }, PEER_ROUTING_TEST_TIMEOUT_MS);

  it('keeps /sessions/:id/stream usable during a peer-routed turn', async () => {
    let releaseExecution: (() => void) | undefined;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const calleeConfig = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_ID: 'callee-peer',
        CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
        CATS_RUNTIME_PEER_TRUSTED_IDS: 'caller-peer',
      },
    });
    const calleeFetch = vi.fn(async () => {
      await executionGate;
      return new Response(JSON.stringify({
        id: 'peer-provider-session-1',
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'peer streamed',
          }],
        }],
        usage: {
          input_tokens: 4,
          output_tokens: 3,
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });
    const callee = createRuntimeServer(calleeConfig.config, {
      apiBackend: {
        env: {
          ...calleeConfig.env,
          OPENAI_API_KEY: 'openai-test-key',
        },
        fetch: calleeFetch,
      },
    });
    const calleeAddress = await callee.start();

    const callerConfig = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_ID: 'caller-peer',
        CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
        CATS_RUNTIME_PEER_TRUSTED_IDS: 'callee-peer',
        CATS_RUNTIME_PEER_STATIC_PEERS: JSON.stringify([{
          peerId: 'callee-peer',
          displayName: 'callee',
          advertisedUrl: `http://${calleeAddress.host}:${calleeAddress.port}`,
          providers: ['codex'],
          targets: [{
            provider: 'codex',
            backend: 'api',
            instance: 'main',
            default: true,
          }],
          trust: {
            state: 'trusted',
            reason: 'configured_static_peer',
          },
        }]),
      },
    });
    const caller = createRuntimeServer(callerConfig.config);

    try {
      const callerAddress = await caller.start();
      const session = caller.context.registry.create({
        id: 'caller-session',
        providerName: 'codex',
        providerBackend: 'api',
        providerInstanceId: 'main',
        cwd: caller.context.config.sessionBaseDir,
      });
      caller.context.registry.updateStatus(session.id, 'ready');

      const messagePromise = fetch(`http://${callerAddress.host}:${callerAddress.port}/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'stream this',
          routing: {
            mode: 'peer',
            peerId: 'callee-peer',
          },
        }),
      });

      await waitFor(() => Boolean(caller.context.runtime?.get(session.id)?.busy));
      // Wait for the observer connection to be established before letting the
      // peer execution finish, otherwise the test can race and only observe the
      // final session_closed frame in full-suite runs.
      const streamResponse = await fetch(`http://${callerAddress.host}:${callerAddress.port}/sessions/${session.id}/stream`);

      releaseExecution?.();

      const messageResponse = await messagePromise;

      expect(messageResponse.status).toBe(200);
      expect(streamResponse.status).toBe(200);
      expect(parseNdjson(await messageResponse.text())).toEqual([
        expect.objectContaining({ type: 'init' }),
        expect.objectContaining({ type: 'text', text: 'peer streamed' }),
        expect.objectContaining({ type: 'result' }),
      ]);
      expect(parseSse(await streamResponse.text())).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'peer streamed' }),
        expect.objectContaining({ type: 'result' }),
        expect.objectContaining({ type: 'session_closed' }),
      ]));
    } finally {
      await caller.close();
      await callee.close();
      await callerConfig.cleanup();
      await calleeConfig.cleanup();
    }
  }, PEER_ROUTING_TEST_TIMEOUT_MS);
});
