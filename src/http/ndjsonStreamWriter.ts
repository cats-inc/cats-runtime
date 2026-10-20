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
  /** One coalesced workspace snapshot; never queue each update behind a slow reader. */
  writeWorkspaceActivity(value: unknown): void;
  /** The ReadableStream consumer requested another chunk. */
  pull(): void;
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
  let pendingWorkspace: unknown;

  const enqueue = (value: unknown) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      lastWriteAt = now();
    } catch {
      open = false;
    }
  };
  const flushWorkspace = (force = false) => {
    if (!open || pendingWorkspace === undefined
      || (!force && (controller.desiredSize ?? 0) <= 0)) return;
    const next = pendingWorkspace;
    pendingWorkspace = undefined;
    enqueue(next);
  };
  const write = (value: unknown) => {
    const type = value && typeof value === 'object' && 'type' in value ? value.type : undefined;
    if (type === 'result' || type === 'error') flushWorkspace(true);
    enqueue(value);
  };
  const timer = setInterval(() => {
    if (now() - lastWriteAt >= heartbeatMs) write(NDJSON_HEARTBEAT_EVENT);
  }, options.checkMs ?? 5_000);
  timer.unref?.();

  return {
    write,
    writeWorkspaceActivity(value) {
      if (!open) return;
      pendingWorkspace = value;
      flushWorkspace();
    },
    pull() { flushWorkspace(); },
    cancel() {
      open = false;
      pendingWorkspace = undefined;
      clearInterval(timer);
    },
    close() {
      clearInterval(timer);
      if (!open) return;
      flushWorkspace(true);
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
