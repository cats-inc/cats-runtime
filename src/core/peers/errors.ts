import type { StreamEvent } from '../types.js';
import type {
  PeerExecutionFailure,
} from './types.js';

export class PeerExecutionError extends Error {
  constructor(readonly failure: PeerExecutionFailure) {
    super(failure.message);
    this.name = 'PeerExecutionError';
  }
}

export function createPeerExecutionError(
  failure: PeerExecutionFailure,
): PeerExecutionError {
  return new PeerExecutionError(failure);
}

export function isPeerExecutionError(
  error: unknown,
): error is PeerExecutionError {
  return error instanceof PeerExecutionError;
}

export function toPeerExecutionFailure(
  error: unknown,
  fallback: PeerExecutionFailure,
): PeerExecutionFailure {
  if (isPeerExecutionError(error)) {
    return error.failure;
  }

  if (error instanceof Error) {
    return {
      ...fallback,
      message: error.message,
    };
  }

  return {
    ...fallback,
    message: String(error),
  };
}

export function toPeerExecutionErrorEvent(
  error: unknown,
  fallback: PeerExecutionFailure,
): StreamEvent {
  const failure = toPeerExecutionFailure(error, fallback);
  return {
    type: 'error',
    text: failure.message,
    metadata: {
      peerRoutingFailure: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        ...(failure.peerId ? { peerId: failure.peerId } : {}),
        ...(failure.status !== undefined ? { status: failure.status } : {}),
        ...(failure.details ? { details: { ...failure.details } } : {}),
      },
    },
  };
}
