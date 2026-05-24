import { rmSync } from 'node:fs';

const RETRYABLE_CODES = new Set([
  'EBUSY',
  'ENOTEMPTY',
  'EPERM',
]);

export function cleanupTempDirWithRetries(
  dir: string | undefined,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {},
): void {
  if (!dir) {
    return;
  }

  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 100;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!RETRYABLE_CODES.has(code || '') || attempt === attempts - 1) {
        throw error;
      }
      sleepSync(delayMs * (attempt + 1));
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
