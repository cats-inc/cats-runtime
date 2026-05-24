import type { ProviderRuntimeConfig } from '../../backends/cli/config.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import type {
  ProviderExecutionPlatform,
  ProviderInstallCatalogView,
  ProviderInstallKnowledge,
  ProviderPrerequisiteMetadata,
  ProviderPathHint,
  ProviderPlatformInstallMetadata,
} from './types.js';

export const GENERIC_AUTH_ERROR_PATTERNS = [
  'login required',
  'not logged in',
  'authentication required',
  'please sign in',
  'sign in to continue',
  'unauthorized',
  'forbidden',
];

function createLocalBinPathHints(
  binaryName: string,
  options: {
    windowsExecutable?: string;
    alias?: string;
  } = {},
): Partial<Record<ProviderExecutionPlatform, ProviderPathHint>> {
  const executable = options.windowsExecutable || `${binaryName}.exe`;
  const alias = options.alias ? ` or ${options.alias}` : '';
  return {
    windows: {
      expectedPath: `~/.local/bin/${executable}`,
      directoryHint: '~/.local/bin',
      exportCommand: 'setx PATH "%USERPROFILE%\\.local\\bin;%PATH%"',
      reloadHint: 'Open a new terminal window after updating PATH.',
    },
    macos: {
      expectedPath: `~/.local/bin/${binaryName}`,
      directoryHint: '~/.local/bin',
      exportCommand: 'export PATH="$HOME/.local/bin:$PATH"',
      shellRcPath: '~/.zshrc',
      persistenceEntry: '.local/bin',
      reloadHint: `Run source ~/.zshrc or source ~/.bashrc before invoking ${binaryName}${alias}.`,
    },
    linux: {
      expectedPath: `~/.local/bin/${binaryName}`,
      directoryHint: '~/.local/bin',
      exportCommand: 'export PATH="$HOME/.local/bin:$PATH"',
      shellRcPath: '~/.bashrc',
      persistenceEntry: '.local/bin',
      reloadHint: `Run source ~/.bashrc before invoking ${binaryName}${alias}.`,
    },
  };
}

function createNpmPathHints(
  binaryName: string,
): Partial<Record<ProviderExecutionPlatform, ProviderPathHint>> {
  return {
    windows: {
      expectedPath: '%APPDATA%\\npm',
      directoryHint: '%APPDATA%\\npm',
      exportCommand: 'setx PATH "%APPDATA%\\npm;%PATH%"',
      reloadHint: `Open a new terminal window after installing ${binaryName}.`,
    },
    macos: {
      directoryHint: '~/.npm-global/bin',
      exportCommand: 'export PATH="$HOME/.npm-global/bin:$PATH"',
      shellRcPath: '~/.zshrc',
      persistenceEntry: '.npm-global/bin',
      reloadHint: `Run source ~/.zshrc or source ~/.bashrc before invoking ${binaryName}.`,
    },
    linux: {
      directoryHint: '~/.npm-global/bin',
      exportCommand: 'export PATH="$HOME/.npm-global/bin:$PATH"',
      shellRcPath: '~/.bashrc',
      persistenceEntry: '.npm-global/bin',
      reloadHint: `Run source ~/.bashrc before invoking ${binaryName}.`,
    },
  };
}

function createInstallerPrerequisites(
  prerequisites: ProviderPrerequisiteMetadata[],
): Partial<Record<ProviderExecutionPlatform, ProviderPrerequisiteMetadata[]>> {
  return {
    macos: prerequisites.map((prerequisite) => ({ ...prerequisite })),
    linux: prerequisites.map((prerequisite) => ({ ...prerequisite })),
  };
}

function createNativeInstallerPrerequisites(
  familyLabel: string,
): Partial<Record<ProviderExecutionPlatform, ProviderPrerequisiteMetadata[]>> {
  return createInstallerPrerequisites([
    {
      id: 'bash',
      label: 'Bash',
      command: 'bash',
      summary: `${familyLabel} install flow expects a bash shell in the execution environment.`,
    },
    {
      id: 'curl',
      label: 'curl',
      command: 'curl',
      summary: `${familyLabel} install flow downloads the official installer with curl.`,
    },
  ]);
}

function createNpmPrerequisites(
  familyLabel: string,
): Partial<Record<ProviderExecutionPlatform, ProviderPrerequisiteMetadata[]>> {
  const prerequisites = [
    {
      id: 'node',
      label: 'Node.js',
      command: 'node',
      summary: `${familyLabel} install flow requires Node.js in the execution environment.`,
    },
    {
      id: 'npm',
      label: 'npm',
      command: 'npm',
      summary: `${familyLabel} install flow requires npm in the execution environment.`,
    },
  ];

  return {
    windows: prerequisites.map((prerequisite) => ({ ...prerequisite })),
    macos: prerequisites.map((prerequisite) => ({ ...prerequisite })),
    linux: prerequisites.map((prerequisite) => ({ ...prerequisite })),
  };
}

function createNativeInstall(
  installerId: string,
  windowsCommand: string,
  unixCommand: string,
  options: {
    docsUrl?: string;
    notes?: string[];
    windowsNotes?: string[];
    requiresShellRestart?: boolean;
  } = {},
): Record<ProviderExecutionPlatform, ProviderPlatformInstallMetadata> {
  return {
    windows: {
      supported: true,
      installerId,
      method: 'native_installer',
      command: windowsCommand,
      docsUrl: options.docsUrl,
      requiresShellRestart: options.requiresShellRestart ?? true,
      notes: options.windowsNotes || options.notes,
    },
    macos: {
      supported: true,
      installerId,
      method: 'native_installer',
      command: unixCommand,
      docsUrl: options.docsUrl,
      requiresShellRestart: options.requiresShellRestart ?? true,
      notes: options.notes,
    },
    linux: {
      supported: true,
      installerId,
      method: 'native_installer',
      command: unixCommand,
      docsUrl: options.docsUrl,
      requiresShellRestart: options.requiresShellRestart ?? true,
      notes: options.notes,
    },
  };
}

function createNpmInstall(
  installerId: string,
  npmPackage: string,
  options: {
    docsUrl?: string;
    notes?: string[];
  } = {},
): Record<ProviderExecutionPlatform, ProviderPlatformInstallMetadata> {
  const base = {
    supported: true,
    installerId,
    method: 'npm_global' as const,
    command: `npm install -g ${npmPackage}`,
    docsUrl: options.docsUrl,
    prerequisites: ['node', 'npm'],
    requiresShellRestart: true,
    notes: options.notes,
  };
  return {
    windows: { ...base },
    macos: { ...base },
    linux: { ...base },
  };
}

function createGenericNpmKnowledge(
  provider: ProviderName,
  familyLabel: string,
  npmPackage: string,
  authHint: string,
  options: {
    docsUrl?: string;
    envVars?: string[];
    authPatterns?: string[];
  } = {},
): ProviderInstallKnowledge {
  return {
    provider,
    familyLabel,
    installPack: 'npm-global',
    binaryName: provider === 'opencode' ? 'opencode' : provider,
    defaultDocsUrl: options.docsUrl,
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNpmPrerequisites(familyLabel),
      npmPackage,
      npmExpectedPrefix: {
        macos: '~/.npm-global',
        linux: '~/.npm-global',
      },
      pathHints: createNpmPathHints(provider === 'opencode' ? 'opencode' : provider),
    },
    auth: {
      requiredAfterInstall: true,
      envVars: options.envVars || [],
      interactive: true,
      docsUrl: options.docsUrl,
      hint: authHint,
      errorPatterns: options.authPatterns || GENERIC_AUTH_ERROR_PATTERNS,
    },
    platforms: createNpmInstall(
      provider,
      npmPackage,
      {
        docsUrl: options.docsUrl || `https://www.npmjs.com/package/${npmPackage}`,
      },
    ),
  };
}

const INSTALL_KNOWLEDGE: Record<ProviderName, ProviderInstallKnowledge> = {
  claude: {
    provider: 'claude',
    familyLabel: 'Claude Code CLI',
    installPack: 'native-cli',
    binaryName: 'claude',
    defaultDocsUrl: 'https://code.claude.com/docs/en/setup',
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNativeInstallerPrerequisites('Claude Code CLI'),
      expectedPaths: {
        windows: '~/.local/bin/claude.exe',
        macos: '~/.local/bin/claude',
        linux: '~/.local/bin/claude',
      },
      pathHints: createLocalBinPathHints('claude'),
    },
    auth: {
      requiredAfterInstall: true,
      envVars: ['ANTHROPIC_API_KEY'],
      interactive: true,
      docsUrl: 'https://code.claude.com/docs/en/setup',
      hint: 'Sign in through the browser on first launch or set ANTHROPIC_API_KEY.',
      errorPatterns: [...GENERIC_AUTH_ERROR_PATTERNS, 'anthropic_api_key'],
    },
    platforms: createNativeInstall(
      'claude-code',
      'irm https://claude.ai/install.ps1 | iex',
      'curl -fsSL https://claude.ai/install.sh | bash',
      {
        docsUrl: 'https://code.claude.com/docs/en/setup',
        notes: ['The official native installer places Claude in ~/.local/bin.'],
        windowsNotes: [
          'The official native installer places Claude in %USERPROFILE%\\.local\\bin\\claude.exe.',
        ],
      },
    ),
  },
  cursor: {
    provider: 'cursor',
    familyLabel: 'Cursor Agent CLI',
    installPack: 'native-cli',
    binaryName: 'cursor-agent',
    defaultDocsUrl: 'https://cursor.com',
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNativeInstallerPrerequisites('Cursor Agent CLI'),
      expectedPaths: {
        windows: '~/.local/bin/cursor-agent.exe',
        macos: '~/.local/bin/cursor-agent',
        linux: '~/.local/bin/cursor-agent',
      },
      pathHints: createLocalBinPathHints('cursor-agent', { alias: 'ca' }),
    },
    auth: {
      requiredAfterInstall: true,
      envVars: ['CURSOR_API_KEY'],
      interactive: true,
      docsUrl: 'https://cursor.com',
      hint: 'Sign in through the browser on first launch or set CURSOR_API_KEY.',
      errorPatterns: [...GENERIC_AUTH_ERROR_PATTERNS, 'cursor_api_key'],
    },
    platforms: createNativeInstall(
      'cursor-agent',
      "irm 'https://cursor.com/install?win32=true' | iex",
      'curl https://cursor.com/install -fsSL | bash',
      {
        docsUrl: 'https://cursor.com',
        notes: ['Cursor installs into ~/.local/bin and may add a ca alias.'],
        windowsNotes: [
          'Cursor installs into %USERPROFILE%\\.local\\bin\\cursor-agent.exe.',
          'If the official installer fails under PowerShell 7, retry with Windows PowerShell 5.1.',
        ],
      },
    ),
  },
  goose: {
    provider: 'goose',
    familyLabel: 'Goose CLI',
    installPack: 'native-cli',
    binaryName: 'goose',
    defaultDocsUrl: 'https://github.com/block/goose',
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNativeInstallerPrerequisites('Goose CLI'),
      expectedPaths: {
        windows: '~/.local/bin/goose.exe',
        macos: '~/.local/bin/goose',
        linux: '~/.local/bin/goose',
      },
      pathHints: createLocalBinPathHints('goose'),
    },
    auth: {
      requiredAfterInstall: true,
      envVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
      interactive: true,
      docsUrl: 'https://github.com/block/goose',
      hint: 'Run goose configure or provide provider API keys after install.',
      errorPatterns: [...GENERIC_AUTH_ERROR_PATTERNS, 'configure'],
    },
    platforms: createNativeInstall(
      'goose-cli',
      "irm 'https://raw.githubusercontent.com/block/goose/main/download_cli.ps1' | iex",
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash',
      {
        docsUrl: 'https://github.com/block/goose',
        notes: ['Goose installs into ~/.local/bin and uses goose configure for provider setup.'],
        windowsNotes: [
          'Goose installs into %USERPROFILE%\\.local\\bin\\goose.exe.',
          'Windows Defender may require you to review the download before retrying.',
        ],
      },
    ),
  },
  junie: {
    provider: 'junie',
    familyLabel: 'Junie CLI',
    installPack: 'native-cli',
    binaryName: 'junie',
    defaultDocsUrl: 'https://junie.jetbrains.com/cli',
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNativeInstallerPrerequisites('Junie CLI'),
      expectedPaths: {
        macos: '~/.local/bin/junie',
        linux: '~/.local/bin/junie',
      },
      pathHints: createLocalBinPathHints('junie'),
    },
    auth: {
      requiredAfterInstall: true,
      envVars: ['JUNIE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
      interactive: true,
      docsUrl: 'https://junie.jetbrains.com/cli',
      hint: 'Sign in with a JetBrains account or set JUNIE_API_KEY before use.',
      errorPatterns: [...GENERIC_AUTH_ERROR_PATTERNS, 'junie_api_key'],
    },
    platforms: createNativeInstall(
      'junie-cli',
      "iex (irm 'https://junie.jetbrains.com/install.ps1')",
      'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
      {
        docsUrl: 'https://junie.jetbrains.com/cli',
        notes: ['Junie installs into ~/.local/bin and may require reopening the shell.'],
      },
    ),
  },
  kiro: {
    provider: 'kiro',
    familyLabel: 'Kiro CLI',
    installPack: 'native-cli',
    binaryName: 'kiro-cli',
    defaultDocsUrl: 'https://cli.kiro.dev',
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNativeInstallerPrerequisites('Kiro CLI'),
      expectedPaths: {
        windows: '%LOCALAPPDATA%\\Kiro-Cli\\kiro-cli.exe',
        macos: '~/.local/bin/kiro-cli',
        linux: '~/.local/bin/kiro-cli',
      },
      pathHints: {
        ...createLocalBinPathHints('kiro-cli', { alias: 'kc' }),
        windows: {
          expectedPath: '%LOCALAPPDATA%\\Kiro-Cli\\kiro-cli.exe',
          directoryHint: '%LOCALAPPDATA%\\Kiro-Cli',
          reloadHint: 'Open a new terminal window after installing Kiro CLI on Windows.',
        },
      },
    },
    auth: {
      requiredAfterInstall: true,
      envVars: [],
      interactive: true,
      docsUrl: 'https://cli.kiro.dev',
      hint: 'Complete the Kiro CLI sign-in flow after installation.',
      errorPatterns: GENERIC_AUTH_ERROR_PATTERNS,
    },
    platforms: {
      windows: {
        supported: true,
        installerId: 'kiro-cli',
        method: 'native_installer',
        command: "iex (irm 'https://cli.kiro.dev/install.ps1')",
        docsUrl: 'https://cli.kiro.dev',
        requiresShellRestart: true,
        notes: [
          'Kiro installs into %LOCALAPPDATA%\\Kiro-Cli and may add kiro-cli to PATH.',
        ],
      },
      macos: {
        supported: true,
        installerId: 'kiro-cli',
        method: 'native_installer',
        command: 'curl -fsSL https://cli.kiro.dev/install | bash',
        docsUrl: 'https://cli.kiro.dev',
        requiresShellRestart: true,
        notes: ['Kiro installs into ~/.local/bin and may add a kc alias.'],
      },
      linux: {
        supported: true,
        installerId: 'kiro-cli',
        method: 'native_installer',
        command: 'curl -fsSL https://cli.kiro.dev/install | bash',
        docsUrl: 'https://cli.kiro.dev',
        requiresShellRestart: true,
        notes: ['Kiro installs into ~/.local/bin and may add a kc alias.'],
      },
    },
  },
  codex: createGenericNpmKnowledge(
    'codex',
    'OpenAI Codex CLI',
    '@openai/codex',
    'Complete the Codex CLI sign-in or API configuration after install.',
  ),
  antigravity: {
    provider: 'antigravity',
    familyLabel: 'Antigravity CLI',
    installPack: 'native-cli',
    binaryName: 'agy',
    defaultDocsUrl: 'https://antigravity.google/cli',
    check: {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      prerequisites: createNativeInstallerPrerequisites('Antigravity CLI'),
      expectedPaths: {
        windows: '%LOCALAPPDATA%\\agy\\bin\\agy.exe',
        macos: '~/.local/bin/agy',
        linux: '~/.local/bin/agy',
      },
      pathHints: {
        windows: {
          expectedPath: '%LOCALAPPDATA%\\agy\\bin\\agy.exe',
          directoryHint: '%LOCALAPPDATA%\\agy\\bin',
          exportCommand: 'setx PATH "%LOCALAPPDATA%\\agy\\bin;%PATH%"',
          reloadHint: 'Open a new terminal window after installing Antigravity CLI.',
        },
        macos: {
          expectedPath: '~/.local/bin/agy',
          directoryHint: '~/.local/bin',
          exportCommand: 'export PATH="$HOME/.local/bin:$PATH"',
          shellRcPath: '~/.zshrc',
          persistenceEntry: '.local/bin',
          reloadHint: 'Run source ~/.zshrc or source ~/.bashrc before invoking agy.',
        },
        linux: {
          expectedPath: '~/.local/bin/agy',
          directoryHint: '~/.local/bin',
          exportCommand: 'export PATH="$HOME/.local/bin:$PATH"',
          shellRcPath: '~/.bashrc',
          persistenceEntry: '.local/bin',
          reloadHint: 'Run source ~/.bashrc before invoking agy.',
        },
      },
    },
    auth: {
      requiredAfterInstall: true,
      envVars: [],
      interactive: true,
      docsUrl: 'https://antigravity.google/cli',
      hint: 'Complete the Antigravity CLI sign-in flow after installation.',
      errorPatterns: GENERIC_AUTH_ERROR_PATTERNS,
    },
    platforms: createNativeInstall(
      'antigravity-cli',
      'irm https://antigravity.google/cli/install.ps1 | iex',
      'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      {
        docsUrl: 'https://antigravity.google/cli',
        notes: ['Antigravity installs agy into ~/.local/bin on macOS and Linux.'],
        windowsNotes: ['Antigravity installs agy.exe into %LOCALAPPDATA%\\agy\\bin.'],
      },
    ),
  },
  copilot: createGenericNpmKnowledge(
    'copilot',
    'GitHub Copilot CLI',
    '@github/copilot',
    'Complete the GitHub Copilot CLI sign-in flow after install.',
  ),
  opencode: createGenericNpmKnowledge(
    'opencode',
    'OpenCode CLI',
    'opencode-ai',
    'Complete the OpenCode CLI authentication flow after install.',
  ),
  kilo: createGenericNpmKnowledge(
    'kilo',
    'Kilo Code CLI',
    '@kilocode/cli',
    'Run kilo auth or complete the Kilo Code authentication flow after install.',
    {
      docsUrl: 'https://kilo.ai/docs',
    },
  ),
  auggie: createGenericNpmKnowledge(
    'auggie',
    'Auggie CLI',
    '@augmentcode/auggie',
    'Complete the Auggie CLI authentication flow after install.',
  ),
  pi: createGenericNpmKnowledge(
    'pi',
    'Pi Coding Agent CLI',
    '@mariozechner/pi-coding-agent',
    'Complete the Pi Coding Agent CLI authentication flow after install.',
  ),
};

export function getProviderInstallKnowledge(
  provider: ProviderName,
): ProviderInstallKnowledge {
  return INSTALL_KNOWLEDGE[provider];
}

export function resolveExecutionPlatform(
  runtime: ProviderRuntimeConfig,
  hostPlatform: NodeJS.Platform = process.platform,
): ProviderExecutionPlatform {
  if (runtime.mode === 'wsl' || runtime.mode === 'docker') {
    return 'linux';
  }

  if (hostPlatform === 'win32') {
    return 'windows';
  }
  if (hostPlatform === 'darwin') {
    return 'macos';
  }
  return 'linux';
}

export function buildProviderInstallCatalogView(
  provider: ProviderName,
  runtime: ProviderRuntimeConfig,
  hostPlatform: NodeJS.Platform = process.platform,
): ProviderInstallCatalogView {
  const knowledge = getProviderInstallKnowledge(provider);
  const executionPlatform = resolveExecutionPlatform(runtime, hostPlatform);
  const pathHint = knowledge.check.pathHints?.[executionPlatform] || {};
  const install = knowledge.platforms[executionPlatform];

  return {
    provider,
    familyLabel: knowledge.familyLabel,
    installPack: knowledge.installPack,
    executionPlatform,
    runtime: { ...runtime },
    binaryName: knowledge.binaryName,
    prerequisites: (knowledge.check.prerequisites?.[executionPlatform] || []).map((prerequisite) => ({
      ...prerequisite,
    })),
    install: {
      ...install,
      prerequisites: install.prerequisites ? [...install.prerequisites] : undefined,
      notes: install.notes ? [...install.notes] : undefined,
    },
    auth: {
      requiredAfterInstall: knowledge.auth.requiredAfterInstall,
      envVars: [...(knowledge.auth.envVars || [])],
      docsUrl: knowledge.auth.docsUrl || knowledge.defaultDocsUrl,
      interactive: knowledge.auth.interactive !== false,
      hint: knowledge.auth.hint,
    },
    path: {
      ...pathHint,
    },
    npm: knowledge.check.npmPackage
      ? {
        packageName: knowledge.check.npmPackage,
        expectedPrefix: knowledge.check.npmExpectedPrefix?.[executionPlatform],
      }
      : undefined,
  };
}
