import { describe, expect, it, vi } from 'vitest';
import { ProviderEvolutionEvidenceCollector } from '../../../core/compatibility/providerEvolution.js';
import type { StreamEvent } from '../../../core/types.js';
import { AuggieProvider } from './auggie.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { CopilotProvider } from './copilot.js';
import { CursorProvider } from './cursor.js';
import { GooseProvider } from './goose.js';
import { JunieProvider } from './junie.js';
import { KiloProvider } from './kilo.js';
import { OpencodeProvider } from './opencode.js';
import { PiProvider } from './pi.js';
import type { AuggieSessionService } from '../auggie/AuggieSessionService.js';
import type { GooseNativeSessionService } from '../goose/GooseNativeSessionService.js';
import type { KiloNativeSessionService } from '../kilo/KiloNativeSessionService.js';
import type { OpencodeNativeSessionService } from '../opencode/OpencodeNativeSessionService.js';

function createMockGooseNative(): GooseNativeSessionService {
  return {
    listAllSessions: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    getLatestSession: vi.fn(async () => null),
    canResumeSession: vi.fn(async () => true),
    loadHistory: vi.fn(async () => []),
    deleteSession: vi.fn(async () => false),
  } as unknown as GooseNativeSessionService;
}

describe('provider evolution instrumentation', () => {
  it('records normalized and raw passthrough paths for Claude', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'claude',
      instance: 'default',
      parserId: 'claude-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new ClaudeProvider(undefined, collector);

    provider.parseStreamLine('Starting Claude...');
    provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
      },
    }));

    const bundle = collector.finalize();
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.text).toBe(1);
  });

  it('records normalized Claude tool-use blocks instead of raw passthrough only', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'claude',
      instance: 'default',
      parserId: 'claude-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new ClaudeProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'read_file',
          id: 'tool-1',
          input: { path: 'README.md' },
        }],
      },
    }))).toEqual([
      expect.objectContaining({
        type: 'progress',
      }),
      expect.objectContaining({
        type: 'tool_use',
        toolName: 'read_file',
      }),
    ]);

    const bundle = collector.finalize();
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.progress).toBe(1);
    expect(bundle.summary.normalizedEventTypes.tool_use).toBe(1);
  });

  it('records normalized Claude reasoning and tool-result blocks', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'claude',
      instance: 'default',
      parserId: 'claude-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new ClaudeProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Reviewing the change.' },
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'done' },
        ],
      },
    }))).toEqual([
      expect.objectContaining({
        type: 'progress',
      }),
      expect.objectContaining({
        type: 'progress',
      }),
      expect.objectContaining({
        type: 'tool_result',
      }),
    ]);

    const bundle = collector.finalize();
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.progress).toBe(2);
    expect(bundle.summary.normalizedEventTypes.tool_result).toBe(1);
  });

  it('records ignored bootstrap responses for Codex', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'codex',
      instance: 'default',
      parserId: 'codex-json-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CodexProvider(undefined, collector);

    provider.buildSpawnArgs({ cwd: '/tmp/test' });
    provider.buildStdinMessage('Hello');
    provider.parseStreamLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      result: { capabilities: {}, serverInfo: { name: 'codex' } },
    }));

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredCount).toBe(1);
    expect(bundle.summary.ignoredEventTypes.initialize).toBe(1);
  });

  it('records normalized progress signals for Codex plan deltas', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'codex',
      instance: 'default',
      parserId: 'codex-json-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CodexProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/plan/delta',
      params: { delta: 'Inspect config before editing.' },
    }))).toEqual({
      type: 'progress',
      text: 'Inspect config before editing.',
      metadata: expect.objectContaining({
        kind: 'plan',
        status: 'running',
      }),
    });

    const bundle = collector.finalize();
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.progress).toBe(1);
    expect(bundle.summary.ignoredCount).toBe(0);
  });

  it('records schema failures for Copilot event shapes that are missing required fields', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'copilot',
      instance: 'default',
      parserId: 'copilot-json-stream',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CopilotProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'session.start',
      data: {},
    }))).toBeNull();

    const bundle = collector.finalize();
    expect(bundle.summary.schemaFailureCount).toBe(1);
    expect(bundle.summary.schemaFailureCounts['session.start']).toBe(1);
  });

  it('records normalized Copilot tool results instead of treating them as opaque assistant messages', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'copilot',
      instance: 'default',
      parserId: 'copilot-json-stream',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CopilotProvider(undefined, collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant.message',
      data: {
        toolResults: [{
          name: 'read_file',
          id: 'tool-1',
          output: { ok: true },
        }],
      },
    }))).toEqual([
      expect.objectContaining({
        type: 'progress',
      }),
      expect.objectContaining({
        type: 'tool_result',
      }),
    ]);

    const bundle = collector.finalize();
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.progress).toBe(1);
    expect(bundle.summary.normalizedEventTypes.tool_result).toBe(1);
  });

  it('records ignored, normalized, and unknown Cursor event paths', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'cursor',
      instance: 'default',
      parserId: 'cursor-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new CursorProvider(collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'user',
      text: 'hello',
    }))).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'thinking',
      text: 'Inspecting the repository.',
    }))).toEqual(expect.objectContaining({
      type: 'progress',
    }));
    expect(provider.parseStreamLine('Cursor banner...')).toEqual({
      type: 'raw',
      text: 'Cursor banner...',
    });
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'future.event',
      payload: { ok: true },
    }))).toBeNull();

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredEventTypes.user).toBe(1);
    expect(bundle.summary.normalizedEventTypes.progress).toBe(1);
    expect(bundle.summary.rawPassthroughEventTypes.non_json_line).toBe(1);
    expect(bundle.summary.unknownEventTypes['future.event']).toBe(1);
  });

  it('records schema failures for Goose message events without content blocks', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'goose',
      instance: 'default',
      parserId: 'goose-stream-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new GooseProvider(createMockGooseNative(), collector);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: [] },
    }))).toBeNull();

    const bundle = collector.finalize();
    expect(bundle.summary.schemaFailureCounts.message).toBe(1);
  });

  it('records ignored and unknown Pi event paths', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'pi',
      instance: 'default',
      parserId: 'pi-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new PiProvider({ evolutionObserver: collector });

    expect(provider.parseStreamLine(JSON.stringify({ type: 'response' }))).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'some_future_event',
      data: 'test',
    }))?.type).toBe('raw');

    const bundle = collector.finalize();
    expect(bundle.summary.ignoredEventTypes.response).toBe(1);
    expect(bundle.summary.unknownEventTypes.some_future_event).toBe(1);
  });

  it('records normalized and raw passthrough Auggie print-mode paths', async () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'auggie',
      instance: 'default',
      parserId: 'auggie-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const sessions = {
      getLatestSession: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          providerSessionId: 'session-new',
          cwd: '/tmp/repo',
          sourcePath: '/tmp/session-new.json',
          messageCount: 1,
          exchangeCount: 1,
          lastActivity: '2026-04-07T00:00:00.000Z',
          usage: {
            inputTokens: 11,
            outputTokens: 7,
          },
        }),
      getSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10, collector);

    await provider.beforeTurn?.({ cwd: '/tmp/repo' });
    expect(provider.parseStreamLine('Some unexpected Auggie banner')).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'result',
      session_id: 'remote-session-id',
      result: 'probe-complete',
      is_error: false,
    }))).toEqual({
      type: 'text',
      text: 'probe-complete',
    });
    await expect(provider.afterTurn?.({ cwd: '/tmp/repo' })).resolves.toEqual({
      type: 'result',
      sessionId: 'session-new',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
      },
    });

    const bundle = collector.finalize();
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.normalizedCount).toBe(2);
    expect(bundle.summary.normalizedEventTypes.text).toBe(1);
    expect(bundle.summary.normalizedEventTypes.result).toBe(1);
  });

  it('records normalized Kilo native-session prompt events', async () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'kilo',
      instance: 'default',
      parserId: 'kilo-native',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const native = {
      prompt: vi.fn(async () => ({
        sessionId: 'kilo-1',
        messageId: 'msg-1',
        text: 'Done.',
        usage: {
          inputTokens: 11,
          outputTokens: 22,
        },
        toolUses: [
          { toolId: 'tool-1', toolName: 'write' },
        ],
      })),
      abortSession: vi.fn(),
      listPendingPermissions: vi.fn().mockResolvedValue([]),
      replyPermission: vi.fn().mockResolvedValue(true),
      listPendingQuestions: vi.fn().mockResolvedValue([]),
      rejectQuestion: vi.fn().mockResolvedValue(true),
    } as unknown as KiloNativeSessionService;
    const provider = new KiloProvider(native, collector);

    const events: StreamEvent[] = [];
    for await (const event of provider.streamTurn({ message: 'Ship it' }, {
      cwd: '/tmp/repo',
      resumeSessionId: 'kilo-1',
      permissionMode: 'skip',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: 'tool_use' }),
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({ type: 'result' }),
    ]);
    const bundle = collector.finalize();
    expect(bundle.summary.normalizedCount).toBe(3);
    expect(bundle.summary.normalizedEventTypes.tool_use).toBe(1);
    expect(bundle.summary.normalizedEventTypes.text).toBe(1);
    expect(bundle.summary.normalizedEventTypes.result).toBe(1);
  });

  it('records normalized OpenCode native-session prompt events', async () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'opencode',
      instance: 'default',
      parserId: 'opencode-native',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const native = {
      prompt: vi.fn(async () => ({
        sessionId: 'oc-1',
        messageId: 'msg-1',
        text: 'Done.',
        usage: {
          inputTokens: 9,
          outputTokens: 18,
        },
        toolUses: [
          { toolId: 'tool-1', toolName: 'read_file' },
        ],
      })),
      abortSession: vi.fn(),
      listPendingPermissions: vi.fn().mockResolvedValue([]),
      replyPermission: vi.fn().mockResolvedValue(true),
      listPendingQuestions: vi.fn().mockResolvedValue([]),
      rejectQuestion: vi.fn().mockResolvedValue(true),
    } as unknown as OpencodeNativeSessionService;
    const provider = new OpencodeProvider(native, collector);

    const events: StreamEvent[] = [];
    for await (const event of provider.streamTurn({ message: 'Ship it' }, {
      cwd: '/tmp/repo',
      resumeSessionId: 'oc-1',
      permissionMode: 'skip',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: 'tool_use' }),
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({ type: 'result' }),
    ]);
    const bundle = collector.finalize();
    expect(bundle.summary.normalizedCount).toBe(3);
    expect(bundle.summary.normalizedEventTypes.tool_use).toBe(1);
    expect(bundle.summary.normalizedEventTypes.text).toBe(1);
    expect(bundle.summary.normalizedEventTypes.result).toBe(1);
  });

  it('records normalized and raw passthrough Junie stdout paths', () => {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'junie',
      instance: 'default',
      parserId: 'junie-json',
      probeProfile: 'manual-smoke',
      transport: 'cli',
    });
    const provider = new JunieProvider(undefined, undefined, collector);

    expect(provider.parseStreamLine('Downloading tool metadata...')).toEqual({
      type: 'raw',
      text: 'Downloading tool metadata...',
    });
    expect(provider.parseStreamLine(JSON.stringify({
      sessionId: 'junie-session-1',
      taskName: 'Runtime probe',
      result: 'probe-complete',
      llmUsage: [{ inputTokens: 10, outputTokens: 4 }],
    }))).toEqual([
      {
        type: 'text',
        text: 'probe-complete',
      },
      expect.objectContaining({
        type: 'result',
        sessionId: 'junie-session-1',
      }),
    ]);

    const bundle = collector.finalize();
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.text).toBe(1);
    expect(bundle.summary.normalizedEventTypes.result).toBe(1);
  });
});
