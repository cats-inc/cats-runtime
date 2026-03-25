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
  sharedSecret: string | readonly string[] | undefined,
  payload: string,
  signature: string | undefined,
): boolean {
  const secrets = normalizeSharedSecrets(sharedSecret);
  if (secrets.length === 0 || typeof signature !== 'string') {
    return false;
  }

  const normalizedSignature = normalizePeerPayloadSignature(signature);
  if (!normalizedSignature) {
    return false;
  }

  const actualSignature = Buffer.from(normalizedSignature, 'hex');
  for (const secret of secrets) {
    const expectedSignature = Buffer.from(
      createPeerPayloadSignature(secret, payload).slice(`${PEER_SIGNATURE_ALGORITHM}=`.length),
      'hex',
    );

    if (actualSignature.length !== expectedSignature.length) {
      continue;
    }

    if (timingSafeEqual(actualSignature, expectedSignature)) {
      return true;
    }
  }

  return false;
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

function normalizeSharedSecrets(
  value: string | readonly string[] | undefined,
): string[] {
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((secret): secret is string => typeof secret === 'string' && secret.length > 0);
}
