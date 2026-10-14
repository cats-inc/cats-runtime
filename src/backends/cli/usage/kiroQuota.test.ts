import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import { kiroQuotaProtocol, normalizeKiroQuotaRead, readKiroQuota as readConfiguredKiroQuota } from './kiroQuota.js';
import { runQuotaCli } from './quotaCli.js';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/provider-captures/kiro-2.31.0/account-usage.success.redacted.json', import.meta.url), 'utf8'));
function cli(script: string): ProviderCommandConfig {
  return { path: process.execPath, args: ['-e', script, '--'], runner: 'direct', runtime: { mode: 'native' } };
}
const read = (command: ProviderCommandConfig, signal?: AbortSignal, timeout?: number) =>
  runQuotaCli(command, 'kiro', kiroQuotaProtocol(), signal, timeout);
const protocol = (reply: string) => `
  if (JSON.stringify(process.argv.slice(1)) !== '["acp","--agent-engine","v3","--auth-method","cli"]') process.exit(9);
  const rl = require('node:readline').createInterface({ input: process.stdin });
  let phase = 0;
  const send = x => { const s = JSON.stringify(x) + '\\n'; process.stdout.write(s.slice(0,7)); process.stdout.write(s.slice(7)); };
  rl.on('line', line => {
    const m = JSON.parse(line);
    if (phase === 0 && m.method === 'initialize' && m.params.protocolVersion === 1
      && m.params.clientCapabilities.terminal === false && m.params.clientCapabilities.fs.readTextFile === false) {
      phase++; send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}});
    } else if (phase === 1 && m.method === '_kiro/account/getUsage' && JSON.stringify(m.params) === '{}') {
      phase++; ${reply}
    } else process.exit(8);
  });`;

describe('Kiro V3 quota-only ACP account read', () => {
  it('reads credits with CLI-owned auth, no session/turn, and redacts all non-quota data', async () => {
    const response = { ...fixture, token: 'PRIVATE', data: { ...fixture.data,
      accountId: 'PRIVATE', planName: 'PRIVATE', overageCharges: 99, addOnCredits: [{ token: 'PRIVATE' }] } };
    const result = await read(cli(protocol(`send({id:m.id,result:${JSON.stringify(response)}}); process.stderr.write('PRIVATE');`)));
    expect(result).toMatchObject({ status: 'updated', quota: { source: 'kiro.account.getUsage',
      'credits.unit': 'credits', 'credits.used': 0.37, 'credits.limit': 1000, 'credits.remaining': 999.63,
      'credits.resetsOn': '2099-11-01',
    } });
    expect(result.quota?.['credits.usedPercent']).toBeCloseTo(0.037);
    expect(result.quota).not.toHaveProperty('credits.resetsAt');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|planName|overage|addOn|accountId/u);
  });

  it('preserves zero, exhausted and unknown limits without using rounded percentages or inferring unlimited', () => {
    const quota = (window: Record<string, unknown>) => normalizeKiroQuotaRead({ success: true, data: {
      usageBreakdowns: [{ resourceType: 'CREDIT', ...window }],
    } });
    expect(quota({ used: 0, limit: 100, hasLimit: true })).toMatchObject({ quota: { 'credits.remaining': 100, 'credits.usedPercent': 0 } });
    expect(quota({ used: 120, limit: 100, hasLimit: true })).toMatchObject({ quota: { 'credits.used': 120, 'credits.remaining': 0, 'credits.usedPercent': 100 } });
    expect(quota({ used: 0, limit: 0, hasLimit: true })).toMatchObject({ quota: { 'credits.limit': 0, 'credits.remaining': 0 } });
    expect(quota({ used: 0, limit: 0, hasLimit: true }).quota).not.toHaveProperty('credits.usedPercent');
    for (const window of [{ used: 2, limit: 100, hasLimit: false }, { used: 2, limit: -1, hasLimit: true }, { used: 2 }]) {
      const result = quota(window);
      expect(result).toMatchObject({ status: 'updated', quota: { 'credits.used': 2 } });
      expect(result.quota).not.toHaveProperty('credits.limit');
      expect(result.quota).not.toHaveProperty('credits.remaining');
      expect(result.quota).not.toHaveProperty('credits.unlimited');
    }
    for (const used of [undefined, null, '2', -1, NaN, Infinity]) {
      expect(quota({ used, limit: 100, hasLimit: true })).toEqual({ status: 'unavailable' });
    }
  });

  it('rejects missing/duplicate/unknown resources and does not manufacture reset instants', () => {
    for (const usageBreakdowns of [undefined, [], [{ resourceType: 'TOKENS', used: 2 }], [fixture.data.usageBreakdowns[0], fixture.data.usageBreakdowns[0]]]) {
      expect(normalizeKiroQuotaRead({ success: true, data: { usageBreakdowns } })).toEqual({ status: 'unavailable' });
    }
    for (const billingCycleReset of ['2099-02-30', '2099-13-01', '2099-11-01T00:00:00Z', 'PRIVATE', null]) {
      const result = normalizeKiroQuotaRead({ ...fixture, data: { ...fixture.data, billingCycleReset } });
      expect(result.quota).not.toHaveProperty('credits.resetsOn');
      expect(result.quota).not.toHaveProperty('credits.resetsAt');
    }
    expect(normalizeKiroQuotaRead({})).toEqual({ status: 'unavailable' });
  });

  it.each([
    [{ success: false, message: 'Unable to get bearer token PRIVATE' }, 'auth_required'],
    [{ success: false, message: 'Not supported PRIVATE' }, 'unsupported'],
    [{ success: false, message: 'Upstream failed PRIVATE' }, 'error'],
  ])('sanitizes failed result %j', async (result, status) => {
    expect(await read(cli(protocol(`send({id:m.id,result:${JSON.stringify(result)}});`)))).toEqual({ status });
  });

  it('sanitizes RPC errors and refuses server-initiated credential/tool requests', async () => {
    expect(await read(cli(protocol('send({id:m.id,error:{code:-32601,message:"PRIVATE"}});')))).toEqual({ status: 'unsupported' });
    expect(await read(cli(protocol('send({id:m.id,error:{code:-32000,message:"Not logged in PRIVATE"}});')))).toEqual({ status: 'auth_required' });
    expect(await read(cli(protocol('send({id:99,method:"_kiro/auth/getAccessToken"});')))).toEqual({ status: 'unsupported' });
  });

  it('bounds malformed output and reaps timeout/cancelled processes', async () => {
    expect(await read(cli('process.stdout.write("PRIVATE\\n");'))).toEqual({ status: 'error' });
    expect(await read(cli('process.stderr.write("x".repeat(600000));'))).toEqual({ status: 'error' });
    expect(await read(cli('setInterval(() => {},1000);'), undefined, 100)).toEqual({ status: 'timeout' });
    const controller = new AbortController();
    const pending = read(cli('setInterval(() => {},1000);'), controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ status: 'error' });
  });

  it.each(['wsl', 'docker'] as const)('rejects the unverified %s transport before spawning', async mode => {
    expect(await readConfiguredKiroQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode } })).toEqual({ status: 'unsupported' });
  });
  it('rejects custom/prompt/resume arguments before spawning', async () => {
    expect(await readConfiguredKiroQuota({ path: 'must-not-spawn', args: ['chat', 'PRIVATE'], runner: 'auto', runtime: { mode: 'native' } })).toEqual({ status: 'unsupported' });
  });
});
