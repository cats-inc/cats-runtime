import { describe, expect, it } from 'vitest';
import { expandNativeEnvPath } from './pathUtils.js';

describe('expandNativeEnvPath', () => {
  it('expands generic Windows-style environment variables', () => {
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;

    process.env.APPDATA = 'C:\\Users\\Alice\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\Alice\\AppData\\Local';

    try {
      expect(expandNativeEnvPath('%APPDATA%\\npm')).toBe(
        'C:\\Users\\Alice\\AppData\\Roaming\\npm',
      );
      expect(expandNativeEnvPath('%LOCALAPPDATA%\\Programs\\Auggie')).toBe(
        'C:\\Users\\Alice\\AppData\\Local\\Programs\\Auggie',
      );
    } finally {
      if (originalAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = originalAppData;
      }

      if (originalLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = originalLocalAppData;
      }
    }
  });
});
