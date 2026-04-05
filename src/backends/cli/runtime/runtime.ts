import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, posix as pathPosix, win32 as pathWin32 } from 'node:path';
import type { ProviderCommandConfig, ProviderRuntimeConfig } from '../config.js';
import { resolveRuntimeRoot, resolveRuntimeSessionsDir } from '../../../shared/runtimePaths.js';

export interface ShellInvocation {
  command: string;
  args: string[];
}

export interface ProcessSpawnConfig extends ShellInvocation {
  shell: boolean | string;
  cwd?: string;
  env?: Record<string, string>;
  windowsVerbatimArguments?: boolean;
}

interface RuntimePayloadFile {
  path: string;
  content: string;
}

interface RuntimeExecPayload {
  cwd: string;
  command: string;
  args: string[];
  ensureCwd?: boolean;
  tempFiles?: RuntimePayloadFile[];
}

const POWERSHELL_EXEC_PAYLOAD_ENV = 'CATS_RUNTIME_PWSH_EXEC_B64';
const WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.com']);

export interface RuntimeAdapter {
  readonly mode: ProviderRuntimeConfig['mode'];
  readonly distro?: string;
  toRuntimePath(path: string): string;
  toHostPath(path: string): string;
  buildShellInvocation(script: string): ShellInvocation;
}

export function createRuntimeAdapter(config: ProviderRuntimeConfig): RuntimeAdapter {
  if (config.mode === 'wsl') {
    return new WslRuntimeAdapter(config.distro || 'Ubuntu');
  }
  if (config.mode === 'docker') {
    return new DockerRuntimeAdapter(config.container || 'cats-cli');
  }
  return new NativeRuntimeAdapter();
}

class NativeRuntimeAdapter implements RuntimeAdapter {
  readonly mode = 'native' as const;
  readonly distro = undefined;

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
  readonly distro: string;

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

class DockerRuntimeAdapter implements RuntimeAdapter {
  readonly mode = 'docker' as const;
  readonly distro = undefined;
  readonly container: string;

  constructor(container: string) {
    this.container = container;
  }

  toRuntimePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  toHostPath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  buildShellInvocation(script: string): ShellInvocation {
    return {
      command: 'docker',
      args: ['exec', this.container, 'bash', '-lc', script],
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
    return buildWslSpawnConfig(commandConfig, providerName, args, cwd);
  }
  if (commandConfig.runtime.mode === 'docker') {
    return buildDockerSpawnConfig(commandConfig, providerName, args, cwd);
  }
  return buildNativeSpawnConfig(commandConfig, providerName, args, cwd);
}

export function buildPowerShellCommandScript(): string {
  return [
    `$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:${POWERSHELL_EXEC_PAYLOAD_ENV}))`,
    '$payload = $payloadJson | ConvertFrom-Json',
    '$runtimeArgs = @()',
    'foreach ($item in $payload.args) { $runtimeArgs += [string]$item }',
    '& ([string]$payload.command) @runtimeArgs',
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

export function buildWindowsCmdProxyCommandLine(
  commandPath: string,
  args: string[],
): string {
  const quotedParts = [commandPath, ...args].map(quoteWindowsCmdProxyArgument);
  return `"${quotedParts.join(' ')}"`;
}

export function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildWslSpawnConfig(
  commandConfig: ProviderCommandConfig,
  providerName: string,
  args: string[],
  cwd: string,
): ProcessSpawnConfig {
  const payload = Buffer.from(JSON.stringify(
    buildRuntimeExecPayload(commandConfig.runtime, providerName, commandConfig.path, args, cwd),
  ), 'utf8').toString('base64');
  const wslenv = appendWslenv(process.env.WSLENV, 'CATS_RUNTIME_WSL_EXEC_B64');
  const commandScript = [
    'python3 - <<\'PY\'',
    'import base64',
    'import json',
    'import os',
    '',
    'payload = json.loads(base64.b64decode(os.environ["CATS_RUNTIME_WSL_EXEC_B64"]).decode("utf-8"))',
    'if payload.get("ensureCwd"):',
    '    os.makedirs(payload["cwd"], exist_ok=True)',
    'for file in payload.get("tempFiles", []):',
    '    parent = os.path.dirname(file["path"])',
    '    if parent:',
    '        os.makedirs(parent, exist_ok=True)',
    '    with open(file["path"], "w", encoding="utf-8") as handle:',
    '        handle.write(file["content"])',
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

function buildDockerSpawnConfig(
  commandConfig: ProviderCommandConfig,
  providerName: string,
  args: string[],
  cwd: string,
): ProcessSpawnConfig {
  const payload = Buffer.from(JSON.stringify(
    buildRuntimeExecPayload(commandConfig.runtime, providerName, commandConfig.path, args, cwd),
  ), 'utf8').toString('base64');
  const commandScript = [
    'python3 - <<\'PY\'',
    'import base64',
    'import json',
    'import os',
    '',
    'payload = json.loads(base64.b64decode(os.environ["CATS_RUNTIME_DOCKER_EXEC_B64"]).decode("utf-8"))',
    'os.environ["PATH"] = "/root/.local/bin:" + os.environ.get("PATH", "")',
    'if payload.get("ensureCwd"):',
    '    os.makedirs(payload["cwd"], exist_ok=True)',
    'for file in payload.get("tempFiles", []):',
    '    parent = os.path.dirname(file["path"])',
    '    if parent:',
    '        os.makedirs(parent, exist_ok=True)',
    '    with open(file["path"], "w", encoding="utf-8") as handle:',
    '        handle.write(file["content"])',
    'os.chdir(payload["cwd"])',
    'argv = [payload["command"], *payload.get("args", [])]',
    'os.execvp(argv[0], argv)',
    'PY',
  ].join('\n');

  return {
    command: 'docker',
    args: [
      'exec',
      '-i',
      '-e',
      `CATS_RUNTIME_DOCKER_EXEC_B64=${payload}`,
      commandConfig.runtime.container || 'cats-cli',
      'bash',
      '-lc',
      commandScript,
    ],
    shell: false,
    env: {
      CATS_RUNTIME_DOCKER_EXEC_B64: payload,
    },
  };
}

function buildRuntimeExecPayload(
  runtimeConfig: ProviderRuntimeConfig,
  providerName: string,
  commandPath: string,
  args: string[],
  cwd: string,
): RuntimeExecPayload {
  const runtime = createRuntimeAdapter(runtimeConfig);
  const cwdInfo = runtimeConfig.mode === 'docker'
    ? resolveDockerRuntimeCwd(cwd)
    : {
      cwd: runtime.toRuntimePath(cwd),
      ensureCwd: false,
    };

  const translatedArgs = args.map((arg) => arg === cwd ? cwdInfo.cwd : arg);
  const tempFiles: RuntimePayloadFile[] = [];

  if (providerName === 'auggie') {
    translateRuntimeFileArg(
      translatedArgs,
      tempFiles,
      runtime,
      runtimeConfig,
      '--instruction-file',
      'auggie-instruction',
    );
  }

  if (providerName === 'pi') {
    translateRuntimeFileArg(
      translatedArgs,
      tempFiles,
      runtime,
      runtimeConfig,
      '--append-system-prompt',
      'pi-system-prompt',
    );
  }

  return {
    cwd: cwdInfo.cwd,
    command: commandPath,
    args: translatedArgs,
    ensureCwd: cwdInfo.ensureCwd || undefined,
    tempFiles: tempFiles.length > 0 ? tempFiles : undefined,
  };
}

function translateRuntimeFileArg(
  translatedArgs: string[],
  tempFiles: RuntimePayloadFile[],
  runtime: RuntimeAdapter,
  runtimeConfig: ProviderRuntimeConfig,
  flagName: string,
  tempFilePrefix: string,
): void {
  const fileIndex = translatedArgs.indexOf(flagName);
  if (fileIndex === -1 || fileIndex + 1 >= translatedArgs.length) {
    return;
  }

  const hostFile = translatedArgs[fileIndex + 1]!;
  if (!existsSync(hostFile)) {
    return;
  }

  if (runtimeConfig.mode === 'wsl') {
    translatedArgs[fileIndex + 1] = runtime.toRuntimePath(hostFile);
    return;
  }

  if (runtimeConfig.mode === 'docker') {
    const runtimeFile = pathPosix.join(
      '/tmp',
      'cats-runtime',
      `${tempFilePrefix}-${randomUUID()}.txt`,
    );
    tempFiles.push({
      path: runtimeFile,
      content: readFileSync(hostFile, 'utf8'),
    });
    translatedArgs[fileIndex + 1] = runtimeFile;
  }
}

function resolveDockerRuntimeCwd(cwd: string): { cwd: string; ensureCwd: boolean } {
  const mapped = mapHostRuntimeSessionPathToDocker(cwd);
  if (mapped) {
    return {
      cwd: mapped,
      ensureCwd: true,
    };
  }

  return {
    cwd: createRuntimeAdapter({ mode: 'docker' }).toRuntimePath(cwd),
    ensureCwd: false,
  };
}

function mapHostRuntimeSessionPathToDocker(cwd: string): string | null {
  const sessionBaseDir = resolveHostRuntimeSessionBaseDir();
  if (!sessionBaseDir) {
    return null;
  }

  const pathApi = selectHostPathApi(cwd, sessionBaseDir);
  const resolvedBase = stripTrailingSeparators(pathApi.resolve(sessionBaseDir));
  const resolvedCwd = stripTrailingSeparators(pathApi.resolve(cwd));
  const relative = pathApi.relative(resolvedBase, resolvedCwd);

  if (relative.startsWith('..') || pathApi.isAbsolute(relative)) {
    return null;
  }

  const normalizedRelative = relative.replace(/\\/g, '/');
  return normalizedRelative
    ? pathPosix.join('/root/.cats/runtime/sessions', normalizedRelative)
    : '/root/.cats/runtime/sessions';
}

function resolveHostRuntimeSessionBaseDir(): string {
  return resolveRuntimeSessionsDir(resolveRuntimeRoot(process.env));
}

function selectHostPathApi(left: string, right: string) {
  return looksLikeWindowsPath(left) || looksLikeWindowsPath(right)
    ? pathWin32
    : pathPosix;
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\');
}

function stripTrailingSeparators(pathValue: string): string {
  if (!pathValue || pathValue.length <= 1 || /^[A-Za-z]:[\\/]$/.test(pathValue)) {
    return pathValue;
  }

  const stripped = pathValue.replace(/[\\/]+$/, '');
  return stripped || pathValue;
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
      if (shouldUseDirectWindowsSpawn(commandPath)) {
        return {
          command: commandPath,
          args,
          shell: false,
          cwd,
        };
      }
      return buildWindowsShellProxySpawnConfig(commandPath, args, cwd);

    case 'shell':
      if (process.platform === 'win32') {
        return buildWindowsShellProxySpawnConfig(commandPath, args, cwd);
      }
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
      return buildWindowsShellProxySpawnConfig(
        commandPath,
        args,
        cwd,
        commandConfig.runnerPath || process.env.ComSpec || 'cmd.exe',
      );

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

function buildWindowsShellProxySpawnConfig(
  commandPath: string,
  args: string[],
  cwd: string,
  shellPath: string = process.env.ComSpec || 'cmd.exe',
): ProcessSpawnConfig {
  if (shouldUsePowerShellWindowsProxy(commandPath, args, shellPath)) {
    return buildPowerShellSpawnConfig(
      commandPath,
      args,
      isPowerShellExecutable(shellPath) ? shellPath : (process.env.PWSH_PATH || 'powershell.exe'),
      cwd,
    );
  }

  return buildWindowsCmdSpawnConfig(commandPath, args, shellPath, cwd);
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

function buildWindowsCmdSpawnConfig(
  commandPath: string,
  args: string[],
  shellPath: string,
  cwd: string,
): ProcessSpawnConfig {
  return {
    command: shellPath,
    args: [
      '/d',
      '/v:off',
      '/s',
      '/c',
      buildWindowsCmdProxyCommandLine(commandPath, args),
    ],
    shell: false,
    cwd,
    windowsVerbatimArguments: true,
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

function shouldUseDirectWindowsSpawn(commandPath: string): boolean {
  const extension = extname(commandPath).toLowerCase();
  return WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS.has(extension);
}

function shouldUsePowerShellWindowsProxy(
  commandPath: string,
  args: string[],
  shellPath: string,
): boolean {
  const extension = extname(commandPath).toLowerCase();
  return isPowerShellExecutable(shellPath)
    || extension === '.ps1'
    || commandPath.includes('"')
    || args.some((arg) => arg.includes('"'));
}

function isPowerShellExecutable(shellPath: string): boolean {
  const normalized = shellPath.replace(/\\/g, '/').toLowerCase();
  return normalized.endsWith('/powershell.exe')
    || normalized.endsWith('/pwsh.exe')
    || normalized === 'powershell.exe'
    || normalized === 'pwsh.exe';
}

function quoteWindowsCmdProxyArgument(value: string): string {
  return escapeWindowsCmdMetaChars(quoteWindowsProcessArgument(value));
}

function quoteWindowsProcessArgument(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  let result = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      result += '\\'.repeat(backslashes * 2 + 1);
      result += '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes);
    backslashes = 0;
    result += char;
  }

  result += '\\'.repeat(backslashes * 2);
  result += '"';
  return result;
}

function escapeWindowsCmdMetaChars(value: string): string {
  return value.replace(/[\^&|<>()]/g, '^$&');
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
