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

  it.each([
    ['win32', 'windows', 'irm https://static.devin.ai/cli/setup.ps1 | iex'],
    ['darwin', 'macos', 'curl -fsSL https://cli.devin.ai/install.sh | bash'],
    ['linux', 'linux', 'curl -fsSL https://cli.devin.ai/install.sh | bash'],
  ] as const)('describes the Devin native installer on %s', (
    hostPlatform,
    executionPlatform,
    command,
  ) => {
    const view = buildProviderInstallCatalogView('devin', { mode: 'native' }, hostPlatform);

    expect(view).toMatchObject({
      familyLabel: 'Devin CLI',
      installPack: 'native-cli',
      executionPlatform,
      binaryName: 'devin',
      install: { installerId: 'devin-cli', method: 'native_installer', command },
      auth: { envVars: [], interactive: true },
    });
    // Packaged installers strip the trailing interactive step, so a successful
    // install never implies the CLI is usable.
    expect(view.auth.hint).toContain('devin auth login');
    expect(view.install.notes?.some((note) => note.includes('devin setup'))).toBe(true);
  });

  it('points Devin detection at the platform-specific install directory', () => {
    expect(buildProviderInstallCatalogView('devin', { mode: 'native' }, 'win32').path)
      .toMatchObject({ directoryHint: '%LOCALAPPDATA%\devin\cli\bin' });
    expect(buildProviderInstallCatalogView('devin', { mode: 'native' }, 'linux').path)
      .toMatchObject({ expectedPath: '~/.local/bin/devin' });
  });

  it.each([
    ['win32', 'windows', 'irm https://aider.chat/install.ps1 | iex', '~/.local/bin/aider.exe'],
    ['darwin', 'macos', 'curl -LsSf https://aider.chat/install.sh | sh', '~/.local/bin/aider'],
    ['linux', 'linux', 'curl -LsSf https://aider.chat/install.sh | sh', '~/.local/bin/aider'],
  ] as const)('describes the Aider installer on %s', (
    hostPlatform,
    executionPlatform,
    command,
    expectedPath,
  ) => {
    const view = buildProviderInstallCatalogView('aider', { mode: 'native' }, hostPlatform);

    expect(view).toMatchObject({
      familyLabel: 'Aider',
      installPack: 'native-cli',
      executionPlatform,
      binaryName: 'aider',
      install: { installerId: 'aider', method: 'native_installer', command },
      path: { expectedPath },
    });
    // Deleting the shim leaves aider-chat installed in the uv tool environment.
    expect(view.install.notes?.some((note) => note.includes('uv tool uninstall aider-chat')))
      .toBe(true);
  });

  it('models Aider auth as multi-source rather than env-var-only', () => {
    // Aider reads credentials from env vars, .env, .aider.conf.yml, and an
    // OpenRouter OAuth store it writes to ~/.aider/oauth-keys.env. A probe host
    // with no model env vars set still reached the model, so env presence alone
    // cannot decide readiness.
    const view = buildProviderInstallCatalogView('aider', { mode: 'native' }, 'linux');

    expect(view.auth.envVars).toContain('ANTHROPIC_API_KEY');
    expect(view.auth.envVars).toContain('OPENROUTER_API_KEY');
    expect(view.auth.interactive).toBe(true);
    expect(view.auth.hint).toContain('oauth-keys.env');
    expect(view.auth.hint).toContain('do not prove readiness');
  });

  it('installs Pi from the renamed npm package', () => {
    // The abandoned @mariozechner/pi-coding-agent still resolves on npm and reports
    // itself as up to date, so pointing at it silently disables every Pi upgrade.
    const view = buildProviderInstallCatalogView('pi', { mode: 'native' }, 'linux');

    expect(view.npm?.packageName).toBe('@earendil-works/pi-coding-agent');
    expect(view.install.command).toBe('npm install -g @earendil-works/pi-coding-agent');
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
