import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderCommandConfig } from '../config.js';
import { buildProcessSpawnConfig, type ProcessSpawnConfig } from '../runtime/runtime.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';

const TUI_ARGS = ['--no-session-log', '--disable-write', '--disable-shell', '--trust-workspace'];

/** Only a complete native Subscription card in a fresh, zero-turn CLI may establish quota. */
export function normalizeMuseQuotaRead(text: string, now = new Date()): QuotaCollectionResult {
  const cards = [...text.matchAll(/┌[^\r\n]*┐([\s\S]*?)└[^\r\n]*┘/gu)]
    .map(match => match[1]!).filter(card => /\bSession usage\b/u.test(card) && /\bSubscription\s*·/u.test(card));
  if (cards.length !== 1) return { status: 'unavailable' };
  const card = cards[0]!;
  const turns = [...card.matchAll(/\bTurns\s+(\d+)\b/gu)];
  if (turns.length !== 1 || turns[0]![1] !== '0') return { status: 'unavailable' };
  const quota: Record<string, string | number | boolean> = { source: 'muse.tui.usage', observedAt: now.toISOString() };
  const rows = [...card.matchAll(/(?:^|\n)\s*│\s*(Current|Weekly)\s+(\d+(?:\.\d+)?)% used(?:\s*·\s*Resets ([^\r\n│]*))?\s*│/gu)];
  if (rows.length !== 2 || new Set(rows.map(row => row[1])).size !== 2) return { status: 'unavailable' };
  for (const row of rows) {
    const used = Number(row[2]);
    if (!Number.isFinite(used) || used < 0) return { status: 'unavailable' };
    const id = row[1] === 'Current' ? 'current' : 'weekly';
    quota[`${id}.usedPercent`] = Math.min(100, used);
    const label = row[3]?.trim();
    if (label && label.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(label)) quota[`${id}.resetLabel`] = label;
  }
  // TUI local-clock labels do not establish a date/timezone, or an exact window duration.
  return { status: 'updated', quota };
}

/** Find only an already-installed helper. This never installs software or reads account files. */
export function findMuseQuotaWinpty(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string | undefined {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter((root): root is string => Boolean(root));
  const candidates = [
    ...roots.map(root => join(root, 'Git', 'usr', 'bin', 'winpty.exe')),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'Git', 'usr', 'bin', 'winpty.exe')] : []),
    ...(env.PATH ?? '').split(';').filter(Boolean).flatMap(dir => [join(dir, 'winpty.exe'), join(dir, '..', 'usr', 'bin', 'winpty.exe')]),
  ];
  return candidates.find(exists);
}

/** Windows native only. MSP usage/read is host-local and empty in a fresh quota-only process. */
export async function readMuseQuota(command: ProviderCommandConfig, signal?: AbortSignal, timeoutMs = 8_000): Promise<QuotaCollectionResult> {
  if (command.args?.length || command.runtime.mode !== 'native' || process.platform !== 'win32') return { status: 'unsupported' };
  if (signal?.aborted) return { status: 'error' };
  const helper = findMuseQuotaWinpty();
  if (!helper) return { status: 'unsupported' };
  const scratch = await mkdtemp(join(tmpdir(), 'cats-muse-quota-'));
  try {
    const cli = buildProcessSpawnConfig(command, 'muse', TUI_ARGS, scratch);
    if (cli.shell || cli.windowsVerbatimArguments) return { status: 'unsupported' };
    return await runMuseQuotaTui({ ...cli, command: helper,
      args: ['-Xallow-non-tty', '-Xplain', cli.command, ...cli.args], cwd: scratch, shell: false }, signal, timeoutMs);
  } catch { return { status: 'unavailable' }; }
  finally { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {}); }
}

/** Fixed builtin input, bounded output/time, and cleanup of this owned helper/CLI tree. */
export async function runMuseQuotaTui(config: ProcessSpawnConfig, signal?: AbortSignal, timeoutMs = 8_000, startupWaitMs = 3_000): Promise<QuotaCollectionResult> {
  if (signal?.aborted) return { status: 'error' };
  return new Promise(resolve => {
    const child = spawn(config.command, config.args, { cwd: config.cwd, env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    let text = '', bytes = 0, sent = false, result: QuotaCollectionResult | undefined;
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let killerDone: Promise<void> = Promise.resolve();
    const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    const abort = () => finish({ status: 'error' });
    function finish(value: QuotaCollectionResult) {
      if (result) return;
      result = value;
      clearTimeout(timer); clearTimeout(inputTimer); signal?.removeEventListener('abort', abort);
      // Kill before EOF can make the wrapper exit and orphan the console agent.
      if (child.pid && process.platform === 'win32') killerDone = new Promise(done => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        const reap = setTimeout(() => { child.kill(); killer.kill(); }, 1000);
        killer.on('error', () => { child.kill(); });
        killer.on('exit', code => { if (code !== 0) child.kill(); });
        killer.on('close', () => { clearTimeout(reap); done(); });
      });
      else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      // On Windows taskkill must still see the live wrapper to discover its tree.
      // Keep stdin open: taskkill closes the pipes when it reaps the processes.
      if (process.platform !== 'win32') child.stdin.end();
    }
    function read(chunk: string) {
      if (result) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 512 * 1024) { finish({ status: 'error' }); return; }
      text += chunk;
      if (!sent && /\bMuse Code\b/u.test(text)) {
        sent = true;
        inputTimer = setTimeout(() => {
          if (result) return;
          child.stdin.write('/usage\r');
          inputTimer = setTimeout(() => { if (!result) child.stdin.write('\r'); }, 300);
        }, startupWaitMs);
      }
      const quota = normalizeMuseQuotaRead(text);
      if (quota.status === 'updated') finish(quota);
      else if (/└[^\r\n]*┘/u.test(text) && /\bSession usage\b/u.test(text) && /\bTurns\s+[1-9]/u.test(text)) finish({ status: 'error' });
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', read);
    child.stderr.on('data', chunk => {
      if (result) return;
      bytes += chunk.length; // Drain privately; stderr is never parsed as a quota card.
      if (bytes > 512 * 1024) finish({ status: 'error' });
    });
    child.stdin.on('error', () => finish({ status: 'error' }));
    child.on('error', () => finish({ status: 'unavailable' }));
    child.on('close', () => {
      clearTimeout(timer); clearTimeout(inputTimer); signal?.removeEventListener('abort', abort);
      void killerDone.then(() => resolve(result ?? { status: 'unavailable' }));
    });
  });
}
