import { existsSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import type { ProviderCommandConfig, RuntimeConfig } from '../config.js';

export interface ShellInvocation {
  command: string;
  args: string[];
}

export interface ProcessSpawnConfig extends ShellInvocation {
  shell: boolean | string;
  cwd?: string;
  env?: Record<string, string>;
}

const POWERSHELL_EXEC_PAYLOAD_ENV = 'CATS_RUNTIME_PWSH_EXEC_B64';

export interface RuntimeAdapter {
  readonly mode: RuntimeConfig['mode'];
  toRuntimePath(path: string): string;
  toHostPath(path: string): string;
  buildShellInvocation(script: string): ShellInvocation;
}

export function createRuntimeAdapter(config: RuntimeConfig): RuntimeAdapter {
  if (config.mode === 'wsl') {
    return new WslRuntimeAdapter(config.distro || 'Ubuntu');
  }
  return new NativeRuntimeAdapter();
}

class NativeRuntimeAdapter implements RuntimeAdapter {
  readonly mode = 'native' as const;

  toRuntimePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  toHostPath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  buildShellInvocation(script: string): ShellInvocation {
    if (process.platform === 'win32') {
      return {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', script],
      };
    }

    return {
      command: 'bash',
      args: ['-lc', script],
    };
  }
}

class WslRuntimeAdapter implements RuntimeAdapter {
  readonly mode = 'wsl' as const;
  private readonly distro: string;

  constructor(distro: string) {
    this.distro = distro;
  }

  toRuntimePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) return trimmed;

    const slashPath = trimmed.replace(/\\/g, '/');
    if (slashPath.startsWith('/')) {
      return slashPath;
    }

    const driveMatch = slashPath.match(/^([A-Za-z]):(\/.*)?$/);
    if (!driveMatch) {
      return slashPath;
    }

    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2] || '';
    return `/mnt/${drive}${rest}`;
  }

  toHostPath(path: string): string {
    const trimmed = path.trim();
    const match = trimmed.match(/^\/mnt\/([a-z])\/(.*)$/);
    if (!match) {
      return trimmed.replace(/\\/g, '/');
    }

    const drive = match[1].toUpperCase();
    return `${drive}:/${match[2]}`;
  }

  buildShellInvocation(script: string): ShellInvocation {
    return {
      command: 'wsl',
      args: ['-d', this.distro, 'bash', '-lc', script],
    };
  }
}

export function buildProcessSpawnConfig(
  commandConfig: ProviderCommandConfig,
  providerName: string,
  args: string[],
  cwd: string,
): ProcessSpawnConfig {
  if (commandConfig.runtime.mode === 'wsl') {
    return buildWslSpawnConfig(commandConfig, args, cwd);
  }
  return buildNativeSpawnConfig(commandConfig, providerName, args, cwd);
}

export function buildPowerShellCommandScript(): string {
  return [
    `$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:${POWERSHELL_EXEC_PAYLOAD_ENV}))`,
    '$payload = $payloadJson | ConvertFrom-Json',
    '$agentFleetArgs = @()',
    'foreach ($item in $payload.args) { $agentFleetArgs += [string]$item }',
    '& ([string]$payload.command) @agentFleetArgs',
    'exit $LASTEXITCODE',
  ].join('; ');
}

export function buildPowerShellExecEnv(
  commandPath: string,
  args: string[],
): Record<string, string> {
  return {
    [POWERSHELL_EXEC_PAYLOAD_ENV]: Buffer.from(JSON.stringify({
      command: commandPath,
      args,
    }), 'utf8').toString('base64'),
  };
}

export function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildWslSpawnConfig(
  commandConfig: ProviderCommandConfig,
  args: string[],
  cwd: string,
): ProcessSpawnConfig {
  const runtime = createRuntimeAdapter(commandConfig.runtime);
  const runtimeCwd = runtime.toRuntimePath(cwd);
  const payload = Buffer.from(JSON.stringify({
    cwd: runtimeCwd,
    command: commandConfig.path,
    args,
  }), 'utf8').toString('base64');
  const wslenv = appendWslenv(process.env.WSLENV, 'CATS_RUNTIME_WSL_EXEC_B64');
  const commandScript = [
    'python3 - <<\'PY\'',
    'import base64',
    'import json',
    'import os',
    '',
    'payload = json.loads(base64.b64decode(os.environ["CATS_RUNTIME_WSL_EXEC_B64"]).decode("utf-8"))',
    'os.chdir(payload["cwd"])',
    'argv = [payload["command"], *payload.get("args", [])]',
    'os.execvp(argv[0], argv)',
    'PY',
  ].join('\n');

  return {
    command: 'wsl',
    args: [
      '-d',
      commandConfig.runtime.distro || 'Ubuntu',
      'bash',
      '-lc',
      commandScript,
    ],
    shell: false,
    env: {
      CATS_RUNTIME_WSL_EXEC_B64: payload,
      WSLENV: wslenv,
    },
  };
}

function appendWslenv(existing: string | undefined, name: string): string {
  if (!existing) return name;

  const parts = existing.split(':').filter(Boolean);
  if (parts.includes(name)) return existing;
  return `${existing}:${name}`;
}

function buildNativeSpawnConfig(
  commandConfig: ProviderCommandConfig,
  providerName: string,
  args: string[],
  cwd: string,
): ProcessSpawnConfig {
  const commandPath = resolveCommandPathForRunner(
    commandConfig.path,
    commandConfig.runner,
  );

  if (
    process.platform === 'win32'
    && providerName === 'copilot'
    && commandConfig.runner === 'auto'
  ) {
    return buildPowerShellSpawnConfig(
      commandPath,
      args,
      commandConfig.runnerPath || process.env.PWSH_PATH || 'pwsh.exe',
      cwd,
    );
  }

  switch (commandConfig.runner) {
    case 'auto':
      if (process.platform !== 'win32') {
        return {
          command: commandPath,
          args,
          shell: false,
          cwd,
        };
      }
      return {
        command: commandPath,
        args,
        shell: true,
        cwd,
      };

    case 'shell':
      return {
        command: commandPath,
        args,
        shell: true,
        cwd,
      };

    case 'direct':
      return {
        command: commandPath,
        args,
        shell: false,
        cwd,
      };

    case 'cmd':
      return {
        command: commandPath,
        args,
        shell: commandConfig.runnerPath || process.env.ComSpec || 'cmd.exe',
        cwd,
      };

    case 'pwsh':
      return buildPowerShellSpawnConfig(
        commandPath,
        args,
        commandConfig.runnerPath || process.env.PWSH_PATH || 'pwsh.exe',
        cwd,
      );

    case 'powershell':
      return buildPowerShellSpawnConfig(
        commandPath,
        args,
        commandConfig.runnerPath || 'powershell.exe',
        cwd,
      );
  }
}

function buildPowerShellSpawnConfig(
  commandPath: string,
  args: string[],
  shellPath: string,
  cwd: string,
): ProcessSpawnConfig {
  return {
    command: shellPath,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      buildPowerShellCommandScript(),
    ],
    shell: false,
    cwd,
    env: buildPowerShellExecEnv(commandPath, args),
  };
}

function resolveCommandPathForRunner(
  commandPath: string,
  runner: ProviderCommandConfig['runner'],
): string {
  if (process.platform !== 'win32') {
    return commandPath;
  }
  if (runner === 'shell') {
    return commandPath;
  }
  return resolveWindowsCommandPath(commandPath);
}

function resolveWindowsCommandPath(commandPath: string): string {
  if (isExplicitPath(commandPath)) {
    return commandPath;
  }

  const pathDirs = (process.env.PATH || '')
    .split(delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  const extensions = extname(commandPath)
    ? ['']
    : buildWindowsExtensions();

  const resolvedFromPath = findCommandPath(commandPath, pathDirs, extensions);
  if (resolvedFromPath) {
    return resolvedFromPath;
  }

  const commonNpmDirs = buildCommonWindowsNpmDirs();
  const resolvedFromNpmBins = findCommandPath(commandPath, commonNpmDirs, [
    '.cmd',
    '.bat',
    '.exe',
    '',
  ]);
  return resolvedFromNpmBins || commandPath;
}

function isExplicitPath(commandPath: string): boolean {
  return isAbsolute(commandPath) || commandPath.includes('/') || commandPath.includes('\\');
}

function buildWindowsExtensions(): string[] {
  const pathext = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  return [...pathext, ''];
}

function findCommandPath(commandPath: string, dirs: string[], extensions: string[]): string | null {
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `${commandPath}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function buildCommonWindowsNpmDirs(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || (home ? join(home, 'AppData', 'Roaming') : '');
  const localAppData = process.env.LOCALAPPDATA || (home ? join(home, 'AppData', 'Local') : '');

  return Array.from(new Set([
    process.env.npm_config_prefix || '',
    home ? join(home, '.npm-global') : '',
    appData ? join(appData, 'npm') : '',
    localAppData ? join(localAppData, 'npm') : '',
  ].filter(Boolean)));
}
