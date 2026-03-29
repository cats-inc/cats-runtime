import { describe, expect, it } from 'vitest';

import { isDirectCliEntrypoint } from './cliEntrypoint.js';

describe('isDirectCliEntrypoint', () => {
  it('matches when argv path already equals the module path', () => {
    expect(isDirectCliEntrypoint(
      'file:///tmp/cats-runtime/dist/index.js',
      '/tmp/cats-runtime/dist/index.js',
    )).toBe(true);
  });

  it('matches when argv path resolves through a symlink', () => {
    expect(isDirectCliEntrypoint(
      'file:///opt/cats-runtime/dist/index.js',
      '/usr/local/bin/cats-runtime',
      (path) => {
        expect(path).toBe('/usr/local/bin/cats-runtime');
        return '/opt/cats-runtime/dist/index.js';
      },
    )).toBe(true);
  });

  it('returns false when the resolved path points somewhere else', () => {
    expect(isDirectCliEntrypoint(
      'file:///opt/cats-runtime/dist/index.js',
      '/usr/local/bin/cats-runtime',
      () => '/opt/other/index.js',
    )).toBe(false);
  });

  it('returns false when argv path is missing', () => {
    expect(isDirectCliEntrypoint(
      'file:///opt/cats-runtime/dist/index.js',
      undefined,
    )).toBe(false);
  });

  it('returns false when realpath lookup fails', () => {
    expect(isDirectCliEntrypoint(
      'file:///opt/cats-runtime/dist/index.js',
      '/usr/local/bin/cats-runtime',
      () => {
        throw new Error('boom');
      },
    )).toBe(false);
  });
});
