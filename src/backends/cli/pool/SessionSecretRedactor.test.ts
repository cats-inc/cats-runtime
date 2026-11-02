import { describe, expect, it } from 'vitest';
import { SessionSecretRedactor } from './SessionSecretRedactor.js';
describe('private session credential diagnostics', () => {
  it('redacts every possible stderr chunk boundary before logging', () => {
    const secret = 'fixture-token/with+symbols';
    for (let split = 1; split < secret.length; split++) {
      const redactor = new SessionSecretRedactor([secret]);
      const output = redactor.chunk(`error: Bearer ${secret.slice(0, split)}`)
        + redactor.chunk(`${secret.slice(split)} rejected\n`) + redactor.finish();
      expect(output).toBe('error: Bearer [REDACTED] rejected\n');
    }
  });
  it('redacts JSON/URL escapes and an unfinished prefix without touching normal diagnostics', () => {
    const redactor = new SessionSecretRedactor(['fixture+token', 'quote"secret']);
    expect(redactor.line('fixture%2Btoken quote\\"secret')).toBe('[REDACTED] [REDACTED]');
    expect(redactor.chunk('ordinary stderr\n')).toBe('ordinary stderr\n');
    expect(redactor.chunk('fixture+')).toBe('');
    expect(redactor.finish()).toBe('[REDACTED]');
  });
});
