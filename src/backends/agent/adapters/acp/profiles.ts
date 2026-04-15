import { basename, win32 } from 'node:path';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';

export interface AcpProviderProfile {
  id: string;
  label: string;
  family: string;
  tier: 1 | 2;
  summary: string;
  clientCapabilityMeta?: Record<string, unknown>;
  probe: {
    helpArgs: string[];
  };
}

const CODEX_ACP_PROFILE: AcpProviderProfile = {
  id: 'codex-acp',
  label: 'Codex ACP',
  family: 'codex',
  tier: 1,
  summary: 'Tier 1 Codex ACP target with runtime overlap on JSON-RPC lifecycle semantics.',
  clientCapabilityMeta: {
    terminal_output: true,
  },
  probe: {
    helpArgs: ['--help'],
  },
};

const CLAUDE_ACP_PROFILE: AcpProviderProfile = {
  id: 'claude-acp',
  label: 'Claude ACP',
  family: 'claude',
  tier: 1,
  summary: 'Tier 1 Claude ACP target with auth-capable registry profile.',
  probe: {
    helpArgs: ['--help'],
  },
};

const GEMINI_ACP_PROFILE: AcpProviderProfile = {
  id: 'gemini-acp',
  label: 'Gemini ACP',
  family: 'gemini',
  tier: 1,
  summary: 'Tier 1 Gemini ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const CURSOR_ACP_PROFILE: AcpProviderProfile = {
  id: 'cursor-acp',
  label: 'Cursor ACP',
  family: 'cursor',
  tier: 1,
  summary: 'Tier 1 Cursor ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const COPILOT_ACP_PROFILE: AcpProviderProfile = {
  id: 'copilot-acp',
  label: 'Copilot ACP',
  family: 'copilot',
  tier: 1,
  summary: 'Tier 1 Copilot ACP target with public preview registry evidence.',
  probe: {
    helpArgs: ['--help'],
  },
};

const OPENCODE_ACP_PROFILE: AcpProviderProfile = {
  id: 'opencode-acp',
  label: 'OpenCode ACP',
  family: 'opencode',
  tier: 2,
  summary: 'Tier 2 OpenCode ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const KILO_ACP_PROFILE: AcpProviderProfile = {
  id: 'kilo-acp',
  label: 'Kilo ACP',
  family: 'kilo',
  tier: 2,
  summary: 'Tier 2 Kilo ACP target with curated registry evidence.',
  probe: {
    helpArgs: ['--help'],
  },
};

const GOOSE_ACP_PROFILE: AcpProviderProfile = {
  id: 'goose-acp',
  label: 'Goose ACP',
  family: 'goose',
  tier: 2,
  summary: 'Tier 2 Goose ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const PI_ACP_PROFILE: AcpProviderProfile = {
  id: 'pi-acp',
  label: 'Pi ACP',
  family: 'pi',
  tier: 2,
  summary: 'Tier 2 Pi ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const AUGGIE_ACP_PROFILE: AcpProviderProfile = {
  id: 'auggie-acp',
  label: 'Auggie ACP',
  family: 'auggie',
  tier: 2,
  summary: 'Tier 2 Auggie ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const JUNIE_ACP_PROFILE: AcpProviderProfile = {
  id: 'junie-acp',
  label: 'Junie ACP',
  family: 'junie',
  tier: 2,
  summary: 'Tier 2 Junie ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const KIRO_ACP_PROFILE: AcpProviderProfile = {
  id: 'kiro-acp',
  label: 'Kiro ACP',
  family: 'kiro',
  tier: 2,
  summary: 'Tier 2 Kiro ACP target with public ACP-compatible evidence.',
  probe: {
    helpArgs: ['--help'],
  },
};

function stripPackageVersion(token: string): string {
  if (!token) {
    return '';
  }

  if (token.startsWith('@')) {
    const slashIndex = token.indexOf('/');
    if (slashIndex === -1) {
      return token;
    }

    const versionIndex = token.indexOf('@', slashIndex + 1);
    return versionIndex === -1 ? token : token.slice(0, versionIndex);
  }

  const versionIndex = token.indexOf('@');
  return versionIndex === -1 ? token : token.slice(0, versionIndex);
}

function stripExecutableExtension(token: string): string {
  return token.replace(/\.(cmd|exe|bat|ps1|sh|js|mjs|cjs)$/u, '');
}

function normalizeToken(token: string | undefined): string {
  if (!token) {
    return '';
  }

  return stripExecutableExtension(stripPackageVersion(token.trim().toLowerCase()));
}

function normalizeCommandName(command: string | undefined): string {
  if (!command) {
    return '';
  }

  return normalizeToken(win32.basename(command)) || normalizeToken(basename(command));
}

function collectArgTokens(args: readonly string[] | undefined): Set<string> {
  const tokens = new Set<string>();

  for (const arg of args || []) {
    const normalizedArg = normalizeToken(arg);
    const normalizedBase = normalizeToken(basename(arg));
    const normalizedWindowsBase = normalizeToken(win32.basename(arg));

    if (normalizedArg) {
      tokens.add(normalizedArg);
    }
    if (normalizedBase) {
      tokens.add(normalizedBase);
    }
    if (normalizedWindowsBase) {
      tokens.add(normalizedWindowsBase);
    }
  }

  return tokens;
}

function hasHelpFlag(args: readonly string[] | undefined): boolean {
  return (args || []).some((arg) => arg === '--help' || arg === '-h');
}

export function resolveAcpProviderProfile(
  instance: RemoteProviderInstanceConfig,
): AcpProviderProfile | undefined {
  const providerName = normalizeToken(instance.providerName);
  const commandName = normalizeCommandName(instance.command);
  const argNames = collectArgTokens(instance.args);
  const hasAcpSubcommand = argNames.has('acp');
  const hasAcpFlag = argNames.has('--acp') || argNames.has('--acp=true');

  if (
    providerName === 'codex'
    || commandName === 'codex-acp'
    || argNames.has('codex-acp')
    || argNames.has('@zed-industries/codex-acp')
  ) {
    return CODEX_ACP_PROFILE;
  }

  if (
    providerName === 'claude'
    || commandName === 'claude-acp'
    || commandName === 'claude-agent-acp'
    || argNames.has('claude-acp')
    || argNames.has('claude-agent-acp')
    || argNames.has('@agentclientprotocol/claude-agent-acp')
  ) {
    return CLAUDE_ACP_PROFILE;
  }

  if (
    providerName === 'gemini'
    || commandName === 'gemini-acp'
    || argNames.has('gemini-acp')
    || argNames.has('@google/gemini-acp')
  ) {
    return GEMINI_ACP_PROFILE;
  }

  if (
    providerName === 'cursor'
    || commandName === 'cursor-acp'
    || argNames.has('cursor-acp')
    || argNames.has('@cursor/cursor-acp')
  ) {
    return CURSOR_ACP_PROFILE;
  }

  if (
    providerName === 'copilot'
    || commandName === 'copilot-acp'
    || commandName === 'github-copilot-acp'
    || argNames.has('copilot-acp')
    || argNames.has('github-copilot-acp')
    || argNames.has('@github/copilot-acp')
  ) {
    return COPILOT_ACP_PROFILE;
  }

  if (
    providerName === 'opencode'
    || commandName === 'opencode-acp'
    || (commandName === 'opencode' && hasAcpSubcommand)
    || argNames.has('opencode-acp')
  ) {
    return OPENCODE_ACP_PROFILE;
  }

  if (
    providerName === 'kilo'
    || commandName === 'kilo-acp'
    || (commandName === 'kilo' && hasAcpSubcommand)
    || argNames.has('kilo-acp')
    || (argNames.has('@kilocode/cli') && hasAcpSubcommand)
  ) {
    return KILO_ACP_PROFILE;
  }

  if (
    providerName === 'goose'
    || commandName === 'goose-acp'
    || (commandName === 'goose' && hasAcpSubcommand)
    || argNames.has('goose-acp')
  ) {
    return GOOSE_ACP_PROFILE;
  }

  if (
    providerName === 'pi'
    || commandName === 'pi-acp'
    || argNames.has('pi-acp')
  ) {
    return PI_ACP_PROFILE;
  }

  if (
    providerName === 'auggie'
    || commandName === 'auggie-acp'
    || commandName === 'augment-code-acp'
    || (commandName === 'auggie' && hasAcpFlag)
    || argNames.has('auggie-acp')
    || argNames.has('augment-code-acp')
    || (argNames.has('@augmentcode/auggie') && hasAcpFlag)
  ) {
    return AUGGIE_ACP_PROFILE;
  }

  if (
    providerName === 'junie'
    || commandName === 'junie-acp'
    || (commandName === 'junie' && hasAcpFlag)
    || argNames.has('junie-acp')
  ) {
    return JUNIE_ACP_PROFILE;
  }

  if (
    providerName === 'kiro'
    || commandName === 'kiro-acp'
    || commandName === 'kiro-cli-acp'
    || (commandName === 'kiro-cli' && hasAcpSubcommand)
    || argNames.has('kiro-acp')
    || argNames.has('kiro-cli-acp')
  ) {
    return KIRO_ACP_PROFILE;
  }

  return undefined;
}

export function buildAcpHelpProbeArgs(
  instance: RemoteProviderInstanceConfig,
  profile: AcpProviderProfile | undefined,
): string[] {
  const configuredArgs = instance.args ? [...instance.args] : [];
  if (hasHelpFlag(configuredArgs)) {
    return configuredArgs;
  }

  if (configuredArgs.length > 0) {
    configuredArgs.push('--help');
    return configuredArgs;
  }

  return profile ? [...profile.probe.helpArgs] : ['--help'];
}
