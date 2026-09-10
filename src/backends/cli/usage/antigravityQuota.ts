import type { ProviderCommandConfig } from '../config.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';
import { runQuotaCli } from './quotaCli.js';

/** Parse the CLI's own tab-separated /usage report, never a model response. */
export function normalizeAntigravityQuotaRead(text: string, now = new Date()): QuotaCollectionResult {
  const quota: Record<string, string | number | boolean> = {
    source: 'antigravity.usage', observedAt: now.toISOString(),
  };
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(Gemini Models|Claude and GPT models)\t(Weekly|Five Hour) Limit Remaining\t(\d+(?:\.\d+)?)%\t(\S+)\s*$/u.exec(line);
    if (!match) continue;
    const remaining = Number(match[3]);
    const reset = Date.parse(match[4]!);
    if (remaining > 100 || !Number.isFinite(reset)) continue;
    const weekly = match[2] === 'Weekly';
    const id = `${match[1] === 'Gemini Models' ? 'gemini_models' : 'claude_gpt_models'}_${weekly ? 'weekly' : 'five_hour'}`;
    if (seen.has(id)) return { status: 'unavailable' };
    seen.add(id);
    quota[`${id}.usedPercent`] = 100 - remaining;
    quota[`${id}.windowDurationMins`] = weekly ? 10080 : 300;
    quota[`${id}.resetsAt`] = new Date(reset).toISOString();
  }
  return seen.size ? { status: 'updated', quota } : { status: 'unavailable' };
}

export function readAntigravityQuota(
  command: ProviderCommandConfig, signal?: AbortSignal, timeoutMs = 8_000,
): Promise<QuotaCollectionResult> {
  // --disable-slash-commands or injected prompt/stream/resume flags could turn
  // /usage into a model turn. Custom argv is not a verified quota-only contract.
  if (command.args?.length) return Promise.resolve({ status: 'unsupported' });
  return runQuotaCli(command, 'antigravity', {
    args: ['--print', '/usage', '--output-format', 'text', '--print-timeout', '8s'],
    framing: 'text',
    complete: (stdout, code, stderr) => {
      if (code !== 0) return { status: /auth|not logged|sign.?in|log.?in/iu.test(stderr)
        ? 'auth_required' : /unknown flag|not supported|unrecognized/iu.test(stderr) ? 'unsupported' : 'error' };
      return normalizeAntigravityQuotaRead(stdout);
    },
  }, signal, timeoutMs);
}
