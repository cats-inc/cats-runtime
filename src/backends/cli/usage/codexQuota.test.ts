import { describe, expect, it } from 'vitest';
import { readCodexQuota, normalizeCodexQuotaRead } from './codexQuota.js';
import type { ProviderCommandConfig } from '../config.js';

function cli(script: string): ProviderCommandConfig {
  return { path: process.execPath, args: ['-e', script, '--'], runner: 'direct', runtime: { mode: 'native' } };
}
const protocol = (reply: string) => `
  const rl = require('node:readline').createInterface({ input: process.stdin });
  let phase = 0;
  const send = x => process.stdout.write(JSON.stringify(x) + '\\n');
  rl.on('line', line => {
    const m = JSON.parse(line);
    if (phase === 0 && m.method === 'initialize') { phase++; send({ id: m.id, result: {} }); }
    else if (phase === 1 && m.method === 'initialized') phase++;
    else if (phase === 2 && m.method === 'account/rateLimits/read') { phase++; ${reply} }
    else process.exit(7);
  });`;

describe('Codex CLI quota-only stdio client', () => {
  it.each(['wsl', 'docker'] as const)('does not spawn an unverified %s stdio transport', async (mode) => {
    expect(await readCodexQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode } }))
      .toEqual({ status: 'unsupported' });
  });
  it('waits for initialize, reads without a thread/turn, retains actual windows, discards private fields', async () => {
    const result = await readCodexQuota(cli(protocol(`send({ id: m.id, result: {
      rateLimits: { limitId: 'other', primary: { usedPercent: 99 } },
      rateLimitsByLimitId: { codex: { limitId: 'codex', accountId: 'PRIVATE',
        primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1800000000 },
        secondary: { usedPercent: 0, windowDurationMins: 300 } } }, token: 'PRIVATE'
    } }); process.stderr.write('PRIVATE');`)));
    expect(result).toMatchObject({ status: 'updated', quota: {
      source: 'codex.account/rateLimits/read', limitId: 'codex',
      'primary.usedPercent': 10, 'primary.windowDurationMins': 10080, 'secondary.usedPercent': 0,
    } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([
    [-32601, 'Method not found PRIVATE', 'unsupported'],
    [-32000, 'Not logged in PRIVATE', 'auth_required'],
    [-32000, 'Upstream failed PRIVATE', 'error'],
  ])('sanitizes RPC error %s', async (code, message, status) => {
    const response = await readCodexQuota(cli(protocol(`send({id:m.id,error:${JSON.stringify({ code, message })}});`)));
    expect(response).toEqual({ status });
  });

  it('fails closed on unsolicited server requests', async () => {
    expect(await readCodexQuota(cli(protocol(`send({ id: 99, method: 'item/commandExecution/requestApproval' });`))))
      .toEqual({ status: 'unsupported' });
  });

  it('times out and reaps a CLI that ignores stdin EOF', async () => {
    expect(await readCodexQuota(cli('setInterval(() => {}, 1000);'), undefined, 100))
      .toEqual({ status: 'timeout' });
  });

  it('cancels and reaps a CLI and skips an already cancelled request', async () => {
    const controller = new AbortController();
    const pending = readCodexQuota(cli('setInterval(() => {}, 1000);'), controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ status: 'error' });
    expect(await readCodexQuota(cli('process.exit(7)'), controller.signal)).toEqual({ status: 'error' });
  });

  it('bounds output and never returns malformed data or stderr', async () => {
    expect(await readCodexQuota(cli('process.stdout.write("X".repeat(600000));'))).toEqual({ status: 'error' });
    expect(await readCodexQuota(cli('process.stdout.write("PRIVATE\\n");'))).toEqual({ status: 'error' });
  });

  it('keeps invalid/missing numbers unknown rather than inventing zero', () => {
    for (const usedPercent of [-1, 101, NaN, null, '10']) {
      expect(normalizeCodexQuotaRead({ rateLimits: { primary: { usedPercent } } })).toEqual({ status: 'unavailable' });
    }
    expect(normalizeCodexQuotaRead({ rateLimits: { primary: { usedPercent: 0, resetsAt: 1e100 } } }))
      .toMatchObject({ status: 'updated', quota: { 'primary.usedPercent': 0 } });
  });
});
