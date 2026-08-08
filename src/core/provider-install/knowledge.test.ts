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

  it.each([
    ['win32', 'windows', 'irm https://x.ai/cli/install.ps1 | iex', '~/.grok/bin/grok.exe'],
    ['darwin', 'macos', 'curl -fsSL https://x.ai/cli/install.sh | bash', '~/.grok/bin/grok'],
    ['linux', 'linux', 'curl -fsSL https://x.ai/cli/install.sh | bash', '~/.grok/bin/grok'],
  ] as const)('describes the Grok native installer on %s', (
    hostPlatform,
    executionPlatform,
    command,
    expectedPath,
  ) => {
    const view = buildProviderInstallCatalogView('grok', { mode: 'native' }, hostPlatform);

    expect(view).toMatchObject({
      familyLabel: 'Grok CLI',
      installPack: 'native-cli',
      executionPlatform,
      binaryName: 'grok',
      install: {
        installerId: 'grok-cli',
        method: 'native_installer',
        command,
      },
      auth: {
        envVars: ['XAI_API_KEY'],
        interactive: true,
      },
      path: {
        expectedPath,
        directoryHint: '~/.grok/bin',
      },
    });
    expect(view.auth.hint).toContain('grok login');
    expect(view.auth.hint).toContain('~/.grok/auth.json');
    expect(view.install.notes).toContain(
      'The installer also creates an agent alias; Cats intentionally detects only grok.',
    );
  });

  it.each([
    ['win32', 'windows'],
    ['darwin', 'macos'],
    ['linux', 'linux'],
  ] as const)('describes the Cline npm installer on %s', (hostPlatform, executionPlatform) => {
    const view = buildProviderInstallCatalogView('cline', { mode: 'native' }, hostPlatform);

    expect(view).toMatchObject({
      familyLabel: 'Cline CLI',
      installPack: 'npm-global',
      executionPlatform,
      binaryName: 'cline',
      install: {
        installerId: 'cline',
        method: 'npm_global',
        command: 'npm install -g cline',
      },
      auth: {
        envVars: [],
        interactive: true,
      },
      npm: {
        packageName: 'cline',
      },
    });
    expect(view.auth.hint).toContain('cline auth');
  });

  it('derives the npm binary name from the provider id unless overridden', () => {
    // Guards the createGenericNpmKnowledge refactor that replaced the hardcoded
    // `provider === 'opencode'` check with an explicit binaryName option.
    expect(buildProviderInstallCatalogView('opencode', { mode: 'native' }, 'linux').binaryName)
      .toBe('opencode');
    expect(buildProviderInstallCatalogView('cline', { mode: 'native' }, 'linux').binaryName)
      .toBe('cline');
  });
});
