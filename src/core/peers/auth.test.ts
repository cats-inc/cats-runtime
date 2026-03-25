import { describe, expect, it } from 'vitest';
import {
  createPeerPayloadSignature,
  validatePeerPayloadSignature,
} from './auth.js';

describe('peer auth helpers', () => {
  it('creates and validates HMAC payload signatures', () => {
    const payload = '{"turn":{"message":"hello"}}';
    const signature = createPeerPayloadSignature('lan-secret', payload);

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(validatePeerPayloadSignature('lan-secret', payload, signature)).toBe(true);
  });

  it('accepts raw hex signatures and rejects tampered payloads', () => {
    const payload = '{"turn":{"message":"hello"}}';
    const signature = createPeerPayloadSignature('lan-secret', payload);
    const rawDigest = signature.slice('sha256='.length);

    expect(validatePeerPayloadSignature('lan-secret', payload, rawDigest)).toBe(true);
    expect(validatePeerPayloadSignature('lan-secret', '{"turn":{"message":"bye"}}', signature))
      .toBe(false);
  });
});
