import { describe, expect, it } from 'vitest';
import { normalizeCopilotQuotaRead, readCopilotQuota as readConfiguredCopilotQuota, copilotQuotaProtocol } from './copilotQuota.js';
import { runQuotaCli } from './quotaCli.js';
import type { ProviderCommandConfig } from '../config.js';

function cli(script: string): ProviderCommandConfig {
  return { path: process.execPath, args: ['-e', script, '--'], runner: 'direct', runtime: { mode: 'native' } };
}
const readCopilotQuota = (command: ProviderCommandConfig, signal?: AbortSignal, timeout?: number) =>
  runQuotaCli(command, 'copilot', copilotQuotaProtocol(), signal, timeout);
const protocol = (reply: string, legacy = false) => `
  let buffer = Buffer.alloc(0); let phase = 0;
  const send = x => { const s = JSON.stringify(x); process.stdout.write('Content-Length: ' + Buffer.byteLength(s) + '\\r\\n\\r\\n' + s); };
  process.stdin.on('data', c => {
    buffer = Buffer.concat([buffer, c]);
    while (true) {
      const end = buffer.indexOf('\\r\\n\\r\\n'); if (end < 0) break;
      const length = Number(buffer.subarray(0,end).toString().split(':')[1]);
      if (buffer.length < end+4+length) break;
      const m = JSON.parse(buffer.subarray(end+4,end+4+length)); buffer = buffer.subarray(end+4+length);
      if (JSON.stringify(m.params) !== '{}') process.exit(8);
      if (phase === 0 && m.method === 'connect') {
        phase = ${legacy ? 1 : 2};
        send({ id:m.id, ${legacy ? 'error:{code:-32601,message:"Method not found"}' : 'result:{protocolVersion:4}'} });
      } else if (phase === 1 && m.method === 'ping') { phase = 2; send({id:m.id,result:{protocolVersion:3}}); }
      else if (phase === 2 && m.method === 'account.getQuota') { phase++; ${reply} }
      else process.exit(7);
    }
  });`;

describe('Copilot CLI account quota', () => {
  it('rejects configured prompt/resume/custom argv before spawning', async () => {
    for (const args of [['--prompt', 'must-not-run'], ['--resume'], ['unexpected']]) {
      expect(await readConfiguredCopilotQuota({ path: 'must-not-spawn', args, runner: 'auto', runtime: { mode: 'native' } }))
        .toEqual({ status: 'unsupported' });
    }
  });
  it.each([false, true])('reads only account quota (legacy handshake: %s) and redacts private data', async (legacy) => {
    const reply = `send({id:m.id,result:{quotaSnapshots:{premium_interactions:{
      entitlementRequests:300,usedRequests:60,remainingPercentage:80,resetDate:'2026-10-01T00:00:00Z',
      isUnlimitedEntitlement:false,token:'PRIVATE',accountId:'PRIVATE'}},token:'PRIVATE'}});
      process.stderr.write('PRIVATE');`;
    const result = await readCopilotQuota(cli(protocol(reply, legacy)));
    expect(result).toMatchObject({ status: 'updated', quota: {
      source: 'copilot.account.getQuota', 'premium_interactions.usedPercent': 20,
      'premium_interactions.used': 60, 'premium_interactions.limit': 300,
      'premium_interactions.remaining': 240, 'premium_interactions.unit': 'requests',
    } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('keeps unlimited separate from zero or 100 percent', () => {
    const result = normalizeCopilotQuotaRead({ quotaSnapshots: { chat: {
      isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 42, remainingPercentage: 100,
    } } });
    expect(result).toMatchObject({ status: 'updated', quota: { 'chat.unlimited': true, 'chat.used': 42 } });
    expect(result.quota).not.toHaveProperty('chat.usedPercent');
    expect(result.quota).not.toHaveProperty('chat.remaining');
    expect(result.quota).not.toHaveProperty('chat.limit');
  });

  it('preserves reported zero without coercing missing or invalid quantities', () => {
    for (const remainingPercentage of [null, '50', NaN, -1, 101]) {
      expect(normalizeCopilotQuotaRead({ quotaSnapshots: { premium_interactions: { remainingPercentage } } }))
        .toEqual({ status: 'unavailable' });
    }
    expect(normalizeCopilotQuotaRead({ quotaSnapshots: { premium_interactions: { remainingPercentage: 0 } } }))
      .toMatchObject({ status: 'updated', quota: { 'premium_interactions.usedPercent': 100 } });
    expect(normalizeCopilotQuotaRead({ quotaSnapshots: {} })).toEqual({ status: 'unavailable' });
  });

  it.each([
    [-32601, 'No such method PRIVATE', 'unsupported'],
    [-32000, 'Not logged in PRIVATE', 'auth_required'],
    [-32000, 'Upstream failed PRIVATE', 'error'],
  ])('sanitizes account error %s', async (code, message, status) => {
    expect(await readCopilotQuota(cli(protocol(`send({id:m.id,error:${JSON.stringify({ code, message })}});`))))
      .toEqual({ status });
  });

  it('rejects unsolicited requests without approving tools or authentication', async () => {
    expect(await readCopilotQuota(cli(protocol("send({id:99,method:'account.login',params:{token:'PRIVATE'}});"))))
      .toEqual({ status: 'unsupported' });
  });

  it('times out and cancels without leaving a process running', async () => {
    expect(await readCopilotQuota(cli('setInterval(() => {}, 1000);'), undefined, 100)).toEqual({ status: 'timeout' });
    const controller = new AbortController();
    const pending = readCopilotQuota(cli('setInterval(() => {}, 1000);'), controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ status: 'error' });
    expect(await readCopilotQuota(cli('process.exit(7)'), controller.signal)).toEqual({ status: 'error' });
  });

  it.each(['wsl', 'docker'] as const)('does not spawn an unverified %s transport', async (mode) => {
    expect(await readCopilotQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode } }))
      .toEqual({ status: 'unsupported' });
  });

  it('bounds output and rejects bad framing', async () => {
    for (const script of [
      'process.stdout.write("X".repeat(600000));',
      'process.stdout.write("Content-Length: 2\\r\\nContent-Length: 2\\r\\n\\r\\n{}");',
      'process.stdout.write("Content-Length: 8\\r\\n\\r\\nPRIVATE!");',
    ]) expect(await readCopilotQuota(cli(script))).toEqual({ status: 'error' });
  });
});
