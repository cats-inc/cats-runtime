import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ProviderCommandConfig } from '../config.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';

export type CodexQuotaStatus = 'updated' | 'auth_required' | 'unsupported' | 'unavailable' | 'timeout' | 'error';
export interface CodexQuotaResult {
  status: CodexQuotaStatus;
  quota?: Record<string, string | number | boolean>;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

/** Keep quota facts only. Neither credentials nor account identity leave the CLI. */
export function normalizeCodexQuotaRead(value: unknown, now = new Date()): CodexQuotaResult {
  const result = record(value);
  const limits = record(record(result?.rateLimitsByLimitId)?.codex) ?? record(result?.rateLimits);
  if (!limits) return { status: 'unavailable' };
  const quota: Record<string, string | number | boolean> = {
    source: 'codex.account/rateLimits/read', observedAt: now.toISOString(),
  };
  if (typeof limits.limitId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(limits.limitId)) {
    quota.limitId = limits.limitId;
  }
  let count = 0;
  for (const id of ['primary', 'secondary']) {
    const window = record(limits[id]);
    const used = window?.usedPercent;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) continue;
    quota[`${id}.usedPercent`] = used;
    const minutes = window?.windowDurationMins;
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
      quota[`${id}.windowDurationMins`] = minutes;
    }
    const reset = window?.resetsAt;
    if (typeof reset === 'number' && Number.isFinite(reset) && reset > 0 && reset < 8.64e12) {
      quota[`${id}.resetsAt`] = new Date(reset * 1000).toISOString();
    }
    count += 1;
  }
  return count ? { status: 'updated', quota } : { status: 'unavailable' };
}

/** A one-shot, quota-only CLI client. No HTTP client, auth-file reads or model turns. */
export async function readCodexQuota(
  command: ProviderCommandConfig,
  signal?: AbortSignal,
  timeoutMs = 8_000,
): Promise<CodexQuotaResult> {
  if (signal?.aborted) return { status: 'error' };
  // Remote launchers currently consume stdin for their bootstrap script. Do not
  // claim stdio account-query support until those transports are verified.
  if (command.runtime.mode !== 'native') return { status: 'unsupported' };
  try {
    const config = buildProcessSpawnConfig(command, 'codex', [...(command.args ?? []), 'app-server'], tmpdir());
    return await new Promise<CodexQuotaResult>((resolve) => {
      const child = spawn(config.command, config.args, {
        cwd: config.cwd ?? tmpdir(), env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'], shell: config.shell,
        windowsVerbatimArguments: config.windowsVerbatimArguments, windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let buffer = '';
      let bytes = 0;
      let initialized = false;
      let finished: CodexQuotaResult | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
      const abort = () => finish({ status: 'error' });
      const finish = (result: CodexQuotaResult) => {
        if (finished) return;
        finished = result;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        // EOF lets app-server clean up. Reap an unresponsive CLI tree, including npm shims.
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
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
      child.on('spawn', () => {
        if (!finished) send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'cats-runtime', version: '1.0.0' } } });
      });
      child.stdin.on('error', () => finish({ status: 'error' }));
      child.on('error', () => finish({ status: 'unavailable' }));
      child.on('close', () => {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        resolve(finished ?? { status: 'error' });
      });
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length; // Drain but never store, log or return provider stderr.
        if (bytes > 512 * 1024) finish({ status: 'error' });
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (finished) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > 512 * 1024) { finish({ status: 'error' }); return; }
        buffer += chunk;
        let end: number;
        while (!finished && (end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let message: Record<string, unknown> | undefined;
          try { message = record(JSON.parse(line)); } catch { finish({ status: 'error' }); break; }
          if (!message) continue;
          // No server-initiated tools, approvals or login are authorized by a quota read.
          if (message.method) {
            if (message.id !== undefined) finish({ status: 'unsupported' });
            continue;
          }
          if (message.id !== (initialized ? 2 : 1)) continue;
          const error = record(message.error);
          if (error) {
            const text = typeof error.message === 'string' ? error.message : '';
            finish({ status: error.code === -32601 ? 'unsupported'
              : /unauth|not logged|sign.?in|log.?in|auth.*required|requires.*auth|chatgpt.*auth|401/iu.test(text)
                ? 'auth_required' : 'error' });
          } else if (!initialized) {
            if (!record(message.result)) { finish({ status: 'error' }); continue; }
            initialized = true;
            send({ method: 'initialized' });
            send({ id: 2, method: 'account/rateLimits/read' });
          } else finish(normalizeCodexQuotaRead(message.result));
        }
      });
    });
  } catch { return { status: 'unavailable' }; }
}
