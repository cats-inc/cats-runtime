import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeStartupTrace,
  isRuntimeStartupTraceEnabled,
} from '../src/core/startupTrace.js';

describe('runtime startup trace', () => {
  it('stays disabled by default', () => {
    expect(isRuntimeStartupTraceEnabled({})).toBe(false);
  });

  it('accepts common truthy env values', () => {
    expect(isRuntimeStartupTraceEnabled({ CATS_RUNTIME_STARTUP_TRACE: 'true' })).toBe(true);
    expect(isRuntimeStartupTraceEnabled({ CATS_RUNTIME_STARTUP_TRACE: '1' })).toBe(true);
    expect(isRuntimeStartupTraceEnabled({ CATS_RUNTIME_STARTUP_TRACE: 'yes' })).toBe(true);
    expect(isRuntimeStartupTraceEnabled({ CATS_RUNTIME_STARTUP_TRACE: 'on' })).toBe(true);
  });

  it('writes structured startup trace payloads when enabled', () => {
    const writes: string[] = [];
    const now = vi.fn(() => new Date('2026-04-16T01:02:03.000Z'));
    const trace = createRuntimeStartupTrace({
      env: { CATS_RUNTIME_STARTUP_TRACE: 'true' },
      now,
      write: (line) => {
        writes.push(line);
      },
      startedAtMs: new Date('2026-04-16T01:02:00.000Z').getTime(),
      pid: 4242,
    });

    trace.trace('server.listen.ready', { port: 3110 });

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toEqual({
      event: 'runtime.startup_trace',
      service: 'cats-runtime',
      pid: 4242,
      phase: 'server.listen.ready',
      timestamp: '2026-04-16T01:02:03.000Z',
      elapsedMs: 3000,
      details: {
        port: 3110,
      },
    });
  });
});
