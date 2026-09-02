import { describe, expect, it } from 'vitest';

import {
  createRuntimeDiagnosticsAuthPayload,
  formatRuntimeHealthLabel,
} from '../src/http/dashboardHealthOverlay.js';

describe('dashboard runtime health overlay label', () => {
  it('surfaces provider failures even when runtime itself is ready', () => {
    expect(formatRuntimeHealthLabel(
      'ok',
      'Runtime is ready to accept requests.',
      {
        status: 'degraded',
        ok: 4,
        targets: 5,
        summary: '1 provider target(s) are unavailable.',
      },
    )).toBe('Runtime is ready to accept requests. · 1 provider target(s) are unavailable.');
  });

  it('keeps runtime failures primary when the runtime itself is unavailable', () => {
    expect(formatRuntimeHealthLabel(
      'unavailable',
      'Runtime diagnostics unavailable.',
      {
        status: 'unavailable',
        ok: 0,
        targets: 5,
        summary: '5 provider target(s) are unavailable.',
      },
    )).toBe('Runtime diagnostics unavailable.');
  });
});

describe('runtime diagnostics auth payload', () => {
  it('blames the Cats session, not an API key, when proxied by the platform', () => {
    const payload = createRuntimeDiagnosticsAuthPayload(true);

    expect(payload.runtime.summary).toBe('Sign in to Cats to see runtime diagnostics.');
    expect(payload.runtime.summary).not.toContain('API key');
    expect(payload.providers.summary.summary).not.toContain('API key');
  });

  it('still reports a missing API key when the runtime is reached directly', () => {
    const payload = createRuntimeDiagnosticsAuthPayload(false);

    expect(payload.runtime.summary).toBe('API key required for runtime diagnostics.');
    expect(payload.providers.summary.summary).toContain('API key');
  });

  it('never renders a zero provider count as if it were a real reading', () => {
    for (const proxyMode of [true, false]) {
      const payload = createRuntimeDiagnosticsAuthPayload(proxyMode);
      const label = formatRuntimeHealthLabel(
        payload.runtime.status,
        payload.runtime.summary,
        payload.providers.summary,
      );

      // `providers 0/0 ok` reads as "no providers work" rather than
      // "diagnostics could not be read".
      expect(label).not.toContain('providers 0/0 ok');
      expect(label).toBe(payload.runtime.summary);
    }
  });
});
