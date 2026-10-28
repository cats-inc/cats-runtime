import { InteractionError, type InteractionHost } from './types.js';
import { record } from './validation.js';

export const EXECUTION_ACCESS = ['read-only', 'workspace-write', 'full-access'] as const;
export type ExecutionAccess = typeof EXECUTION_ACCESS[number];
export type ExecutionApproval = 'never' | 'untrusted' | 'on-request';
export type SessionExecutionPolicy = { version: 1; mode: 'provider';
  constraints: { maxAccess: ExecutionAccess; network: boolean } }
  | { version: 1; mode: 'explicit'; access: ExecutionAccess; network: boolean; approval: ExecutionApproval };

export interface EffectiveExecutionPolicy {
  requested?: SessionExecutionPolicy;
  source: 'legacy' | 'provider' | 'explicit';
  status: 'not_observed' | 'verified' | 'mismatch' | 'unsupported';
  observed?: { access: ExecutionAccess; network: boolean; approval: string; reviewer: string };
  coverage: 'local-process-only';
  reason?: string;
  configurationSources: string[];
}

export function parseExecutionPolicy(value: unknown): SessionExecutionPolicy | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  const invalid = (): never => { throw new InteractionError('interaction_invalid', 'Invalid execution policy.'); };
  if (!input || input.version !== 1) return invalid();
  if (input.mode === 'provider') {
    const constraints = record(input.constraints);
    if (Object.keys(input).some(key => !['version', 'mode', 'constraints'].includes(key)) || !constraints
      || Object.keys(constraints).some(key => !['maxAccess', 'network'].includes(key))
      || !EXECUTION_ACCESS.includes(constraints.maxAccess as ExecutionAccess) || typeof constraints.network !== 'boolean') return invalid();
    return { version: 1, mode: 'provider', constraints: { maxAccess: constraints.maxAccess as ExecutionAccess, network: constraints.network } };
  }
  if (input.mode !== 'explicit' || Object.keys(input).some(key => !['version', 'mode', 'access', 'network', 'approval'].includes(key))
    || !EXECUTION_ACCESS.includes(input.access as ExecutionAccess) || typeof input.network !== 'boolean'
    || typeof input.approval !== 'string' || !['never', 'untrusted', 'on-request'].includes(input.approval)
    // Current native protocol can express these combinations without named profiles.
    || input.access === 'read-only' && input.network || input.access === 'full-access' && !input.network) return invalid();
  return { version: 1, mode: 'explicit', access: input.access as ExecutionAccess,
    network: input.network, approval: input.approval as ExecutionApproval };
}

export function assertExecutionPolicyAdmission(policy: SessionExecutionPolicy | undefined, options: {
  interactionHost?: InteractionHost; workspaceMode?: string; permissionMode?: string; allowedTools?: string[];
}): void {
  if (!policy) return;
  if (!options.interactionHost || options.permissionMode === 'whitelist' || options.allowedTools?.length) {
    throw new InteractionError('interaction_unsupported', 'Execution policy requires an interaction host and cannot override tool allowlists.');
  }
  const access = policy.mode === 'explicit' ? policy.access : policy.constraints.maxAccess;
  if (options.workspaceMode === 'read_only' && access !== 'read-only') {
    throw new InteractionError('interaction_unsupported', 'Execution policy exceeds the host read-only workspace boundary.');
  }
}
