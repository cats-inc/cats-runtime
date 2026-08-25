import { basename, win32 } from 'node:path';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';

/**
 * Maps runtime permission modes onto an agent's own ACP session modes.
 *
 * Only declare this for agents whose default session mode is more permissive
 * than the runtime's `default`. Agents that route every tool through
 * `session/request_permission` need no mapping, because the runtime's
 * request-time decision already governs them.
 *
 * `null` marks a runtime mode the agent cannot represent, and makes the adapter
 * refuse rather than silently run under a weaker mode.
 */
export interface AcpSessionModeMapping {
  skip?: string | null;
  default?: string | null;
  whitelist?: string | null;
}

export interface AcpProviderProfile {
  id: string;
  label: string;
  family: string;
  tier: 1 | 2;
  summary: string;
  clientCapabilityMeta?: Record<string, unknown>;
  sessionModes?: AcpSessionModeMapping;
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

const ANTIGRAVITY_ACP_PROFILE: AcpProviderProfile = {
  id: 'agy-acp',
  label: 'Antigravity ACP',
  family: 'antigravity',
  tier: 1,
  summary: 'Tier 1 Antigravity ACP target aligned with the agy-acp adapter contract.',
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

const DEVIN_ACP_PROFILE: AcpProviderProfile = {
  id: 'devin-acp',
  label: 'Devin ACP',
  family: 'devin',
  tier: 1,
  summary: 'Tier 1 Devin ACP target served by the devin acp stdio subcommand, verified against '
    + 'Devin 3000.3.27 (protocolVersion 1, loadSession, four session modes) and re-probed on '
    + '3000.5.20, which additionally advertises sessionCapabilities.list and .delete; the '
    + 'runtime uses list for session discovery and delete when a runtime session is deleted.',
  // Devin defaults to `accept-edits`, which performs fs/write_text_file without
  // ever issuing session/request_permission. Leaving the mode unset would let a
  // runtime `default` turn edit the workspace un-gated, so the mode is pinned.
  //
  // Live probe (Devin 3000.3.27, "create a file" prompt, permission requests
  // rejected by the client):
  //   accept-edits -> file written, no permission request for the write
  //   ask          -> no write attempted, no permission request
  //   bypass       -> file written, no permission request
  sessionModes: {
    skip: 'bypass',
    default: 'ask',
    // No Devin mode enforces a per-tool allowlist: `accept-edits` lets edits
    // through un-gated and `ask` blocks them outright, so an allowlist could
    // never both permit and constrain an edit tool.
    whitelist: null,
  },
  probe: {
    // Devin serves ACP from a subcommand, so its help lives behind `acp`.
    helpArgs: ['acp', '--help'],
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
    (providerName === 'antigravity' && instance.transport === 'acp')
    || commandName === 'agy-acp'
    || argNames.has('agy-acp')
  ) {
    return ANTIGRAVITY_ACP_PROFILE;
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
    commandName === 'opencode-acp'
    || (commandName === 'opencode' && hasAcpSubcommand)
    || argNames.has('opencode-acp')
  ) {
    return OPENCODE_ACP_PROFILE;
  }

  if (
    commandName === 'kilo-acp'
    || (commandName === 'kilo' && hasAcpSubcommand)
    || argNames.has('kilo-acp')
    || (argNames.has('@kilocode/cli') && hasAcpSubcommand)
  ) {
    return KILO_ACP_PROFILE;
  }

  if (
    commandName === 'goose-acp'
    || (commandName === 'goose' && hasAcpSubcommand)
    || argNames.has('goose-acp')
  ) {
    return GOOSE_ACP_PROFILE;
  }

  if (
    commandName === 'pi-acp'
    || argNames.has('pi-acp')
  ) {
    return PI_ACP_PROFILE;
  }

  if (
    commandName === 'auggie-acp'
    || commandName === 'augment-code-acp'
    || (commandName === 'auggie' && hasAcpFlag)
    || argNames.has('auggie-acp')
    || argNames.has('augment-code-acp')
    || (argNames.has('@augmentcode/auggie') && hasAcpFlag)
  ) {
    return AUGGIE_ACP_PROFILE;
  }

  if (
    commandName === 'junie-acp'
    || (commandName === 'junie' && hasAcpFlag)
    || argNames.has('junie-acp')
  ) {
    return JUNIE_ACP_PROFILE;
  }

  if (
    commandName === 'kiro-acp'
    || commandName === 'kiro-cli-acp'
    || (commandName === 'kiro-cli' && hasAcpSubcommand)
    || argNames.has('kiro-acp')
    || argNames.has('kiro-cli-acp')
  ) {
    return KIRO_ACP_PROFILE;
  }

  // Devin ships no standalone *-acp binary; ACP is a subcommand of the CLI
  // itself, so `devin` alone is not an ACP target.
  if (
    providerName === 'devin'
    || commandName === 'devin-acp'
    || argNames.has('devin-acp')
    || (commandName === 'devin' && hasAcpSubcommand)
  ) {
    return DEVIN_ACP_PROFILE;
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
