import type { EffectiveExecutionPolicy, ExecutionAccess, SessionExecutionPolicy } from '../../../core/interactions/policy.js';

/**
 * Claude Code has no sandbox on native Windows, so it enforces no filesystem or network
 * ceiling. Only the unrestricted ceiling is admitted; a narrower one is rejected before
 * execution rather than reported as parity (SPEC-039 R8).
 */
export const CLAUDE_ADMISSIBLE_CEILINGS: Array<{ access: ExecutionAccess; network: boolean }> = [
  { access: 'full-access', network: true },
];

const CLAUDE_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan']);

export function claudeAdmitsPolicy(policy: SessionExecutionPolicy): boolean {
  const access = policy.mode === 'explicit' ? policy.access : policy.constraints.maxAccess;
  const network = policy.mode === 'explicit' ? policy.network : policy.constraints.network;
  return CLAUDE_ADMISSIBLE_CEILINGS.some(ceiling => ceiling.access === access && ceiling.network === network);
}

/** The `--permission-mode` an admitted policy launches with; provider mode keeps the user's. */
export function claudePermissionMode(policy: SessionExecutionPolicy): 'manual' | 'bypassPermissions' | undefined {
  if (policy.mode === 'provider') return undefined;
  return policy.approval === 'never' ? 'bypassPermissions' : 'manual';
}

/** Compare the mode `initialize` reports with the admitted policy. `manual` reports `default`. */
export function verifyClaudePolicy(policy: SessionExecutionPolicy, reportedMode: unknown): EffectiveExecutionPolicy {
  const base: EffectiveExecutionPolicy = { requested: structuredClone(policy), source: policy.mode,
    status: 'unsupported', coverage: 'local-process-only', configurationSources: [] };
  if (typeof reportedMode !== 'string' || !CLAUDE_PERMISSION_MODES.has(reportedMode)) {
    return { ...base, reason: 'effective_policy_not_reported_or_unsupported' };
  }
  const observed = { access: 'full-access' as const, network: true, approval: reportedMode,
    reviewer: reportedMode === 'auto' ? 'auto_classifier'
      : reportedMode === 'bypassPermissions' || reportedMode === 'dontAsk' ? 'none' : 'user' };
  const launched = claudePermissionMode(policy);
  const expected = launched === 'manual' ? 'default' : launched;
  const matches = claudeAdmitsPolicy(policy) && (expected === undefined || reportedMode === expected);
  return { ...base, observed, status: matches ? 'verified' : 'mismatch',
    ...(matches ? {} : { reason: 'effective_permission_mode_differs_from_host_admission' }) };
}
