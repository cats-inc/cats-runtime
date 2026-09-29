import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNdjsonStreamWriter, NDJSON_HEARTBEAT_EVENT } from './ndjsonStreamWriter.js';

function fakeController() {
  const lines: unknown[] = [];
  let closed = false;
  const decoder = new TextDecoder();
  const controller = {
    enqueue(chunk: Uint8Array) {
      if (closed) throw new TypeError('Invalid state: Controller is already closed');
      lines.push(JSON.parse(decoder.decode(chunk)));
    },
    close() {
      if (closed) throw new TypeError('Invalid state: Controller is already closed');
      closed = true;
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, lines, closeFromClient: () => { closed = true; }, isClosed: () => closed };
}

describe('createNdjsonStreamWriter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a heartbeat only after the stream has been silent', () => {
    vi.useFakeTimers();
    const { controller, lines } = fakeController();
    const writer = createNdjsonStreamWriter(controller, { heartbeatMs: 30_000, checkMs: 5_000 });
    writer.write({ type: 'text', text: 'hi' });
    vi.advanceTimersByTime(25_000);
    expect(lines).toEqual([{ type: 'text', text: 'hi' }]);
    vi.advanceTimersByTime(10_000);
    expect(lines.at(-1)).toEqual(NDJSON_HEARTBEAT_EVENT);
    writer.write({ type: 'result' });
    vi.advanceTimersByTime(20_000);
    expect(lines.filter((line) => line === NDJSON_HEARTBEAT_EVENT || JSON.stringify(line) === JSON.stringify(NDJSON_HEARTBEAT_EVENT))).toHaveLength(1);
    writer.close();
    vi.advanceTimersByTime(120_000);
    expect(lines.at(-1)).toEqual({ type: 'result' });
  });

  it('stops writing once the client is gone instead of throwing', () => {
    vi.useFakeTimers();
    const { controller, lines, closeFromClient } = fakeController();
    const writer = createNdjsonStreamWriter(controller);
    writer.write({ type: 'text', text: 'a' });
    closeFromClient();
    expect(() => writer.write({ type: 'text', text: 'b' })).not.toThrow();
    expect(writer.open).toBe(false);
    expect(() => writer.close()).not.toThrow();
    expect(lines).toEqual([{ type: 'text', text: 'a' }]);
  });

  it('ignores writes after the stream is cancelled and closes normally otherwise', () => {
    const cancelled = fakeController();
    const writer = createNdjsonStreamWriter(cancelled.controller);
    writer.cancel();
    writer.write({ type: 'text', text: 'late' });
    writer.close();
    expect(cancelled.lines).toEqual([]);
    expect(cancelled.isClosed()).toBe(false);

    const normal = fakeController();
    const other = createNdjsonStreamWriter(normal.controller);
    other.write({ type: 'result' });
    other.close();
    expect(normal.isClosed()).toBe(true);
    expect(normal.lines).toEqual([{ type: 'result' }]);
  });
});
