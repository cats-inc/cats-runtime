import { describe, expect, it } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import type { ProviderSpawnOptions } from '../../../core/types.js';
import type { Provider, StreamEvent } from '../providers/types.js';
import { WorkerProcess } from './WorkerProcess.js';

const TOKEN = 'synthetic-session-mcp-secret';
const ENV_VAR = 'CATS_MCP_CATS_TOKEN';

function commandConfig(mode: 'native' | 'wsl'): ProviderCommandConfig {
  return mode === 'native'
    ? { path: process.execPath, runner: 'direct', runtime: { mode } }
    : { path: process.execPath, runner: 'direct', runtime: { mode, distro: 'Ubuntu' } };
}

/** Ephemeral child that reports whether it saw the token in its env and argv. */
function createEnvProbeProvider(seen: { opts?: ProviderSpawnOptions }): Provider {
  return {
    name: 'claude',
    capabilities: { resume: true, fork: false, permissions: true, sessionMcpServers: true },
    ephemeral: true,
    buildSpawnArgs(opts) {
      seen.opts = opts;
      return [
        '-e',
        [
          `const env = process.env[${JSON.stringify(ENV_VAR)}] === ${JSON.stringify(TOKEN)};`,
          `const argv = process.argv.join(' ').includes(${JSON.stringify(TOKEN)});`,
          "process.stdout.write(JSON.stringify({ env, argv }) + '\\n');",
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine(line: string): StreamEvent {
      return { type: 'result', text: line };
    },
    resolveFirstEventTimeoutMs() {
      return 0;
    },
  };
}

describe('WorkerProcess session MCP environment (SPEC-035)', () => {
  const mcpServers: ProviderSpawnOptions['mcpServers'] = [{
    name: 'cats',
    transport: 'http',
    url: 'http://127.0.0.1:3000/mcp',
    bearerTokenEnvVar: ENV_VAR,
  }];

  it('delivers the token through the child environment only', async () => {
    const seen: { opts?: ProviderSpawnOptions } = {};
    const worker = new WorkerProcess(
      createEnvProbeProvider(seen),
      { cwd: process.cwd(), mcpServers },
      commandConfig('native'),
      { retries: 1, timeoutMs: 5000 },
      false,
      { [ENV_VAR]: TOKEN },
    );

    const events = await worker.sendMessage('ignored');
    expect(JSON.parse((events[0] as { text: string }).text)).toEqual({ env: true, argv: false });
    expect(seen.opts?.mcpServers).toEqual(mcpServers);
    expect(JSON.stringify(seen.opts)).not.toContain(TOKEN);
  });

  it('refuses to launch with session MCP secrets outside a native runtime', async () => {
    const worker = new WorkerProcess(
      createEnvProbeProvider({}),
      { cwd: process.cwd(), mcpServers },
      commandConfig('wsl'),
      { retries: 1, timeoutMs: 5000 },
      false,
      { [ENV_VAR]: TOKEN },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      'Session MCP servers require a native CLI runtime.',
    );
  });
});
