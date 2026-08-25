import { describe, expect, it } from 'vitest';
import {
  GROK_STREAMING_JSON_BASE_ARGS,
  GROK_STREAMING_JSON_PROFILE_ID,
  GrokProvider,
} from './grok.js';
import type { CompatibilityProfileSelection } from './types.js';

const VERIFIED_PROFILE: CompatibilityProfileSelection = {
  id: GROK_STREAMING_JSON_PROFILE_ID,
  label: 'Grok CLI 1.0.0 native streaming-json',
  protocolFamily: 'streaming-json',
  parserId: 'grok-native-streaming-json',
  spawnBaseArgs: [...GROK_STREAMING_JSON_BASE_ARGS],
  confidence: 'exact',
};

describe('GrokProvider', () => {
  it('uses the best-known adapter when no compatibility profile is available', () => {
    const provider = new GrokProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: true,
      permissions: true,
    });
    const args = provider.buildSpawnArgs({ cwd: '/tmp/grok-provider-test' });
    expect(args).toContain('streaming-json');
    expect(args).toContain('/tmp/grok-provider-test');
  });

  it('builds verified ephemeral args with model, resume, fork, and safe headless defaults', () => {
    const provider = new GrokProvider(VERIFIED_PROFILE);
    provider.prepareEphemeralTurn({ message: 'Remember this' });

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/grok-provider-test',
      model: 'grok-4.5',
      resumeSessionId: 'session-fixture',
      forkSession: true,
    });

    expect(args.slice(0, 2)).toEqual(['-p', 'Remember this']);
    expect(args).toContain('streaming-json');
    expect(args).toContain('--disable-web-search');
    expect(args).toContain('--no-memory');
    expect(args).toContain('--no-subagents');
    expect(args).toContain('--verbatim');
    expect(args).toContain('/tmp/grok-provider-test');
    expect(args).toContain('grok-4.5');
    expect(args).toContain('session-fixture');
    expect(args).toContain('--fork-session');
    expect(args).toContain('dontAsk');
    expect(args).toContain('read_file');
  });

  it('maps skip and non-empty whitelist permissions to verified Grok flags', () => {
    const skipProvider = new GrokProvider(VERIFIED_PROFILE);
    skipProvider.prepareEphemeralTurn({ message: 'Run it' });
    const skipArgs = skipProvider.buildSpawnArgs({
      cwd: '/tmp/grok-provider-test',
      permissionMode: 'skip',
    });
    expect(skipArgs).toContain('auto');
    expect(skipArgs).toContain('--always-approve');

    const whitelistProvider = new GrokProvider(VERIFIED_PROFILE);
    whitelistProvider.prepareEphemeralTurn({ message: 'Read it' });
    const whitelistArgs = whitelistProvider.buildSpawnArgs({
      cwd: '/tmp/grok-provider-test',
      permissionMode: 'whitelist',
      allowedTools: ['Read', 'edit'],
    });
    expect(whitelistArgs).toContain('--tools');
    expect(whitelistArgs).toContain('read_file,search_replace');
  });

  it('refuses unsafe or unsatisfied Grok allowlists', () => {
    const emptyProvider = new GrokProvider(VERIFIED_PROFILE);
    emptyProvider.prepareEphemeralTurn({ message: 'Do nothing' });
    expect(() => emptyProvider.buildSpawnArgs({
      cwd: '/tmp/grok-provider-test',
      permissionMode: 'whitelist',
      allowedTools: [],
    })).toThrow(/cannot enforce an empty tool allowlist safely/);

    const editProvider = new GrokProvider(VERIFIED_PROFILE);
    editProvider.prepareEphemeralTurn({ message: 'Edit it' });
    expect(() => editProvider.buildSpawnArgs({
      cwd: '/tmp/grok-provider-test',
      permissionMode: 'whitelist',
      allowedTools: ['search_replace'],
    })).toThrow(/requires read_file/);
  });

  it('requires resume identity before native fork', () => {
    const provider = new GrokProvider(VERIFIED_PROFILE);
    provider.prepareEphemeralTurn({ message: 'Fork it' });
    expect(() => provider.buildSpawnArgs({
      cwd: '/tmp/grok-provider-test',
      forkSession: true,
    })).toThrow(/fork requires a resume session id/);
  });

  it('keeps non-JSON probe output as raw evidence', () => {
    const provider = new GrokProvider();

    expect(provider.parseStreamLine('  probe output  ')).toEqual({
      type: 'raw',
      text: 'probe output',
    });
    expect(provider.parseStreamLine('   ')).toBeNull();
  });

  it('normalizes observed native text and terminal events', () => {
    const provider = new GrokProvider();

    expect(provider.parseStreamLine('{"type":"text","data":"chunk"}')).toEqual({
      type: 'text',
      text: 'chunk',
      raw: { type: 'text', data: 'chunk' },
    });
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'end',
      sessionId: 'session-fixture',
      total_cost_usd: 0.25,
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
        output_tokens: 5,
        total_tokens: 20,
      },
    }))).toMatchObject({
      type: 'result',
      sessionId: 'session-fixture',
      usage: {
        inputTokens: 15,
        outputTokens: 5,
        promptInputTokens: 10,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 2,
        totalTokens: 20,
        estimatedCost: 0.25,
        currency: 'USD',
      },
    });
  });

  it('pairs native tool calls with completed and failed results', () => {
    const provider = new GrokProvider();
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'tool_call',
      toolCallId: 'call-1',
      toolName: 'read_file',
      kind: 'read',
      status: 'pending',
      rawInput: { target_file: 'fixture.txt' },
    }))).toMatchObject([
      { type: 'progress', metadata: { kind: 'tool', status: 'running' } },
      {
        type: 'tool_use',
        toolName: 'read_file',
        toolId: 'call-1',
        toolArgs: { target_file: 'fixture.txt' },
      },
    ]);

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'failed',
      content: [{
        type: 'content',
        content: { type: 'text', text: 'missing' },
      }],
    }))).toMatchObject([
      { type: 'progress', metadata: { kind: 'tool', status: 'failed' } },
      {
        type: 'tool_result',
        toolName: 'read_file',
        toolId: 'call-1',
        text: 'missing',
        isError: true,
      },
    ]);
  });

  it('normalizes stdout errors and classifies auth, model, and toolset failures', () => {
    const provider = new GrokProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'error',
      message: 'Not signed in.',
    }))).toMatchObject({
      type: 'error',
      text: 'Not signed in.',
    });
    expect(provider.classifyLaunchFailure({
      source: 'stderr',
      line: 'Not signed in. Run grok login --device-code',
      stderrLines: [],
    })).toMatchObject({
      category: 'auth_required',
      statusCode: 401,
      retryable: false,
    });
    expect(provider.classifyLaunchFailure({
      source: 'stderr',
      line: "Couldn't set model 'missing': unknown model id",
      stderrLines: [],
    })).toMatchObject({
      category: 'provider_rejected',
      statusCode: 400,
      retryable: false,
    });
    expect(provider.classifyLaunchFailure({
      source: 'stderr',
      line: 'session initialization failed: Requirements unsatisfied',
      stderrLines: [],
    })).toMatchObject({
      category: 'provider_rejected',
      statusCode: 400,
      retryable: false,
    });
  });
});
