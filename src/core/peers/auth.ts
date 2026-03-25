import { createHmac, timingSafeEqual } from 'node:crypto';

const PEER_SIGNATURE_ALGORITHM = 'sha256';
const PEER_SIGNATURE_HEX_LENGTH = 64;

export function createPeerPayloadSignature(
  sharedSecret: string,
  payload: string,
): string {
  const digest = createHmac(PEER_SIGNATURE_ALGORITHM, sharedSecret)
    .update(payload)
    .digest('hex');
  return `${PEER_SIGNATURE_ALGORITHM}=${digest}`;
}

export function validatePeerPayloadSignature(
  sharedSecret: string | undefined,
  payload: string,
  signature: string | undefined,
): boolean {
  if (!sharedSecret || typeof signature !== 'string') {
    return false;
  }

  const normalizedSignature = normalizePeerPayloadSignature(signature);
  if (!normalizedSignature) {
    return false;
  }

  const expectedSignature = Buffer.from(
    createPeerPayloadSignature(sharedSecret, payload).slice(`${PEER_SIGNATURE_ALGORITHM}=`.length),
    'hex',
  );
  const actualSignature = Buffer.from(normalizedSignature, 'hex');

  if (actualSignature.length !== expectedSignature.length) {
    return false;
  }

  return timingSafeEqual(actualSignature, expectedSignature);
}

function normalizePeerPayloadSignature(
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const prefixed = `${PEER_SIGNATURE_ALGORITHM}=`;
  if (!trimmed.startsWith(prefixed)) {
    return undefined;
  }

  const digest = trimmed.slice(prefixed.length);

  return isHexDigest(digest) ? digest.toLowerCase() : undefined;
}

function isHexDigest(
  value: string,
): boolean {
  return value.length === PEER_SIGNATURE_HEX_LENGTH
    && /^[a-fA-F0-9]+$/.test(value);
}
