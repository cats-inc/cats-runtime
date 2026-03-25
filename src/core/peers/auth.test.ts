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

  it('requires the algorithm prefix and rejects tampered payloads', () => {
    const payload = '{"turn":{"message":"hello"}}';
    const signature = createPeerPayloadSignature('lan-secret', payload);
    const rawDigest = signature.slice('sha256='.length);

    expect(validatePeerPayloadSignature('lan-secret', payload, rawDigest)).toBe(false);
    expect(validatePeerPayloadSignature('lan-secret', '{"turn":{"message":"bye"}}', signature))
      .toBe(false);
  });

  it('binds timestamp and nonce headers into the signed payload when provided', () => {
    const payload = '{"turn":{"message":"hello"}}';
    const context = {
      timestamp: '1763510400000',
      nonce: 'nonce-1',
    };
    const signature = createPeerPayloadSignature('lan-secret', payload, context);

    expect(validatePeerPayloadSignature('lan-secret', payload, signature, context)).toBe(true);
    expect(validatePeerPayloadSignature('lan-secret', payload, signature, {
      timestamp: context.timestamp,
      nonce: 'nonce-2',
    })).toBe(false);
    expect(validatePeerPayloadSignature('lan-secret', payload, signature, {
      timestamp: '1763510401000',
      nonce: context.nonce,
    })).toBe(false);
  });
});
