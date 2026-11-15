import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempDirWithRetries } from '../../../../tests/tempCleanup.js';
import type { ProviderCommandConfig } from '../config.js';
import { getProviderProcessPolicy } from '../runtime/providerProcessPolicy.js';
import type { StreamEvent } from './types.js';
import { buildKimiArgs, buildKimiExitError, findKimiWireJournal, KimiProvider } from './kimi.js';

const fixtureDir = fileURLToPath(new URL('../../../../tests/fixtures/provider-captures/kimi-2.5.3/', import.meta.url));

/** Replays a captured stdout/stderr pair and exit code, and records its argv and environment. */
const FAKE_KIMI = `
const fs = require('node:fs');
const env = process.env;
if (env.FAKE_KIMI_ARGV) {
  fs.writeFileSync(env.FAKE_KIMI_ARGV, JSON.stringify({
    args: process.argv.slice(2), noAutoUpdate: env.KIMI_CODE_NO_AUTO_UPDATE ?? null,
  }));
}
if (env.FAKE_KIMI_STDOUT) process.stdout.write(fs.readFileSync(env.FAKE_KIMI_STDOUT));
if (env.FAKE_KIMI_STDERR) process.stderr.write(fs.readFileSync(env.FAKE_KIMI_STDERR));
if (env.FAKE_KIMI_HANG) setInterval(() => {}, 1000);
else process.exitCode = Number(env.FAKE_KIMI_EXIT ?? 0);
`;

let root: string;
let commandConfig: ProviderCommandConfig;

function createFakeKimi(dir: string): string {
  const script = join(dir, 'fake-kimi.cjs');
  writeFileSync(script, FAKE_KIMI);
  if (process.platform === 'win32') {
    const shim = join(dir, 'kimi.cmd');
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return shim;
  }
  const launcher = join(dir, 'kimi');
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(launcher, 0o755);
  return launcher;
}

function replay(name: string, exitCode: number): void {
  vi.stubEnv('FAKE_KIMI_STDOUT', join(fixtureDir, `${name}.stdout.redacted.ndjson`));
  vi.stubEnv('FAKE_KIMI_STDERR', exitCode === 0 ? '' : join(fixtureDir, `${name}.stderr.redacted.txt`));
  vi.stubEnv('FAKE_KIMI_EXIT', String(exitCode));
}

async function collect(
  provider: KimiProvider,
  options: { model?: string; resumeSessionId?: string } = {},
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of provider.streamTurn({ message: 'Read hello.txt' }, { cwd: root, ...options })) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cats-kimi-'));
  commandConfig = { path: createFakeKimi(root), runner: 'auto', runtime: { mode: 'native' } };
  vi.stubEnv('FAKE_KIMI_ARGV', join(root, 'argv.json'));
  vi.stubEnv('FAKE_KIMI_HANG', '');
  vi.stubEnv('CATS_KIMI_TURN_TIMEOUT_MS', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTempDirWithRetries(root);
});

describe('buildKimiArgs', () => {
  it('runs print mode with model, session and the prompt last', () => {
    expect(buildKimiArgs({ cwd: '/w', model: 'kimi-code/k3', resumeSessionId: 'session_1' }, 'hi'))
      .toEqual(['--output-format', 'stream-json', '--model', 'kimi-code/k3', '--session', 'session_1',
        '--prompt', 'hi']);
    expect(buildKimiArgs({ cwd: '/w', model: '  ' }, null)).toEqual(['--output-format', 'stream-json']);
  });

  it('places the compiled prompt from prepareEphemeralTurn once', () => {
    const provider = new KimiProvider(commandConfig);
    provider.prepareEphemeralTurn({ message: '晚安', instructions: 'Keep it short.' });

    expect(provider.buildSpawnArgs({ cwd: '/w' }).slice(-2))
      .toEqual(['--prompt', 'Instructions:\nKeep it short.\n\nUser message:\n晚安']);
    expect(provider.buildSpawnArgs({ cwd: '/w' })).not.toContain('--prompt');
  });

  it('declares resume without fork or permission control', () => {
    expect(new KimiProvider().capabilities).toEqual({ resume: true, fork: false, permissions: false });
  });
});

describe('KimiProvider.streamTurn', () => {
  it('streams a tool turn and ends with the session id and the journal usage', async () => {
    replay('tool-turn.success', 0);
    const sessionId = 'session_40d3a7c9-b49e-4df6-875b-c62d6f616fe3';
    const kimiHome = join(root, 'kimi-home');
    const sessionDir = join(kimiHome, 'sessions', 'wd_work_4bc2d6c3509e', sessionId, 'agents', 'main');
    mkdirSync(sessionDir, { recursive: true });
    copyFileSync(join(fixtureDir, 'wire-two-turns.excerpt.redacted.jsonl'), join(sessionDir, 'wire.jsonl'));

    const events = await collect(new KimiProvider(commandConfig, { kimiHome }), { model: '__kimi_env_model__' });

    expect(events.map((event) => event.type))
      .toEqual(['progress', 'text', 'progress', 'tool_use', 'tool_result', 'text', 'result']);
    expect(events.at(-1)).toEqual({
      type: 'result',
      sessionId,
      usage: { inputTokens: 120, outputTokens: 7, totalTokens: 127, sourceConfidence: 'reported' },
      reportedModels: [{ model: 'mock-model', matchesRequest: true }],
    });
    const launched = JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8')) as {
      args: string[]; noAutoUpdate: string | null;
    };
    expect(launched.args).toEqual(['--output-format', 'stream-json', '--model', '__kimi_env_model__',
      '--prompt', 'Read hello.txt']);
    expect(launched.noAutoUpdate).toBe('1');
  });

  it('ends without usage when the session journal is not on this machine', async () => {
    replay('text-turn.success', 0);

    const events = await collect(new KimiProvider(commandConfig, { kimiHome: join(root, 'absent') }));

    expect(events.at(-1)).toEqual({ type: 'result', sessionId: 'session_e2582112-778b-4af1-b02a-9f6f27f27822' });
  });

  it.each(['resume-missing.error', 'resume-other-directory.error'])(
    'reports %s as an unavailable provider session when resuming',
    async (name) => {
      replay(name, 1);

      const events = await collect(new KimiProvider(commandConfig), { resumeSessionId: 'session_gone' });

      expect(events[0]).toEqual({ type: 'init', sessionId: 'session_gone' });
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'provider_session_unavailable' });
      const launched = JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8')) as { args: string[] };
      expect(launched.args.slice(2, 4)).toEqual(['--session', 'session_gone']);
    },
  );

  it.each([
    ['provider-api.error', 'Kimi Code failed: provider.api_error: mock bad request'],
    ['model-not-configured.error', 'Kimi Code failed: Model "kimi-code/k3" is not configured in config.toml.'],
  ])('reports %s with Kimi\'s own sentence', async (name, text) => {
    replay(name, 1);

    const events = await collect(new KimiProvider(commandConfig));

    expect(events.at(-1)).toEqual({ type: 'error', text });
  });

  it('reports the missing plan the real account returned', async () => {
    replay('subscription-required.error', 1);

    const last = (await collect(new KimiProvider(commandConfig))).at(-1);

    expect(last).toMatchObject({ type: 'error' });
    expect(last?.text).toMatch(/^Kimi Code failed: provider\.auth_error: Your current subscription/u);
    expect(last?.text).not.toContain('See log');
  });

  it('fails a successful exit that never wrote the resume hint', async () => {
    vi.stubEnv('FAKE_KIMI_STDOUT', join(fixtureDir, 'provider-api.error.stdout.redacted.ndjson'));
    vi.stubEnv('FAKE_KIMI_EXIT', '0');

    const events = await collect(new KimiProvider(commandConfig));

    expect(events.at(-1)).toEqual({ type: 'error', text: 'Kimi Code exited without completing the turn.' });
  });

  it('stops a turn that outlives the turn limit', async () => {
    vi.stubEnv('FAKE_KIMI_HANG', '1');
    vi.stubEnv('CATS_KIMI_TURN_TIMEOUT_MS', '1500');

    const events = await collect(new KimiProvider(commandConfig));

    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(events.at(-1)?.text).toMatch(/did not finish within 1500ms/u);
  }, 20_000);
});

describe('Kimi process details', () => {
  it('turns off Kimi auto-update only for processes Cats starts', () => {
    expect(getProviderProcessPolicy('kimi', ['--prompt', 'x'], 'kimi')).toEqual({
      args: ['--prompt', 'x'], env: { KIMI_CODE_NO_AUTO_UPDATE: '1' },
    });
  });

  it('keeps launch failures and stdout error frames ahead of stderr parsing', () => {
    expect(buildKimiExitError(null, [], { launchError: new Error('spawn kimi ENOENT') }))
      .toEqual({ type: 'error', text: 'Kimi Code could not start: spawn kimi ENOENT' });
    const busy = { type: 'error' as const, text: 'Session is in use by another client.' };
    expect(buildKimiExitError(4, [], { stdoutError: busy })).toBe(busy);
    expect(buildKimiExitError(1, ['boom', 'See log: x'])).toEqual({
      type: 'error', text: 'Kimi Code exited with code 1 before completing the turn. stderr: boom',
    });
  });

  it('does not report an unavailable session for a turn that was not resuming', () => {
    const missing = ['error: failed to run prompt: Session "s" not found.'];
    expect(buildKimiExitError(1, missing)).toEqual({ type: 'error', text: 'Kimi Code failed: Session "s" not found.' });
  });

  it('finds a session journal under any workdir key and refuses path-like ids', async () => {
    const kimiHome = join(root, 'home');
    const dir = join(kimiHome, 'sessions', 'wd_a_1', 'session_x', 'agents', 'main');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'wire.jsonl'), '');

    expect(await findKimiWireJournal(kimiHome, 'session_x')).toBe(join(dir, 'wire.jsonl'));
    expect(await findKimiWireJournal(kimiHome, '../session_x')).toBeNull();
    expect(await findKimiWireJournal(join(root, 'none'), 'session_x')).toBeNull();
  });
});
