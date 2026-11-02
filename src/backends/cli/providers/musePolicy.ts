import type { ProviderSpawnOptions } from './types.js';
import { assertExecutionPolicyAdmission, type EffectiveExecutionPolicy, type ExecutionAccess } from '../../../core/interactions/policy.js';
import { record } from '../../../core/interactions/validation.js';

export const MUSE_ADMISSIBLE_CEILINGS: Array<{ access: ExecutionAccess; network: boolean }> = [
  { access: 'full-access', network: true },
];

export function museHostedPolicy(options: ProviderSpawnOptions): {
  args: string[];
} {
  assertExecutionPolicyAdmission(options.executionPolicy, options);
  const policy = options.executionPolicy;
  if (!policy) throw new Error('Muse hosted execution requires an explicit policy admission.');
  if (policy.mode !== 'provider') throw new Error('Muse hosted tools currently inherit native permission settings; select provider configuration with full machine and network access.');
  const access = policy.constraints.maxAccess;
  const network = policy.constraints.network;
  if (!MUSE_ADMISSIBLE_CEILINGS.some(ceiling => ceiling.access === access && ceiling.network === network)) {
    throw new Error('Muse cannot enforce this access/network combination.');
  }
  return { args: [] };
}

/** Interpret native profile evidence, never equate an approval mode with a human reviewer. */
export function observeMusePolicy(options: ProviderSpawnOptions, session: Record<string, unknown>,
  sandboxAvailable: boolean): EffectiveExecutionPolicy {
  const requested = options.executionPolicy!;
  const base: EffectiveExecutionPolicy = { requested: structuredClone(requested), source: requested.mode,
    status: 'verified', coverage: 'local-process-only', configurationSources: ['native-process', 'native-session-profile'] };
  const state = record(session.permissionState);
  const axes = record(state?.axes);
  const approval = record(session.approvalMode)?.mode;
  const profiles: Record<string, ExecutionAccess> = {
    ':read-only': 'read-only', ':ask-me': 'workspace-write', ':auto-review': 'workspace-write', ':unrestricted': 'full-access',
  };
  const access = typeof state?.profileId === 'string' ? profiles[state.profileId] : undefined;
  if (!access || !axes || !['onRequest', 'promptUnmatched', 'allowAll', 'denyUnmatched'].includes(String(approval))
    || !['human', 'autoReview', 'none'].includes(String(state?.reviewerAuthority))
    || !['restricted', 'off', 'enabled'].includes(String(axes.network))
    || axes.filesystem !== (access === 'full-access' ? 'unrestricted' : 'sandboxed')
    || access !== 'full-access' && !sandboxAvailable) {
    return { ...base, reason: 'unrestricted_ceiling_native_permission_details_not_observed' };
  }
  // Muse's picker "off" is the proxy_only native network mode (1.4.14
  // isolated retained-profile probe). It is not an egress-denial guarantee.
  const network = access !== 'read-only' && axes.network !== 'restricted';
  const reviewer = approval === 'allowAll' || approval === 'denyUnmatched' ? 'none'
    : state!.reviewerAuthority === 'human' && state!.reviewerAttached === true ? 'user' : String(state!.reviewerAuthority);
  const observed = { access, network, approval: String(approval), reviewer };
  return { ...base, observed, reason: 'native_baseline_within_unrestricted_host_ceiling' };
}
