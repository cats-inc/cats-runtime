import { describe, expect, it } from 'vitest';
import { hiddenWindowsSpawnOptions } from './windowsSpawn.js';

describe('hiddenWindowsSpawnOptions', () => {
  it('returns a Windows-safe spawn override', () => {
    expect(hiddenWindowsSpawnOptions()).toEqual({
      windowsHide: true,
    });
  });
});
