import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ApiBackendManager } from './ApiBackendManager.js';
import { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import { toSessionView } from '../../cli/pool/sessionView.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import type { StreamEvent } from '../../../core/types.js';
import { RuntimeSessionManager } from '../../../core/runtime/RuntimeSessionManager.js';
import { buildSessionInspection } from '../../../core/runtime/sessionInspection.js';

async function collectEvents(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function createTarget(): ProviderTargetDescriptor {
  return {
    providerName: 'codex',
    backend: 'api',
    instanceId: 'gateway',
    defaultTarget: true,
    remoteInstance: {
      id: 'gateway',
      providerName: 'codex',
      backend: 'api',
      transport: 'openai',
      model: 'gpt-4.1',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://example.test',
    },
  };
}

function createRuntimeManager(
  sessionBaseDir: string,
  manager: ApiBackendManager,
): RuntimeSessionManager {
  return new RuntimeSessionManager(
    { sessionBaseDir } as never,
    {
      get: vi.fn(),
      spawn: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(),
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as never,
    manager,
  );
}

function buildMeteringSnapshot() {
  return {
    preflight: {
      outcome: 'allowed',
      scope: 'session',
      metric: 'total_output_tokens',
      action: 'warn',
      observedAt: '2026-03-26T00:00:00.000Z',
      reason: 'No guardrail triggered.',
    },
    activeGuardrails: [],
    recentIncidents: [],
  } as never;
}

describe('ApiBackendManager', () => {
  it('keeps session-level instructions when a turn does not override them', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      instructions: 'Session-level instructions.',
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_123',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hello from api backend' }],
        }],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-4.1',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://example.test',
        systemPrompt: 'Remote system prompt.',
      },
    };

    const handle = manager.spawn(session.id, target);
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody?.instructions).toContain('Remote system prompt.');
    expect(capturedBody?.instructions).toContain('Session-level instructions.');
    expect(events).toEqual([
      expect.objectContaining({ type: 'init', sessionId: 'resp_123' }),
      { type: 'text', text: 'hello from api backend', raw: expect.any(Object) },
      expect.objectContaining({
        type: 'result',
        sessionId: 'resp_123',
        usage: {
          inputTokens: 12,
          outputTokens: 4,
        },
      }),
    ]);
  });

  it('layers session-level instructions before turn-level overrides', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-layered',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      instructions: 'Session-level instructions.',
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_456',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hello from layered api backend' }],
        }],
        usage: {
          input_tokens: 8,
          output_tokens: 3,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-4.1',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://example.test',
      },
    };

    const handle = manager.spawn(session.id, target);
    await collectEvents(handle.streamMessage({
      message: 'hello',
      instructions: 'Turn-level instructions.',
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody?.instructions).toContain('Session-level instructions.');
    expect(capturedBody?.instructions).toContain('Turn-level instructions.');
    expect(String(capturedBody?.instructions)).toMatch(
      /Session-level instructions\.\s+Turn-level instructions\./,
    );
  });

  it('applies resolved advanced model controls as provider request patches', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-controls',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      model: 'gpt-5.4',
      modelSelection: {
        entryMode: 'auto',
        presetId: 'deep_reasoning',
        controls: {
          'openai.reasoning_effort': 'high',
        },
      },
      modelResolution: {
        entryId: 'gpt-5.4',
        model: 'gpt-5.4',
        entryMode: 'auto',
        presetId: 'deep_reasoning',
        controls: {
          'openai.reasoning_effort': 'high',
        },
        supportTier: 'full',
        warnings: [],
      },
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_controls',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hello from controlled api backend' }],
        }],
        usage: {
          input_tokens: 8,
          output_tokens: 2,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const target: ProviderTargetDescriptor = {
      providerName: 'codex',
      backend: 'api',
      instanceId: 'gateway',
      defaultTarget: true,
      remoteInstance: {
        id: 'gateway',
        providerName: 'codex',
        backend: 'api',
        transport: 'openai',
        model: 'gpt-4.1',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://example.test',
      },
    };

    const handle = manager.spawn(session.id, target);
    await collectEvents(handle.streamMessage({
      message: 'hello',
    }));

    expect(capturedBody?.reasoning).toEqual({
      effort: 'high',
    });
  });

  it('uses the compatibility strategy when no strategy hint is provided', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-compatibility',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_compat',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'Compatibility path reply.' }],
        }],
        usage: {
          input_tokens: 6,
          output_tokens: 2,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const handle = manager.spawn(session.id, createTarget());
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
    }));
    const updated = registry.get(session.id);

    expect(events).toEqual([
      expect.objectContaining({ type: 'init', sessionId: 'resp_compat' }),
      { type: 'text', text: 'Compatibility path reply.', raw: expect.any(Object) },
      expect.objectContaining({
        type: 'result',
        sessionId: 'resp_compat',
        usage: {
          inputTokens: 6,
          outputTokens: 2,
        },
      }),
    ]);
    expect(events.some((event) =>
      event.type === 'progress' && event.metadata?.kind === 'strategy'
    )).toBe(false);
    expect(String(capturedBody?.instructions ?? '')).not.toContain('Execution strategy: react');
    expect(updated).toMatchObject({
      strategy: {
        effectiveStrategy: 'simple_tool_call',
        resolutionSource: 'compatibility_fallback',
        summary: {
          status: 'completed',
          stepCount: 1,
          resolutionSource: 'compatibility_fallback',
          lastEvent: 'strategy_completed',
        },
      },
    });
  });

  it('honors a session-persisted strategy request when the turn omits a per-turn hint', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-persisted-react',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      strategy: {
        request: {
          requestedStrategy: 'react',
          acceptanceCriteria: 'Return a concise answer.',
          strategyContext: {
            maxSteps: 4,
          },
        },
      },
    });

    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_persisted_react',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'React session request reply.' }],
        }],
        usage: {
          input_tokens: 6,
          output_tokens: 2,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const handle = manager.spawn(session.id, createTarget());
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
    }));
    const updated = registry.get(session.id);

    expect(String(capturedBody?.instructions ?? '')).toContain('Execution strategy: react.');
    expect(String(capturedBody?.instructions ?? '')).toContain(
      'Acceptance criteria:\nReturn a concise answer.',
    );
    expect(events.some((event) =>
      event.type === 'progress'
      && event.metadata?.kind === 'strategy'
      && event.metadata?.status === 'completed'
    )).toBe(true);
    expect(updated).toMatchObject({
      strategy: {
        preferredStrategy: 'react',
        request: {
          requestedStrategy: 'react',
          acceptanceCriteria: 'Return a concise answer.',
          strategyContext: {
            maxSteps: 4,
          },
        },
        effectiveStrategy: 'react',
        resolutionSource: 'explicit_request',
      },
    });
  });

  it('falls back to the compatibility strategy when cats sends an unsupported strategy hint', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-unsupported-strategy',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp_unsupported_strategy',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Compatibility fallback reply.' }],
      }],
      usage: {
        input_tokens: 5,
        output_tokens: 2,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const handle = manager.spawn(session.id, createTarget());
    const events = await collectEvents(handle.streamMessage({
      message: 'hello',
      requestedStrategy: 'reflexion',
      correlation: {
        taskId: 'task-work-1',
        product: 'work',
      },
    }));
    const updated = registry.get(session.id);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'progress',
      text: "Requested strategy 'reflexion' is not supported by this runtime; falling back to 'simple_tool_call'.",
      metadata: expect.objectContaining({
        kind: 'strategy',
        status: 'fallback',
        strategyEvent: 'strategy_degraded',
        requestedStrategy: 'reflexion',
        effectiveStrategy: 'simple_tool_call',
        strategyResolutionSource: 'compatibility_fallback',
        degradedStrategy: 'reflexion',
        fallbackStrategy: 'simple_tool_call',
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'init',
      sessionId: 'resp_unsupported_strategy',
    }));
    expect(events).toContainEqual({
      type: 'text',
      text: 'Compatibility fallback reply.',
      raw: expect.any(Object),
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'result',
      sessionId: 'resp_unsupported_strategy',
      usage: {
        inputTokens: 5,
        outputTokens: 2,
      },
    }));
    expect(updated).toMatchObject({
      strategy: {
        request: {
          requestedStrategy: 'reflexion',
          correlation: {
            taskId: 'task-work-1',
            product: 'work',
          },
        },
        effectiveStrategy: 'simple_tool_call',
        resolutionSource: 'compatibility_fallback',
        summary: {
          status: 'completed',
          stepCount: 1,
          lastEvent: 'strategy_completed',
        },
      },
    });
    expect(updated?.strategy?.preferredStrategy).toBeUndefined();
  });

  it('does not repeat strategy_degraded events once an unsupported persisted strategy already resolved through compatibility fallback', async () => {
    const registry = new SessionRegistry();
    const session = registry.create({
      id: 'api-session-persisted-unsupported-strategy',
      providerName: 'codex',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      cwd: '/repo',
      strategy: {
        request: {
          requestedStrategy: 'reflexion',
        },
        effectiveStrategy: 'simple_tool_call',
        resolutionSource: 'compatibility_fallback',
        summary: {
          status: 'completed',
          stepCount: 1,
          resolutionSource: 'compatibility_fallback',
          updatedAt: '2026-03-26T00:00:00.000Z',
          lastEvent: 'strategy_completed',
        },
        updatedAt: '2026-03-26T00:00:00.000Z',
      },
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp_persisted_unsupported_strategy',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Compatibility fallback reply.' }],
      }],
      usage: {
        input_tokens: 5,
        output_tokens: 2,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const manager = new ApiBackendManager(
      { sessionBaseDir: '/tmp/cats-runtime-tests' },
      registry,
      {
        fetch: fetchMock as typeof fetch,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      },
    );

    const handle = manager.spawn(session.id, createTarget());
    const events = await collectEvents(handle.streamMessage({
      message: 'hello again',
    }));

    expect(events.some((event) =>
      event.type === 'progress'
      && event.metadata?.kind === 'strategy'
      && event.metadata?.strategyEvent === 'strategy_degraded'
    )).toBe(false);
  });

  it('runs explicit react with additive stream events and runtime-owned inspection metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-api-react-'));
    const repoDir = join(root, 'repo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'answer.txt'), '42\n', 'utf-8');

    try {
      const registry = new SessionRegistry();
      const session = registry.create({
        id: 'api-session-react',
        providerName: 'codex',
        providerBackend: 'api',
        providerInstanceId: 'gateway',
        cwd: repoDir,
      });

      const requestBodies: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (requestBodies.length === 1) {
          return new Response(JSON.stringify({
            id: 'resp_react_1',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Checking answer.txt.' }],
              },
              {
                type: 'function_call',
                call_id: 'call_read_answer',
                name: 'read_file',
                arguments: '{"path":"answer.txt"}',
              },
            ],
            usage: {
              input_tokens: 7,
              output_tokens: 3,
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          id: 'resp_react_2',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '42' }],
          }],
          usage: {
            input_tokens: 4,
            output_tokens: 1,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const manager = new ApiBackendManager(
        { sessionBaseDir: root },
        registry,
        {
          fetch: fetchMock as typeof fetch,
          env: {
            OPENAI_API_KEY: 'test-key',
          },
        },
      );
      const runtime = createRuntimeManager(root, manager);
      const turn = {
        message: 'Read answer.txt and tell me the value.',
        requestedStrategy: 'react' as const,
        acceptanceCriteria: 'Return only the file value.',
        strategyContext: {
          maxSteps: 4,
          timeoutMs: 1500,
          stuckThreshold: 2,
        },
        correlation: {
          traceId: 'trace-react-1',
        },
      };

      runtime.beginRun(session, turn);

      const handle = manager.spawn(session.id, createTarget());
      const events = await collectEvents(handle.streamMessage(turn));
      for (const event of events) {
        runtime.observeEvent(session.id, event);
      }

      const updated = registry.get(session.id)!;
      const inspection = buildSessionInspection({
        session: updated,
        view: toSessionView(updated, {
          attached: manager.isAttached(session.id),
          externalSessionLiveWindowMs: 15000,
        }),
        trackedState: runtime.getTrackedState(session.id),
        metering: buildMeteringSnapshot(),
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(requestBodies[0]?.instructions)).toContain('Execution strategy: react.');
      expect(String(requestBodies[0]?.instructions)).toContain(
        'Acceptance criteria:\nReturn only the file value.',
      );
      expect(String(requestBodies[0]?.instructions)).toContain(
        'Strategy context (condensed runtime summary):',
      );
      expect(String(requestBodies[0]?.instructions)).toContain('maxSteps: 4');
      expect(String(requestBodies[0]?.instructions)).toContain('timeoutMs: 1500');
      expect(requestBodies[1]?.previous_response_id).toBe('resp_react_1');

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            status: 'started',
            strategyEvent: 'strategy_started',
            effectiveStrategy: 'react',
            strategyResolutionSource: 'explicit_request',
          }),
        }),
        expect.objectContaining({
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'call_read_answer',
        }),
        expect.objectContaining({
          type: 'tool_result',
          toolName: 'read_file',
          toolId: 'call_read_answer',
          text: expect.stringContaining('42'),
        }),
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            status: 'completed',
            strategyEvent: 'strategy_completed',
            effectiveStrategy: 'react',
          }),
        }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'resp_react_2',
          usage: {
            inputTokens: 11,
            outputTokens: 4,
          },
        }),
      ]));

      expect(updated).toMatchObject({
        strategy: {
          preferredStrategy: 'react',
          request: {
            requestedStrategy: 'react',
            acceptanceCriteria: 'Return only the file value.',
            strategyContext: {
              maxSteps: 4,
              timeoutMs: 1500,
              stuckThreshold: 2,
            },
            correlation: {
              traceId: 'trace-react-1',
            },
          },
          effectiveStrategy: 'react',
          resolutionSource: 'explicit_request',
          summary: {
            status: 'completed',
            stepCount: 2,
            stepLimit: 4,
            timeoutMs: 1500,
            duplicateStepCount: 1,
            lastStepSignature: 'read_file:{"path":"answer.txt"}',
            lastEvent: 'strategy_completed',
            resolutionSource: 'explicit_request',
          },
          localState: {
            consecutiveDuplicateToolCalls: 1,
            lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
          },
        },
      });

      expect(inspection.strategy).toMatchObject({
        requestedStrategy: 'react',
        effectiveStrategy: 'react',
        acceptanceCriteria: 'Return only the file value.',
        correlation: {
          traceId: 'trace-react-1',
        },
        state: {
          preferredStrategy: 'react',
          effectiveStrategy: 'react',
          summary: {
            status: 'completed',
            stepCount: 2,
          },
        },
      });
      expect(inspection.recentEvents.some((event) =>
        event.eventType === 'progress' && event.kind === 'strategy'
      )).toBe(true);
      expect(inspection.recentEvents.some((event) =>
        event.eventType === 'progress'
        && event.kind === 'strategy'
        && event.status === 'completed'
      )).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
  it('runs explicit pdca with additive phase events and runtime-owned inspection metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-api-pdca-'));
    const repoDir = join(root, 'repo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'answer.txt'), '42\n', 'utf-8');

    try {
      const registry = new SessionRegistry();
      const session = registry.create({
        id: 'api-session-pdca',
        providerName: 'codex',
        providerBackend: 'api',
        providerInstanceId: 'gateway',
        cwd: repoDir,
      });

      const requestBodies: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (requestBodies.length === 1) {
          return new Response(JSON.stringify({
            id: 'resp_pdca_1',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Planning the first inspection cycle.' }],
              },
              {
                type: 'function_call',
                call_id: 'call_read_answer_pdca',
                name: 'read_file',
                arguments: '{"path":"answer.txt"}',
              },
            ],
            usage: {
              input_tokens: 7,
              output_tokens: 3,
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          id: 'resp_pdca_2',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '42' }],
          }],
          usage: {
            input_tokens: 4,
            output_tokens: 1,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const manager = new ApiBackendManager(
        { sessionBaseDir: root },
        registry,
        {
          fetch: fetchMock as typeof fetch,
          env: {
            OPENAI_API_KEY: 'test-key',
          },
        },
      );
      const runtime = createRuntimeManager(root, manager);
      const turn = {
        message: 'Inspect answer.txt and return only the verified value.',
        requestedStrategy: 'pdca' as const,
        acceptanceCriteria: 'Return only the verified file value.',
        strategyContext: {
          maxCycles: 4,
          timeoutMs: 1500,
          stuckThreshold: 2,
        },
        correlation: {
          taskId: 'task-work-1',
          product: 'work',
        },
      };

      runtime.beginRun(session, turn);

      const handle = manager.spawn(session.id, createTarget());
      const events = await collectEvents(handle.streamMessage(turn));
      for (const event of events) {
        runtime.observeEvent(session.id, event);
      }

      const updated = registry.get(session.id)!;
      const inspection = buildSessionInspection({
        session: updated,
        view: toSessionView(updated, {
          attached: manager.isAttached(session.id),
          externalSessionLiveWindowMs: 15000,
        }),
        trackedState: runtime.getTrackedState(session.id),
        metering: buildMeteringSnapshot(),
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(requestBodies[0]?.instructions)).toContain('Execution strategy: pdca.');
      expect(String(requestBodies[0]?.instructions)).toContain(
        'Acceptance criteria:\nReturn only the verified file value.',
      );
      expect(String(requestBodies[0]?.instructions)).toContain('maxCycles: 4');
      expect(requestBodies[1]?.previous_response_id).toBe('resp_pdca_1');

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            status: 'started',
            strategyEvent: 'strategy_started',
            effectiveStrategy: 'pdca',
            strategyResolutionSource: 'explicit_request',
          }),
        }),
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            strategyEvent: 'strategy_plan',
            effectiveStrategy: 'pdca',
          }),
        }),
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            strategyEvent: 'strategy_do',
            effectiveStrategy: 'pdca',
          }),
        }),
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            strategyEvent: 'strategy_check',
            effectiveStrategy: 'pdca',
          }),
        }),
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            strategyEvent: 'strategy_act',
            effectiveStrategy: 'pdca',
          }),
        }),
        expect.objectContaining({
          type: 'progress',
          metadata: expect.objectContaining({
            kind: 'strategy',
            status: 'completed',
            strategyEvent: 'strategy_completed',
            effectiveStrategy: 'pdca',
          }),
        }),
        expect.objectContaining({
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'call_read_answer_pdca',
        }),
        expect.objectContaining({
          type: 'tool_result',
          toolName: 'read_file',
          toolId: 'call_read_answer_pdca',
          text: expect.stringContaining('42'),
        }),
        expect.objectContaining({
          type: 'result',
          sessionId: 'resp_pdca_2',
          usage: {
            inputTokens: 11,
            outputTokens: 4,
          },
        }),
      ]));

      expect(updated).toMatchObject({
        strategy: {
          preferredStrategy: 'pdca',
          request: {
            requestedStrategy: 'pdca',
            acceptanceCriteria: 'Return only the verified file value.',
            strategyContext: {
              maxCycles: 4,
              timeoutMs: 1500,
              stuckThreshold: 2,
            },
            correlation: {
              taskId: 'task-work-1',
              product: 'work',
            },
          },
          effectiveStrategy: 'pdca',
          resolutionSource: 'explicit_request',
          summary: {
            status: 'completed',
            stepCount: 2,
            stepLimit: 4,
            timeoutMs: 1500,
            duplicateStepCount: 1,
            lastStepSignature: 'read_file:{"path":"answer.txt"}',
            lastEvent: 'strategy_completed',
            resolutionSource: 'explicit_request',
          },
          localState: {
            currentPhase: 'completed',
            completedCycles: 2,
            consecutiveDuplicateToolCalls: 1,
            lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
            lastToolCallCount: 1,
          },
        },
      });

      expect(inspection.strategy).toMatchObject({
        requestedStrategy: 'pdca',
        effectiveStrategy: 'pdca',
        acceptanceCriteria: 'Return only the verified file value.',
        correlation: {
          taskId: 'task-work-1',
          product: 'work',
        },
        state: {
          preferredStrategy: 'pdca',
          effectiveStrategy: 'pdca',
          summary: {
            status: 'completed',
            stepCount: 2,
          },
          localState: {
            currentPhase: 'completed',
            completedCycles: 2,
          },
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
