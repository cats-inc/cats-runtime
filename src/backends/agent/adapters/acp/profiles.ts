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
