/** Host-facing interaction contract. Native provider request IDs stay in the adapter. */
export const INTERACTION_KINDS = [
  'command_approval', 'file_approval', 'permission_grant', 'user_input', 'mcp_form', 'mcp_url',
] as const;
export type InteractionKind = typeof INTERACTION_KINDS[number];
export type InteractionStatus = 'pending' | 'responding' | 'resolved' | 'expired'
  | 'cancelled' | 'interrupted' | 'unsupported';

export interface InteractionHost {
  version: 1;
  kinds: InteractionKind[];
  timeoutMs: number;
}

export interface InteractionOption {
  id: string;
  label: string;
  description?: string;
}

export interface InteractionField {
  id: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'strings';
  required: boolean;
  secret?: boolean;
  options?: InteractionOption[];
  allowOther?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

export interface InteractionPrompt {
  kind: InteractionKind;
  title: string;
  message?: string;
  command?: string;
  cwd?: string;
  server?: string;
  url?: string;
  choices?: InteractionOption[];
  fields?: InteractionField[];
  /** Provider-normalized permission units. Granting one never grants another unit. */
  permissions?: InteractionOption[];
  scopes?: ('turn' | 'session')[];
}

export interface ProviderInteraction {
  interactionId: string;
  sessionId: string;
  workerGeneration: string;
  executionId: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
  status: InteractionStatus;
  prompt?: InteractionPrompt;
  /** Terminal receipts retain the kind, but discard prompt and answer contents. */
  kind: InteractionKind;
  reason?: string;
  decision?: InteractionAnswer['action'];
  providerConfirmed?: boolean;
}

export interface InteractionAnswer {
  action: 'accept' | 'decline' | 'cancel';
  choice?: string;
  values?: Record<string, string | number | boolean | string[]>;
  grants?: string[];
  scope?: 'turn' | 'session';
}

export interface InteractionResponse {
  expectedRevision: number;
  idempotencyKey: string;
  answer: InteractionAnswer;
}

export interface InteractionSnapshot {
  version: 1;
  sessionId: string;
  workerGeneration: string | null;
  revision: number;
  interactions: ProviderInteraction[];
}

export class InteractionError extends Error {
  constructor(readonly code: 'interaction_invalid' | 'interaction_conflict' | 'interaction_not_found'
    | 'interaction_limit' | 'interaction_unsupported' | 'interaction_admission_required', message: string) {
    super(message);
    this.name = 'InteractionError';
  }
}
