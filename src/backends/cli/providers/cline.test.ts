import { describe, expect, it } from 'vitest';
import {
  CLINE_JSON_BASE_ARGS,
  CLINE_JSON_PROFILE_ID,
  ClineProvider,
} from './cline.js';
import type { CompatibilityProfileSelection } from './types.js';

const VERIFIED_PROFILE: CompatibilityProfileSelection = {
  id: CLINE_JSON_PROFILE_ID,
  label: 'Cline CLI 3.0.51 JSON stream',
  protocolFamily: 'json-stream',
  parserId: 'cline-native-json',
  spawnBaseArgs: [...CLINE_JSON_BASE_ARGS],
  confidence: 'exact',
};

function verifiedProvider(): ClineProvider {
  const provider = new ClineProvider(VERIFIED_PROFILE);
  provider.prepareEphemeralTurn({ message: 'Say hi' });
  return provider;
}

describe('ClineProvider', () => {
  it('requires the exact fixture-backed compatibility profile', () => {
    const provider = new ClineProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(() => provider.buildSpawnArgs({ cwd: '/work' }))
      .toThrow(/exact Cline 3\.0\.51 JSON compatibility profile/);
  });

  it('refuses a best-fit profile rather than guessing the contract', () => {
    const provider = new ClineProvider({ ...VERIFIED_PROFILE, confidence: 'weak' });
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(() => provider.buildSpawnArgs({ cwd: '/work' }))
      .toThrow(/exact Cline 3\.0\.51 JSON compatibility profile/);
  });

  it('reports resume as unavailable because --id conflicts with --json on 3.0.51', () => {
    expect(new ClineProvider().capabilities).toEqual({
      resume: false,
      fork: false,
      permissions: true,
    });
  });

  it('builds a JSON turn with the prompt last', () => {
    const args = verifiedProvider().buildSpawnArgs({ cwd: '/work' });

    expect(args).toEqual(['--json', '--cwd', '/work', '--auto-approve', 'false', 'Say hi']);
    // Cline resolves subcommands on an exact first-argument match, so the
    // prompt must never lead.
    expect(args[0]).toBe('--json');
    expect(args.at(-1)).toBe('Say hi');
  });

  it('maps skip permission mode to global auto-approval', () => {
    const args = verifiedProvider().buildSpawnArgs({ cwd: '/work', permissionMode: 'skip' });

    expect(args).toContain('--auto-approve');
    expect(args[args.indexOf('--auto-approve') + 1]).toBe('true');
  });

  it('refuses whitelist mode instead of silently denying every tool', () => {
    // 3.0.51 has only a global --auto-approve boolean. Downgrading to deny-all
    // would present as a working allowlist while blocking everything.
    expect(() => verifiedProvider().buildSpawnArgs({ cwd: '/work', permissionMode: 'whitelist' }))
      .toThrow(/cannot enforce a tool allowlist/);
  });

  it('passes an explicit model but drops the default sentinel', () => {
    expect(verifiedProvider().buildSpawnArgs({ cwd: '/work', model: 'anthropic/claude-opus-5' }))
      .toContain('anthropic/claude-opus-5');
    expect(verifiedProvider().buildSpawnArgs({ cwd: '/work', model: 'cline-default' }))
      .not.toContain('--model');
  });

  it('refuses resume and fork rather than emitting flags that do not work', () => {
    expect(() => verifiedProvider().buildSpawnArgs({ cwd: '/work', resumeSessionId: '1786_abc' }))
      .toThrow(/cannot resume a session/);
    expect(() => verifiedProvider().buildSpawnArgs({ cwd: '/work', forkSession: true }))
      .toThrow(/no session fork mechanism/);
  });

  it('requires a prepared turn before building arguments', () => {
    expect(() => new ClineProvider(VERIFIED_PROFILE).buildSpawnArgs({ cwd: '/work' }))
      .toThrow(/requires prepareEphemeralTurn/);
  });

  it('classifies an insufficient-credit refusal as a provider rejection', () => {
    const refusal = new ClineProvider().classifyLaunchFailure!({
      source: 'stderr',
      stderrLines: ['Insufficient balance. Your Cline Credits balance is $-0.11'],
    });

    expect(refusal).toMatchObject({
      category: 'provider_rejected',
      statusCode: 402,
      retryable: false,
    });
  });

  it('ignores blank lines and passes undecodable output through as raw', () => {
    const provider = new ClineProvider();

    expect(provider.parseStreamLine('  ')).toBeNull();
    expect(provider.parseStreamLine('not json at all')).toEqual({
      type: 'raw',
      text: 'not json at all',
    });
  });
});
