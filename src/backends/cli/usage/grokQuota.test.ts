import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grokQuotaProtocol, normalizeGrokQuotaRead, readGrokQuota } from './grokQuota.js';
import { runQuotaCli } from './quotaCli.js';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/provider-captures/grok-1.0.52/billing.missing-allowance.redacted.json', import.meta.url), 'utf8'));
const rpc = (reply: string) => `
 if (JSON.stringify(process.argv.slice(1)) !== '["agent","stdio"]') process.exit(9);
 let phase=0;
 const rl=require('node:readline').createInterface({input:process.stdin});
 const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
 rl.on('line',line=>{
  const m=JSON.parse(line);
  if(phase===0&&m.method==='initialize'&&m.params.protocolVersion===1&&m.params.clientCapabilities.terminal===false){phase=1;send({id:m.id,result:{protocolVersion:1}});}
  else if(phase===1&&m.method==='_x.ai/billing'&&JSON.stringify(m.params)==='{}'){phase=2;${reply}}
  else process.exit(8);
 });`;
const read = (script: string) => runQuotaCli({ path: process.execPath, args: ['-e', script, '--'], runner: 'direct', runtime: { mode: 'native' } }, 'grok', grokQuotaProtocol());

describe('Grok CLI-only billing read', () => {
  it('only initializes and reads billing; emits included percentage and redacts billing/identity fields', async () => {
    const result = await read(rpc(`send({id:m.id,result:{config:{creditUsagePercent:42.5,currentPeriod:{type:'USAGE_PERIOD_TYPE_WEEKLY',end:'2099-10-19T08:00:00Z'},prepaidBalance:{val:999},onDemandUsed:{val:999},userId:'PRIVATE'},token:'PRIVATE'}});`));
    expect(result).toMatchObject({ status: 'updated', quota: { source: 'grok.billing', 'weekly.usedPercent': 42.5, 'weekly.resetsAt': '2099-10-19T08:00:00.000Z' } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|prepaid|onDemand|userId|token/u);
  });
  it('keeps the live missing-allowance response unknown; money and a reset are not subscription usage', () => {
    expect(normalizeGrokQuotaRead(fixture)).toEqual({ status: 'unavailable' });
    expect(normalizeGrokQuotaRead({ config: { ...fixture.config, prepaidBalance: { val: 100 }, onDemandCap: { val: 100 }, onDemandUsed: {} } })).toEqual({ status: 'unavailable' });
    expect(normalizeGrokQuotaRead({ config: { monthlyLimit: { val: 100 } } })).toEqual({ status: 'unavailable' });
    expect(normalizeGrokQuotaRead({ config: { monthlyLimit: {}, used: {} } })).toEqual({ status: 'unavailable' });
  });
  it('preserves explicit zero and Cent default zero, prefers the explicit percentage, and bounds exhaustion', () => {
    expect(normalizeGrokQuotaRead({ config: { creditUsagePercent: 0 } })).toMatchObject({ quota: { 'included.usedPercent': 0 } });
    expect(normalizeGrokQuotaRead({ config: { monthlyLimit: { val: 100 }, used: {} } })).toMatchObject({ quota: { 'monthly.usedPercent': 0 } });
    expect(normalizeGrokQuotaRead({ config: { creditUsagePercent: 12.5, monthlyLimit: { val: 100 }, used: { val: 90 } } })).toMatchObject({ quota: { 'included.usedPercent': 12.5 } });
    expect(normalizeGrokQuotaRead({ config: { creditUsagePercent: 120 } })).toMatchObject({ quota: { 'included.usedPercent': 100 } });
    for (const creditUsagePercent of [null, '0', -1, NaN, Infinity]) expect(normalizeGrokQuotaRead({ config: { creditUsagePercent } })).toEqual({ status: 'unavailable' });
  });
  it('sanitizes auth/unsupported errors and refuses server-initiated credential or tool requests', async () => {
    expect(await read(rpc(`send({id:m.id,error:{code:-32000,message:'Authentication required PRIVATE'}});`))).toEqual({ status: 'auth_required' });
    expect(await read(rpc(`send({id:m.id,error:{code:-32601,message:'PRIVATE'}});`))).toEqual({ status: 'unsupported' });
    expect(await read(rpc(`send({id:99,method:'authenticate',params:{token:'PRIVATE'}});`))).toEqual({ status: 'unsupported' });
  });
  it('refuses remote transports and custom argv before launching', async () => {
    for (const mode of ['wsl', 'docker'] as const) expect(await readGrokQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode } })).toEqual({ status: 'unsupported' });
    expect(await readGrokQuota({ path: 'must-not-spawn', args: ['-p', 'PRIVATE'], runner: 'auto', runtime: { mode: 'native' } })).toEqual({ status: 'unsupported' });
  });
});
