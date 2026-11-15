import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderSessionCapabilities } from '../../../core/interactions/capabilities.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

export type KimiDependency = ProviderSessionCapabilities['dependencies'][number];

/** Kimi lists an installed plugin's skill as `skill:<plugin>:<skill>` in ACP available commands. */
const COMPUTER_USE_SKILL = /^skill:kimi-cu(?:-win)?:/u;
/** kimi-cu-win 0.3.13 bundle.json `node_runtime.minimum_version`. */
const MINIMUM_NODE = [24, 15, 0] as const;
const INSTALL_PLUGIN = 'Run kimi in a terminal, open /plugins, install Kimi Computer Use, then start a new conversation.';

export interface KimiComputerUseHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  /** `node --version` from the PATH Kimi's plugin starts with, or null when there is none. */
  nodeVersion(): Promise<string | null>;
}

export function defaultKimiComputerUseHost(): KimiComputerUseHost {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    nodeVersion: () => new Promise(resolve => {
      execFile('node', ['--version'], { timeout: 5000, env: process.env, ...hiddenWindowsSpawnOptions() },
        (error, stdout) => resolve(error ? null : String(stdout).trim() || null));
    }),
  };
}

/**
 * The plugin README's runtime lookup: an explicit KIMI_CU_WINDOWS_EXE, then
 * KIMI_CU_WINDOWS_HOME, then `%LOCALAPPDATA%\Kimi Computer Use` and the older `KimiCU`.
 */
export function kimiComputerUseRuntimeCandidates(env: NodeJS.ProcessEnv): string[] {
  if (env.KIMI_CU_WINDOWS_EXE) return [env.KIMI_CU_WINDOWS_EXE];
  if (env.KIMI_CU_WINDOWS_HOME) return [join(env.KIMI_CU_WINDOWS_HOME, 'kimi-cu.exe')];
  const local = env.LOCALAPPDATA;
  return local ? [join(local, 'Kimi Computer Use', 'kimi-cu.exe'), join(local, 'KimiCU', 'kimi-cu.exe')] : [];
}

function atLeast(version: string, minimum: readonly number[]): boolean {
  const parts = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version)?.slice(1).map(Number);
  if (!parts) return false;
  for (let index = 0; index < minimum.length; index++) {
    if (parts[index]! !== minimum[index]!) return parts[index]! > minimum[index]!;
  }
  return true;
}

/**
 * Kimi's computer use is its own plugin (kimi-cu-win on Windows), loaded at session start
 * from the user's Kimi home. Runtime reports what it can observe: whether this session
 * loaded the plugin, whether the native runtime the plugin needs is installed, and whether
 * Node.js is new enough. It never installs or configures any of them.
 */
export async function kimiComputerUseDependency(commands: readonly string[] | null,
  host: KimiComputerUseHost): Promise<KimiDependency> {
  const unavailable = (evidence: string, remediation: string): KimiDependency =>
    ({ kind: 'computer_use', status: 'unavailable', evidence, remediation });
  if (commands === null) {
    return { kind: 'computer_use', status: 'unknown', evidence: 'Kimi has not listed this session\'s skills yet.',
      remediation: 'Send a message, then refresh.' };
  }
  if (!commands.some(command => COMPUTER_USE_SKILL.test(command))) {
    return unavailable('Kimi did not load a computer-use plugin in this session.', INSTALL_PLUGIN);
  }
  if (host.platform !== 'win32') {
    return { kind: 'computer_use', status: 'unknown',
      evidence: 'Kimi loaded its computer-use plugin. Runtime checks the plugin\'s native runtime only on Windows.',
      remediation: 'Follow the plugin\'s own setup for this platform.' };
  }
  if (!kimiComputerUseRuntimeCandidates(host.env).some(path => host.exists(path))) {
    return unavailable('Kimi loaded its computer-use plugin, but the Kimi Computer Use runtime (kimi-cu.exe) is not installed.',
      'Install the runtime from https://cdn.kimi.com/kimi-computer-use-windows/latest/setup_windows.cmd, then start a new conversation.');
  }
  const node = await host.nodeVersion();
  if (!node || !atLeast(node, MINIMUM_NODE)) {
    return unavailable(node ? `Kimi Computer Use needs Node.js ${MINIMUM_NODE.join('.')} or later on PATH; found ${node.slice(0, 32)}.`
      : `Kimi Computer Use needs Node.js ${MINIMUM_NODE.join('.')} or later on PATH; none was found.`,
    'Install a current Node.js, then restart Cats so Kimi starts with the new PATH.');
  }
  return { kind: 'computer_use', status: 'available',
    evidence: `Kimi loaded its computer-use plugin; its runtime and Node.js ${node.slice(0, 32)} are installed. Each desktop action asks for approval.`,
    remediation: 'The desktop must be unlocked while Kimi works on it.' };
}
