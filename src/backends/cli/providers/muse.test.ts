import { describe, expect, it } from 'vitest';
import {
  MUSE_EXEC_JSON_BASE_ARGS,
  MUSE_EXEC_JSON_PROFILE_ID,
  MUSE_REASONING_EFFORTS,
  MuseProvider,
} from './muse.js';
import type { CompatibilityProfileSelection, StreamEvent } from './types.js';

const VERIFIED_PROFILE: CompatibilityProfileSelection = {
  id: MUSE_EXEC_JSON_PROFILE_ID,
  label: 'Meta Muse CLI 1.0.3 exec MSP records',
  protocolFamily: 'json-stream',
  parserId: 'muse-native-msp-records',
  spawnBaseArgs: [...MUSE_EXEC_JSON_BASE_ARGS],
  confidence: 'exact',
};

const READ_TOOLS = ['read_file', 'read_memory', 'read_skill', 'search', 'tool_search'];
const WRITE_TOOLS = [
  'add_memory',
  'apply_patch',
  'artifact',
  'edit_file',
  'edit_memory',
  'write_file',
];
const SHELL_TOOLS = [
  'bash',
  'bash_input',
  'exec_command',
  'monitor',
  'powershell',
  'powershell_input',
  'shell',
  'write_stdin',
];

function asEvents(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) return [];
  return Array.isArray(event) ? event : [event];
}

function record(payloadType: string, payload: Record<string, unknown>, sessionId = 'session-1'): string {
  return JSON.stringify({
    schema_version: 1,
    stream: { kind: 'session', id: sessionId },
    record_type: 'event',
    payload_type: payloadType,
    payload,
  });
}

describe('MuseProvider', () => {
  it('uses the best-known adapter when no compatibility profile is available', () => {
    const provider = new MuseProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: true,
    });

    const args = provider.buildSpawnArgs({ cwd: '/tmp/muse-provider-test' });
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(args.at(-1)).toBe('Say hi');
  });

  it('refuses to build spawn args before prepareEphemeralTurn', () => {
    const provider = new MuseProvider(VERIFIED_PROFILE);
    expect(() => provider.buildSpawnArgs({ cwd: '/tmp/muse-provider-test' }))
      .toThrow(/prepareEphemeralTurn/);
  });

  it('resumes by session id and never passes --workspace', () => {
    const provider = new MuseProvider(VERIFIED_PROFILE);
    provider.prepareEphemeralTurn({ message: 'Continue' });

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/muse-provider-test',
      resumeSessionId: '00000000-0000-0000-0000-000000000001',
      model: 'muse-spark-1.3',
    });

    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('00000000-0000-0000-0000-000000000001');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('muse-spark-1.3');
    // The runtime already sets (and translates) the child process cwd, which is
    // what muse roots its workspace at.
    expect(args).not.toContain('--workspace');
    expect(args).not.toContain('/tmp/muse-provider-test');
  });

  it('drops the no-selection model sentinel instead of sending it', () => {
    const provider = new MuseProvider(VERIFIED_PROFILE);
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/muse-provider-test',
      model: 'muse-default',
    });

    expect(args).not.toContain('--model');
  });

  it('refuses to fork because muse exec has no fork argument', () => {
    const provider = new MuseProvider(VERIFIED_PROFILE);
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(() => provider.buildSpawnArgs({
      cwd: '/tmp/muse-provider-test',
      resumeSessionId: 'session-1',
      forkSession: true,
    })).toThrow(/cannot fork/i);
  });

  it('passes the curated reasoning effort through as --reasoning-effort', () => {
    for (const effort of MUSE_REASONING_EFFORTS) {
      const provider = new MuseProvider(VERIFIED_PROFILE);
      provider.prepareEphemeralTurn({ message: 'Say hi' });
      const args = provider.buildSpawnArgs({
        cwd: '/tmp/muse-provider-test',
        modelControls: { 'muse.reasoning_effort': effort },
      });
      expect(args[args.indexOf('--reasoning-effort') + 1]).toBe(effort);
    }
  });

  it('rejects a reasoning effort muse does not accept', () => {
    const provider = new MuseProvider(VERIFIED_PROFILE);
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(() => provider.buildSpawnArgs({
      cwd: '/tmp/muse-provider-test',
      modelControls: { 'muse.reasoning_effort': 'extreme' },
    })).toThrow(/Unsupported Meta Muse reasoning effort/);
  });

  describe('permission modes', () => {
    function argsFor(options: Record<string, unknown>): string[] {
      const provider = new MuseProvider(VERIFIED_PROFILE);
      provider.prepareEphemeralTurn({ message: 'Say hi' });
      return provider.buildSpawnArgs({ cwd: '/tmp/muse-provider-test', ...options });
    }

    it('keeps the default mode read-only through the capability switches', () => {
      // Probed on 1.0.3: --approval-mode alone does not gate anything in a
      // headless run, so the fail-safe has to be the --disable-* switches.
      const args = argsFor({ permissionMode: 'default' });
      expect(args).toContain('--disable-write');
      expect(args).toContain('--disable-shell');
      expect(args).toContain('--disable-web-tools');
    });

    it('treats an unspecified permission mode exactly like default', () => {
      expect(argsFor({})).toEqual(argsFor({ permissionMode: 'default' }));
    });

    it('leaves every capability on in skip mode', () => {
      const args = argsFor({ permissionMode: 'skip' });
      expect(args).toContain('--disable-approval');
      expect(args).not.toContain('--disable-write');
      expect(args).not.toContain('--disable-shell');
      expect(args).not.toContain('--disable-web-tools');
    });

    it('gates a read-only allowlist down to the read tools', () => {
      const args = argsFor({ permissionMode: 'whitelist', allowedTools: READ_TOOLS });
      expect(args).toContain('--disable-write');
      expect(args).toContain('--disable-shell');
      expect(args).toContain('--disable-web-tools');
    });

    it('accepts a whole capability group and leaves that group enabled', () => {
      const args = argsFor({
        permissionMode: 'whitelist',
        allowedTools: ['read_file', ...WRITE_TOOLS],
      });
      expect(args).not.toContain('--disable-write');
      expect(args).toContain('--disable-shell');
      expect(args).toContain('--disable-web-tools');
    });

    it('normalizes common tool aliases onto muse tool names', () => {
      const args = argsFor({
        permissionMode: 'whitelist',
        allowedTools: ['Read', 'web-search', 'web_fetch'],
      });
      expect(args).not.toContain('--disable-web-tools');
      expect(args).toContain('--disable-write');
    });

    it('refuses a partial allowlist it cannot enforce', () => {
      expect(() => argsFor({
        permissionMode: 'whitelist',
        allowedTools: ['read_file', 'write_file'],
      })).toThrow(/cannot enforce a partial write tool allowlist/);

      expect(() => argsFor({
        permissionMode: 'whitelist',
        allowedTools: ['read_file', ...SHELL_TOOLS.slice(0, 2)],
      })).toThrow(/cannot enforce a partial shell tool allowlist/);
    });

    it('refuses an unknown allowlist entry rather than silently widening', () => {
      expect(() => argsFor({
        permissionMode: 'whitelist',
        allowedTools: ['read_file', 'launch_missiles'],
      })).toThrow(/Unsupported Meta Muse tool allowlist entry: launch_missiles/);
    });
  });

  describe('parseStreamLine', () => {
    it('announces the session id from the first record it sees', () => {
      const provider = new MuseProvider();
      const events = asEvents(provider.parseStreamLine(record(
        'runtime.command.accepted',
        { kind: 'command_accepted', command_kind: 'turn.submit' },
        'aaaaaaaa-0000-0000-0000-000000000001',
      )));

      expect(events).toEqual([
        expect.objectContaining({ type: 'init', sessionId: 'aaaaaaaa-0000-0000-0000-000000000001' }),
      ]);

      // Only once: a second record must not re-announce it.
      expect(asEvents(provider.parseStreamLine(record('run.lifecycle.started', { prompt: 'hi' }))))
        .toEqual([]);
    });

    it('emits text deltas and carries the session id on the result', () => {
      const provider = new MuseProvider();
      provider.parseStreamLine(record('runtime.command.accepted', {}));

      expect(asEvents(provider.parseStreamLine(record('run.output.delta', { text: 'bra' }))))
        .toEqual([expect.objectContaining({ type: 'text', text: 'bra' })]);

      const result = asEvents(provider.parseStreamLine(record('run.terminal.completed', {
        terminal: 'completed',
        text: 'bravo',
        reason: null,
      })));
      expect(result).toEqual([
        expect.objectContaining({ type: 'result', sessionId: 'session-1' }),
      ]);
      // The terminal record repeats the whole answer; re-emitting it would
      // duplicate the turn text that the deltas already carried.
      expect(result[0]).not.toHaveProperty('text');
    });

    it('turns a failed run terminal into an error carrying the reason', () => {
      const provider = new MuseProvider();
      const events = asEvents(provider.parseStreamLine(record('run.terminal.failed', {
        terminal: 'failed',
        text: null,
        reason: 'modelError',
      })));

      expect(events).toEqual([
        expect.objectContaining({ type: 'init' }),
        expect.objectContaining({ type: 'error', text: 'modelError' }),
      ]);
    });

    it('pairs a tool call with its result and reports the tool name', () => {
      const provider = new MuseProvider();
      provider.parseStreamLine(record('runtime.command.accepted', {}));
      provider.parseStreamLine(record('task.lifecycle.proposed', {
        event: { kind: 'proposed', task_id: 'task-1', task_kind: 'tool.read_file' },
      }));
      provider.parseStreamLine(record('task.lifecycle.side_effect_intent', {
        event: {
          kind: 'side_effect_intent',
          task_id: 'task-1',
          operation: 'tool:read_file',
          idempotency_key: 'tool:call_1',
        },
      }));

      const events = asEvents(provider.parseStreamLine(record('tool.result', {
        call_id: 'call_1',
        text: 'file contents',
        correlation_facts: { tool_name: 'read_file', outcome: 'success' },
      })));

      expect(events).toEqual([
        expect.objectContaining({ type: 'tool_use', toolName: 'read_file', toolId: 'call_1' }),
        expect.objectContaining({
          type: 'tool_result',
          toolName: 'read_file',
          toolId: 'call_1',
          text: 'file contents',
        }),
        expect.objectContaining({ type: 'progress' }),
      ]);
      expect(events[1]).not.toHaveProperty('isError');
    });

    it('marks a non-success tool outcome as an error', () => {
      const provider = new MuseProvider();
      const events = asEvents(provider.parseStreamLine(record('tool.result', {
        call_id: 'call_9',
        text: 'permission denied',
        correlation_facts: { tool_name: 'write_file', outcome: 'failure' },
      })));

      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool_result',
        toolName: 'write_file',
        isError: true,
      }));
    });

    it('reports a tool task that dies before tool.result', () => {
      const provider = new MuseProvider();
      provider.parseStreamLine(record('runtime.command.accepted', {}));
      provider.parseStreamLine(record('task.lifecycle.proposed', {
        event: { kind: 'proposed', task_id: 'task-2', task_kind: 'tool.shell' },
      }));

      const events = asEvents(provider.parseStreamLine(record('task.lifecycle.failed', {
        event: { kind: 'failed', task_id: 'task-2', reason: 'sandbox denied the command' },
      })));

      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool_result',
        toolName: 'shell',
        isError: true,
        text: 'sandbox denied the command',
      }));
    });

    it('passes a non-JSON stdout line through as raw', () => {
      const provider = new MuseProvider();
      expect(asEvents(provider.parseStreamLine('muse: workspace root: /tmp/x')))
        .toEqual([expect.objectContaining({ type: 'raw', text: 'muse: workspace root: /tmp/x' })]);
    });

    it('ignores blank lines', () => {
      const provider = new MuseProvider();
      expect(provider.parseStreamLine('   ')).toBeNull();
    });
  });

  describe('classifyLaunchFailure', () => {
    it('classifies a missing sign-in as auth_required', () => {
      const provider = new MuseProvider();
      const refusal = provider.classifyLaunchFailure({
        source: 'stderr',
        line: 'muse: not logged in; run muse login',
        stderrLines: [],
      });

      expect(refusal).toMatchObject({
        category: 'auth_required',
        statusCode: 401,
        retryable: false,
      });
    });

    it('returns null for evidence it cannot classify', () => {
      const provider = new MuseProvider();
      expect(provider.classifyLaunchFailure({
        source: 'exit',
        stderrLines: ['something unfamiliar'],
        exitCode: 3,
      })).toBeNull();
    });
  });
});
