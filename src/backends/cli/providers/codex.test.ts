import { describe, it, expect, beforeEach } from 'vitest';
import { CodexProvider } from './codex.js';
import type { StreamEvent } from './types.js';

function toEventList(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) {
    return [];
  }
  return Array.isArray(event) ? event : [event];
}

describe('CodexProvider', () => {
  let provider: CodexProvider;
  const baseOpts = { cwd: '/tmp/test' };

  beforeEach(() => {
    provider = new CodexProvider();
  });

  describe('buildSpawnArgs', () => {
    it('builds basic args with app-server', () => {
      const args = provider.buildSpawnArgs(baseOpts);
      expect(args).toEqual(['app-server']);
    });

    it('includes model flag when provided', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', model: 'o3' });
      expect(args).toContain('-c');
      expect(args).toContain('model="o3"');
    });

    it('includes reasoning effort config when provided', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        modelControls: {
          'codex.reasoning_effort': 'xhigh',
        },
      });
      expect(args).toContain('-c');
      expect(args).toContain('model_reasoning_effort="xhigh"');
    });
  });

  describe('configured launch overrides', () => {
    it('places native configuration after app-server and before selected model controls', () => {
      const configured = ['--profile', 'worker', '-c', 'features.apps=false',
        '--config', 'model="instance-default"', '--config=model_reasoning_effort="low"'];
      const spawn = provider.buildSpawnArgs({ ...baseOpts, model: 'selected-model',
        modelControls: { 'codex.reasoning_effort': 'high' } });
      expect(provider.composeLaunchArgs(configured, spawn)).toEqual([
        '--profile', 'worker', 'app-server', '-c', 'features.apps=false',
        '--config', 'model="instance-default"', '--config=model_reasoning_effort="low"',
        '-c', 'model="selected-model"', '-c', 'model_reasoning_effort="high"',
      ]);
      expect(configured[2]).toBe('-c');
      expect(spawn[0]).toBe('app-server');
    });

    it('preserves attached override syntax, quoted paths and repeated values in order', () => {
      const configured = ['-cfeatures.apps=true', '-c=features.apps=false',
        '-c', 'model_instructions_file="C:/private profile/base.md"'];
      expect(provider.composeLaunchArgs(configured, ['app-server'])).toEqual(['app-server', ...configured]);
    });

    it('preserves other invocation shapes, unrelated arguments and malformed options for native validation', () => {
      expect(provider.composeLaunchArgs(['-c', 'features.apps=false'], ['exec']))
        .toEqual(['-c', 'features.apps=false', 'exec']);
      expect(provider.composeLaunchArgs(['--help', '-c'], ['app-server']))
        .toEqual(['--help', '-c', 'app-server']);
      expect(provider.composeLaunchArgs(['--', '-c', 'features.apps=false'], ['app-server']))
        .toEqual(['--', '-c', 'features.apps=false', 'app-server']);
      expect(provider.composeLaunchArgs([], ['app-server'])).toEqual(['app-server']);
    });
  });

  describe('buildStdinMessage', () => {
    it('sends pipelined init on first call', () => {
      provider.buildSpawnArgs(baseOpts);
      const msg = provider.buildStdinMessage('Hello');
      const lines = msg.trim().split('\n');
      expect(lines.length).toBe(3); // initialize, initialized, thread/start

      const initialize = JSON.parse(lines[0]);
      expect(initialize.method).toBe('initialize');
      expect(initialize.jsonrpc).toBe('2.0');
      expect(initialize.id).toBe(0);

      const initialized = JSON.parse(lines[1]);
      expect(initialized.method).toBe('initialized');
      expect(initialized.id).toBeUndefined(); // notification — no id

      const threadStart = JSON.parse(lines[2]);
      expect(threadStart.method).toBe('thread/start');
      expect(threadStart.id).toBe(1);
      expect(threadStart.params.sandbox).toBe('workspace-write');
      expect(threadStart.params.approvalPolicy).toBe('never');
      expect(threadStart.params.experimentalRawEvents).toBe(false);
      expect(threadStart.params.persistExtendedHistory).toBeUndefined();
    });

    it('resumes an existing thread when resumeSessionId is provided', () => {
      provider.buildSpawnArgs({ ...baseOpts, resumeSessionId: 'thread-123' });
      const msg = provider.buildStdinMessage('Hello again');
      const lines = msg.trim().split('\n');
      const threadResume = JSON.parse(lines[2]);

      expect(threadResume.method).toBe('thread/resume');
      expect(threadResume.params.threadId).toBe('thread-123');
      expect(threadResume.params.persistExtendedHistory).toBeUndefined();
    });

    it('forks an existing thread when forkSession is requested', () => {
      provider.buildSpawnArgs({
        ...baseOpts,
        resumeSessionId: 'thread-parent',
        forkSession: true,
      });
      const msg = provider.buildStdinMessage('Fork it');
      const lines = msg.trim().split('\n');
      const threadFork = JSON.parse(lines[2]);

      expect(threadFork.method).toBe('thread/fork');
      expect(threadFork.params.threadId).toBe('thread-parent');
      expect(threadFork.params.persistExtendedHistory).toBeUndefined();
    });

    it('maps read_only workspace to the current Codex no-approval policy', () => {
      provider.buildSpawnArgs({
        ...baseOpts,
        workspaceMode: 'read_only',
        permissionMode: 'default',
      });

      const msg = provider.buildStdinMessage('Inspect only');
      const lines = msg.trim().split('\n');
      const threadStart = JSON.parse(lines[2]);

      expect(threadStart.params.sandbox).toBe('read-only');
      expect(threadStart.params.approvalPolicy).toBe('never');
    });

    it('returns empty string when still initializing', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('First');
      const msg = provider.buildStdinMessage('Second');
      expect(msg).toBe('');
    });

    it('throws clearly after bootstrap failed earlier', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('First');
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'thread/start.persistFullHistory requires experimentalApi capability',
        },
      }));

      expect(() => provider.buildStdinMessage('Retry')).toThrow(
        'Codex session bootstrap failed earlier. Close and recreate the session.',
      );
    });

    it('sends turn/start directly when ready', () => {
      provider.buildSpawnArgs(baseOpts);
      // Simulate init completion
      provider.buildStdinMessage('First');
      // Simulate receiving thread response
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { threadId: 'thread-abc' },
      }));
      // Consume pending turn start
      provider.getPendingTurnStart();

      const msg = provider.buildStdinMessage('Second message');
      const parsed = JSON.parse(msg.trim());
      expect(parsed.method).toBe('turn/start');
      expect(parsed.params.input).toEqual([{ type: 'text', text: 'Second message' }]);
      expect(parsed.params.threadId).toBe('thread-abc');
      expect(parsed.params.approvalPolicy).toBe('never');
    });

    it('prefixes instruction overlays into the Codex turn input when provided', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('First');
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { threadId: 'thread-abc' },
      }));
      provider.getPendingTurnStart();

      const msg = provider.buildStdinMessage('Second message', {
        message: 'Second message',
        instructions: 'Stay terse.',
      });
      const parsed = JSON.parse(msg.trim());
      expect(parsed.params.input).toEqual([{
        type: 'text',
        text: expect.stringContaining('Instructions:\nStay terse.'),
      }]);
      expect(parsed.params.input[0].text).toContain('User message:\nSecond message');
    });
  });

  describe('getPendingTurnStart', () => {
    it('returns pending turn/start after init completes', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('Hello');

      // Simulate thread/start response
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { threadId: 'thread-123' },
      }));

      const pending = provider.getPendingTurnStart();
      expect(pending).not.toBeNull();
      const parsed = JSON.parse(pending!.trim());
      expect(parsed.method).toBe('turn/start');
      expect(parsed.params.input).toEqual([{ type: 'text', text: 'Hello' }]);
      expect(parsed.params.threadId).toBe('thread-123');
    });

    it('returns null when no pending message', () => {
      expect(provider.getPendingTurnStart()).toBeNull();
    });

    it('returns null after pending is consumed', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('Hello');
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { threadId: 'thread-123' },
      }));
      provider.getPendingTurnStart(); // consume
      expect(provider.getPendingTurnStart()).toBeNull();
    });
  });

  describe('parseStreamLine', () => {
    it('returns null for empty lines', () => {
      expect(provider.parseStreamLine('')).toBeNull();
      expect(provider.parseStreamLine('  ')).toBeNull();
    });

    it('returns raw for non-JSON lines', () => {
      const event = provider.parseStreamLine('Starting codex...');
      expect(event?.type).toBe('raw');
      expect(event?.text).toBe('Starting codex...');
    });

    it('parses initialize response as null (internal)', () => {
      // Put provider in initializing state
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('Hello');

      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: { capabilities: {}, serverInfo: { name: 'codex' } },
      }));
      expect(event).toBeNull();
    });

    it('parses thread/start response with threadId as init event', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('Hello');

      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { threadId: 'thread-xyz' },
      }));
      expect(event?.type).toBe('init');
      expect(event?.sessionId).toBe('thread-xyz');
    });

    it('parses thread/start response with thread.id as init event', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('Hello');

      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { thread: { id: 'thread-nested' } },
      }));
      expect(event?.type).toBe('init');
      expect(event?.sessionId).toBe('thread-nested');
    });

    it('surfaces bootstrap JSON-RPC errors instead of swallowing them', () => {
      provider.buildSpawnArgs(baseOpts);
      provider.buildStdinMessage('Hello');

      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'thread/start.persistFullHistory requires experimentalApi capability',
        },
      }));

      expect(event).toEqual({
        type: 'error',
        text: 'Codex JSON-RPC error -32600: thread/start.persistFullHistory requires experimentalApi capability',
      });
    });

    it('parses item/agentMessage/delta as text event', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { delta: 'Hello world' },
      }));
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Hello world');
    });

    it('parses item/started with commandExecution as progress plus tool_use', () => {
      const events = toEventList(provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'commandExecution', command: 'bash', id: 'tool-1' },
        },
      })));
      expect(events).toEqual([
        {
          type: 'progress',
          text: 'Codex started command: bash',
          metadata: {
            kind: 'command',
            status: 'started',
            source: 'provider',
            provider: 'codex',
            backend: 'cli',
            native: {
              sourceEvent: 'item/started',
              itemType: 'commandExecution',
              toolName: 'bash',
              itemId: 'tool-1',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'bash',
          toolId: 'tool-1',
        },
      ]);
    });

    it('parses item/started with fileChange as progress plus tool_use', () => {
      const events = toEventList(provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'fileChange', name: 'edit_file', id: 'tool-2' },
        },
      })));
      expect(events).toEqual([
        {
          type: 'progress',
          text: 'Codex started file update: edit_file',
          metadata: {
            kind: 'files',
            status: 'started',
            source: 'provider',
            provider: 'codex',
            backend: 'cli',
            native: {
              sourceEvent: 'item/started',
              itemType: 'fileChange',
              toolName: 'edit_file',
              itemId: 'tool-2',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'edit_file',
          toolId: 'tool-2',
        },
      ]);
    });

    it('parses item/started with mcpToolCall as progress plus tool_use', () => {
      const events = toEventList(provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'mcpToolCall', tool: 'file_read', id: 'tool-3' },
        },
      })));
      expect(events).toEqual([
        {
          type: 'progress',
          text: 'Codex started tool: file_read',
          metadata: {
            kind: 'tool',
            status: 'started',
            source: 'provider',
            provider: 'codex',
            backend: 'cli',
            native: {
              sourceEvent: 'item/started',
              itemType: 'mcpToolCall',
              toolName: 'file_read',
              itemId: 'tool-3',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'file_read',
          toolId: 'tool-3',
        },
      ]);
    });

    it('ignores item/started for agentMessage', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'agentMessage', id: 'msg-1' },
        },
      }));
      expect(event).toBeNull();
    });

    it('ignores item/started for reasoning', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'reasoning', id: 'reason-1' },
        },
      }));
      expect(event).toBeNull();
    });

    it('ignores item/started without item object', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {},
      }));
      expect(event).toBeNull();
    });

    it('parses turn/completed as result event', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
      }));
      expect(event?.type).toBe('result');
      // turn/completed does not carry usage directly
      expect(event?.usage).toBeUndefined();
    });

    it('attaches cached usage from tokenUsage/updated to turn/completed', () => {
      // First, receive token usage
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: { last: { inputTokens: 100, outputTokens: 50 } },
        },
      }));

      // Then, turn completes — should attach cached usage
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId: 'thread-1' },
      }));
      expect(event?.type).toBe('result');
      expect(event?.usage?.inputTokens).toBe(100);
      expect(event?.usage?.outputTokens).toBe(50);
    });

    it('clears cached usage after turn/completed consumes it', () => {
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: { last: { inputTokens: 100, outputTokens: 50 } },
        },
      }));
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: {},
      }));

      // Second turn/completed should not have usage
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: {},
      }));
      expect(event?.type).toBe('result');
      expect(event?.usage).toBeUndefined();
    });

    it('normalizes cached token usage with cache, prompt, total, and context-window facts', () => {
      const tokenUsage = {
        total: {
          totalTokens: 16579,
          inputTokens: 16574,
          cachedInputTokens: 12288,
          cacheWriteInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 16579,
          inputTokens: 16574,
          cachedInputTokens: 12288,
          cacheWriteInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 258400,
      };
      provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/tokenUsage/updated',
        params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage },
      }));

      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
      }));

      expect(event?.type).toBe('result');
      expect(event?.usage).toEqual({
        inputTokens: 16574,
        outputTokens: 5,
        promptInputTokens: 4286,
        cacheReadInputTokens: 12288,
        cacheCreationInputTokens: 0,
        totalTokens: 16579,
      });
      expect(event?.metadata).toEqual({
        native: {
          sourceEvent: 'turn/completed',
          tokenUsage: { total: tokenUsage.total, modelContextWindow: 258400 },
        },
      });
    });

    it('counts both model responses observed in the isolated K4 implementation turn', () => {
      const first = {
        inputTokens: 9260, cachedInputTokens: 0, cacheWriteInputTokens: 0,
        outputTokens: 70, reasoningOutputTokens: 0, totalTokens: 9330,
      };
      const last = {
        inputTokens: 9375, cachedInputTokens: 9088, cacheWriteInputTokens: 0,
        outputTokens: 102, reasoningOutputTokens: 34, totalTokens: 9477,
      };
      const total = {
        inputTokens: 18635, cachedInputTokens: 9088, cacheWriteInputTokens: 0,
        outputTokens: 172, reasoningOutputTokens: 34, totalTokens: 18807,
      };
      for (const tokenUsage of [{ last: first, total: first }, { last, total }]) {
        provider.parseStreamLine(JSON.stringify({
          method: 'thread/tokenUsage/updated', params: { tokenUsage },
        }));
      }
      const event = provider.parseStreamLine(JSON.stringify({ method: 'turn/completed', params: {} }));
      expect(event?.usage).toEqual({
        inputTokens: 18635, outputTokens: 172, promptInputTokens: 9547,
        cacheReadInputTokens: 9088, cacheCreationInputTokens: 0, totalTokens: 18807,
      });
    });

    it('normalizes account/rateLimits/updated into quota progress and carries it onto turn/completed', () => {
      const resetsAt = new Date(1789593617 * 1000).toISOString();
      const rateLimits = {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 1789593617 },
        secondary: null,
        credits: { hasCredits: false, unlimited: false, balance: '0' },
        individualLimit: null,
        spendControlReached: null,
        planType: 'pro',
        rateLimitReachedType: null,
      };
      const progress = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'account/rateLimits/updated',
        params: { rateLimits },
      }));

      expect(progress).toEqual(expect.objectContaining({
        type: 'progress',
        text: `Codex rate limit: primary 1% used of 10080-minute window (resets ${resetsAt}); plan pro.`,
        metadata: expect.objectContaining({
          kind: 'quota',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: { sourceEvent: 'account/rateLimits/updated', rateLimits },
          quota: {
            source: 'codex.account/rateLimits/updated',
            observedAt: expect.any(String),
            limitId: 'codex',
            planType: 'pro',
            'primary.usedPercent': 1,
            'primary.windowDurationMins': 10080,
            'primary.resetsAt': resetsAt,
            'credits.hasCredits': false,
            'credits.unlimited': false,
            'credits.balance': '0',
          },
        }),
      }));

      const result = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId: 'thread-1' },
      }));
      expect(result?.type).toBe('result');
      expect(result?.usage).toBeUndefined();
      expect(result?.metadata).toEqual({
        runtimeUsage: {
          quota: expect.objectContaining({ limitId: 'codex', 'primary.usedPercent': 1 }),
        },
      });
    });

    it('marks reached rate limits as blocked quota progress', () => {
      const progress = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'account/rateLimits/updated',
        params: {
          rateLimits: {
            limitId: 'codex',
            primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1789011952 },
            secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1789598752 },
            planType: 'pro',
            rateLimitReachedType: 'primary',
          },
        },
      }));

      expect(progress?.type).toBe('progress');
      expect(progress?.text).toContain('Codex rate limit reached (primary)');
      expect(progress?.metadata).toEqual(expect.objectContaining({
        kind: 'quota',
        status: 'blocked',
        quota: expect.objectContaining({
          rateLimitReachedType: 'primary',
          'primary.usedPercent': 100,
          'secondary.usedPercent': 40,
          'secondary.windowDurationMins': 10080,
        }),
      }));
    });

    it('ignores account/rateLimits/updated without a usable snapshot', () => {
      expect(provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'account/rateLimits/updated',
        params: {},
      }))).toBeNull();
      expect(provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'account/rateLimits/updated',
        params: { rateLimits: { limitId: null, primary: null, secondary: null } },
      }))).toBeNull();
    });

    it('parses turn/failed as error event', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: { reason: 'context_limit_exceeded' },
      }));
      expect(event?.type).toBe('error');
      expect(event?.text).toContain('context_limit_exceeded');
    });

    it('parses item/completed for command execution as completed progress', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          item: { type: 'commandExecution', command: 'bash', id: 'tool-1' },
        },
      }));

      expect(event).toEqual({
        type: 'progress',
        text: 'Codex completed command: bash',
        metadata: {
          kind: 'command',
          status: 'completed',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'item/completed',
            itemType: 'commandExecution',
            toolName: 'bash',
            itemId: 'tool-1',
          },
        },
      });
    });

    it('parses plan, reasoning, and command deltas as progress events', () => {
      const planEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/plan/delta',
        params: { delta: 'Plan next: inspect repository.' },
      }));
      const reasoningEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/reasoning/summaryTextDelta',
        params: { summaryText: 'Need to verify the config before editing.' },
      }));
      const commandEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/commandExecution/outputDelta',
        params: { outputDelta: 'package.json\\nREADME.md\\n' },
      }));

      expect(planEvent).toEqual({
        type: 'progress',
        text: 'Plan next: inspect repository.',
        metadata: {
          kind: 'plan',
          status: 'running',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'item/plan/delta',
            hasPlanDelta: true,
          },
        },
      });
      expect(reasoningEvent).toEqual({
        type: 'progress',
        text: 'Need to verify the config before editing.',
        metadata: {
          kind: 'reasoning',
          status: 'running',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'item/reasoning/summaryTextDelta',
            hasReasoningDelta: true,
          },
        },
      });
      expect(commandEvent).toEqual({
        type: 'progress',
        text: 'package.json\\nREADME.md\\n',
        metadata: {
          kind: 'command',
          status: 'running',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'item/commandExecution/outputDelta',
            hasOutputDelta: true,
          },
        },
      });
    });

    it('parses plan, diff, thread, and model updates as progress events', () => {
      const planEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/plan/updated',
        params: {
          plan: {
            summary: 'Plan updated after repository scan.',
            steps: [{ id: '1' }, { id: '2' }],
          },
        },
      }));
      const diffEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/diff/updated',
        params: {
          diff: {
            files: ['src/a.ts', 'src/b.ts'],
          },
        },
      }));
      const statusEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/status/changed',
        params: { status: 'busy' },
      }));
      const rerouteEvent = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'model/rerouted',
        params: { fromModel: 'gpt-5.4', toModel: 'gpt-5.4-mini' },
      }));

      expect(planEvent).toEqual({
        type: 'progress',
        text: 'Plan updated after repository scan.',
        metadata: {
          kind: 'plan',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'turn/plan/updated',
            stepCount: 2,
          },
        },
      });
      expect(diffEvent).toEqual({
        type: 'progress',
        text: 'Codex updated proposed file changes (2 files).',
        metadata: {
          kind: 'files',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'turn/diff/updated',
            fileCount: 2,
          },
        },
      });
      expect(statusEvent).toEqual({
        type: 'progress',
        text: 'Codex session status changed to busy.',
        metadata: {
          kind: 'session',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'thread/status/changed',
            threadStatus: 'busy',
          },
        },
      });
      expect(rerouteEvent).toEqual({
        type: 'progress',
        text: 'Codex rerouted from gpt-5.4 to gpt-5.4-mini.',
        metadata: {
          kind: 'model_state',
          status: 'updated',
          source: 'provider',
          provider: 'codex',
          backend: 'cli',
          native: {
            sourceEvent: 'model/rerouted',
            fromModel: 'gpt-5.4',
            toModel: 'gpt-5.4-mini',
          },
        },
      });
    });

    it('returns null for approval request notifications', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/commandExecution/requestApproval',
        params: { itemId: 'tool-1' },
      }));
      expect(event).toBeNull();
    });

    it('returns null for informational notifications', () => {
      for (const method of [
        'turn/started',
        'thread/compacted',
        'deprecationNotice',
        'configWarning',
        'error',
      ]) {
        const event = provider.parseStreamLine(JSON.stringify({
          jsonrpc: '2.0',
          method,
          params: {},
        }));
        expect(event).toBeNull();
      }
    });

    it('returns raw for unknown notifications', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'some/unknown',
        params: {},
      }));
      expect(event?.type).toBe('raw');
    });
  });

  describe('usage across model requests and Runtime turns', () => {
    const counts = (inputTokens: number, outputTokens: number) => ({
      inputTokens, outputTokens, cachedInputTokens: 0, cacheWriteInputTokens: 0,
      totalTokens: inputTokens + outputTokens,
    });
    const notify = (method: string, params: Record<string, unknown>) =>
      provider.parseStreamLine(JSON.stringify({ method, params }));
    const usage = (
      turnId: string,
      last: ReturnType<typeof counts>,
      total?: ReturnType<typeof counts>,
      threadId = 'usage-thread',
    ) => notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { last, total } });
    const completed = (turnId: string) => notify('turn/completed', {
      threadId: 'usage-thread', turn: { id: turnId, status: 'completed' },
    });
    const initialize = (resume = false, fork = false) => {
      provider.buildSpawnArgs({ ...baseOpts,
        ...(resume ? { resumeSessionId: 'usage-thread', forkSession: fork } : {}),
      });
      provider.buildStdinMessage('first request');
      provider.parseStreamLine(JSON.stringify({ id: 1, result: { thread: { id: 'usage-thread' } } }));
    };
    const start = (turnId: string, first = false) => {
      const message = first ? provider.getPendingTurnStart() : provider.buildStdinMessage('next request');
      const request = JSON.parse(message!);
      provider.parseStreamLine(JSON.stringify({ id: request.id, result: { turn: { id: turnId } } }));
      notify('turn/started', { threadId: 'usage-thread', turn: { id: turnId } });
    };

    it('deduplicates cumulative notifications and charges only the next turn delta', () => {
      initialize();
      start('turn-one', true);
      usage('turn-one', counts(100, 10), counts(100, 10));
      usage('turn-one', counts(100, 10), counts(100, 10));
      usage('turn-one', counts(100, 10), counts(200, 20));
      expect(completed('turn-one')?.usage).toMatchObject({ inputTokens: 200, outputTokens: 20, totalTokens: 220 });
      start('turn-two');
      usage('turn-one', counts(100, 10), counts(200, 20));
      usage('turn-two', counts(100, 10), counts(300, 30));
      expect(completed('turn-two')?.usage).toMatchObject({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
      expect(completed('turn-two')?.usage).toBeUndefined();
    });

    it.each([false, true])('excludes unobserved historical totals after resume (fork=%s)', (fork) => {
      initialize(true, fork);
      start('resumed-turn', true);
      usage('resumed-turn', counts(100, 10), counts(10100, 1010));
      usage('resumed-turn', counts(200, 20), counts(10300, 1030));
      expect(completed('resumed-turn')?.usage).toMatchObject({ inputTokens: 300, outputTokens: 30, totalTokens: 330 });
    });

    it('uses bootstrap and idle notifications as checkpoints without charging old usage', () => {
      initialize(true);
      usage('old-turn', counts(100, 10), counts(10000, 1000));
      const pending = JSON.parse(provider.getPendingTurnStart()!);
      usage('old-turn', counts(100, 10), counts(10000, 1000));
      provider.parseStreamLine(JSON.stringify({ id: pending.id, result: { turn: { id: 'new-turn' } } }));
      usage('new-turn', counts(50, 5), counts(10050, 1005));
      expect(completed('new-turn')?.usage).toMatchObject({ inputTokens: 50, outputTokens: 5, totalTokens: 55 });
      usage('new-turn', counts(50, 5), counts(10050, 1005));
      start('next-turn');
      usage('next-turn', counts(60, 6), counts(10110, 1011));
      expect(completed('next-turn')?.usage).toMatchObject({ inputTokens: 60, outputTokens: 6, totalTokens: 66 });
    });

    it('keeps another thread or turn from changing the accounting checkpoint', () => {
      initialize();
      start('current-turn', true);
      usage('current-turn', counts(100, 10), counts(100, 10));
      usage('current-turn', counts(900, 90), counts(900, 90), 'unrelated-thread');
      usage('unrelated-turn', counts(900, 90), counts(900, 90));
      usage('current-turn', counts(50, 5), counts(150, 15));
      expect(completed('current-turn')?.usage).toMatchObject({ inputTokens: 150, outputTokens: 15, totalTokens: 165 });
    });

    it('accumulates last-only observations without later counting them twice', () => {
      initialize();
      start('partial-turn', true);
      usage('partial-turn', counts(100, 10));
      usage('partial-turn', counts(200, 20));
      usage('partial-turn', counts(300, 30), counts(10600, 1060));
      usage('partial-turn', counts(40, 4), counts(10640, 1064));
      expect(completed('partial-turn')?.usage).toMatchObject({ inputTokens: 640, outputTokens: 64, totalTokens: 704 });
    });

    it('starts a new checkpoint if native cumulative counters reset', () => {
      initialize();
      start('reset-turn', true);
      usage('reset-turn', counts(100, 10), counts(100, 10));
      usage('reset-turn', counts(20, 2), counts(20, 2));
      usage('reset-turn', counts(20, 2), counts(20, 2));
      expect(completed('reset-turn')?.usage).toMatchObject({ inputTokens: 120, outputTokens: 12, totalTokens: 132 });
    });
  });

  describe('buildAutoResponse', () => {
    it('returns null for empty lines', () => {
      expect(provider.buildAutoResponse('')).toBeNull();
    });

    it('returns null for non-JSON lines', () => {
      expect(provider.buildAutoResponse('not json')).toBeNull();
    });

    it('auto-approves commandExecution requestApproval', () => {
      provider.buildSpawnArgs(baseOpts);
      const line = JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'ls' },
      });
      const response = provider.buildAutoResponse(line);
      expect(response).not.toBeNull();
      const parsed = JSON.parse(response!.trim());
      expect(parsed.id).toBe(42);
      expect(parsed.result.decision).toBe('accept');
    });

    it('auto-approves fileChange requestApproval', () => {
      provider.buildSpawnArgs(baseOpts);
      const line = JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'item/fileChange/requestApproval',
        params: { path: '/tmp/test.txt' },
      });
      const response = provider.buildAutoResponse(line);
      expect(response).not.toBeNull();
      const parsed = JSON.parse(response!.trim());
      expect(parsed.id).toBe(7);
      expect(parsed.result.decision).toBe('accept');
    });

    it('auto-approves legacy applyPatchApproval', () => {
      provider.buildSpawnArgs(baseOpts);
      const line = JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'applyPatchApproval',
        params: {},
      });
      const response = provider.buildAutoResponse(line);
      expect(response).not.toBeNull();
      const parsed = JSON.parse(response!.trim());
      expect(parsed.result.decision).toBe('approved');
    });

    it('rejects approvals in default permission mode', () => {
      provider.buildSpawnArgs({
        ...baseOpts,
        permissionMode: 'default',
      });

      const execResponse = provider.buildAutoResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'rm -rf tmp' },
      }));
      const fileResponse = provider.buildAutoResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'applyPatchApproval',
        params: {},
      }));

      expect(JSON.parse(execResponse!.trim()).result.decision).toBe('decline');
      expect(JSON.parse(fileResponse!.trim()).result.decision).toBe('denied');
    });

    it('best-effort whitelists command approvals by allowed tool token', () => {
      provider.buildSpawnArgs({
        ...baseOpts,
        permissionMode: 'whitelist',
        allowedTools: ['bash'],
      });

      const allowed = provider.buildAutoResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'bash -lc ls' },
      }));
      const blocked = provider.buildAutoResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'python script.py' },
      }));

      expect(JSON.parse(allowed!.trim()).result.decision).toBe('accept');
      expect(JSON.parse(blocked!.trim()).result.decision).toBe('decline');
    });

    it('grants requested permissions only in skip mode', () => {
      provider.buildSpawnArgs(baseOpts);

      const skipResponse = provider.buildAutoResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 30,
        method: 'item/permissions/requestApproval',
        params: {
          permissions: {
            network: { enabled: true },
            fileSystem: { write: ['/tmp/test'], read: ['/tmp/test'] },
            macos: null,
          },
        },
      }));

      provider.buildSpawnArgs({
        ...baseOpts,
        permissionMode: 'default',
      });
      const rejectResponse = provider.buildAutoResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'item/permissions/requestApproval',
        params: {
          permissions: {
            network: { enabled: true },
            fileSystem: { write: ['/tmp/test'], read: ['/tmp/test'] },
            macos: null,
          },
        },
      }));

      expect(JSON.parse(skipResponse!.trim()).result.permissions).toEqual({
        network: { enabled: true },
        fileSystem: { write: ['/tmp/test'], read: ['/tmp/test'] },
      });
      expect(JSON.parse(rejectResponse!.trim()).result.permissions).toEqual({});
    });

    it('returns null for non-approval methods', () => {
      const line = JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { delta: 'text' },
      });
      expect(provider.buildAutoResponse(line)).toBeNull();
    });
  });
});
