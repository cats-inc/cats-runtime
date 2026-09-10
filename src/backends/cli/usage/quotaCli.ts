import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ProviderCommandConfig } from '../config.js';
import type { ProviderName } from '../providers/types.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';

export const quotaRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

type Send = (value: unknown) => void;
export type QuotaProtocol = { args: string[] } & ({
  framing: 'ndjson' | 'content-length';
  start: (send: Send) => void;
  receive: (message: Record<string, unknown>, send: Send) => QuotaCollectionResult | undefined;
} | {
  framing: 'text';
  complete: (stdout: string, exitCode: number | null, stderr: string) => QuotaCollectionResult;
});

/** Bounded CLI pipes only: no credentials, HTTP, terminal interaction, or raw logging. */
export async function runQuotaCli(
  command: ProviderCommandConfig, provider: ProviderName, protocol: QuotaProtocol,
  signal?: AbortSignal, timeoutMs = 8_000,
): Promise<QuotaCollectionResult> {
  if (signal?.aborted) return { status: 'error' };
  if (command.runtime.mode !== 'native') return { status: 'unsupported' };
  try {
    const config = buildProcessSpawnConfig(command, provider, [...(command.args ?? []), ...protocol.args], tmpdir());
    return await new Promise<QuotaCollectionResult>((resolve) => {
      const child = spawn(config.command, config.args, {
        cwd: config.cwd ?? tmpdir(), env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'], shell: config.shell,
        windowsVerbatimArguments: config.windowsVerbatimArguments, windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let buffer = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let bytes = 0;
      let finished: QuotaCollectionResult | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
      const abort = () => finish({ status: 'error' });
      const finish = (result: QuotaCollectionResult) => {
        if (finished) return;
        finished = result;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        child.stdin.end();
        killTimer = setTimeout(() => {
          if (!child.pid) return;
          if (process.platform === 'win32') {
            const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
            killer.on('error', () => child.kill());
            killer.on('exit', (code) => { if (code !== 0) child.kill(); });
            const killerTimeout = setTimeout(() => { child.kill(); killer.kill(); }, 1000);
            killer.on('close', () => clearTimeout(killerTimeout));
          } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          }
        }, 500);
      };
      const send: Send = (value) => {
        if (finished) return;
        const body = JSON.stringify(value);
        child.stdin.write(protocol.framing === 'ndjson' ? `${body}\n`
          : `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.on('spawn', () => {
        if (!finished) {
          try {
            if (protocol.framing === 'text') child.stdin.end();
            else protocol.start(send);
          } catch { finish({ status: 'error' }); }
        }
      });
      child.stdin.on('error', () => finish({ status: 'error' }));
      child.on('error', () => finish({ status: 'unavailable' }));
      child.on('close', (code) => {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        if (!finished && protocol.framing === 'text') {
          try { finished = protocol.complete(buffer.toString('utf8'), code, stderr.toString('utf8')); }
          catch { finished = { status: 'error' }; }
        }
        resolve(finished ?? { status: 'error' });
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (finished) return;
        bytes += chunk.length;
        if (bytes > 512 * 1024) finish({ status: 'error' });
        else if (protocol.framing === 'text') stderr = Buffer.concat([stderr, chunk]);
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (finished) return;
        bytes += chunk.length;
        if (bytes > 512 * 1024) { finish({ status: 'error' }); return; }
        buffer = Buffer.concat([buffer, chunk]);
        if (protocol.framing === 'text') return;
        while (!finished) {
          let start = 0;
          let length: number;
          let consumed: number;
          if (protocol.framing === 'ndjson') {
            const end = buffer.indexOf('\n');
            if (end < 0) break;
            length = end; consumed = end + 1;
          } else {
            const end = buffer.indexOf('\r\n\r\n');
            if (end < 0) { if (buffer.length > 8192) finish({ status: 'error' }); break; }
            if (end > 8192) { finish({ status: 'error' }); break; }
            const headers = buffer.subarray(0, end).toString('ascii');
            const lengths = [...headers.matchAll(/^Content-Length: (\d+)\r?$/gimu)];
            length = lengths.length === 1 ? Number(lengths[0]![1]) : NaN;
            if (!Number.isSafeInteger(length) || length <= 0 || length > 512 * 1024) {
              finish({ status: 'error' }); break;
            }
            start = end + 4; consumed = start + length;
            if (buffer.length < consumed) break;
          }
          try {
            const message = quotaRecord(JSON.parse(buffer.subarray(start, start + length).toString('utf8')));
            buffer = buffer.subarray(consumed);
            if (!message) { finish({ status: 'error' }); break; }
            const result = protocol.receive(message, send);
            if (result) finish(result);
          } catch { finish({ status: 'error' }); break; }
        }
      });
    });
  } catch { return { status: 'unavailable' }; }
}
