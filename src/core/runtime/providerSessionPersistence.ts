import type { ProviderSessionPersistence, ProviderSpawnOptions, SessionInfo } from '../types.js';

export function parseProviderSessionPersistence(value: unknown): ProviderSessionPersistence {
  if (value === undefined || value === 'persistent') return 'persistent';
  if (value === 'ephemeral') return value;
  throw new Error('providerSessionPersistence must be persistent or ephemeral.');
}

export function parseSessionLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || [...value].length > 160
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('sessionLabel must be nonempty plain text of at most 160 characters.');
  }
  return value.trim();
}

export class ProviderSessionNotResumableError extends Error {
  readonly code = 'provider_session_not_resumable';

  constructor() {
    super('Ephemeral provider sessions cannot be resumed, forked or restarted. Create a new job.');
    this.name = 'ProviderSessionNotResumableError';
  }
}

export function ephemeralSessionResponse(): { error: string; code: string } {
  const error = new ProviderSessionNotResumableError();
  return { error: error.message, code: error.code };
}

/** Every CLI spawn uses the registry's immutable policy, including internal recycle/wake paths. */
export function providerSessionSpawnOptions(
  session: SessionInfo | undefined,
  opts: ProviderSpawnOptions,
): ProviderSpawnOptions {
  const persistence = session?.providerSessionPersistence ?? opts.providerSessionPersistence ?? 'persistent';
  if (session && opts.providerSessionPersistence !== undefined
    && opts.providerSessionPersistence !== (session.providerSessionPersistence ?? 'persistent')) {
    throw new Error('providerSessionPersistence cannot change after creation.');
  }
  if (persistence === 'ephemeral' && (opts.resumeSessionId || opts.forkSession
    || session && (session.status !== 'initializing' || session.providerSessionId))) {
    throw new ProviderSessionNotResumableError();
  }
  return { ...opts, ...(persistence === 'ephemeral' ? { providerSessionPersistence: persistence } : {}),
    ...(session?.sessionLabel ? { sessionLabel: session.sessionLabel } : {}) };
}
