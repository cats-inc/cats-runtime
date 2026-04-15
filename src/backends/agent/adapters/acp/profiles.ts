import { basename } from 'node:path';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';

export interface AcpProviderProfile {
  id: string;
  label: string;
  family: string;
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
  summary: 'Tier 1 Codex ACP pilot target with runtime overlap on JSON-RPC lifecycle semantics.',
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
  summary: 'Tier 1 Claude ACP target with auth-capable registry profile.',
  probe: {
    helpArgs: ['--help'],
  },
};

const GEMINI_ACP_PROFILE: AcpProviderProfile = {
  id: 'gemini-acp',
  label: 'Gemini ACP',
  family: 'gemini',
  summary: 'Tier 1 Gemini ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const CURSOR_ACP_PROFILE: AcpProviderProfile = {
  id: 'cursor-acp',
  label: 'Cursor ACP',
  family: 'cursor',
  summary: 'Tier 1 Cursor ACP target with public and curated registry overlap.',
  probe: {
    helpArgs: ['--help'],
  },
};

const COPILOT_ACP_PROFILE: AcpProviderProfile = {
  id: 'copilot-acp',
  label: 'Copilot ACP',
  family: 'copilot',
  summary: 'Tier 1 Copilot ACP target with public preview registry evidence.',
  probe: {
    helpArgs: ['--help'],
  },
};

function normalizeCommandName(command: string | undefined): string {
  if (!command) {
    return '';
  }

  return basename(command).trim().toLowerCase();
}

function hasHelpFlag(args: readonly string[] | undefined): boolean {
  return (args || []).some((arg) => arg === '--help' || arg === '-h');
}

export function resolveAcpProviderProfile(
  instance: RemoteProviderInstanceConfig,
): AcpProviderProfile | undefined {
  const providerName = instance.providerName.trim().toLowerCase();
  const commandName = normalizeCommandName(instance.command);
  const argNames = new Set((instance.args || [])
    .map((arg) => basename(arg).trim().toLowerCase()));

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
