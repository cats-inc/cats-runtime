import { describe, expect, it } from 'vitest';
import { normalizeAntigravityQuotaRead, readAntigravityQuota } from './antigravityQuota.js';
import { runQuotaCli } from './quotaCli.js';

const report = 'Gemini Models\tWeekly Limit Remaining\t78%\t2026-09-12T09:30:56Z\n'
  + 'Gemini Models\tFive Hour Limit Remaining\t11%\t2026-09-10T19:56:48Z\n'
  + 'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-17T19:54:38Z\n'
  + 'Claude and GPT models\tFive Hour Limit Remaining\t0%\t2026-09-11T00:54:38Z\n';

describe('Antigravity CLI built-in /usage report', () => {
  it('preserves each model bucket, actual reset and zero; excludes unrelated output', () => {
    const result = normalizeAntigravityQuotaRead(`Account: PRIVATE\n${report}`, new Date('2026-09-11T00:00:00Z'));
    expect(result).toMatchObject({ status: 'updated', quota: {
      source: 'antigravity.usage', 'gemini_models_weekly.usedPercent': 22,
      'gemini_models_five_hour.usedPercent': 89, 'gemini_models_five_hour.windowDurationMins': 300,
      'gemini_models_five_hour.resetsAt': '2026-09-10T19:56:48.000Z',
      'claude_gpt_models_weekly.usedPercent': 0, 'claude_gpt_models_five_hour.usedPercent': 100,
    } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('does not accept freeform model prose, guessed numbers, or duplicate buckets', () => {
    for (const input of ['You have 90% left.', '', report.replace(/\d+%/gu, '101%'),
      report.replace(/\t\d+%/gu, '\t—'), report.replace(/2026-\S+/gu, 'unknown'), report + report]) {
      expect(normalizeAntigravityQuotaRead(input)).toEqual({ status: 'unavailable' });
    }
  });

  it('rejects custom argv that could disable built-in slash commands without spawning', async () => {
    for (const args of [['--disable-slash-commands'], ['--input-format', 'stream-json'], ['--continue'], ['unexpected prompt']]) {
      expect(await readAntigravityQuota({ path: 'must-not-spawn', args, runner: 'auto', runtime: { mode: 'native' } }))
        .toEqual({ status: 'unsupported' });
    }
    expect(await readAntigravityQuota({ path: 'must-not-spawn', runner: 'auto', runtime: { mode: 'wsl' } }))
      .toEqual({ status: 'unsupported' });
  });

  it('bounded text transport buffers fragmented UTF-8, drains stderr, waits for exit, and reaps timeouts', async () => {
    const run = (script: string, timeout = 8000) => runQuotaCli({ path: process.execPath, args: ['-e', script, '--'],
      runner: 'direct', runtime: { mode: 'native' } }, 'antigravity', {
      args: [], framing: 'text', complete: (stdout, code) => code === 0
        ? normalizeAntigravityQuotaRead(stdout) : { status: 'error' },
    }, undefined, timeout);
    const result = await run(`const b=Buffer.from(${JSON.stringify(`PRIVATE 中文\n${report}`)});
      for(const byte of b) process.stdout.write(Buffer.from([byte])); process.stderr.write('PRIVATE');`);
    expect(result.status).toBe('updated'); expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(await run(`process.stdout.write(${JSON.stringify(report)});process.exitCode=1;`)).toEqual({ status: 'error' });
    expect(await run('process.stdout.write("x".repeat(600000));')).toEqual({ status: 'error' });
    expect(await run('setInterval(()=>{},1000);', 100)).toEqual({ status: 'timeout' });
  });
});
