import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupTempDirWithRetries } from './tempCleanup.js';
import { loadConfig } from '../src/core/config.js';
import {
  ProviderEvolutionProbeService,
  PROVIDER_EVOLUTION_PROBE_PROFILES,
} from '../src/core/compatibility/providerEvolutionProbe.js';
import { createRuntimeServer } from '../src/server.js';
import { parseCoreNdjson as parseNdjson } from './streamEventTestUtils.js';

function createAgentConfigRoot(options: { model?: string } = {}) {
  const model = options.model || 'openclaw-coder';
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-agent-test-'));
  const configPath = join(root, 'providers.yaml');
  writeFileSync(configPath, `
version: 1
routing:
  providers:
    openclaw:
      default_target:
        backend: agent
        instance: gateway
backends:
  agent:
    providers:
      openclaw:
        default_instance: gateway
        transport: openclaw_gateway
        url: ws://gateway.test/ws
        auth_token_env: OPENCLAW_TOKEN
        client_id: cats-runtime-test
        scopes:
          - operator.admin
        instances:
          gateway:
            model: ${model}
`.trimStart());

  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: configPath,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    OPENCLAW_TOKEN: 'test-token',
  };

  mkdirSync(env.CATS_RUNTIME_DATA_DIR, { recursive: true });
  mkdirSync(env.CATS_RUNTIME_SESSION_BASE_DIR, { recursive: true });
  mkdirSync(join(root, 'repo'), { recursive: true });

  return {
    root,
    env,
    config: loadConfig(env),
    cleanup: () => cleanupTempDirWithRetries(root),
  };
}

function createAgentSdkConfigRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-agent-sdk-test-'));
  const configPath = join(root, 'providers.yaml');
  writeFileSync(configPath, `
version: 1
routing:
  providers:
    claude:
      default_target:
        backend: agent
        instance: sdk
backends:
  agent:
    providers:
      claude:
        default_instance: sdk
        transport: agent_sdk_bridge
        base_url: http://agent-sdk.test
        auth_token_env: AGENT_SDK_TOKEN
        instances:
          sdk:
            model: sonnet
`.trimStart());

  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: configPath,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    AGENT_SDK_TOKEN: 'bridge-token',
  };

  mkdirSync(env.CATS_RUNTIME_DATA_DIR, { recursive: true });
  mkdirSync(env.CATS_RUNTIME_SESSION_BASE_DIR, { recursive: true });
  mkdirSync(join(root, 'repo'), { recursive: true });

  return {
    root,
    env,
    config: loadConfig(env),
    cleanup: () => cleanupTempDirWithRetries(root),
  };
}

function createAgentSdkBridgeToolGroups() {
  return [
    {
      id: 'core',
      label: 'Core',
      tools: [
        { name: 'read_file', source: 'core' },
        { name: 'write_file', source: 'core' },
      ],
    },
  ];
}

class FakeOpenClawSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;
  private requestCount = 0;

  constructor(private readonly scripts: FakeOpenClawGatewayScript[]) {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      this.emitFrame({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-1' },
      });
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    this.requestCount += 1;
    const method = typeof frame.method === 'string' ? frame.method : '';

    if (method === 'connect') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { type: 'hello-ok', protocol: 3 },
      });
      return;
    }

    if (method === 'health') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          ok: true,
          ts: 1_747_884_800_000,
          durationMs: 12,
          channels: {
            telegram: {
              linked: true,
            },
          },
          channelOrder: ['telegram'],
          channelLabels: {
            telegram: 'Telegram',
          },
          heartbeatSeconds: 60,
          defaultAgentId: 'default',
          agents: [{
            agentId: 'default',
            isDefault: true,
          }],
          sessions: {
            path: '/tmp/openclaw-sessions.json',
            count: 1,
            recent: [],
          },
        },
      });
      return;
    }

    if (method === 'models.list') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          models: [
            {
              id: 'claude-test-a',
              name: 'A-Model',
              provider: 'anthropic',
              contextWindow: 200_000,
            },
            {
              id: 'gpt-test-z',
              provider: 'openai',
            },
          ],
        },
      });
      return;
    }

    if (method === 'tools.catalog') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          groups: [
            {
              id: 'core',
              label: 'Core',
              tools: [
                { name: 'read_file', source: 'core' },
                { name: 'write_file', source: 'core' },
              ],
            },
            {
              id: 'plugin:media',
              label: 'Media',
              tools: [
                {
                  name: 'share_image',
                  source: 'plugin',
                  pluginId: 'media',
                  optional: true,
                },
              ],
            },
          ],
        },
      });
      return;
    }

    if (method === 'tools.effective') {
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          groups: [
            {
              id: 'core',
              source: 'core',
              tools: [
                { id: 'exec', source: 'core' },
              ],
            },
            {
              id: 'channel',
              source: 'channel',
              tools: [
                { id: 'send_message', source: 'channel' },
              ],
            },
          ],
        },
      });
      return;
    }

    if (method === 'agent') {
      const params = frame.params as Record<string, unknown>;
      const script = this.scripts.shift() || {
        runId: `run-${this.requestCount}`,
        assistant: ['done'],
      };

      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'accepted',
          runId: script.runId,
          sessionKey: params.sessionKey,
        },
      });

      for (const text of script.assistant) {
        this.emitFrame({
          type: 'event',
          event: 'agent',
          payload: {
            runId: script.runId,
            stream: 'assistant',
            data: { delta: text },
          },
        });
      }
      return;
    }

    if (method === 'agent.wait') {
      const params = frame.params as Record<string, unknown>;
      const runId = typeof params.runId === 'string' ? params.runId : 'run-unknown';
      this.emitFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          status: 'ok',
          runId,
          summary: `completed ${runId}`,
          artifacts: [{
            id: `${runId}-artifact`,
            path: `/tmp/${runId}.md`,
            label: `Artifact ${runId}`,
          }],
          services: [{
            id: `${runId}-preview`,
            name: 'preview',
            url: `https://preview.test/${runId}`,
          }],
        },
      });
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  private emitFrame(frame: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(frame),
    }));
  }
}

interface FakeOpenClawGatewayScript {
  runId: string;
  assistant: string[];
}

function createFakeWebSocketFactory(
  scripts: FakeOpenClawGatewayScript[],
  sentFrames: Array<Record<string, unknown>>,
) {
  return (_url: string | URL, _init?: WebSocketInit) => {
    const socket = new FakeOpenClawSocket(scripts);
    const originalSend = socket.send.bind(socket);
    socket.send = ((data) => {
      originalSend(data);
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      sentFrames.push(frame);
    }) as typeof socket.send;
    return socket as unknown as WebSocket;
  };
}

describe('agent backend integration', () => {
  it('surfaces retained provider-evolution summaries on /providers/config', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const probeService = new ProviderEvolutionProbeService({
      rootDir: join(config.dataDir, 'compatibility', 'provider-evolution'),
      now: () => now,
    });

    const request = {
      target: {
        provider: 'openclaw',
        instance: 'agent/gateway',
        parserId: 'openclaw-gateway-v3',
        probeProfile: 'manual_text',
        transport: 'agent' as const,
        version: '3',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
    };

    await probeService.run({
      ...request,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'agent.output.delta',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'run.completed',
          events: { type: 'result' },
        });
        return {
          status: 'completed' as const,
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    now += 1000;

    const current = await probeService.run({
      ...request,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'agent.output.delta',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'run.completed',
          events: { type: 'result' },
        });
        observer.recordSchemaFailure({
          rawEventType: 'gateway.event',
          rawSample: { event: 'gateway.event' },
        });
        return {
          status: 'completed' as const,
          turnsCompleted: 1,
          emittedEventCount: 3,
        };
      },
    });

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
      },
    });

    try {
      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: expect.objectContaining({
          openclaw: expect.objectContaining({
            instances: [
              expect.objectContaining({
                id: 'gateway',
                target: 'agent/gateway',
                providerEvolution: {
                  latestArtifact: expect.objectContaining({
                    artifactId: current.artifact.id,
                    probeProfile: 'manual_text',
                    transport: 'agent',
                    version: '3',
                    relativePath: expect.stringContaining('openclaw'),
                    capabilitySnapshot: expect.objectContaining({
                      incrementalText: expect.objectContaining({
                        observed: true,
                        count: 1,
                      }),
                      finalResult: expect.objectContaining({
                        observed: true,
                        count: 1,
                      }),
                    }),
                    compare: expect.objectContaining({
                      addedEventTypeCount: 0,
                      removedEventTypeCount: 0,
                      frequencyDropCount: 0,
                      schemaChangeCount: 1,
                      semanticDriftSuspected: false,
                    }),
                    review: expect.objectContaining({
                      classifications: ['schema_change'],
                    }),
                  }),
                },
              }),
            ],
          }),
        }),
      }));
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('creates, streams, resumes, and reuses OpenClaw-backed sessions', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const scripts: FakeOpenClawGatewayScript[] = [
      { runId: 'run-1', assistant: ['hello ', 'world'] },
      { runId: 'run-2', assistant: ['welcome back'] },
    ];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory(scripts, sentFrames),
      },
    });

    try {
      const providerResponse = await runtime.app.request('/providers/config');
      expect(providerResponse.status).toBe(200);
      expect(await providerResponse.json()).toEqual(expect.objectContaining({
        providers: {
          openclaw: {
            defaultInstance: 'gateway',
            defaultBackend: 'agent',
            instances: [expect.objectContaining({
              id: 'gateway',
              target: 'agent/gateway',
              backend: 'agent',
              transport: 'openclaw_gateway',
              model: 'openclaw-coder',
              continuity: {
                source: 'provider_managed',
                summary: expect.stringContaining('external agent runtime owns provider-managed session continuity'),
                resume: true,
                fork: true,
                permissions: false,
                providerManagedSessions: true,
                sessionKey: true,
                providerSessionState: true,
                remoteCancel: false,
              },
              agentRuntime: {
                adapter: 'openclaw',
                family: 'gateway',
                summary: expect.stringContaining('OpenClaw gateway'),
                endpoint: 'ws://gateway.test/ws',
                transport: {
                  kind: 'websocket',
                  protocol: 'openclaw_gateway_v3',
                  liveProbe: 'rpc_health',
                  modelDiscovery: 'models_list',
                  toolDiscovery: 'tools_catalog',
                  streaming: 'agent_event_frames',
                },
                request: {
                  headerNames: ['authorization'],
                },
                auth: {
                  mechanisms: ['connect_auth', 'handshake_header'],
                  credentials: [
                    { kind: 'url', configured: true },
                    { kind: 'auth_token', configured: true },
                    { kind: 'password', configured: false },
                  ],
                },
                continuity: {
                  providerManagedSessions: true,
                  sessionKey: true,
                  providerSessionState: true,
                  cancel: false,
                },
                capabilities: {
                  probe: true,
                  modelDiscovery: true,
                  toolCatalog: true,
                  effectiveToolCatalog: true,
                  cancel: false,
                  runtimeServices: true,
                  toolCallEvents: false,
                },
              },
              tooling: {
                source: 'provider_managed',
                discoverable: true,
                sessionScopedOverrides: false,
                summary: expect.stringContaining('query a bounded remote tool catalog'),
                observability: {
                  catalog: 'provider_remote_enumerated',
                  toolCallEvents: false,
                  runtimeServices: true,
                },
              },
              install: null,
              compatibility: null,
            })],
          },
        },
        executionStrategies: expect.objectContaining({
          summary: expect.objectContaining({
            totalFamilies: 7,
            supportedFamilies: 7,
            fallbackOnlyFamilies: 0,
            compatibilityDefault: 'simple_tool_call',
          }),
        }),
      }));

      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          cwd: config.sessionBaseDir,
          sessionKey: 'task-123',
          reusePolicy: 'prefer_existing',
          instructions: 'Focus on architecture.',
          context: {
            source: 'interactive',
            taskId: 'task-123',
          },
          outputDir: '/tmp/out',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string; providerBackend: string; sessionKey: string };
      expect(created.providerBackend).toBe('agent');
      expect(created.sessionKey).toBe('task-123');
      expect(created).toEqual(expect.objectContaining({
        providerTarget: expect.objectContaining({
          provider: 'openclaw',
          backend: 'agent',
          instance: 'gateway',
          target: 'agent/gateway',
          resolved: true,
          transport: 'openclaw_gateway',
          model: 'openclaw-coder',
          continuity: expect.objectContaining({
            source: 'provider_managed',
            providerManagedSessions: true,
            sessionKey: true,
            providerSessionState: true,
          }),
          tooling: expect.objectContaining({
            source: 'provider_managed',
            discoverable: true,
          }),
          agentRuntime: expect.objectContaining({
            adapter: 'openclaw',
            transport: expect.objectContaining({
              protocol: 'openclaw_gateway_v3',
            }),
          }),
        }),
      }));

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Draft the report',
        }),
      });
      expect(messageResponse.status).toBe(200);
      const events = parseNdjson(await messageResponse.text());
      expect(events.map((event) => event.type)).toEqual(['init', 'text', 'text', 'result']);
      expect(events.at(-1)?.artifacts).toEqual([{
        id: 'run-1-artifact',
        path: '/tmp/run-1.md',
        label: 'Artifact run-1',
      }]);

      const providerResponseAfterMessage = await runtime.app.request('/providers/config');
      expect(providerResponseAfterMessage.status).toBe(200);
      await expect(providerResponseAfterMessage.json()).resolves.toEqual(expect.objectContaining({
        providers: {
          openclaw: expect.objectContaining({
            instances: [expect.objectContaining({
              id: 'gateway',
              latestSessionEvidence: expect.objectContaining({
                source: 'runtime_registry_latest_session',
                sessionId: created.id,
                sessionKey: 'task-123',
                observedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                  outputDir: '/tmp/out',
                }),
                counts: expect.objectContaining({
                  artifactCount: 1,
                  serviceCount: 1,
                  previewSurfaceCount: 2,
                }),
                artifacts: expect.arrayContaining([
                  expect.objectContaining({
                    id: 'run-1-artifact',
                    hasPath: true,
                  }),
                ]),
                services: expect.arrayContaining([
                  expect.objectContaining({
                    name: 'preview',
                    url: 'https://preview.test/run-1',
                  }),
                ]),
              }),
            })],
          }),
        },
      }));

      const historyResponse = await runtime.app.request(`/sessions/${created.id}/history`);
      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toMatchObject({
        transcript: {
          ownership: 'runtime',
          source: 'jsonl',
          parser: 'generic_jsonl',
        },
        sessionKey: 'task-123',
        providerTarget: {
          provider: 'openclaw',
          backend: 'agent',
          instance: 'gateway',
          target: 'agent/gateway',
          resolved: true,
          transport: 'openclaw_gateway',
          model: 'openclaw-coder',
          continuity: expect.objectContaining({
            source: 'provider_managed',
            providerManagedSessions: true,
            sessionKey: true,
            providerSessionState: true,
          }),
          tooling: expect.objectContaining({
            source: 'provider_managed',
            discoverable: true,
          }),
          agentRuntime: expect.objectContaining({
            adapter: 'openclaw',
            transport: expect.objectContaining({
              protocol: 'openclaw_gateway_v3',
            }),
          }),
        },
        outputDir: '/tmp/out',
        context: {
          source: 'interactive',
          taskId: 'task-123',
        },
        artifacts: [{
          id: 'run-1-artifact',
          path: '/tmp/run-1.md',
        }],
        inspection: {
          lastRun: {
            status: 'succeeded',
            previewSurfaces: expect.arrayContaining([
              expect.objectContaining({
                kind: 'artifact',
                artifactId: 'run-1-artifact',
              }),
              expect.objectContaining({
                kind: 'service',
                url: 'https://preview.test/run-1',
              }),
            ]),
          },
        },
      });

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const reuseResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          sessionKey: 'task-123',
          reusePolicy: 'require_existing',
        }),
      });
      expect(reuseResponse.status).toBe(200);
      const reused = await reuseResponse.json() as { id: string };
      expect(reused.id).toBe(created.id);

      const resumedMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Continue',
        }),
      });
      expect(resumedMessage.status).toBe(200);
      const resumedEvents = parseNdjson(await resumedMessage.text());
      expect(resumedEvents.map((event) => event.type)).toEqual(['init', 'text', 'result']);

      const agentRequests = sentFrames.filter((frame) => frame.method === 'agent');
      const connectRequests = sentFrames.filter((frame) => frame.method === 'connect');
      expect(connectRequests).toHaveLength(2);
      expect(connectRequests[0]?.params).toEqual(expect.objectContaining({
        minProtocol: 3,
        maxProtocol: 3,
      }));
      expect(agentRequests).toHaveLength(2);
      expect((agentRequests[0].params as Record<string, unknown>).sessionKey).toBe('task-123');
      expect((agentRequests[1].params as Record<string, unknown>).sessionKey).toBe('task-123');
      expect((agentRequests[0].params as Record<string, unknown>).message)
        .toBe('Focus on architecture.\n\nDraft the report');
      expect((agentRequests[1].params as Record<string, unknown>).message)
        .toBe('Focus on architecture.\n\nContinue');
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('runs a live OpenClaw gateway health probe through provider diagnostics', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=openclaw&backend=agent&instance=gateway',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'openclaw',
            backend: 'agent',
            instance: 'gateway',
            availability: expect.objectContaining({
              probe: 'live',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'agent_runtime_contract',
                status: 'ok',
                message: expect.stringContaining('OpenClaw gateway'),
                details: expect.objectContaining({
                  adapter: 'openclaw',
                  family: 'gateway',
                  transport: expect.objectContaining({
                    protocol: 'openclaw_gateway_v3',
                    liveProbe: 'rpc_health',
                  }),
                  continuity: expect.objectContaining({
                    cancel: false,
                  }),
                }),
              }),
              expect.objectContaining({
                code: 'probe',
                status: 'ok',
                message: expect.stringContaining('Gateway health RPC succeeded'),
              }),
              expect.objectContaining({
                code: 'gateway_agents_visible',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'ws://gateway.test/ws',
                  agentCount: 1,
                  channelCount: 1,
                  linkedChannels: ['telegram'],
                  defaultAgentId: 'default',
                  sessionCount: 1,
                  latencyMs: 12,
                }),
              }),
              expect.objectContaining({
                code: 'model_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  source: 'dynamic',
                  modelCount: 3,
                  defaultModel: 'openclaw-coder',
                }),
              }),
              expect.objectContaining({
                code: 'tool_catalog_loaded',
                status: 'ok',
                message: '3 tool(s) across 2 group(s) advertised by the OpenClaw gateway.',
                details: expect.objectContaining({
                  method: 'tools_catalog',
                  toolCount: 3,
                  groupCount: 2,
                  groups: [
                    { id: 'core', label: 'Core', toolCount: 2 },
                    { id: 'plugin:media', label: 'Media', toolCount: 1 },
                  ],
                }),
              }),
            ]),
            config: expect.objectContaining({
              continuity: expect.objectContaining({
                source: 'provider_managed',
                providerManagedSessions: true,
                sessionKey: true,
                providerSessionState: true,
                remoteCancel: false,
              }),
              agentRuntime: expect.objectContaining({
                adapter: 'openclaw',
                family: 'gateway',
                transport: expect.objectContaining({
                  protocol: 'openclaw_gateway_v3',
                  modelDiscovery: 'models_list',
                }),
                continuity: expect.objectContaining({
                  providerManagedSessions: true,
                }),
              }),
              liveProbe: expect.objectContaining({
                adapter: 'openclaw',
                endpoint: 'ws://gateway.test/ws',
                agentCount: 1,
                channelCount: 1,
                linkedChannels: ['telegram'],
                defaultAgentId: 'default',
                sessionCount: 1,
                latencyMs: 12,
              }),
              modelCatalog: expect.objectContaining({
                source: 'dynamic',
                defaultModel: 'openclaw-coder',
                modelCount: 3,
              }),
              toolCatalog: {
                source: 'provider_remote',
                status: 'ready',
                method: 'tools_catalog',
                summary: '3 tool(s) across 2 group(s) advertised by the OpenClaw gateway.',
                toolCount: 3,
                groupCount: 2,
                groups: [
                  { id: 'core', label: 'Core', toolCount: 2 },
                  { id: 'plugin:media', label: 'Media', toolCount: 1 },
                ],
              },
            }),
            reprobe: expect.objectContaining({
              liveSupported: true,
            }),
          }),
        ],
      }));
      expect(sentFrames.filter((frame) => frame.method === 'connect')).toHaveLength(3);
      expect(sentFrames.filter((frame) => frame.method === 'health')).toHaveLength(1);
      expect(sentFrames.filter((frame) => frame.method === 'models.list')).toHaveLength(1);
      expect(sentFrames.filter((frame) => frame.method === 'tools.catalog')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('surfaces Agent SDK provider-registry semantics in live provider diagnostics', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      fetchCalls.push({ url, method, body });

      if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
        return new Response(JSON.stringify({
          providers: [
            {
              name: 'claude',
              models: ['sonnet', 'haiku'],
              default_model: 'sonnet',
              capabilities: {
                streaming: true,
                mcp: true,
                vision: false,
              },
              tool_groups: createAgentSdkBridgeToolGroups(),
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
        return new Response(JSON.stringify({
          id: 'probe-session-1',
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
        return new Response(JSON.stringify({
          id: 'probe-session-1',
          provider: 'claude',
          provider_session_id: 'sdk-provider-1',
          model: 'sonnet',
          status: 'idle',
          metadata: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: fakeFetch,
      },
    });

    try {
      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'claude',
            backend: 'agent',
            instance: 'sdk',
            availability: expect.objectContaining({
              probe: 'live',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'agent_runtime_contract',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'probe',
                status: 'ok',
                message: expect.stringContaining('claude available via Agent SDK bridge'),
              }),
              expect.objectContaining({
                code: 'bridge_provider_listed',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/providers',
                  targetProvider: 'claude',
                  providerCount: 1,
                  modelCount: 2,
                  defaultModel: 'sonnet',
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                }),
              }),
              expect.objectContaining({
                code: 'bridge_configured_model_visible',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/providers',
                  targetProvider: 'claude',
                  configuredModel: 'sonnet',
                  configuredModelListed: true,
                  modelCount: 2,
                  defaultModel: 'sonnet',
                }),
              }),
              expect.objectContaining({
                code: 'bridge_provider_streaming_supported',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/providers',
                  targetProvider: 'claude',
                  streamingAdvertised: true,
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                }),
              }),
              expect.objectContaining({
                code: 'bridge_provider_tool_catalog_visible',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/providers',
                  targetProvider: 'claude',
                  toolCatalogVisible: true,
                  toolCount: 2,
                  toolGroupCount: 1,
                }),
              }),
              expect.objectContaining({
                code: 'bridge_probe_session_create',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/sessions',
                  targetProvider: 'claude',
                  probeModel: 'sonnet',
                }),
              }),
              expect.objectContaining({
                code: 'bridge_probe_session_read',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/sessions',
                  targetProvider: 'claude',
                  probeModel: 'sonnet',
                  observedStatus: 'idle',
                  providerSessionIdPresent: true,
                }),
              }),
              expect.objectContaining({
                code: 'bridge_probe_session_cleanup',
                status: 'ok',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/sessions',
                  targetProvider: 'claude',
                  probeModel: 'sonnet',
                }),
              }),
              expect.objectContaining({
                code: 'model_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  source: 'dynamic',
                  modelCount: 2,
                  defaultModel: 'sonnet',
                }),
              }),
              expect.objectContaining({
                code: 'configured_model_present',
                status: 'ok',
                details: expect.objectContaining({
                  model: 'sonnet',
                  source: 'dynamic',
                  status: 'available',
                }),
              }),
            ]),
            config: expect.objectContaining({
              continuity: expect.objectContaining({
                source: 'provider_managed',
                providerManagedSessions: true,
                sessionKey: true,
                providerSessionState: true,
                remoteCancel: true,
              }),
              agentRuntime: expect.objectContaining({
                adapter: 'agent_sdk_bridge',
                transport: expect.objectContaining({
                  protocol: 'agent_sdk_http_v1',
                }),
              }),
              liveProbe: {
                adapter: 'agent_sdk_bridge',
                endpoint: 'http://agent-sdk.test/api/v1/providers',
                targetProvider: 'claude',
                providerCount: 1,
                providerListed: true,
                modelCount: 2,
                semanticStatus: 'ok',
                defaultModel: 'sonnet',
                configuredModel: 'sonnet',
                configuredModelListed: true,
                toolCatalogVisible: true,
                toolCount: 2,
                toolGroupCount: 1,
                capabilities: {
                  streaming: true,
                  mcp: true,
                  vision: false,
                },
                sessionLifecycle: {
                  createChecked: true,
                  createStatus: 'ok',
                  readChecked: true,
                  readStatus: 'ok',
                  cleanupChecked: true,
                  cleanupStatus: 'ok',
                  probeModel: 'sonnet',
                  observedStatus: 'idle',
                  observedProvider: 'claude',
                  observedModel: 'sonnet',
                  providerSessionIdPresent: true,
                },
              },
              modelCatalog: expect.objectContaining({
                source: 'dynamic',
                defaultModel: 'sonnet',
                modelCount: 2,
                warnings: [],
              }),
              toolCatalog: expect.objectContaining({
                source: 'provider_remote',
                status: 'ready',
                method: 'providers_get',
                toolCount: 2,
                groupCount: 1,
              }),
            }),
            reprobe: expect.objectContaining({
              liveSupported: true,
            }),
          }),
        ],
      }));
      expect(fetchCalls).toEqual([
        { url: 'http://agent-sdk.test/api/v1/providers', method: 'GET', body: undefined },
        {
          url: 'http://agent-sdk.test/api/v1/sessions',
          method: 'POST',
          body: {
            provider: 'claude',
            model: 'sonnet',
          },
        },
        {
          url: 'http://agent-sdk.test/api/v1/sessions/probe-session-1',
          method: 'GET',
          body: undefined,
        },
        {
          url: 'http://agent-sdk.test/api/v1/sessions/probe-session-1',
          method: 'DELETE',
          body: undefined,
        },
        { url: 'http://agent-sdk.test/api/v1/providers', method: 'GET', body: undefined },
        { url: 'http://agent-sdk.test/api/v1/providers', method: 'GET', body: undefined },
      ]);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('degrades Agent SDK bridge live diagnostics when the registry omits tool metadata', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'claude',
            backend: 'agent',
            instance: 'sdk',
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'live',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'probe',
                status: 'degraded',
                message: 'claude is listed by Agent SDK bridge but did not expose provider-registry tool metadata',
              }),
              expect.objectContaining({
                code: 'bridge_provider_tool_catalog_visible',
                status: 'degraded',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/providers',
                  targetProvider: 'claude',
                  toolCatalogVisible: false,
                  toolCount: 0,
                  toolGroupCount: 0,
                }),
              }),
              expect.objectContaining({
                code: 'tool_catalog_unavailable',
                status: 'degraded',
              }),
            ]),
            config: expect.objectContaining({
              liveProbe: expect.objectContaining({
                adapter: 'agent_sdk_bridge',
                endpoint: 'http://agent-sdk.test/api/v1/providers',
                targetProvider: 'claude',
                semanticStatus: 'degraded',
                configuredModel: 'sonnet',
                configuredModelListed: true,
                toolCatalogVisible: false,
                toolCount: 0,
                toolGroupCount: 0,
                capabilities: {
                  streaming: true,
                  mcp: true,
                  vision: false,
                },
              }),
              toolCatalog: expect.objectContaining({
                source: 'provider_remote',
                status: 'unavailable',
                method: 'providers_get',
                toolCount: 0,
                groupCount: 0,
              }),
            }),
          }),
        ],
      }));
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('degrades Agent SDK bridge live diagnostics when the registry omits streaming support', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string }> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';
          fetchCalls.push({ url, method });

          if (url === 'http://agent-sdk.test/api/v1/providers') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  tool_groups: createAgentSdkBridgeToolGroups(),
                  capabilities: {
                    streaming: false,
                    mcp: true,
                    vision: false,
                  },
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'claude',
            backend: 'agent',
            instance: 'sdk',
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'live',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'probe',
                status: 'degraded',
                message: 'claude is listed by Agent SDK bridge but does not advertise streaming support',
              }),
              expect.objectContaining({
                code: 'bridge_provider_streaming_supported',
                status: 'degraded',
                details: expect.objectContaining({
                  endpoint: 'http://agent-sdk.test/api/v1/providers',
                  targetProvider: 'claude',
                  streamingAdvertised: false,
                  capabilities: {
                    streaming: false,
                    mcp: true,
                    vision: false,
                  },
                }),
              }),
            ]),
            config: expect.objectContaining({
              continuity: expect.objectContaining({
                source: 'provider_managed',
                providerManagedSessions: true,
                sessionKey: true,
                providerSessionState: true,
                remoteCancel: true,
              }),
              liveProbe: expect.objectContaining({
                adapter: 'agent_sdk_bridge',
                endpoint: 'http://agent-sdk.test/api/v1/providers',
                targetProvider: 'claude',
                semanticStatus: 'degraded',
                configuredModel: 'sonnet',
                configuredModelListed: true,
                toolCatalogVisible: true,
                toolCount: 2,
                toolGroupCount: 1,
                capabilities: {
                  streaming: false,
                  mcp: true,
                  vision: false,
                },
              }),
            }),
          }),
        ],
      }));
      expect(fetchCalls).toEqual([
        { url: 'http://agent-sdk.test/api/v1/providers', method: 'GET' },
        { url: 'http://agent-sdk.test/api/v1/providers', method: 'GET' },
        { url: 'http://agent-sdk.test/api/v1/providers', method: 'GET' },
      ]);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('surfaces Agent SDK session activity on live provider diagnostics without forcing unsupported effective tool discovery', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
            return new Response(JSON.stringify({
              id: 'probe-session-1',
              provider: 'claude',
              provider_session_id: 'sdk-provider-probe',
              model: 'sonnet',
              status: 'idle',
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
            return new Response(null, { status: 204 });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-effective-diagnostics',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime bridge diagnostics activity',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const response = await runtime.app.request(`/diagnostics/providers?probe=live&sessionId=${created.id}`);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        query: { filters: Record<string, unknown> };
        providers: Array<{
          availability: { status: string };
          checks: Array<{ code: string; status: string; details?: Record<string, unknown> }>;
          config: Record<string, unknown>;
        }>;
      };

      expect(body).toEqual(expect.objectContaining({
        query: expect.objectContaining({
          filters: {
            provider: 'claude',
            backend: 'agent',
            instance: 'sdk',
            toolCatalogScope: 'effective',
            sessionId: created.id,
            sessionKey: 'sdk-effective-diagnostics',
          },
        }),
        providers: [
          expect.objectContaining({
            availability: expect.objectContaining({
              status: 'ok',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'session_evidence_visible',
                status: 'ok',
                details: expect.objectContaining({
                  source: 'runtime_session_inspection',
                  sessionId: created.id,
                  sessionKey: 'sdk-effective-diagnostics',
                  observedAt: expect.any(String),
                  artifactCount: 0,
                  serviceCount: 1,
                  previewSurfaceCount: 1,
                  readyPreviewSurfaceCount: 1,
                  browserSessionCount: 0,
                  openBrowserPageCount: 0,
                  serviceIds: ['preview'],
                }),
              }),
              expect.objectContaining({
                code: 'bridge_session_activity_visible',
                status: 'ok',
                details: expect.objectContaining({
                  source: 'runtime_session',
                  sessionId: created.id,
                  sessionKey: 'sdk-effective-diagnostics',
                  observedAt: expect.any(String),
                  toolUseCount: 1,
                  toolResultCount: 1,
                  serviceUpdateCount: 1,
                  observedToolNames: ['grep'],
                  observedServiceIds: ['preview'],
                }),
              }),
              expect.objectContaining({
                code: 'tool_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  method: 'providers_get',
                  toolCount: 2,
                  groupCount: 1,
                }),
              }),
            ]),
            config: expect.objectContaining({
              toolCatalog: expect.objectContaining({
                source: 'provider_remote',
                status: 'ready',
                method: 'providers_get',
                toolCount: 2,
                groupCount: 1,
              }),
              sessionActivity: expect.objectContaining({
                source: 'runtime_session',
                sessionId: created.id,
                sessionKey: 'sdk-effective-diagnostics',
                providerSessionId: 'bridge-session-1',
                status: 'idle',
                observedAt: expect.any(String),
                activity: {
                  toolUseCount: 1,
                  toolResultCount: 1,
                  serviceUpdateCount: 1,
                  observedToolNames: ['grep'],
                  observedServiceIds: ['preview'],
                },
              }),
              sessionEvidence: expect.objectContaining({
                source: 'runtime_session_inspection',
                sessionId: created.id,
                sessionKey: 'sdk-effective-diagnostics',
                providerSessionId: 'bridge-session-1',
                status: 'idle',
                observedAt: expect.any(String),
                latestRun: expect.objectContaining({
                  id: expect.any(String),
                  status: 'succeeded',
                }),
                counts: {
                  artifactCount: 0,
                  serviceCount: 1,
                  previewSurfaceCount: 1,
                  readyPreviewSurfaceCount: 1,
                  browserSessionCount: 0,
                  openBrowserPageCount: 0,
                },
                artifacts: [],
                services: [
                  {
                    id: 'preview',
                    name: 'preview',
                    url: 'https://preview.test/bridge-session-1',
                  },
                ],
                previewSurfaces: expect.arrayContaining([
                  expect.objectContaining({
                    kind: 'service',
                    source: 'session_service',
                    status: 'ready',
                    renderHint: 'iframe',
                    label: 'preview',
                    url: 'https://preview.test/bridge-session-1',
                  }),
                ]),
                browserSessions: [],
              }),
            }),
          }),
        ],
      }));
      expect(body.providers[0]?.checks.some((check) => check.code === 'tool_catalog_unavailable')).toBe(false);
      expect(body.providers[0]?.config.toolCatalogContext).toBeUndefined();
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('exposes Agent SDK session activity through the MCP provider_diagnostics tool without forcing unsupported effective tool discovery', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
            return new Response(JSON.stringify({
              id: 'probe-session-1',
              provider: 'claude',
              provider_session_id: 'sdk-provider-probe',
              model: 'sonnet',
              status: 'idle',
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
            return new Response(null, { status: 204 });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-mcp-effective-diagnostics',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime MCP bridge diagnostics activity',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const mcpResponse = await runtime.app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'sdk-effective-diagnostics',
          method: 'tools/call',
          params: {
            name: 'provider_diagnostics',
            arguments: {
              probe: 'live',
              sessionId: created.id,
            },
          },
        }),
      });
      expect(mcpResponse.status).toBe(200);
      const mcpBody = await mcpResponse.json() as {
        result?: {
          structuredContent?: {
            query?: { filters?: Record<string, unknown> };
            providers?: Array<{ checks?: Array<{ code: string }>; config?: Record<string, unknown> }>;
          };
        };
      };

      expect(mcpBody).toEqual(expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            providersPath: `/diagnostics/providers?probe=live&sessionId=${created.id}`,
            query: expect.objectContaining({
              filters: {
                provider: 'claude',
                backend: 'agent',
                instance: 'sdk',
                toolCatalogScope: 'effective',
                sessionId: created.id,
                sessionKey: 'sdk-mcp-effective-diagnostics',
              },
            }),
            providers: [
              expect.objectContaining({
                checks: expect.arrayContaining([
                  expect.objectContaining({
                    code: 'session_evidence_visible',
                  }),
                  expect.objectContaining({
                    code: 'bridge_session_activity_visible',
                  }),
                  expect.objectContaining({
                    code: 'tool_catalog_loaded',
                  }),
                ]),
                config: expect.objectContaining({
                  toolCatalog: expect.objectContaining({
                    method: 'providers_get',
                  }),
                  sessionActivity: expect.objectContaining({
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-effective-diagnostics',
                    activity: {
                      toolUseCount: 1,
                      toolResultCount: 1,
                      serviceUpdateCount: 1,
                      observedToolNames: ['grep'],
                      observedServiceIds: ['preview'],
                    },
                  }),
                  sessionEvidence: expect.objectContaining({
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-effective-diagnostics',
                    counts: expect.objectContaining({
                      serviceCount: 1,
                      previewSurfaceCount: 1,
                    }),
                    services: [
                      {
                        id: 'preview',
                        name: 'preview',
                        url: 'https://preview.test/bridge-session-1',
                      },
                    ],
                  }),
                }),
              }),
            ],
          }),
        }),
      }));
      const structuredProviders = mcpBody.result?.structuredContent?.providers || [];
      expect(structuredProviders[0]?.config?.toolCatalogContext).toBeUndefined();
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('surfaces latest retained Agent SDK session evidence on live provider diagnostics without session filters', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
            return new Response(JSON.stringify({
              id: 'probe-session-1',
              provider: 'claude',
              provider_session_id: 'sdk-provider-probe',
              model: 'sonnet',
              status: 'idle',
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
            return new Response(null, { status: 204 });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-latest-evidence',
        }),
      });
      expect(createResponse.status).toBe(201);

      const created = await createResponse.json() as { id: string };
      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime retained evidence',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
      );
      expect(response.status).toBe(200);
      const body = await response.json() as {
        query: { filters: Record<string, unknown> };
        providers: Array<{
          checks: Array<{ code: string; details?: Record<string, unknown> }>;
          config: Record<string, unknown>;
        }>;
      };

      expect(body).toEqual(expect.objectContaining({
        query: expect.objectContaining({
          filters: {
            provider: 'claude',
            backend: 'agent',
            instance: 'sdk',
          },
        }),
        providers: [
          expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'latest_session_activity_visible',
                details: expect.objectContaining({
                  source: 'runtime_registry_latest_session',
                  sessionId: created.id,
                  sessionKey: 'sdk-latest-evidence',
                  observedAt: expect.any(String),
                  toolUseCount: 1,
                  toolResultCount: 1,
                  serviceUpdateCount: 1,
                  observedToolNames: ['grep'],
                  observedServiceIds: ['preview'],
                }),
              }),
              expect.objectContaining({
                code: 'latest_session_evidence_visible',
                details: expect.objectContaining({
                  source: 'runtime_registry_latest_session',
                  sessionId: created.id,
                  sessionKey: 'sdk-latest-evidence',
                  observedAt: expect.any(String),
                  artifactCount: 0,
                  serviceCount: 1,
                  previewSurfaceCount: 1,
                  readyPreviewSurfaceCount: 1,
                  browserSessionCount: 0,
                  openBrowserPageCount: 0,
                  serviceIds: ['preview'],
                }),
              }),
              expect.objectContaining({
                code: 'tool_catalog_loaded',
              }),
            ]),
            config: expect.objectContaining({
              latestSessionActivity: expect.objectContaining({
                source: 'runtime_registry_latest_session',
                sessionId: created.id,
                sessionKey: 'sdk-latest-evidence',
                providerSessionId: 'bridge-session-1',
                status: 'idle',
                observedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                }),
                activity: {
                  toolUseCount: 1,
                  toolResultCount: 1,
                  serviceUpdateCount: 1,
                  observedToolNames: ['grep'],
                  observedServiceIds: ['preview'],
                },
              }),
              latestSessionEvidence: expect.objectContaining({
                source: 'runtime_registry_latest_session',
                sessionId: created.id,
                sessionKey: 'sdk-latest-evidence',
                providerSessionId: 'bridge-session-1',
                status: 'idle',
                observedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                }),
                latestRun: expect.objectContaining({
                  id: expect.any(String),
                  status: 'succeeded',
                }),
                counts: {
                  artifactCount: 0,
                  serviceCount: 1,
                  previewSurfaceCount: 1,
                  readyPreviewSurfaceCount: 1,
                  browserSessionCount: 0,
                  openBrowserPageCount: 0,
                },
                artifacts: [],
                services: [
                  {
                    id: 'preview',
                    name: 'preview',
                    url: 'https://preview.test/bridge-session-1',
                  },
                ],
                previewSurfaces: expect.arrayContaining([
                  expect.objectContaining({
                    kind: 'service',
                    source: 'session_service',
                    status: 'ready',
                    renderHint: 'iframe',
                    label: 'preview',
                    url: 'https://preview.test/bridge-session-1',
                  }),
                ]),
                browserSessions: [],
              }),
            }),
          }),
        ],
      }));
      expect(body.providers[0]?.checks.some((check) => check.code === 'bridge_session_activity_visible')).toBe(false);
      expect(body.providers[0]?.config.sessionActivity).toBeUndefined();
      expect(body.providers[0]?.config.sessionEvidence).toBeUndefined();
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('exposes latest retained Agent SDK session evidence through the MCP provider_diagnostics tool', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
            return new Response(JSON.stringify({
              id: 'probe-session-1',
              provider: 'claude',
              provider_session_id: 'sdk-provider-probe',
              model: 'sonnet',
              status: 'idle',
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
            return new Response(null, { status: 204 });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-mcp-latest-evidence',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime retained MCP evidence',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const mcpResponse = await runtime.app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'sdk-latest-evidence',
          method: 'tools/call',
          params: {
            name: 'provider_diagnostics',
            arguments: {
              probe: 'live',
              provider: 'claude',
              backend: 'agent',
              instance: 'sdk',
            },
          },
        }),
      });
      expect(mcpResponse.status).toBe(200);
      const mcpBody = await mcpResponse.json() as {
        result?: {
          structuredContent?: {
            query?: { filters?: Record<string, unknown> };
            providers?: Array<{ checks?: Array<{ code: string }>; config?: Record<string, unknown> }>;
          };
        };
      };

      expect(mcpBody).toEqual(expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            providersPath: '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
            query: expect.objectContaining({
              filters: {
                provider: 'claude',
                backend: 'agent',
                instance: 'sdk',
              },
            }),
            providers: [
              expect.objectContaining({
                checks: expect.arrayContaining([
                  expect.objectContaining({
                    code: 'latest_session_activity_visible',
                  }),
                  expect.objectContaining({
                    code: 'latest_session_evidence_visible',
                  }),
                  expect.objectContaining({
                    code: 'tool_catalog_loaded',
                  }),
                ]),
                config: expect.objectContaining({
                  latestSessionActivity: expect.objectContaining({
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-latest-evidence',
                    activity: {
                      toolUseCount: 1,
                      toolResultCount: 1,
                      serviceUpdateCount: 1,
                      observedToolNames: ['grep'],
                      observedServiceIds: ['preview'],
                    },
                  }),
                  latestSessionEvidence: expect.objectContaining({
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-latest-evidence',
                    counts: expect.objectContaining({
                      serviceCount: 1,
                      previewSurfaceCount: 1,
                    }),
                    services: [
                      {
                        id: 'preview',
                        name: 'preview',
                        url: 'https://preview.test/bridge-session-1',
                      },
                    ],
                  }),
                }),
              }),
            ],
          }),
        }),
      }));
      const structuredProviders = mcpBody.result?.structuredContent?.providers || [];
      expect(structuredProviders[0]?.config?.sessionActivity).toBeUndefined();
      expect(structuredProviders[0]?.config?.sessionEvidence).toBeUndefined();
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('retains Agent SDK target evidence on provider diagnostics after deleting the runtime session', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
            return new Response(JSON.stringify({
              id: 'probe-session-1',
              provider: 'claude',
              provider_session_id: 'sdk-provider-probe',
              model: 'sonnet',
              status: 'idle',
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
            return new Response(null, { status: 204 });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-deleted-evidence',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime durable target evidence',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const deleteResponse = await runtime.app.request(`/sessions/${created.id}`, {
        method: 'DELETE',
      });
      expect(deleteResponse.status).toBe(200);

      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'latest_session_activity_visible',
                details: expect.objectContaining({
                  source: 'retained_target_evidence',
                  sessionId: created.id,
                  sessionKey: 'sdk-deleted-evidence',
                  observedAt: expect.any(String),
                  retainedAt: expect.any(String),
                }),
              }),
              expect.objectContaining({
                code: 'latest_session_evidence_visible',
                details: expect.objectContaining({
                  source: 'retained_target_evidence',
                  sessionId: created.id,
                  sessionKey: 'sdk-deleted-evidence',
                  observedAt: expect.any(String),
                  retainedAt: expect.any(String),
                }),
              }),
            ]),
            config: expect.objectContaining({
              latestSessionActivity: expect.objectContaining({
                source: 'retained_target_evidence',
                sessionId: created.id,
                sessionKey: 'sdk-deleted-evidence',
                observedAt: expect.any(String),
                retainedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                }),
                activity: {
                  toolUseCount: 1,
                  toolResultCount: 1,
                  serviceUpdateCount: 1,
                  observedToolNames: ['grep'],
                  observedServiceIds: ['preview'],
                },
              }),
              latestSessionEvidence: expect.objectContaining({
                source: 'retained_target_evidence',
                sessionId: created.id,
                sessionKey: 'sdk-deleted-evidence',
                observedAt: expect.any(String),
                retainedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                }),
                counts: expect.objectContaining({
                  serviceCount: 1,
                  previewSurfaceCount: 1,
                }),
                services: [
                  {
                    id: 'preview',
                    name: 'preview',
                    url: 'https://preview.test/bridge-session-1',
                  },
                ],
              }),
            }),
          }),
        ],
      }));
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('retains Agent SDK target evidence through the MCP provider_diagnostics tool after deleting the runtime session', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'GET') {
            return new Response(JSON.stringify({
              id: 'probe-session-1',
              provider: 'claude',
              provider_session_id: 'sdk-provider-probe',
              model: 'sonnet',
              status: 'idle',
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions/probe-session-1' && method === 'DELETE') {
            return new Response(null, { status: 204 });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-mcp-deleted-evidence',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime durable MCP target evidence',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const deleteResponse = await runtime.app.request(`/sessions/${created.id}`, {
        method: 'DELETE',
      });
      expect(deleteResponse.status).toBe(200);

      const mcpResponse = await runtime.app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'sdk-mcp-deleted-evidence',
          method: 'tools/call',
          params: {
            name: 'provider_diagnostics',
            arguments: {
              probe: 'live',
              provider: 'claude',
              backend: 'agent',
              instance: 'sdk',
            },
          },
        }),
      });
      expect(mcpResponse.status).toBe(200);
      await expect(mcpResponse.json()).resolves.toEqual(expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            providersPath: '/diagnostics/providers?probe=live&provider=claude&backend=agent&instance=sdk',
            providers: [
              expect.objectContaining({
                checks: expect.arrayContaining([
                  expect.objectContaining({
                    code: 'latest_session_activity_visible',
                  }),
                  expect.objectContaining({
                    code: 'latest_session_evidence_visible',
                  }),
                ]),
                config: expect.objectContaining({
                  latestSessionActivity: expect.objectContaining({
                    source: 'retained_target_evidence',
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-deleted-evidence',
                    observedAt: expect.any(String),
                    retainedAt: expect.any(String),
                  }),
                  latestSessionEvidence: expect.objectContaining({
                    source: 'retained_target_evidence',
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-deleted-evidence',
                    observedAt: expect.any(String),
                    retainedAt: expect.any(String),
                  }),
                }),
              }),
            ],
          }),
        }),
      }));
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('keeps agent tooling ownership honest on the provider tooling route', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], []),
      },
    });

    try {
      const response = await runtime.app.request('/providers/openclaw/tools?instance=agent/gateway');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        provider: 'openclaw',
        backend: 'agent',
        instance: 'gateway',
        target: 'agent/gateway',
        catalogContext: {
          scope: 'catalog',
        },
        continuity: {
          source: 'provider_managed',
          summary: expect.stringContaining('external agent runtime owns provider-managed session continuity'),
          resume: true,
          fork: true,
          permissions: false,
          providerManagedSessions: true,
          sessionKey: true,
          providerSessionState: true,
          remoteCancel: false,
        },
        agentRuntime: expect.objectContaining({
          adapter: 'openclaw',
          family: 'gateway',
          summary: expect.stringContaining('OpenClaw gateway'),
          endpoint: 'ws://gateway.test/ws',
          transport: {
            kind: 'websocket',
            protocol: 'openclaw_gateway_v3',
            liveProbe: 'rpc_health',
            modelDiscovery: 'models_list',
            toolDiscovery: 'tools_catalog',
            streaming: 'agent_event_frames',
          },
          request: {
            headerNames: ['authorization'],
          },
          auth: expect.objectContaining({
            mechanisms: expect.arrayContaining(['connect_auth', 'handshake_header']),
            credentials: expect.arrayContaining([
              { kind: 'url', configured: true },
              { kind: 'auth_token', configured: true },
            ]),
          }),
          continuity: {
            providerManagedSessions: true,
            sessionKey: true,
            providerSessionState: true,
            cancel: false,
          },
          capabilities: {
            probe: true,
            modelDiscovery: true,
            toolCatalog: true,
            effectiveToolCatalog: true,
            cancel: false,
            runtimeServices: true,
            toolCallEvents: false,
          },
        }),
        source: 'provider_managed',
        discoverable: true,
        sessionScopedOverrides: false,
        summary: expect.stringContaining('external agent runtime'),
        catalog: {
          source: 'provider_remote',
          status: 'ready',
          method: 'tools_catalog',
          summary: '3 tool(s) across 2 group(s) advertised by the OpenClaw gateway.',
          toolCount: 3,
          groupCount: 2,
          groups: [
            { id: 'core', label: 'Core', toolCount: 2 },
            { id: 'plugin:media', label: 'Media', toolCount: 1 },
          ],
          tools: [
            { name: 'read_file', source: 'core', groupId: 'core' },
            { name: 'share_image', source: 'plugin', groupId: 'plugin:media', pluginId: 'media', optional: true },
            { name: 'write_file', source: 'core', groupId: 'core' },
          ],
        },
        observability: {
          catalog: 'provider_remote_enumerated',
          toolCallEvents: false,
          runtimeServices: true,
        },
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('supports session-effective OpenClaw tool discovery on the provider tooling route', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          cwd: config.sessionBaseDir,
          sessionKey: 'openclaw-effective-tools',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string; sessionKey: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Prime the remote OpenClaw session',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const response = await runtime.app.request(
        `/providers/openclaw/tools?instance=agent/gateway&scope=effective&sessionId=${created.id}`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        provider: 'openclaw',
        backend: 'agent',
        instance: 'gateway',
        catalogContext: {
          scope: 'effective',
          sessionId: created.id,
          sessionKey: 'openclaw-effective-tools',
        },
        catalog: expect.objectContaining({
          source: 'provider_remote',
          status: 'ready',
          method: 'tools_effective',
          summary: '2 tool(s) across 2 group(s) available to the current OpenClaw session.',
          toolCount: 2,
          groupCount: 2,
          groups: [
            { id: 'channel', toolCount: 1 },
            { id: 'core', toolCount: 1 },
          ],
          tools: [
            { name: 'exec', source: 'core', groupId: 'core' },
            { name: 'send_message', source: 'channel', groupId: 'channel' },
          ],
        }),
      }));
      expect(sentFrames.filter((frame) => frame.method === 'tools.effective')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('exposes session-effective OpenClaw tool discovery through the MCP provider_tools tool', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          cwd: config.sessionBaseDir,
          sessionKey: 'openclaw-mcp-effective-tools',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Prime MCP effective tool inspection',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const mcpResponse = await runtime.app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'effective-tools',
          method: 'tools/call',
          params: {
            name: 'provider_tools',
            arguments: {
              provider: 'openclaw',
              instance: 'agent/gateway',
              scope: 'effective',
              sessionId: created.id,
            },
          },
        }),
      });
      expect(mcpResponse.status).toBe(200);
      await expect(mcpResponse.json()).resolves.toEqual(expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            provider: 'openclaw',
            backend: 'agent',
            instance: 'gateway',
            toolsPath: `/providers/openclaw/tools?instance=agent%2Fgateway&scope=effective&sessionId=${created.id}`,
            catalogContext: {
              scope: 'effective',
              sessionId: created.id,
              sessionKey: 'openclaw-mcp-effective-tools',
            },
            catalog: expect.objectContaining({
              method: 'tools_effective',
              toolCount: 2,
            }),
          }),
        }),
      }));
      expect(sentFrames.filter((frame) => frame.method === 'tools.effective')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('scopes live OpenClaw provider diagnostics to session-effective tool context', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          cwd: config.sessionBaseDir,
          sessionKey: 'openclaw-effective-diagnostics',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Prime diagnostics effective tool inspection',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const response = await runtime.app.request(
        `/diagnostics/providers?probe=live&sessionId=${created.id}`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        probe: 'live',
        query: {
          hasFilters: true,
          filters: {
            provider: 'openclaw',
            backend: 'agent',
            instance: 'gateway',
            toolCatalogScope: 'effective',
            sessionId: created.id,
            sessionKey: 'openclaw-effective-diagnostics',
          },
        },
        summary: expect.objectContaining({
          targets: 1,
        }),
        providers: [
          expect.objectContaining({
            provider: 'openclaw',
            backend: 'agent',
            instance: 'gateway',
            config: expect.objectContaining({
              toolCatalog: expect.objectContaining({
                method: 'tools_effective',
                toolCount: 2,
                groupCount: 2,
              }),
              toolCatalogContext: {
                scope: 'effective',
                sessionId: created.id,
                sessionKey: 'openclaw-effective-diagnostics',
              },
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'tool_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  method: 'tools_effective',
                  toolCount: 2,
                  groupCount: 2,
                }),
              }),
            ]),
          }),
        ],
      }));
      expect(sentFrames.filter((frame) => frame.method === 'tools.effective')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('exposes session-effective provider diagnostics through the MCP provider_diagnostics tool', async () => {
    const { config, env, cleanup } = createAgentConfigRoot();
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openclaw',
          cwd: config.sessionBaseDir,
          sessionKey: 'openclaw-mcp-effective-diagnostics',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Prime MCP diagnostics effective tool inspection',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const mcpResponse = await runtime.app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'effective-diagnostics',
          method: 'tools/call',
          params: {
            name: 'provider_diagnostics',
            arguments: {
              probe: 'live',
              sessionId: created.id,
            },
          },
        }),
      });
      expect(mcpResponse.status).toBe(200);
      await expect(mcpResponse.json()).resolves.toEqual(expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            providersPath: `/diagnostics/providers?probe=live&sessionId=${created.id}`,
            query: {
              hasFilters: true,
              filters: {
                provider: 'openclaw',
                backend: 'agent',
                instance: 'gateway',
                toolCatalogScope: 'effective',
                sessionId: created.id,
                sessionKey: 'openclaw-mcp-effective-diagnostics',
              },
            },
            providers: [
              expect.objectContaining({
                provider: 'openclaw',
                backend: 'agent',
                instance: 'gateway',
                config: expect.objectContaining({
                  toolCatalog: expect.objectContaining({
                    method: 'tools_effective',
                  }),
                  toolCatalogContext: {
                    scope: 'effective',
                    sessionId: created.id,
                    sessionKey: 'openclaw-mcp-effective-diagnostics',
                  },
                }),
              }),
            ],
          }),
        }),
      }));
      expect(sentFrames.filter((frame) => frame.method === 'tools.effective')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('loads a dynamic OpenClaw model catalog through the provider models route', async () => {
    const { config, env, cleanup } = createAgentConfigRoot({
      model: 'anthropic/claude-test-a',
    });
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const response = await runtime.app.request('/providers/openclaw/models?instance=agent/gateway');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        provider: 'openclaw',
        backend: 'agent',
        instance: 'gateway',
        defaultModel: 'anthropic/claude-test-a',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          {
            id: 'anthropic/claude-test-a',
            label: 'A-Model (anthropic)',
            default: true,
            status: 'available',
          },
          {
            id: 'openai/gpt-test-z',
            label: 'openai/gpt-test-z',
            default: false,
            status: 'available',
          },
        ],
        warnings: [],
      });
      expect(sentFrames.filter((frame) => frame.method === 'connect')).toHaveLength(1);
      expect(sentFrames.filter((frame) => frame.method === 'models.list')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('surfaces dynamic OpenClaw model catalog details in live provider diagnostics', async () => {
    const { config, env, cleanup } = createAgentConfigRoot({
      model: 'anthropic/claude-test-a',
    });
    const sentFrames: Array<Record<string, unknown>> = [];
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        webSocketFactory: createFakeWebSocketFactory([], sentFrames),
      },
    });

    try {
      const response = await runtime.app.request(
        '/diagnostics/providers?probe=live&provider=openclaw&backend=agent&instance=gateway',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'openclaw',
            backend: 'agent',
            instance: 'gateway',
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'agent_runtime_contract',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'probe',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'model_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  source: 'dynamic',
                  defaultModel: 'anthropic/claude-test-a',
                  modelCount: 2,
                }),
              }),
              expect.objectContaining({
                code: 'configured_model_present',
                status: 'ok',
                details: expect.objectContaining({
                  model: 'anthropic/claude-test-a',
                  source: 'dynamic',
                  status: 'available',
                }),
              }),
              expect.objectContaining({
                code: 'tool_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  method: 'tools_catalog',
                  toolCount: 3,
                  groupCount: 2,
                }),
              }),
            ]),
            config: expect.objectContaining({
              agentRuntime: expect.objectContaining({
                adapter: 'openclaw',
                transport: expect.objectContaining({
                  protocol: 'openclaw_gateway_v3',
                }),
              }),
              modelCatalog: expect.objectContaining({
                source: 'dynamic',
                defaultModel: 'anthropic/claude-test-a',
                modelCount: 2,
                warnings: [],
              }),
              toolCatalog: expect.objectContaining({
                source: 'provider_remote',
                status: 'ready',
                method: 'tools_catalog',
                toolCount: 3,
                groupCount: 2,
              }),
            }),
          }),
        ],
      }));
      expect(sentFrames.filter((frame) => frame.method === 'connect')).toHaveLength(3);
      expect(sentFrames.filter((frame) => frame.method === 'health')).toHaveLength(1);
      expect(sentFrames.filter((frame) => frame.method === 'models.list')).toHaveLength(1);
      expect(sentFrames.filter((frame) => frame.method === 'tools.catalog')).toHaveLength(1);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('supports an Agent SDK bridge adapter as a second agent target', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      fetchCalls.push({ url, method, body });

      if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
        return new Response(JSON.stringify({
          providers: [
            {
              name: 'claude',
              default_model: 'sonnet',
              models: ['sonnet', 'haiku'],
              capabilities: {
                streaming: true,
                mcp: true,
                vision: false,
              },
              tool_groups: [
                {
                  id: 'core',
                  label: 'Core',
                  tools: [
                    { name: 'grep', source: 'core' },
                    { name: 'read_file', source: 'core' },
                  ],
                },
              ],
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
        return new Response(JSON.stringify({
          id: 'bridge-session-1',
          provider: 'claude',
          model: 'sonnet',
          status: 'idle',
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream' && method === 'POST') {
        const sse = [
          'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
          '',
          'data: not-json',
          '',
          'data: {"type":"content","content":"bridge hello "}',
          '',
          'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
          '',
          'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
          '',
          'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
          '',
          'data: {"type":"content","content":"world"}',
          '',
          'data: {"type":"token_usage","usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}',
          '',
          'data: {"type":"complete","sessionId":"bridge-session-1","finishReason":"stop"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort' && method === 'POST') {
        return new Response(null, {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: fakeFetch,
      },
    });

    try {
      const providerResponse = await runtime.app.request('/providers/config');
      expect(providerResponse.status).toBe(200);
      expect(await providerResponse.json()).toEqual(expect.objectContaining({
        providers: {
          claude: {
            defaultInstance: 'sdk',
            defaultBackend: 'agent',
            instances: [expect.objectContaining({
              id: 'sdk',
              target: 'agent/sdk',
              backend: 'agent',
              transport: 'agent_sdk_bridge',
              model: 'sonnet',
              continuity: {
                source: 'provider_managed',
                summary: expect.stringContaining('external agent runtime owns provider-managed session continuity'),
                resume: true,
                fork: true,
                permissions: false,
                providerManagedSessions: true,
                sessionKey: true,
                providerSessionState: true,
                remoteCancel: true,
              },
              agentRuntime: {
                adapter: 'agent_sdk_bridge',
                family: 'bridge',
                summary: expect.stringContaining('Agent SDK bridge'),
                endpoint: 'http://agent-sdk.test',
                transport: {
                  kind: 'http',
                  protocol: 'agent_sdk_http_v1',
                  liveProbe: 'providers_get',
                  modelDiscovery: 'providers_get',
                  toolDiscovery: 'providers_get',
                  streaming: 'sse',
                },
                request: {
                  headerNames: ['authorization'],
                },
                auth: {
                  mechanisms: ['bearer_header'],
                  credentials: [
                    { kind: 'base_url', configured: true },
                    { kind: 'auth_token', configured: true },
                  ],
                },
                continuity: {
                  providerManagedSessions: true,
                  sessionKey: true,
                  providerSessionState: true,
                  cancel: true,
                },
                capabilities: {
                  probe: true,
                  modelDiscovery: true,
                  toolCatalog: true,
                  effectiveToolCatalog: false,
                  cancel: true,
                  runtimeServices: true,
                  toolCallEvents: true,
                },
              },
              tooling: {
                source: 'provider_managed',
                discoverable: true,
                sessionScopedOverrides: false,
                summary: expect.stringContaining('external agent runtime'),
                observability: {
                  catalog: 'provider_remote_enumerated',
                  toolCallEvents: true,
                  runtimeServices: true,
                },
              },
              install: null,
              compatibility: null,
            })],
          },
        },
        executionStrategies: expect.objectContaining({
          summary: expect.objectContaining({
            totalFamilies: 7,
            supportedFamilies: 7,
            fallbackOnlyFamilies: 0,
            compatibilityDefault: 'simple_tool_call',
          }),
        }),
      }));

      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-task-1',
          reusePolicy: 'prefer_existing',
          instructions: 'Use the bridge carefully.',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string; providerBackend: string; sessionKey: string };
      expect(created.providerBackend).toBe('agent');
      expect(created.sessionKey).toBe('sdk-task-1');

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Plan the next step',
        }),
      });
      expect(messageResponse.status).toBe(200);
      expect(parseNdjson(await messageResponse.text())).toEqual([
        {
          type: 'init',
          providerSessionId: 'bridge-session-1',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'active',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-1',
              },
            },
          },
        },
        {
          type: 'text',
          providerSessionId: 'bridge-session-1',
          text: 'bridge hello ',
        },
        {
          type: 'tool_use',
          providerSessionId: 'bridge-session-1',
          toolName: 'grep',
          toolArgs: {
            pattern: 'TODO',
          },
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'active',
              activity: {
                toolUseCount: 1,
                toolResultCount: 0,
                serviceUpdateCount: 0,
                observedToolNames: ['grep'],
                observedServiceIds: [],
              },
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-1',
                upstreamProviderSessionId: 'sdk-provider-1',
              },
            },
          },
        },
        {
          type: 'tool_result',
          providerSessionId: 'bridge-session-1',
          toolName: 'grep',
          toolId: 'tool-1',
          text: '1 match',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'active',
              activity: {
                toolUseCount: 1,
                toolResultCount: 1,
                serviceUpdateCount: 0,
                observedToolNames: ['grep'],
                observedServiceIds: [],
              },
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-1',
                upstreamProviderSessionId: 'sdk-provider-1',
              },
            },
          },
        },
        {
          type: 'text',
          providerSessionId: 'bridge-session-1',
          text: 'world',
        },
        {
          type: 'result',
          providerSessionId: 'bridge-session-1',
          usage: {
            inputTokens: 12,
            outputTokens: 5,
          },
          services: [
            {
              id: 'preview',
              name: 'preview',
              url: 'https://preview.test/bridge-session-1',
            },
          ],
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'idle',
              services: [
                {
                  id: 'preview',
                  name: 'preview',
                  url: 'https://preview.test/bridge-session-1',
                },
              ],
              activity: {
                toolUseCount: 1,
                toolResultCount: 1,
                serviceUpdateCount: 1,
                observedToolNames: ['grep'],
                observedServiceIds: ['preview'],
              },
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-1',
                upstreamProviderSessionId: 'sdk-provider-1',
              },
            },
          },
          metadata: {
            provider: 'claude',
            runtimeUsage: {
              totalTokens: 17,
              sourceConfidence: 'aggregated',
              latencyMs: expect.any(Number),
            },
          },
        },
      ]);

      const providerResponseAfterMessage = await runtime.app.request('/providers/config');
      expect(providerResponseAfterMessage.status).toBe(200);
      await expect(providerResponseAfterMessage.json()).resolves.toEqual(expect.objectContaining({
        providers: {
          claude: expect.objectContaining({
            instances: [expect.objectContaining({
              id: 'sdk',
              latestSessionActivity: expect.objectContaining({
                source: 'runtime_registry_latest_session',
                sessionId: created.id,
                sessionKey: 'sdk-task-1',
                observedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                }),
                activity: {
                  toolUseCount: 1,
                  toolResultCount: 1,
                  serviceUpdateCount: 1,
                  observedToolNames: ['grep'],
                  observedServiceIds: ['preview'],
                },
              }),
              latestSessionEvidence: expect.objectContaining({
                source: 'runtime_registry_latest_session',
                sessionId: created.id,
                sessionKey: 'sdk-task-1',
                observedAt: expect.any(String),
                workspace: expect.objectContaining({
                  cwd: config.sessionBaseDir,
                }),
                counts: expect.objectContaining({
                  serviceCount: 1,
                  previewSurfaceCount: 1,
                }),
                services: [
                  {
                    id: 'preview',
                    name: 'preview',
                    url: 'https://preview.test/bridge-session-1',
                  },
                ],
              }),
            })],
          }),
        },
      }));

      const observeResponse = await runtime.app.request(`/sessions/${created.id}/observe`);
      expect(observeResponse.status).toBe(200);
      await expect(observeResponse.json()).resolves.toEqual(expect.objectContaining({
        session: expect.objectContaining({
          inspection: expect.objectContaining({
            agentSession: {
              providerSessionId: 'bridge-session-1',
              sessionKey: 'sdk-task-1',
              status: 'idle',
              activity: {
                toolUseCount: 1,
                toolResultCount: 1,
                serviceUpdateCount: 1,
                observedToolNames: ['grep'],
                observedServiceIds: ['preview'],
              },
            },
            services: [
              {
                id: 'preview',
                name: 'preview',
                url: 'https://preview.test/bridge-session-1',
              },
            ],
            previewSurfaces: expect.arrayContaining([
              expect.objectContaining({
                kind: 'service',
                label: 'preview',
                url: 'https://preview.test/bridge-session-1',
              }),
            ]),
            recentEvents: expect.arrayContaining([
              expect.objectContaining({
                eventType: 'tool_use',
                toolName: 'grep',
              }),
              expect.objectContaining({
                eventType: 'tool_result',
                toolName: 'grep',
                toolId: 'tool-1',
              }),
            ]),
          }),
        }),
      }));

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const reuseResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          sessionKey: 'sdk-task-1',
          reusePolicy: 'require_existing',
        }),
      });
      expect(reuseResponse.status).toBe(200);
      const reused = await reuseResponse.json() as { id: string };
      expect(reused.id).toBe(created.id);

      const resumedMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Continue',
        }),
      });
      expect(resumedMessage.status).toBe(200);

      const createCalls = fetchCalls.filter((call) => call.url === 'http://agent-sdk.test/api/v1/sessions');
      expect(createCalls).toHaveLength(1);
      const streamCalls = fetchCalls.filter((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream',
      );
      expect(streamCalls).toHaveLength(2);
      expect(streamCalls[0]?.body).toEqual({
        message: 'Use the bridge carefully.\n\nPlan the next step',
      });
      expect(streamCalls[1]?.body).toEqual({
        message: 'Use the bridge carefully.\n\nContinue',
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('surfaces retained Agent SDK target evidence through the MCP providers_config tool after deleting the runtime session', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    let createCallCount = 0;
    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method || 'GET';

          if (url === 'http://agent-sdk.test/api/v1/providers' && method === 'GET') {
            return new Response(JSON.stringify({
              providers: [
                {
                  name: 'claude',
                  default_model: 'sonnet',
                  models: ['sonnet', 'haiku'],
                  capabilities: {
                    streaming: true,
                    mcp: true,
                    vision: false,
                  },
                  tool_groups: createAgentSdkBridgeToolGroups(),
                },
              ],
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
            createCallCount += 1;
            return new Response(JSON.stringify({
              id: createCallCount === 1 ? 'bridge-session-1' : 'probe-session-1',
            }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }

          if (
            url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
            && method === 'POST'
          ) {
            const sse = [
              'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
              '',
              'data: {"type":"tool_use","toolName":"grep","toolInput":{"pattern":"TODO"}}',
              '',
              'data: {"type":"tool_result","toolName":"grep","toolUseId":"tool-1","content":"1 match"}',
              '',
              'data: {"type":"service_update","services":[{"id":"preview","name":"preview","url":"https://preview.test/bridge-session-1"}]}',
              '',
              'data: {"type":"content","content":"done"}',
              '',
              'data: [DONE]',
              '',
            ].join('\n');
            return new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
          }

          throw new Error(`Unexpected fetch: ${method} ${url}`);
        },
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-mcp-provider-config',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Prime retained provider-config evidence',
        }),
      });
      expect(messageResponse.status).toBe(200);
      await parseNdjson(await messageResponse.text());

      const deleteResponse = await runtime.app.request(`/sessions/${created.id}`, {
        method: 'DELETE',
      });
      expect(deleteResponse.status).toBe(200);

      const mcpResponse = await runtime.app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'sdk-provider-config-retained',
          method: 'tools/call',
          params: {
            name: 'providers_config',
            arguments: {},
          },
        }),
      });
      expect(mcpResponse.status).toBe(200);
      await expect(mcpResponse.json()).resolves.toEqual(expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            configPath: '/providers/config',
            providers: expect.objectContaining({
              claude: expect.objectContaining({
                instances: [expect.objectContaining({
                  id: 'sdk',
                  latestSessionActivity: expect.objectContaining({
                    source: 'retained_target_evidence',
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-provider-config',
                    observedAt: expect.any(String),
                    retainedAt: expect.any(String),
                    workspace: expect.objectContaining({
                      cwd: config.sessionBaseDir,
                    }),
                  }),
                  latestSessionEvidence: expect.objectContaining({
                    source: 'retained_target_evidence',
                    sessionId: created.id,
                    sessionKey: 'sdk-mcp-provider-config',
                    observedAt: expect.any(String),
                    retainedAt: expect.any(String),
                    workspace: expect.objectContaining({
                      cwd: config.sessionBaseDir,
                    }),
                    counts: expect.objectContaining({
                      serviceCount: 1,
                      previewSurfaceCount: 1,
                    }),
                  }),
                })],
              }),
            }),
          }),
        }),
      }));
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('recreates a missing Agent SDK bridge session on resume', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    let createCount = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      fetchCalls.push({ url, method, body });

      if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
        createCount += 1;
        return new Response(JSON.stringify({
          id: `bridge-session-${createCount}`,
          provider: 'claude',
          model: 'sonnet',
          status: 'idle',
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream' && method === 'POST') {
        if (fetchCalls.filter((call) => call.url === url).length === 1) {
          const sse = [
            'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
            '',
            'data: {"type":"content","content":"first turn"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n');
          return new Response(sse, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        return new Response(JSON.stringify({ error: 'session not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-2/messages/stream' && method === 'POST') {
        const sse = [
          'data: {"type":"session_created","sessionId":"bridge-session-2","providerSessionId":"sdk-provider-2"}',
          '',
          'data: {"type":"content","content":"second turn"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort' && method === 'POST') {
        return new Response(null, {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: fakeFetch,
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-task-2',
          reusePolicy: 'prefer_existing',
          instructions: 'Use the bridge carefully.',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const firstMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'First',
        }),
      });
      expect(firstMessage.status).toBe(200);

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);

      const reuseResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          sessionKey: 'sdk-task-2',
          reusePolicy: 'require_existing',
        }),
      });
      expect(reuseResponse.status).toBe(200);

      const resumedMessage = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Second',
        }),
      });
      expect(resumedMessage.status).toBe(200);
      expect(parseNdjson(await resumedMessage.text())).toEqual([
        {
          type: 'init',
          providerSessionId: 'bridge-session-2',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-2',
              sessionKey: 'sdk-task-2',
              status: 'active',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-2',
              },
            },
          },
        },
        {
          type: 'text',
          providerSessionId: 'bridge-session-2',
          text: 'second turn',
        },
        {
          type: 'result',
          providerSessionId: 'bridge-session-2',
          providerState: {
            agentSession: {
              providerSessionId: 'bridge-session-2',
              sessionKey: 'sdk-task-2',
              status: 'idle',
              adapterState: {
                bridgeProvider: 'claude',
                bridgeSessionId: 'bridge-session-2',
                upstreamProviderSessionId: 'sdk-provider-2',
              },
            },
          },
          metadata: {
            provider: 'claude',
          },
        },
      ]);

      const createCalls = fetchCalls.filter((call) => call.url === 'http://agent-sdk.test/api/v1/sessions');
      expect(createCalls).toHaveLength(2);
      expect(fetchCalls.some((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort'
          && call.method === 'POST',
      )).toBe(true);
      expect(fetchCalls.some((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream'
          && call.body?.message === 'Use the bridge carefully.\n\nSecond',
      )).toBe(true);
      expect(fetchCalls.some((call) =>
        call.url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-2/messages/stream'
          && call.body?.message === 'Use the bridge carefully.\n\nSecond',
      )).toBe(true);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('keeps close successful when remote agent abort fails after local detach', async () => {
    const { config, env, cleanup } = createAgentSdkConfigRoot();
    const fetchCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      fetchCalls.push({ url, method, body });

      if (url === 'http://agent-sdk.test/api/v1/sessions' && method === 'POST') {
        return new Response(JSON.stringify({
          id: 'bridge-session-1',
          provider: 'claude',
          model: 'sonnet',
          status: 'idle',
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/messages/stream' && method === 'POST') {
        const sse = [
          'data: {"type":"session_created","sessionId":"bridge-session-1","providerSessionId":"sdk-provider-1"}',
          '',
          'data: {"type":"content","content":"bridge hello"}',
          '',
          'data: {"type":"complete","sessionId":"bridge-session-1","finishReason":"stop"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (url === 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort' && method === 'POST') {
        return new Response(JSON.stringify({
          error: 'upstream unavailable',
        }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const runtime = createRuntimeServer(config, {
      agentBackend: {
        env,
        fetch: fakeFetch,
      },
    });

    try {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd: config.sessionBaseDir,
          sessionKey: 'sdk-task-close-failure',
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as { id: string };

      const messageResponse = await runtime.app.request(`/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          message: 'Plan the next step',
        }),
      });
      expect(messageResponse.status).toBe(200);

      runtime.context.registry.setProviderState(created.id, {
        agentSession: {
          providerSessionId: 'bridge-session-1',
          sessionKey: 'sdk-task-close-failure',
          status: 'active',
          adapterState: {
            bridgeProvider: 'claude',
            bridgeSessionId: 'bridge-session-1',
            upstreamProviderSessionId: 'sdk-provider-1',
          },
        },
      });

      const closeResponse = await runtime.app.request(`/sessions/${created.id}/close`, {
        method: 'POST',
      });
      expect(closeResponse.status).toBe(200);
      await expect(closeResponse.json()).resolves.toEqual(expect.objectContaining({
        action: 'close',
        status: 'closed',
        attached: false,
        inspection: expect.objectContaining({
          state: 'closed',
        }),
      }));
      expect(runtime.context.registry.get(created.id)?.status).toBe('closed');
      expect(runtime.context.runtime?.isAttached(created.id)).toBe(false);
      expect(fetchCalls).toContainEqual(expect.objectContaining({
        url: 'http://agent-sdk.test/api/v1/sessions/bridge-session-1/abort',
        method: 'POST',
      }));
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
