import type { ProviderName } from '../../backends/cli/providers/types.js';
import type {
  ProviderCompatibilityKnowledge,
  ProviderCompatibilityProfile,
} from './types.js';

const CLAUDE_STREAM_JSON_ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
];

const GEMINI_STREAM_JSON_ARGS = [
  '--output-format', 'stream-json',
  '--yolo',
];

const COPILOT_JSON_ARGS = [
  '--output-format', 'json',
  '--stream', 'on',
];

function buildGenericFallbackProfile(provider: ProviderName): ProviderCompatibilityProfile {
  return {
    id: `${provider}-cli-runtime-default`,
    label: `${provider} CLI runtime default`,
    provider,
    protocolFamily: 'provider-default',
    parserId: `${provider}-built-in`,
  };
}

function buildKnowledge(
  provider: ProviderName,
  familyLabel: string,
  primaryProfile: ProviderCompatibilityProfile,
  fallbackProfile?: ProviderCompatibilityProfile,
): ProviderCompatibilityKnowledge {
  return {
    provider,
    familyLabel,
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    primaryProfile,
    fallbackProfile,
  };
}

const KNOWLEDGE: Partial<Record<ProviderName, ProviderCompatibilityKnowledge>> = {
  claude: buildKnowledge(
    'claude',
    'Claude CLI',
    {
      id: 'claude-cli-stream-json-v1',
      label: 'Claude CLI stream-json',
      provider: 'claude',
      protocolFamily: 'stream-json',
      parserId: 'claude-stream-json',
      spawnBaseArgs: [...CLAUDE_STREAM_JSON_ARGS],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['--input-format', '--output-format', '--include-partial-messages'],
    },
    {
      id: 'claude-cli-stream-json-best-fit',
      label: 'Claude CLI stream-json best-fit',
      provider: 'claude',
      protocolFamily: 'stream-json',
      parserId: 'claude-stream-json',
      spawnBaseArgs: [...CLAUDE_STREAM_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--input-format', '--output-format'],
    },
  ),
  codex: buildKnowledge(
    'codex',
    'Codex CLI',
    {
      id: 'codex-cli-json-rpc-app-server',
      label: 'Codex CLI app-server JSON-RPC',
      provider: 'codex',
      protocolFamily: 'json-rpc',
      parserId: 'codex-json-rpc',
      spawnBaseArgs: ['app-server'],
      allowUnknownVersion: true,
      helpTokens: ['app-server'],
    },
    {
      id: 'codex-cli-json-rpc-best-fit',
      label: 'Codex CLI best-fit',
      provider: 'codex',
      protocolFamily: 'json-rpc',
      parserId: 'codex-json-rpc',
      spawnBaseArgs: ['app-server'],
      allowUnknownVersion: true,
    },
  ),
  gemini: buildKnowledge(
    'gemini',
    'Gemini CLI',
    {
      id: 'gemini-cli-stream-json-v1',
      label: 'Gemini CLI stream-json',
      provider: 'gemini',
      protocolFamily: 'stream-json',
      parserId: 'gemini-stream-json',
      spawnBaseArgs: [...GEMINI_STREAM_JSON_ARGS],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--resume'],
    },
    {
      id: 'gemini-cli-stream-json-best-fit',
      label: 'Gemini CLI stream-json best-fit',
      provider: 'gemini',
      protocolFamily: 'stream-json',
      parserId: 'gemini-stream-json',
      spawnBaseArgs: [...GEMINI_STREAM_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--output-format'],
    },
  ),
  copilot: buildKnowledge(
    'copilot',
    'GitHub Copilot CLI',
    {
      id: 'copilot-cli-json-stream-v1',
      label: 'Copilot CLI JSON stream',
      provider: 'copilot',
      protocolFamily: 'json-event-stream',
      parserId: 'copilot-json-stream',
      spawnBaseArgs: [...COPILOT_JSON_ARGS],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--stream', '--resume'],
    },
    {
      id: 'copilot-cli-json-stream-best-fit',
      label: 'Copilot CLI JSON stream best-fit',
      provider: 'copilot',
      protocolFamily: 'json-event-stream',
      parserId: 'copilot-json-stream',
      spawnBaseArgs: [...COPILOT_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--stream'],
    },
  ),
};

export function getProviderCompatibilityKnowledge(
  provider: ProviderName,
): ProviderCompatibilityKnowledge | undefined {
  return KNOWLEDGE[provider];
}

export function getDefaultCompatibilityProfile(
  provider: ProviderName,
): ProviderCompatibilityProfile {
  return getProviderCompatibilityKnowledge(provider)?.fallbackProfile
    || getProviderCompatibilityKnowledge(provider)?.primaryProfile
    || buildGenericFallbackProfile(provider);
}
