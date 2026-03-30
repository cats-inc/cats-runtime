import type { ProviderName } from '../../backends/cli/providers/types.js';
import type {
  ProviderCompatibilityKnowledge,
  ProviderCompatibilityProfile,
} from './types.js';

const CLAUDE_STREAM_JSON_ARGS = [
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

const CURSOR_STREAM_JSON_ARGS = [
  '--trust',
  '--output-format', 'stream-json',
  '--stream-partial-output',
];

const GOOSE_STREAM_JSON_ARGS = [
  'run',
  '--output-format', 'stream-json',
  '--quiet',
  '--max-turns', '100',
];

const JUNIE_JSON_ARGS = [
  '--output-format', 'json',
  '--skip-update-check',
];

const KIRO_CHAT_ARGS = [
  'chat',
  '--no-interactive',
  '--wrap', 'never',
];

const PI_RPC_ARGS = [
  '--mode', 'rpc',
];

const AUGGIE_JSON_ARGS = [
  '--print',
  '--quiet',
  '--output-format', 'json',
];

function buildLiveHelpArgs(args: string[]): string[] {
  return [...args, '--help'];
}

function buildSubcommandHelpArgs(command: string): string[] {
  return ['help', command];
}

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
  options: {
    versionArgs?: string[];
    helpArgs?: string[];
  } = {},
): ProviderCompatibilityKnowledge {
  return {
    provider,
    familyLabel,
    versionArgs: options.versionArgs || ['--version'],
    helpArgs: options.helpArgs || ['--help'],
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
      liveProbeArgs: buildLiveHelpArgs(CLAUDE_STREAM_JSON_ARGS),
      liveProbeTokens: ['--input-format', '--output-format'],
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
      liveProbeArgs: buildLiveHelpArgs(CLAUDE_STREAM_JSON_ARGS),
      liveProbeTokens: ['--input-format', '--output-format'],
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
      liveProbeArgs: ['app-server', '--help'],
      liveProbeTokens: ['app-server'],
    },
    {
      id: 'codex-cli-json-rpc-best-fit',
      label: 'Codex CLI best-fit',
      provider: 'codex',
      protocolFamily: 'json-rpc',
      parserId: 'codex-json-rpc',
      spawnBaseArgs: ['app-server'],
      allowUnknownVersion: true,
      liveProbeArgs: ['app-server', '--help'],
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
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--resume'],
      liveProbeArgs: buildLiveHelpArgs(GEMINI_STREAM_JSON_ARGS),
      liveProbeTokens: ['--output-format'],
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
      liveProbeArgs: buildLiveHelpArgs(GEMINI_STREAM_JSON_ARGS),
      liveProbeTokens: ['--output-format'],
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
      liveProbeArgs: buildLiveHelpArgs(COPILOT_JSON_ARGS),
      liveProbeTokens: ['--output-format', '--stream'],
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
      liveProbeArgs: buildLiveHelpArgs(COPILOT_JSON_ARGS),
      liveProbeTokens: ['--output-format', '--stream'],
    },
  ),
  cursor: buildKnowledge(
    'cursor',
    'Cursor Agent CLI',
    {
      id: 'cursor-cli-stream-json-v1',
      label: 'Cursor Agent CLI stream-json',
      provider: 'cursor',
      protocolFamily: 'stream-json',
      parserId: 'cursor-stream-json',
      spawnBaseArgs: [
        '-p',
        ...CURSOR_STREAM_JSON_ARGS,
      ],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--stream-partial-output', '--resume'],
      // Cursor's `-p` flag expects an inline prompt payload, so the live probe
      // intentionally validates the stream-json flags without carrying `-p`.
      liveProbeArgs: buildLiveHelpArgs(CURSOR_STREAM_JSON_ARGS),
      liveProbeTokens: ['--output-format', '--stream-partial-output'],
    },
    {
      id: 'cursor-cli-stream-json-best-fit',
      label: 'Cursor Agent CLI stream-json best-fit',
      provider: 'cursor',
      protocolFamily: 'stream-json',
      parserId: 'cursor-stream-json',
      spawnBaseArgs: [
        '-p',
        ...CURSOR_STREAM_JSON_ARGS,
      ],
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--stream-partial-output'],
      // Cursor's `-p` flag expects an inline prompt payload, so the live probe
      // intentionally validates the stream-json flags without carrying `-p`.
      liveProbeArgs: buildLiveHelpArgs(CURSOR_STREAM_JSON_ARGS),
      liveProbeTokens: ['--output-format', '--stream-partial-output'],
    },
  ),
  goose: buildKnowledge(
    'goose',
    'Goose CLI',
    {
      id: 'goose-cli-stream-json-v1',
      label: 'Goose CLI stream-json',
      provider: 'goose',
      protocolFamily: 'stream-json',
      parserId: 'goose-stream-json',
      spawnBaseArgs: [...GOOSE_STREAM_JSON_ARGS],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['run', '--output-format', '--max-turns'],
      // Prefer `help run` over `run ... --help` so diagnostics do not risk
      // starting a session while still validating the run-subcommand flags.
      liveProbeArgs: buildSubcommandHelpArgs('run'),
      liveProbeTokens: ['--output-format', '--max-turns'],
    },
    {
      id: 'goose-cli-stream-json-best-fit',
      label: 'Goose CLI stream-json best-fit',
      provider: 'goose',
      protocolFamily: 'stream-json',
      parserId: 'goose-stream-json',
      spawnBaseArgs: [...GOOSE_STREAM_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['run', '--output-format'],
      // Prefer `help run` over `run ... --help` so diagnostics do not risk
      // starting a session while still validating the run-subcommand flags.
      liveProbeArgs: buildSubcommandHelpArgs('run'),
      liveProbeTokens: ['--output-format'],
    },
    {
      helpArgs: buildSubcommandHelpArgs('run'),
    },
  ),
  junie: buildKnowledge(
    'junie',
    'Junie CLI',
    {
      id: 'junie-cli-json-v1',
      label: 'Junie CLI JSON output',
      provider: 'junie',
      protocolFamily: 'json-result',
      parserId: 'junie-json',
      spawnBaseArgs: [...JUNIE_JSON_ARGS],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--project', '--session-id'],
      liveProbeArgs: buildLiveHelpArgs(JUNIE_JSON_ARGS),
      liveProbeTokens: ['--output-format'],
    },
    {
      id: 'junie-cli-json-best-fit',
      label: 'Junie CLI JSON output best-fit',
      provider: 'junie',
      protocolFamily: 'json-result',
      parserId: 'junie-json',
      spawnBaseArgs: [...JUNIE_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--session-id'],
      liveProbeArgs: buildLiveHelpArgs(JUNIE_JSON_ARGS),
      liveProbeTokens: ['--output-format'],
    },
  ),
  kiro: buildKnowledge(
    'kiro',
    'Kiro CLI',
    {
      id: 'kiro-cli-chat-v1',
      label: 'Kiro CLI non-interactive chat',
      provider: 'kiro',
      protocolFamily: 'wrapped-text',
      parserId: 'kiro-chat',
      spawnBaseArgs: [...KIRO_CHAT_ARGS],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['chat', '--no-interactive', '--resume'],
      liveProbeArgs: buildLiveHelpArgs(KIRO_CHAT_ARGS),
      liveProbeTokens: ['--no-interactive', '--wrap'],
    },
    {
      id: 'kiro-cli-chat-best-fit',
      label: 'Kiro CLI non-interactive chat best-fit',
      provider: 'kiro',
      protocolFamily: 'wrapped-text',
      parserId: 'kiro-chat',
      spawnBaseArgs: [...KIRO_CHAT_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['chat', '--no-interactive'],
      liveProbeArgs: buildLiveHelpArgs(KIRO_CHAT_ARGS),
      liveProbeTokens: ['--no-interactive'],
    },
    {
      helpArgs: ['chat', '--help'],
    },
  ),
  pi: buildKnowledge(
    'pi',
    'Pi Coding Agent CLI',
    {
      id: 'pi-cli-rpc-v1',
      label: 'Pi Coding Agent RPC mode',
      provider: 'pi',
      protocolFamily: 'rpc-json',
      parserId: 'pi-rpc',
      spawnBaseArgs: [...PI_RPC_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--mode', '--session'],
      liveProbeArgs: buildLiveHelpArgs(PI_RPC_ARGS),
      liveProbeTokens: ['--mode'],
    },
    {
      id: 'pi-cli-rpc-best-fit',
      label: 'Pi Coding Agent RPC mode best-fit',
      provider: 'pi',
      protocolFamily: 'rpc-json',
      parserId: 'pi-rpc',
      spawnBaseArgs: [...PI_RPC_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--mode'],
      liveProbeArgs: buildLiveHelpArgs(PI_RPC_ARGS),
      liveProbeTokens: ['--mode'],
    },
  ),
  auggie: buildKnowledge(
    'auggie',
    'Auggie CLI',
    {
      id: 'auggie-cli-json-print-v1',
      label: 'Auggie CLI print JSON mode',
      provider: 'auggie',
      protocolFamily: 'json-result',
      parserId: 'auggie-json',
      spawnBaseArgs: [...AUGGIE_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--output-format', '--workspace-root', '--resume'],
      liveProbeArgs: buildLiveHelpArgs(AUGGIE_JSON_ARGS),
      liveProbeTokens: ['--output-format'],
    },
    {
      id: 'auggie-cli-json-print-best-fit',
      label: 'Auggie CLI print JSON mode best-fit',
      provider: 'auggie',
      protocolFamily: 'json-result',
      parserId: 'auggie-json',
      spawnBaseArgs: [...AUGGIE_JSON_ARGS],
      allowUnknownVersion: true,
      helpTokens: ['--output-format'],
      liveProbeArgs: buildLiveHelpArgs(AUGGIE_JSON_ARGS),
      liveProbeTokens: ['--output-format'],
    },
  ),
  opencode: buildKnowledge(
    'opencode',
    'OpenCode CLI',
    {
      id: 'opencode-cli-native-v1',
      label: 'OpenCode native session service',
      provider: 'opencode',
      protocolFamily: 'native-session-service',
      parserId: 'opencode-native',
      spawnBaseArgs: [],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['serve', 'models'],
      liveProbeArgs: ['models', '--help'],
      liveProbeTokens: ['--refresh'],
    },
    {
      id: 'opencode-cli-native-best-fit',
      label: 'OpenCode native session service best-fit',
      provider: 'opencode',
      protocolFamily: 'native-session-service',
      parserId: 'opencode-native',
      spawnBaseArgs: [],
      allowUnknownVersion: true,
      helpTokens: ['models'],
      liveProbeArgs: ['models', '--help'],
      liveProbeTokens: ['--refresh'],
    },
  ),
  kilo: buildKnowledge(
    'kilo',
    'Kilo Code CLI',
    {
      id: 'kilo-cli-native-v1',
      label: 'Kilo native session service',
      provider: 'kilo',
      protocolFamily: 'native-session-service',
      parserId: 'kilo-native',
      spawnBaseArgs: [],
      minVersionMajor: 1,
      allowUnknownVersion: true,
      helpTokens: ['serve', 'models'],
      liveProbeArgs: ['models', '--help'],
      liveProbeTokens: ['--refresh'],
    },
    {
      id: 'kilo-cli-native-best-fit',
      label: 'Kilo native session service best-fit',
      provider: 'kilo',
      protocolFamily: 'native-session-service',
      parserId: 'kilo-native',
      spawnBaseArgs: [],
      allowUnknownVersion: true,
      helpTokens: ['models'],
      liveProbeArgs: ['models', '--help'],
      liveProbeTokens: ['--refresh'],
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
