import { describe, expect, it } from 'vitest';
import { parseAcpCliOptions } from './acp.js';

describe('parseAcpCliOptions', () => {
  it('keeps proxy mode by default and forwards unrelated runtime flags', () => {
    expect(parseAcpCliOptions([
      '--host',
      '127.0.0.1',
      '--diagnose-setup',
    ])).toEqual({
      inspectProxy: false,
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
      inspectProxy: false,
      serveRuntime: true,
      passthroughArgv: [
        '--managed-by',
        'zed',
        '--bootstrap',
      ],
    });
  });

  it('extracts the proxy preflight flag without disturbing runtime options', () => {
    expect(parseAcpCliOptions([
      '--inspect-proxy',
      '--host',
      '127.0.0.1',
      '--managed-by',
      'cats',
    ])).toEqual({
      inspectProxy: true,
      serveRuntime: false,
      passthroughArgv: [
        '--host',
        '127.0.0.1',
        '--managed-by',
        'cats',
      ],
    });
  });
});
