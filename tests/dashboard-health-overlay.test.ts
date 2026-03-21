import { describe, expect, it } from 'vitest';

import { formatRuntimeHealthLabel } from '../src/http/dashboardHealthOverlay.js';

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
