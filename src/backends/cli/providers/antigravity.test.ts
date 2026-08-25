import { describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_STREAM_JSON_BASE_ARGS,
  ANTIGRAVITY_STREAM_JSON_PROFILE_ID,
  AntigravityProvider,
} from './antigravity.js';
import type { CompatibilityProfileSelection } from './types.js';

const VERIFIED_PROFILE: CompatibilityProfileSelection = {
  id: ANTIGRAVITY_STREAM_JSON_PROFILE_ID,
  label: 'Antigravity CLI 1.1.20 stream-json',
  protocolFamily: 'stream-json',
  parserId: 'antigravity-native-stream-json',
  spawnBaseArgs: [...ANTIGRAVITY_STREAM_JSON_BASE_ARGS],
  confidence: 'exact',
};

function verifiedProvider(): AntigravityProvider {
  const provider = new AntigravityProvider(VERIFIED_PROFILE);
  provider.prepareEphemeralTurn({ message: 'Say hi' });
  return provider;
}

describe('AntigravityProvider spawn arguments', () => {
  it('uses the best-known adapter when no compatibility profile is available', () => {
    const provider = new AntigravityProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: true,
    });
    const args = provider.buildSpawnArgs({ cwd: '/tmp/agy-provider-test' });
    expect(args).toContain('stream-json');
    expect(args).toContain('--add-dir');
  });

  it('always scopes the workspace with --add-dir so agy does not fall back to its own scratch', () => {
    const args = verifiedProvider().buildSpawnArgs({ cwd: '/tmp/agy-provider-test' });

    expect(args.slice(0, 2)).toEqual(['-p', 'Say hi']);
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/tmp/agy-provider-test');
  });

  it('resumes through --conversation and refuses a fork it cannot perform', () => {
    const resumed = verifiedProvider().buildSpawnArgs({
      cwd: '/tmp/agy-provider-test',
      model: 'gemini-3.7-flash-high',
      resumeSessionId: 'conversation-fixture',
    });
    expect(resumed[resumed.indexOf('--conversation') + 1]).toBe('conversation-fixture');
    expect(resumed[resumed.indexOf('--model') + 1]).toBe('gemini-3.7-flash-high');

    expect(() => verifiedProvider().buildSpawnArgs({
      cwd: '/tmp/agy-provider-test',
      resumeSessionId: 'conversation-fixture',
      forkSession: true,
    })).toThrow(/no session fork mechanism/);
  });

  it('never passes --mode, whose accept-edits value writes files while reporting request-review', () => {
    for (const permissionMode of ['default', 'skip'] as const) {
      const provider = new AntigravityProvider(VERIFIED_PROFILE);
      provider.prepareEphemeralTurn({ message: 'Say hi' });
      expect(provider.buildSpawnArgs({ cwd: '/tmp/agy-provider-test', permissionMode }))
        .not.toContain('--mode');
    }
  });

  it('leaves default turns in headless auto-deny and only skips permissions on request', () => {
    expect(verifiedProvider().buildSpawnArgs({
      cwd: '/tmp/agy-provider-test',
      permissionMode: 'default',
    })).not.toContain('--dangerously-skip-permissions');

    expect(verifiedProvider().buildSpawnArgs({
      cwd: '/tmp/agy-provider-test',
      permissionMode: 'skip',
    })).toContain('--dangerously-skip-permissions');
  });

  it('refuses whitelist mode rather than rewriting the shared user settings file', () => {
    expect(() => verifiedProvider().buildSpawnArgs({
      cwd: '/tmp/agy-provider-test',
      permissionMode: 'whitelist',
      allowedTools: ['list_dir'],
    })).toThrow(/no per-invocation tool allowlist/);
  });
});

describe('AntigravityProvider stream parsing', () => {
  const provider = () => new AntigravityProvider(VERIFIED_PROFILE);

  function parse(line: string) {
    const parsed = provider().parseStreamLine(line);
    if (!parsed) return [];
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  it('carries the conversation id on sessionId, which is what the CLI worker resumes from', () => {
    const [init] = parse(JSON.stringify({
      event: 'init',
      conversation_id: 'conversation-fixture',
      init: { cwd: '<workspace>', tools: ['list_dir'], permission_mode: 'request-review' },
    }));

    expect(init.type).toBe('init');
    expect(init.sessionId).toBe('conversation-fixture');
    expect(init.metadata).toMatchObject({
      reportedPermissionMode: 'request-review',
      toolCount: 1,
    });
  });

  it('treats text_delta as a delta and ignores the lifecycle steps around it', () => {
    const [text] = parse(JSON.stringify({
      event: 'step_update',
      step_update: { step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'alpha\n' },
    }));
    expect(text).toMatchObject({ type: 'text', text: 'alpha\n' });

    for (const stepType of ['user_input', 'checkpoint', 'system_message']) {
      expect(parse(JSON.stringify({
        event: 'step_update',
        step_update: { step_index: 0, state: 'DONE', step_type: stepType },
      }))).toEqual([]);
    }
  });

  it('correlates a tool call on step_index because agy issues no tool id', () => {
    const instance = provider();
    const active = instance.parseStreamLine(JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 6,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'list_dir',
        tool_info: { name: 'list_dir', parameters: { DirectoryPath: '<workspace>' } },
      },
    })) as Array<Record<string, unknown>>;

    expect(active.map((event) => event.type)).toEqual(['progress', 'tool_use']);
    expect(active[1]).toMatchObject({
      toolName: 'list_dir',
      toolId: '6',
      toolArgs: { DirectoryPath: '<workspace>' },
    });

    // The terminal update repeats only name and parameters, so the tool name has
    // to come from the pending map keyed on step_index.
    const done = instance.parseStreamLine(JSON.stringify({
      event: 'step_update',
      step_update: { step_index: 6, state: 'DONE', step_type: 'tool', duration_seconds: 0.4 },
    })) as Array<Record<string, unknown>>;

    expect(done.map((event) => event.type)).toEqual(['progress', 'tool_result']);
    expect(done[1]).toMatchObject({ toolName: 'list_dir', toolId: '6' });
    expect(done[1].isError).toBeUndefined();
  });

  it('recovers the denial message from a failed tool step', () => {
    const [, result] = parse(JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 3,
        state: 'ERROR',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          name: 'run_command',
          error: { type: 'TOOL_ERROR', message: 'user denied permission to run command' },
        },
      },
    })) as Array<Record<string, unknown>>;

    expect(result).toMatchObject({
      type: 'tool_result',
      toolName: 'run_command',
      isError: true,
      text: 'user denied permission to run command',
    });
  });

  it('reports usage without folding the independent cache counter into the input total', () => {
    const [result] = parse(JSON.stringify({
      event: 'result',
      result: {
        conversation_id: 'conversation-fixture',
        status: 'SUCCESS',
        response: 'alpha\nbeta\ngamma\n',
        num_turns: 1,
        usage: {
          input_tokens: 25955,
          output_tokens: 812,
          thinking_tokens: 657,
          cache_read_tokens: 28485,
          total_tokens: 26767,
        },
      },
    }));

    expect(result).toMatchObject({ type: 'result', sessionId: 'conversation-fixture' });
    expect(result.usage).toEqual({
      inputTokens: 25955,
      outputTokens: 812,
      promptInputTokens: 25955,
      cacheReadInputTokens: 28485,
      totalTokens: 26767,
    });
  });

  it('turns a rejected turn into a terminal error carrying the reason agy gave', () => {
    // A bad --model comes back on stdout as a result envelope with an empty
    // conversation id, zeroed usage, and the reason in `error`. Reporting it as
    // a successful result with an empty response would hide the whole failure.
    const [failed] = parse(JSON.stringify({
      event: 'result',
      result: {
        conversation_id: '',
        status: 'ERROR',
        response: '',
        error: 'invalid model selection (--model "nope"): model nope is not recognized',
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    }));

    expect(failed).toMatchObject({
      type: 'error',
      text: 'invalid model selection (--model "nope"): model nope is not recognized',
    });
    expect(failed.sessionId).toBeUndefined();
  });

  it('falls back to the response text when a failed result carries no error field', () => {
    const [failed] = parse(JSON.stringify({
      event: 'result',
      result: { conversation_id: 'conversation-fixture', status: 'CANCELLED', response: 'partial' },
    }));
    expect(failed).toMatchObject({
      type: 'error',
      text: 'partial',
      sessionId: 'conversation-fixture',
    });
  });

  it('passes unparsable stdout through as raw', () => {
    expect(parse('not json at all')).toEqual([
      { type: 'raw', text: 'not json at all' },
    ]);
  });
});
