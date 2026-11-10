import type { ErrorStreamEvent, SessionInfo, StreamEvent } from '../types.js';

/**
 * ADR-006 rule 8: a provider adapter reports that the CLI cannot resume the
 * session's native session (expired, deleted, or unknown to the CLI). Runtime
 * closes that session for good and never spawns the stale native id again; the
 * caller that owns the transcript continues in a new Runtime session.
 */
export const PROVIDER_SESSION_UNAVAILABLE = 'provider_session_unavailable' as const;

export function providerSessionUnavailableEvent(
  text: string,
  raw?: unknown,
): ErrorStreamEvent {
  return {
    type: 'error',
    text,
    code: PROVIDER_SESSION_UNAVAILABLE,
    ...(raw === undefined ? {} : { raw }),
  };
}

export function isProviderSessionUnavailableEvent(
  event: StreamEvent,
): event is ErrorStreamEvent & { code: typeof PROVIDER_SESSION_UNAVAILABLE } {
  return event.type === 'error' && event.code === PROVIDER_SESSION_UNAVAILABLE;
}

const PROVIDER_SESSION_UNAVAILABLE_MESSAGE = 'The provider can no longer resume this session\'s native session. '
  + 'Create a new session; this one keeps its history but cannot run again.';

/** Thrown by the worker pool instead of spawning a session marked unavailable. */
export class ProviderSessionUnavailableError extends Error {
  readonly code = PROVIDER_SESSION_UNAVAILABLE;

  constructor() {
    super(PROVIDER_SESSION_UNAVAILABLE_MESSAGE);
    this.name = 'ProviderSessionUnavailableError';
  }
}

/** The 410 body `POST /sessions/:id/messages`, `/resume` and native `/fork` answer. */
export function providerSessionUnavailableResponse(
  session: Pick<SessionInfo, 'providerSessionUnavailable'>,
): { error: string; code: typeof PROVIDER_SESSION_UNAVAILABLE } | null {
  return session.providerSessionUnavailable ? providerSessionUnavailableBody() : null;
}

export function providerSessionUnavailableBody(): { error: string; code: typeof PROVIDER_SESSION_UNAVAILABLE } {
  return { error: PROVIDER_SESSION_UNAVAILABLE_MESSAGE, code: PROVIDER_SESSION_UNAVAILABLE };
}
