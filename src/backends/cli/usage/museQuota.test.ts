import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMuseQuotaWinpty, normalizeMuseQuotaRead, readMuseQuota, runMuseQuotaTui } from './museQuota.js';

const card = readFileSync(new URL('../../../../tests/fixtures/provider-captures/muse-1.4.7/usage.zero-turn.redacted.txt', import.meta.url), 'utf8');
const fake = (script: string, timeout = 2000, startup = 0, signal?: AbortSignal) => runMuseQuotaTui({ command: process.execPath, args: ['-e', script], shell: false }, signal, timeout, startup);

describe('Muse native zero-turn TUI allowance', () => {
  it('maps a live zero-turn card, preserves zero and human reset labels, and exports no identity or tokens', () => {
    const result = normalizeMuseQuotaRead(card.replace('REDACTED', 'PRIVATE'));
    expect(result).toMatchObject({ status: 'updated', quota: { source: 'muse.tui.usage',
      'current.usedPercent': 0, 'weekly.usedPercent': 0, 'current.resetLabel': 'at 7:27 AM', 'weekly.resetLabel': 'Oct 19 at 8:00 AM' } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|Input|Cached|Output|Total|Turns|tier/u);
    expect(result.quota).not.toHaveProperty('current.resetsAt');
    expect(result.quota).not.toHaveProperty('current.windowDurationMins');
    expect(normalizeMuseQuotaRead(card.replace('Current        0%', 'Current        32.5%'))).toMatchObject({ quota: { 'current.usedPercent': 32.5 } });
    expect(normalizeMuseQuotaRead(card.replace('Weekly         0%', 'Weekly         120%'))).toMatchObject({ quota: { 'weekly.usedPercent': 100 } });
  });
  it('rejects ordinary text, execution-only stats, nonzero turns, truncated and ambiguous cards', () => {
    for (const text of ['Current 0% used Weekly 0% used', card.replace('Subscription · REDACTED', 'Session only'), card.replace('Turns         0', 'Turns         1'), card.replace(/└[^\n]*/u, ''), card + card, card.replace('Weekly', 'Current')]) {
      expect(normalizeMuseQuotaRead(text)).toEqual({ status: 'unavailable' });
    }
  });
  it('sends only the fixed builtin after ready and survives fragmented UTF-8', async () => {
    const body = JSON.stringify(card);
    const result = await fake(`process.stdout.write('Muse Code 1.4.7\\n');let input='';process.stdin.on('data',c=>{input+=c.toString();if(input==='/usage\\r\\r'){const b=Buffer.from(${body});process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),5);}else if(!'/usage\\r\\r'.startsWith(input))process.exit(9);});`);
    expect(result).toMatchObject({ status: 'updated', quota: { 'current.usedPercent': 0, 'weekly.usedPercent': 0 } });
  });
  it('never sends input before a known banner; expires and cancels pending input', async () => {
    expect(await fake(`process.stdin.on('data',()=>process.stdout.write(${JSON.stringify(card)}));setInterval(()=>{},1000);`, 150)).toEqual({ status: 'timeout' });
    const controller = new AbortController();
    const pending = fake(`process.stdout.write('Muse Code 1.4.7\\n');process.stdin.on('data',()=>process.exit(9));setInterval(()=>{},1000);`, 1000, 1000, controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ status: 'error' });
    expect(await fake(`process.stdout.write('x'.repeat(600000));`)).toEqual({ status: 'error' });
  });
  it('refuses a real or unexpected model turn rather than presenting its quota as a quota-only read', async () => {
    expect(await fake(`process.stdout.write(${JSON.stringify(card.replace('Turns         0', 'Turns         1'))});setInterval(()=>{},1000);`)).toEqual({ status: 'error' });
  });
  it.runIf(process.platform === 'win32')('reaps a long-lived descendant before an EOF-exiting wrapper can disappear', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'cats-muse-reap-test-'));
    const pidFile = join(scratch, 'owned-child.pid');
    let pid: number | undefined;
    try {
      const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.stdin.on('end',()=>process.exit(0));process.stdin.resume();process.stdout.write(${JSON.stringify(card)});setInterval(()=>{},1000);`;
      expect(await fake(script)).toMatchObject({ status: 'updated' });
      pid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      // Reap only this fixture's PID even if the assertion exposes a regression.
      if (!pid) pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
      if (pid > 0) {
        if (process.platform === 'win32') spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        else { try { process.kill(pid, 'SIGKILL'); } catch {} }
      }
      await rm(scratch, { recursive: true, force: true });
    }
  });
  it('finds only an existing helper and refuses custom/remote configurations before launching', async () => {
    expect(findMuseQuotaWinpty({ ProgramFiles: 'C:/Apps', PATH: '' }, () => false)).toBeUndefined();
    expect(findMuseQuotaWinpty({ ProgramFiles: 'C:/Apps', PATH: '' }, path => path.replace(/\\/gu, '/').endsWith('/Git/usr/bin/winpty.exe'))).toBeDefined();
    for (const mode of ['wsl', 'docker'] as const) expect(await readMuseQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode } })).toEqual({ status: 'unsupported' });
    expect(await readMuseQuota({ path: 'must-not-spawn', args: ['exec', 'PRIVATE'], runner: 'auto', runtime: { mode: 'native' } })).toEqual({ status: 'unsupported' });
  });
});
