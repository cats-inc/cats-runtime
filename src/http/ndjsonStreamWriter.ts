/**
 * Writes NDJSON lines to a streaming response for one turn.
 *
 * - After `heartbeatMs` without a line it writes a heartbeat progress event, so
 *   a client's idle timeout does not end a turn that is still working (a
 *   provider can run a long command or reason for minutes without an event).
 *   Clients skip progress events whose `metadata.kind` is `heartbeat`.
 * - Once the client goes away (the stream is cancelled or an enqueue fails),
 *   writes become no-ops, so the turn itself finishes instead of failing with
 *   "Controller is already closed".
 */

export const NDJSON_HEARTBEAT_EVENT = {
  type: 'progress',
  text: '',
  metadata: { kind: 'heartbeat', source: 'runtime' },
} as const;

export interface NdjsonStreamWriterOptions {
  heartbeatMs?: number;
  checkMs?: number;
  now?: () => number;
}

export interface NdjsonStreamWriter {
  write(value: unknown): void;
  /** The client cancelled the stream. */
  cancel(): void;
  /** Stop heartbeats and close the stream if the client is still there. */
  close(): void;
  readonly open: boolean;
}

export function createNdjsonStreamWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: NdjsonStreamWriterOptions = {},
): NdjsonStreamWriter {
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const now = options.now ?? Date.now;
  const encoder = new TextEncoder();
  let open = true;
  let lastWriteAt = now();

  const write = (value: unknown) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      lastWriteAt = now();
    } catch {
      open = false;
    }
  };
  const timer = setInterval(() => {
    if (now() - lastWriteAt >= heartbeatMs) write(NDJSON_HEARTBEAT_EVENT);
  }, options.checkMs ?? 5_000);
  timer.unref?.();

  return {
    write,
    cancel() {
      open = false;
      clearInterval(timer);
    },
    close() {
      clearInterval(timer);
      if (!open) return;
      open = false;
      try {
        controller.close();
      } catch {
        // The client already closed the stream.
      }
    },
    get open() {
      return open;
    },
  };
}
