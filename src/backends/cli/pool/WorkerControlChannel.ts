import { record } from '../../../core/interactions/validation.js';

/** A bounded request/reply channel tied to exactly one child lifetime. */
export class WorkerControlChannel {
  private readonly pending = new Map<string, { finish(error?: Error, result?: Record<string, unknown>): void }>();
  private closed = false;
  constructor(private readonly write: (line: string, done: (error?: Error | null) => void) => void) {}

  request(line: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    if (this.closed || this.pending.size >= 8) return Promise.reject(new Error('Provider control channel unavailable.'));
    const frame = record(JSON.parse(line));
    if (!frame || typeof frame.id !== 'number' && typeof frame.id !== 'string') return Promise.reject(new Error('Invalid provider control request.'));
    const key = JSON.stringify(frame.id);
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
    if (!frame || frame.method !== undefined || frame.id === undefined) return false;
    const pending = this.pending.get(JSON.stringify(frame.id));
    // Late discovery errors must not be mistaken for failed model turns.
    if (!pending) return typeof frame.id === 'string' && frame.id.startsWith('cats-runtime-control-');
    const result = record(frame.result);
    pending.finish(frame.error || !result || line.length > 4_194_304
      ? new Error('Provider discovery response unavailable or unsupported.') : undefined, result);
    return true;
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.finish(new Error('Provider worker stopped.'));
  }
}
