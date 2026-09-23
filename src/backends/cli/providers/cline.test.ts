import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupTempDirWithRetries } from '../../../../tests/tempCleanup.js';
import { createRuntimeTestEnv } from '../../../../tests/support/runtimeTestPaths.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
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
  it('uses the best-known adapter when no compatibility profile is available', () => {
    const provider = new ClineProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(provider.buildSpawnArgs({ cwd: '/work' }))
      .toEqual(['--json', '--cwd', '/work', '--auto-approve', 'false', '--', 'Say hi']);
  });

  it('uses a weak best-fit profile instead of refusing execution', () => {
    const provider = new ClineProvider({ ...VERIFIED_PROFILE, confidence: 'weak' });
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(provider.buildSpawnArgs({ cwd: '/work' }))
      .toEqual(['--json', '--cwd', '/work', '--auto-approve', 'false', '--', 'Say hi']);
  });

  it('reports resume as unavailable because --id conflicts with --json on 3.0.51', () => {
    expect(new ClineProvider().capabilities).toEqual({
      resume: false,
      fork: false,
      permissions: true,
    });
  });

  it('builds a JSON turn with the prompt after the end-of-options marker', () => {
    const args = verifiedProvider().buildSpawnArgs({ cwd: '/work' });

    expect(args).toEqual(['--json', '--cwd', '/work', '--auto-approve', 'false', '--', 'Say hi']);
    expect(args[0]).toBe('--json');
    expect(args.at(-1)).toBe('Say hi');
  });

  it.each(['晚安', '你好，世界！', 'hello', 'doctor', 'config', '--help', '-p'])(
    'passes %j as prompt text accepted by the Cline whitespace heuristic', (message) => {
      const provider = new ClineProvider();
      provider.prepareEphemeralTurn({ message });
      const args = provider.buildSpawnArgs({ cwd: '/work' });

      expect(args.slice(-2)).toEqual(['--', ` ${message}`]);
    },
  );

  it.each(['--model another-model', '--config=some directory', '--autoapprove=false', '--reasoning-effort=low'])(
    'keeps flag-like message %j out of upstream raw-argv preprocessing', (message) => {
      const provider = new ClineProvider();
      provider.prepareEphemeralTurn({ message });

      expect(provider.buildSpawnArgs({ cwd: '/work' }).slice(-2)).toEqual(['--', ` ${message}`]);
    },
  );

  it.each(['Say hi', 'line one\n第二行', '  晚安  ', ' --config=already padded'])(
    'preserves an already unambiguous prompt %j verbatim', (message) => {
      const provider = new ClineProvider();
      provider.prepareEphemeralTurn({ message });

      expect(provider.buildSpawnArgs({ cwd: '/work' }).slice(-2)).toEqual(['--', message]);
    },
  );

  it('preserves session and turn instructions when the user message has no whitespace', () => {
    const provider = new ClineProvider();
    provider.prepareEphemeralTurn({
      message: '晚安', sessionInstructions: 'Answer in Chinese.', instructions: 'Keep it short.',
    });
    const prompt = provider.buildSpawnArgs({ cwd: '/work' }).at(-1);

    expect(prompt).toBe('Instructions:\nAnswer in Chinese.\n\nKeep it short.\n\nUser message:\n晚安');
  });

  it.each(['晚安', 'config', '--help', '--config=some directory'])(
    'round-trips %j through the native launcher as one positional prompt', (message) => {
      const root = mkdtempSync(join(tmpdir(), 'cats-cline argv-'));
      try {
        const script = join(root, 'capture.cjs');
        writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
        const shim = join(root, 'cline.cmd');
        if (process.platform === 'win32') {
          writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
        }
        const provider = new ClineProvider();
        provider.prepareEphemeralTurn({ message });
        const args = provider.buildSpawnArgs({
          cwd: root, model: 'cline-pass/glm-5.3', permissionMode: 'skip',
          modelProvider: 'cline-pass', modelControls: {'cline.reasoning_effort': 'medium'},
        });
        const config = buildProcessSpawnConfig({
          path: process.platform === 'win32' ? shim : process.execPath,
          runner: 'auto', runtime: { mode: 'native' },
        }, 'cline', process.platform === 'win32' ? args : [script, ...args], root);
        const result = spawnSync(config.command, config.args, {
          ...config,
          env: { ...process.env, ...createRuntimeTestEnv(root), ...config.env },
          windowsHide: true, encoding: 'utf8', timeout: 10_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        const received = JSON.parse(result.stdout) as string[];
        expect(received).toEqual(args);
        expect(received.slice(received.indexOf('--') + 1)).toHaveLength(1);
        expect(received.at(-1)).toMatch(/\s/);
        expect(received.at(-1)?.trim()).toBe(message);
        expect(received.slice(received.indexOf('--provider'), received.indexOf('--provider') + 6))
          .toEqual(['--provider', 'cline-pass', '--model', 'cline-pass/glm-5.3', '--thinking', 'medium']);
        expect(received.slice(received.indexOf('--auto-approve'), received.indexOf('--auto-approve') + 2))
          .toEqual(['--auto-approve', 'true']);
      } finally {
        cleanupTempDirWithRetries(root);
      }
    },
  );

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

  it('passes an explicit model and leaves omitted models to the provider', () => {
    expect(verifiedProvider().buildSpawnArgs({ cwd: '/work', model: 'anthropic/claude-opus-5' }))
      .toContain('anthropic/claude-opus-5');
    expect(verifiedProvider().buildSpawnArgs({ cwd: '/work', model: ' ' }))
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
