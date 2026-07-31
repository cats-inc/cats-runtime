import { describe, expect, it } from 'vitest';

import {
  expandWindowsEnvironmentPlaceholders,
  mergePathEntries,
  parseRegQueryPathValue,
  refreshWindowsProcessPath,
  splitWindowsPath,
} from './windowsEnvironmentPath.js';

const USER_KEY = 'HKCU\\Environment';
const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

function regQueryOutput(key: string, type: string, value: string): string {
  return `\r\n${key}\r\n    Path    ${type}    ${value}\r\n\r\n`;
}

describe('parseRegQueryPathValue', () => {
  it('reads the value out of reg query output', () => {
    const stdout = regQueryOutput(
      'HKEY_CURRENT_USER\\Environment',
      'REG_EXPAND_SZ',
      '%USERPROFILE%\\.local\\bin;C:\\tools',
    );
    expect(parseRegQueryPathValue(stdout)).toBe('%USERPROFILE%\\.local\\bin;C:\\tools');
  });

  it('reads plain REG_SZ values', () => {
    const stdout = regQueryOutput('HKEY_LOCAL_MACHINE\\...', 'REG_SZ', 'C:\\Windows;C:\\Windows\\System32');
    expect(parseRegQueryPathValue(stdout)).toBe('C:\\Windows;C:\\Windows\\System32');
  });

  it('keeps directories that contain spaces intact', () => {
    const stdout = regQueryOutput('HKEY_CURRENT_USER\\Environment', 'REG_SZ', 'C:\\Program Files\\Kiro-Cli;C:\\tools');
    expect(parseRegQueryPathValue(stdout)).toBe('C:\\Program Files\\Kiro-Cli;C:\\tools');
  });

  it('does not mistake PATHEXT for PATH', () => {
    const stdout = '\r\nHKEY_CURRENT_USER\\Environment\r\n    PATHEXT    REG_SZ    .COM;.EXE\r\n\r\n';
    expect(parseRegQueryPathValue(stdout)).toBeNull();
  });

  it('returns null when the value is absent', () => {
    expect(parseRegQueryPathValue('ERROR: The system was unable to find the specified registry key')).toBeNull();
  });
});

describe('expandWindowsEnvironmentPlaceholders', () => {
  it('expands placeholders case-insensitively', () => {
    const expanded = expandWindowsEnvironmentPlaceholders(
      '%UserProfile%\\.local\\bin;%LOCALAPPDATA%\\agy\\bin',
      { USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
    );
    expect(expanded).toBe('C:\\Users\\me\\.local\\bin;C:\\Users\\me\\AppData\\Local\\agy\\bin');
  });

  it('leaves unknown placeholders alone rather than dropping the entry', () => {
    const expanded = expandWindowsEnvironmentPlaceholders('%NOPE%\\bin;C:\\tools', {});
    expect(expanded).toBe('%NOPE%\\bin;C:\\tools');
  });
});

describe('mergePathEntries', () => {
  it('appends only entries that are not already present', () => {
    const merged = mergePathEntries(
      ['C:\\Windows', 'C:\\tools'],
      ['C:\\Windows', 'C:\\Users\\me\\.local\\bin'],
    );
    expect(merged).toEqual(['C:\\Windows', 'C:\\tools', 'C:\\Users\\me\\.local\\bin']);
  });

  it('treats casing and trailing separators as the same entry', () => {
    const merged = mergePathEntries(['C:\\Windows'], ['c:\\windows\\', 'C:\\WINDOWS']);
    expect(merged).toEqual(['C:\\Windows']);
  });

  it('preserves existing entries that the registry does not know about', () => {
    // The desktop host injects entries into this sidecar that were never
    // persisted; a refresh must not drop them.
    const merged = mergePathEntries(['C:\\injected\\by\\host'], ['C:\\Windows']);
    expect(merged).toEqual(['C:\\injected\\by\\host', 'C:\\Windows']);
  });
});

describe('splitWindowsPath', () => {
  it('drops empty and whitespace-only segments', () => {
    expect(splitWindowsPath('C:\\a;;  ; C:\\b ;')).toEqual(['C:\\a', 'C:\\b']);
  });
});

describe('refreshWindowsProcessPath', () => {
  it('adds a newly installed CLI directory to the live PATH', async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\me',
    };

    const result = await refreshWindowsProcessPath({
      env,
      platform: 'win32',
      readRegistryPath: async (key) => {
        if (key === MACHINE_KEY) {
          return regQueryOutput('HKEY_LOCAL_MACHINE\\...', 'REG_SZ', 'C:\\Windows');
        }
        if (key === USER_KEY) {
          return regQueryOutput(
            'HKEY_CURRENT_USER\\Environment',
            'REG_EXPAND_SZ',
            '%USERPROFILE%\\.local\\bin',
          );
        }
        return null;
      },
    });

    expect(result.refreshed).toBe(true);
    expect(result.added).toEqual(['C:\\Users\\me\\.local\\bin']);
    expect(env.PATH).toBe('C:\\Windows;C:\\Users\\me\\.local\\bin');
  });

  it('is a no-op when the registry adds nothing new', async () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows;C:\\tools' };

    const result = await refreshWindowsProcessPath({
      env,
      platform: 'win32',
      readRegistryPath: async () => regQueryOutput('HKEY_CURRENT_USER\\Environment', 'REG_SZ', 'C:\\tools'),
    });

    expect(result.refreshed).toBe(false);
    expect(env.PATH).toBe('C:\\Windows;C:\\tools');
  });

  it('leaves PATH untouched when the registry cannot be read', async () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' };

    const result = await refreshWindowsProcessPath({
      env,
      platform: 'win32',
      readRegistryPath: async () => null,
    });

    expect(result.refreshed).toBe(false);
    expect(env.PATH).toBe('C:\\Windows');
  });

  it('does not let a registry read failure escape', async () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' };

    const result = await refreshWindowsProcessPath({
      env,
      platform: 'win32',
      readRegistryPath: async () => {
        throw new Error('reg.exe is missing');
      },
    });

    expect(result.refreshed).toBe(false);
    expect(env.PATH).toBe('C:\\Windows');
  });

  it('does nothing off Windows', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    let called = false;

    const result = await refreshWindowsProcessPath({
      env,
      platform: 'linux',
      readRegistryPath: async () => {
        called = true;
        return null;
      },
    });

    expect(result.refreshed).toBe(false);
    expect(called).toBe(false);
    expect(env.PATH).toBe('/usr/bin');
  });

  it('writes back through the casing the environment already uses', async () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows' };

    await refreshWindowsProcessPath({
      env,
      platform: 'win32',
      readRegistryPath: async (key) => (key === USER_KEY
        ? regQueryOutput('HKEY_CURRENT_USER\\Environment', 'REG_SZ', 'C:\\new')
        : null),
    });

    expect(env.Path).toBe('C:\\Windows;C:\\new');
    expect(env.PATH).toBeUndefined();
  });
});
