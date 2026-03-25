import { describe, expect, it, vi, afterEach } from 'vitest';
import { runCliCommand, isCliAvailable, parseCliJson } from './cli.js';

describe('runCliCommand', () => {
  it('captures stdout from a simple command', async () => {
    const result = await runCliCommand('echo', ['hello'], { timeoutMs: 5000 });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures exit code from a failing command', async () => {
    const result = await runCliCommand('node', ['-e', 'process.exit(42)'], { timeoutMs: 5000 });
    expect(result.code).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr', async () => {
    const result = await runCliCommand('node', ['-e', 'console.error("err")'], { timeoutMs: 5000 });
    expect(result.stderr.trim()).toBe('err');
  });

  it('times out on a long-running command', async () => {
    const result = await runCliCommand('node', ['-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
  });

  it('handles a nonexistent command', async () => {
    const result = await runCliCommand('nonexistent-cmd-abc123', [], { timeoutMs: 2000 });
    // Should not throw; returns null code
    expect(result.code).toBeNull();
  });
});

describe('isCliAvailable', () => {
  it('returns available for node', async () => {
    const result = await isCliAvailable('node', ['--version'], 5000);
    expect(result.available).toBe(true);
    expect(result.version).toBeDefined();
  });

  it('returns unavailable for nonexistent command', async () => {
    const result = await isCliAvailable('nonexistent-cmd-xyz789', ['--version'], 2000);
    expect(result.available).toBe(false);
  });
});

describe('parseCliJson', () => {
  it('parses valid JSON', () => {
    expect(parseCliJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseCliJson('not json')).toBeUndefined();
  });

  it('trims whitespace before parsing', () => {
    expect(parseCliJson('  {"b":2}  ')).toEqual({ b: 2 });
  });
});
