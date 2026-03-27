import type {
  ProviderBackend,
  ProgressStreamEvent,
  RuntimeGuardrailResult,
  RuntimeProgressKind,
  RuntimeProgressStatus,
  RuntimeRateLimitIncident,
} from './types.js';

interface CreateRuntimeProgressEventInput {
  text: string;
  sessionId?: string;
  providerSessionId?: string;
  provider?: string;
  backend?: ProviderBackend;
  instance?: string;
  kind: RuntimeProgressKind;
  status?: RuntimeProgressStatus;
  source?: 'runtime' | 'provider';
  native?: Record<string, unknown>;
  details?: Record<string, unknown>;
  incident?: RuntimeRateLimitIncident;
  guardrail?: RuntimeGuardrailResult;
  raw?: unknown;
}

export function createRuntimeProgressEvent(
  input: CreateRuntimeProgressEventInput,
): ProgressStreamEvent {
  return {
    type: 'progress',
    sessionId: input.sessionId,
    providerSessionId: input.providerSessionId,
    text: input.text,
    raw: input.raw,
    metadata: {
      kind: input.kind,
      ...(input.status ? { status: input.status } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.backend ? { backend: input.backend } : {}),
      ...(input.instance ? { instance: input.instance } : {}),
      ...(input.native ? { native: input.native } : {}),
      ...(input.incident ? { incident: input.incident } : {}),
      ...(input.guardrail ? { guardrail: input.guardrail } : {}),
      ...input.details,
    },
  } satisfies ProgressStreamEvent;
}
