import { describe, it, expect, beforeEach } from 'vitest';
import { CodexProvider } from './codex.js';

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

    it('maps read_only workspace to a rejecting read-only policy', () => {
      provider.buildSpawnArgs({
        ...baseOpts,
        workspaceMode: 'read_only',
        permissionMode: 'default',
      });

      const msg = provider.buildStdinMessage('Inspect only');
      const lines = msg.trim().split('\n');
      const threadStart = JSON.parse(lines[2]);

      expect(threadStart.params.sandbox).toBe('read-only');
      expect(threadStart.params.approvalPolicy).toEqual({
        reject: {
          sandbox_approval: true,
          rules: true,
          mcp_elicitations: true,
        },
      });
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

    it('parses item/started with commandExecution as tool_use', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'commandExecution', command: 'bash', id: 'tool-1' },
        },
      }));
      expect(event?.type).toBe('tool_use');
      expect(event?.toolName).toBe('bash');
      expect(event?.toolId).toBe('tool-1');
    });

    it('parses item/started with fileChange as tool_use', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'fileChange', name: 'edit_file', id: 'tool-2' },
        },
      }));
      expect(event?.type).toBe('tool_use');
      expect(event?.toolName).toBe('edit_file');
      expect(event?.toolId).toBe('tool-2');
    });

    it('parses item/started with mcpToolCall as tool_use', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'mcpToolCall', tool: 'file_read', id: 'tool-3' },
        },
      }));
      expect(event?.type).toBe('tool_use');
      expect(event?.toolName).toBe('file_read');
      expect(event?.toolId).toBe('tool-3');
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

    it('parses turn/failed as error event', () => {
      const event = provider.parseStreamLine(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: { reason: 'context_limit_exceeded' },
      }));
      expect(event?.type).toBe('error');
      expect(event?.text).toContain('context_limit_exceeded');
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
        'turn/started', 'item/completed',
        'item/commandExecution/outputDelta',
        'thread/status/changed', 'thread/compacted',
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
