import { record } from '../../../core/interactions/validation.js';
import type { ProviderControlCorrelation } from '../providers/types.js';

/** JSON-RPC: the request and its reply share `id`; a reply carries `result` or `error`. */
export const JSON_RPC_CONTROL: ProviderControlCorrelation = {
  requestId: frame => typeof frame.id === 'number' || typeof frame.id === 'string' ? frame.id : undefined,
  reply: frame => frame.method !== undefined || (typeof frame.id !== 'number' && typeof frame.id !== 'string')
    ? undefined : { id: frame.id, result: record(frame.result), failed: Boolean(frame.error) },
};

/** A bounded request/reply channel tied to exactly one child lifetime. */
export class WorkerControlChannel {
  private readonly pending = new Map<string, { finish(error?: Error, result?: Record<string, unknown>): void }>();
  private closed = false;
  constructor(
    private readonly write: (line: string, done: (error?: Error | null) => void) => void,
    private readonly correlation: ProviderControlCorrelation = JSON_RPC_CONTROL,
  ) {}

  request(line: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    if (this.closed || this.pending.size >= 8) return Promise.reject(new Error('Provider control channel unavailable.'));
    const frame = record(JSON.parse(line));
    const id = frame ? this.correlation.requestId(frame) : undefined;
    if (id === undefined) return Promise.reject(new Error('Invalid provider control request.'));
    const key = JSON.stringify(id);
    if (this.pending.has(key)) return Promise.reject(new Error('Duplicate provider control request.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Provider discovery timed out.')), Math.min(10_000, Math.max(1, timeoutMs)));
      timer.unref?.();
      const finish = (error?: Error, result?: Record<string, unknown>) => {
        if (!this.pending.delete(key)) return;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result ?? {});
      };
      this.pending.set(key, { finish });
      try { this.write(line, error => { if (error) finish(new Error('Provider control delivery failed.')); }); }
      catch { finish(new Error('Provider control delivery failed.')); }
    });
  }

  consume(line: string): boolean {
    if (!this.pending.size && !line.includes('cats-runtime-control-')) return false;
    let frame: Record<string, unknown> | undefined;
    try { frame = record(JSON.parse(line)); } catch { return false; }
    const reply = frame ? this.correlation.reply(frame) : undefined;
    if (!reply) return false;
    const pending = this.pending.get(JSON.stringify(reply.id));
    // Late discovery errors must not be mistaken for failed model turns.
    if (!pending) return typeof reply.id === 'string' && reply.id.startsWith('cats-runtime-control-');
    pending.finish(reply.failed || !reply.result || line.length > 4_194_304
      ? new Error('Provider discovery response unavailable or unsupported.') : undefined, reply.result);
    return true;
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.finish(new Error('Provider worker stopped.'));
  }
}
