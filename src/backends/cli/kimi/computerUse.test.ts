import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { kimiComputerUseDependency, kimiComputerUseRuntimeCandidates, type KimiComputerUseHost } from './computerUse.js';

const plugin = ['compact', 'skill:kimi-browser-extension:kimi-webbridge', 'skill:kimi-cu-win:kimi-cu'];
function host(overrides: Partial<KimiComputerUseHost> = {}): KimiComputerUseHost {
  return { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Local' }, exists: () => true,
    nodeVersion: async () => 'v26.13.0', ...overrides };
}

describe('Kimi computer-use dependency', () => {
  it('waits for the session skill list before judging', async () => {
    expect(await kimiComputerUseDependency(null, host())).toMatchObject({ kind: 'computer_use', status: 'unknown' });
  });

  it('points to /plugins when the session did not load a computer-use plugin', async () => {
    const nodeVersion = vi.fn(async () => 'v26.13.0');
    expect(await kimiComputerUseDependency(['compact', 'skill:kimi-browser-extension:kimi-webbridge'], host({ nodeVersion })))
      .toMatchObject({ status: 'unavailable', remediation: expect.stringContaining('/plugins') });
    expect(nodeVersion).not.toHaveBeenCalled();
  });

  it('asks for the native runtime when the plugin loaded without it', async () => {
    expect(await kimiComputerUseDependency(plugin, host({ exists: () => false })))
      .toMatchObject({ status: 'unavailable', remediation: expect.stringContaining('setup_windows.cmd') });
  });

  it.each([[null, 'none was found'], ['v24.14.9', 'found v24.14.9'], ['v22.12.0', 'found v22.12.0']])(
    'requires Node.js 24.15 or later on PATH (%s)', async (version, evidence) => {
      expect(await kimiComputerUseDependency(plugin, host({ nodeVersion: async () => version })))
        .toMatchObject({ status: 'unavailable', evidence: expect.stringContaining(evidence) });
    });

  it('is available with the plugin, its runtime and a new enough Node.js', async () => {
    for (const version of ['v24.15.0', 'v25.0.0', 'v26.13.0']) {
      expect(await kimiComputerUseDependency(plugin, host({ nodeVersion: async () => version })))
        .toMatchObject({ status: 'available', evidence: expect.stringContaining('asks for approval') });
    }
  });

  it('does not judge the native runtime outside Windows', async () => {
    expect(await kimiComputerUseDependency(['skill:kimi-cu:kimi-cu'], host({ platform: 'darwin' })))
      .toMatchObject({ status: 'unknown' });
  });

  it('follows the plugin\'s runtime lookup order', () => {
    expect(kimiComputerUseRuntimeCandidates({ KIMI_CU_WINDOWS_EXE: 'D:\\cu.exe', LOCALAPPDATA: 'C:\\Local' })).toEqual(['D:\\cu.exe']);
    expect(kimiComputerUseRuntimeCandidates({ KIMI_CU_WINDOWS_HOME: 'D:\\cu' })).toEqual([join('D:\\cu', 'kimi-cu.exe')]);
    expect(kimiComputerUseRuntimeCandidates({ LOCALAPPDATA: 'C:\\Local' })).toEqual([
      join('C:\\Local', 'Kimi Computer Use', 'kimi-cu.exe'), join('C:\\Local', 'KimiCU', 'kimi-cu.exe')]);
    expect(kimiComputerUseRuntimeCandidates({})).toEqual([]);
  });
});
