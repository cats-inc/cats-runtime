import { describe, expect, it } from 'vitest';
import { parseAcpCliOptions } from './acp.js';

describe('parseAcpCliOptions', () => {
  it('keeps proxy mode by default and forwards unrelated runtime flags', () => {
    expect(parseAcpCliOptions([
      '--host',
      '127.0.0.1',
      '--diagnose-setup',
    ])).toEqual({
      serveRuntime: false,
      passthroughArgv: [
        '--host',
        '127.0.0.1',
        '--diagnose-setup',
      ],
    });
  });

  it('extracts the direct runtime flag without disturbing other runtime options', () => {
    expect(parseAcpCliOptions([
      '--serve-runtime',
      '--managed-by',
      'zed',
      '--bootstrap',
    ])).toEqual({
      serveRuntime: true,
      passthroughArgv: [
        '--managed-by',
        'zed',
        '--bootstrap',
      ],
    });
  });
});
