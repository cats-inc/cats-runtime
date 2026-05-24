import { describe, expect, it } from 'vitest';
import { buildProviderInstallCatalogView } from './knowledge.js';

describe('buildProviderInstallCatalogView', () => {
  it('keeps Kiro on the native Windows install path', () => {
    const view = buildProviderInstallCatalogView('kiro', { mode: 'native' }, 'win32');

    expect(view.executionPlatform).toBe('windows');
    expect(view.install.supported).toBe(true);
    expect(view.install.command).toBe("iex (irm 'https://cli.kiro.dev/install.ps1')");
    expect(view.path.expectedPath).toBe('%LOCALAPPDATA%\\Kiro-Cli\\kiro-cli.exe');
    expect(view.install.notes).not.toContain(
      'Kiro CLI should run in a Linux or WSL execution environment on Windows hosts.',
    );
  });

  it('keeps Antigravity on the native installer path', () => {
    const view = buildProviderInstallCatalogView('antigravity', { mode: 'native' }, 'win32');

    expect(view.familyLabel).toBe('Antigravity CLI');
    expect(view.install.method).toBe('native_installer');
    expect(view.install.command).toBe('irm https://antigravity.google/cli/install.ps1 | iex');
    expect(view.binaryName).toBe('agy');
    expect(view.path.expectedPath).toBe('%LOCALAPPDATA%\\agy\\bin\\agy.exe');
  });
});
