import { describe, expect, it } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import { normalizeClaudeQuotaRead, readClaudeQuota as readConfiguredClaudeQuota, claudeQuotaProtocol } from './claudeQuota.js';
import { runQuotaCli } from './quotaCli.js';

function cli(script: string): ProviderCommandConfig {
  return { path: process.execPath, args: ['-e', script, '--'], runner: 'direct', runtime: { mode: 'native' } };
}
const readClaudeQuota = (command: ProviderCommandConfig, signal?: AbortSignal, timeout?: number) =>
  runQuotaCli(command, 'claude', claudeQuotaProtocol(), signal, timeout);
const protocol = (reply: string) => `
  let buffer = ''; let phase = 0;
  const send = x => process.stdout.write(JSON.stringify(x) + '\\n');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\\n')) {
      const end = buffer.indexOf('\\n'); const m = JSON.parse(buffer.slice(0,end)); buffer = buffer.slice(end+1);
      if (m.type !== 'control_request') process.exit(7);
      if (phase === 0 && m.request.subtype === 'initialize') {
        phase++; send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{}}});
      } else if (phase === 1 && JSON.stringify(m.request) === '{"subtype":"get_usage","skip_behaviors":true}') {
        phase++; ${reply}
      } else process.exit(8);
    }
  });`;

describe('Claude CLI get_usage account quota', () => {
  it('rejects configured prompt/resume/custom argv before spawning', async () => {
    for (const args of [['--print', 'must-not-run'], ['--continue'], ['unexpected']]) {
      expect(await readConfiguredClaudeQuota({ path: 'must-not-spawn', args, runner: 'auto', runtime: { mode: 'native' } }))
        .toEqual({ status: 'unsupported' });
    }
  });
  it('uses only initialize/get_usage controls and excludes private/session data', async () => {
    const result = await readClaudeQuota(cli(protocol(`
      send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{
        rate_limits_available:true,rate_limits:{five_hour:{utilization:0,resets_at:null},
          seven_day:{utilization:6,resets_at:'2026-09-15T21:00:00Z'}},
        session:{total_cost_usd:99,model_usage:{PRIVATE:1}},behaviors:{PRIVATE:1},token:'PRIVATE'
      }}}); process.stderr.write('PRIVATE');`)));
    expect(result).toMatchObject({ status: 'updated', quota: { source: 'claude.get_usage',
      'five_hour.usedPercent': 0, 'seven_day.usedPercent': 6, 'seven_day.windowDurationMins': 10080,
      'seven_day.resetsAt': '2026-09-15T21:00:00.000Z',
    } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|total_cost|model_usage|behaviors/u);
  });

  it('does not confuse 0–100 usage with passive fractions or invent missing values', () => {
    expect(normalizeClaudeQuotaRead({ rate_limits: { five_hour: { utilization: 0.5 } } }))
      .toMatchObject({ status: 'updated', quota: { 'five_hour.usedPercent': 0.5 } });
    for (const utilization of [null, '6', -1, 101, NaN]) {
      expect(normalizeClaudeQuotaRead({ rate_limits: { seven_day: { utilization } } }))
        .toEqual({ status: 'unavailable' });
    }
    expect(normalizeClaudeQuotaRead({ rate_limits_available: false, rate_limits: null }))
      .toEqual({ status: 'unsupported' });
    expect(normalizeClaudeQuotaRead({ rate_limits_available: true, rate_limits: null }))
      .toEqual({ status: 'unavailable' });
  });

  it.each([
    ['Unknown control request get_usage PRIVATE', 'unsupported'],
    ['Not logged in PRIVATE', 'auth_required'],
    ['Upstream unavailable PRIVATE', 'error'],
  ])('sanitizes CLI failure %s', async (error, status) => {
    expect(await readClaudeQuota(cli(protocol(`send({type:'control_response',response:{
      subtype:'error',request_id:m.request_id,error:${JSON.stringify(error)}}});`))))
      .toEqual({ status });
  });

  it.each(['control_request', 'assistant', 'result'])('never approves or consumes model event %s', async (type) => {
    expect(await readClaudeQuota(cli(protocol(`send({type:${JSON.stringify(type)}});`))))
      .toEqual({ status: type === 'control_request' ? 'unsupported' : 'error' });
  });

  it('bounds malformed output and reaps timed-out or cancelled children', async () => {
    expect(await readClaudeQuota(cli('process.stdout.write("PRIVATE\\n");'))).toEqual({ status: 'error' });
    expect(await readClaudeQuota(cli('process.stderr.write("x".repeat(600000));'))).toEqual({ status: 'error' });
    expect(await readClaudeQuota(cli('setInterval(() => {}, 1000);'), undefined, 100)).toEqual({ status: 'timeout' });
    const controller = new AbortController();
    const pending = readClaudeQuota(cli('setInterval(() => {}, 1000);'), controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ status: 'error' });
  });

  it.each(['wsl', 'docker'] as const)('does not spawn an unverified %s transport', async (mode) => {
    expect(await readClaudeQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode } }))
      .toEqual({ status: 'unsupported' });
  });
});
