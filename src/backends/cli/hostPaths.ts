import { execFileSync } from 'node:child_process';
import { posix as pathPosix, win32 as pathWin32 } from 'node:path';
import type { ProviderRuntimeConfig } from './config.js';

interface HostFilesystemPathOptions {
  runtime?: Pick<ProviderRuntimeConfig, 'mode' | 'distro'>;
  label?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  cwd?: string;
  resolveWslHomeDir?: (distro: string) => string;
}

const wslHomeDirCache = new Map<string, string>();

export function resolveHostFilesystemPath(
  pathValue: string,
  options: HostFilesystemPathOptions = {},
): string {
  const trimmed = pathValue.trim();
  const label = options.label || 'path';
  const platform = options.platform || process.platform;
  const runtime = options.runtime;
  const cwd = options.cwd || process.cwd();
  const pathApi = platform === 'win32'
    ? pathWin32
    : pathPosix;

  if (!trimmed) {
    throw new Error(`${label} must not be empty`);
  }

  if (platform === 'win32' && runtime?.mode === 'wsl') {
    if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
      const wslHomeDir = resolveWslHomeDir(runtime, label, options.resolveWslHomeDir);
      return normalizeWslUncPath(
        linuxPathToWslUnc(`${wslHomeDir}${trimmed === '~' ? '' : trimmed.slice(1)}`, runtime),
      );
    }

    if (isLinuxAbsolutePath(trimmed)) {
      return normalizeWslUncPath(linuxPathToWslUnc(trimmed, runtime));
    }
  }

  if (platform === 'win32' && runtime?.mode === 'docker' && isAmbiguousWindowsWslPath(trimmed)) {
    throw new Error(
      `${label} for Docker-backed instances on Windows must be a host-accessible path. `
      + `Use a Windows path such as 'C:\\path\\to\\sessions'. Received '${pathValue}'.`,
    );
  }

  const expanded = expandHomeDir(trimmed, options.homeDir, label, pathApi.resolve);
  if (platform === 'win32' && isWslUncPath(expanded)) {
    return normalizeWslUncPath(expanded);
  }
  const resolved = pathApi.isAbsolute(expanded)
    ? expanded
    : pathApi.resolve(cwd, expanded);
  return pathApi.normalize(resolved);
}

export function normalizeHostFilesystemPath(
  pathValue: string,
  options: HostFilesystemPathOptions = {},
): string {
  const platform = options.platform || process.platform;
  const resolved = stripTrailingSeparators(resolveHostFilesystemPath(pathValue, options));

  if (platform !== 'win32' || isWslUncPath(resolved)) {
    return resolved;
  }

  return resolved.toLowerCase();
}

export function isWslUncPath(pathValue: string): boolean {
  const normalized = pathValue.replace(/\//g, '\\');
  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(normalized);
}

function expandHomeDir(
  pathValue: string,
  configuredHomeDir: string | undefined,
  label: string,
  resolveFn: (...paths: string[]) => string,
): string {
  if (!pathValue.startsWith('~')) {
    return pathValue;
  }

  const homeDir = configuredHomeDir || process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error(`Cannot resolve ${label}: HOME or USERPROFILE is not set`);
  }

  if (pathValue === '~') {
    return homeDir;
  }
  if (pathValue.startsWith('~/') || pathValue.startsWith('~\\')) {
    return resolveFn(homeDir, pathValue.slice(2));
  }

  throw new Error(`${label} uses unsupported home-directory syntax '${pathValue}'`);
}

function isAmbiguousWindowsWslPath(pathValue: string): boolean {
  if (pathValue === '~' || pathValue.startsWith('~/') || pathValue.startsWith('~\\')) {
    return true;
  }

  return /^[\\/](?![\\/])/.test(pathValue);
}

function isLinuxAbsolutePath(pathValue: string): boolean {
  return pathValue.startsWith('/');
}

function stripTrailingSeparators(pathValue: string): string {
  if (pathValue.length <= 1 || /^[A-Za-z]:[\\/]$/.test(pathValue)) {
    return pathValue;
  }

  const stripped = pathValue.replace(/[\\/]+$/, '');
  return stripped || pathValue;
}

function normalizeWslUncPath(pathValue: string): string {
  const withoutLeading = pathValue
    .replace(/\//g, '\\')
    .replace(/^\\+/, '');
  return `\\\\${withoutLeading.replace(/\\+/g, '\\')}`;
}

function linuxPathToWslUnc(
  linuxPath: string,
  runtime: Pick<ProviderRuntimeConfig, 'mode' | 'distro'>,
): string {
  const distro = runtime.distro || 'Ubuntu';
  const normalized = linuxPath.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    throw new Error(`Expected an absolute Linux path for WSL translation. Received '${linuxPath}'.`);
  }
  const uncPath = `\\\\wsl$\\${distro}${normalized.replace(/\//g, '\\')}`;
  return uncPath;
}

function resolveWslHomeDir(
  runtime: Pick<ProviderRuntimeConfig, 'mode' | 'distro'>,
  label: string,
  resolver?: (distro: string) => string,
): string {
  const distro = runtime.distro || 'Ubuntu';
  const cacheKey = distro.toLowerCase();
  const cached = wslHomeDirCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const resolved = (
      resolver
        ? resolver(distro)
        : execFileSync('wsl', ['-d', distro, 'bash', '-lc', 'printf %s "$HOME"'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
    ).trim();

    if (!resolved.startsWith('/')) {
      throw new Error(`WSL reported a non-absolute home directory '${resolved}'`);
    }

    wslHomeDirCache.set(cacheKey, resolved);
    return resolved;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not resolve ${label} for WSL distro '${distro}' from '~'. `
      + `Verify that WSL is accessible, or use an explicit WSL path like `
      + `'/home/user/...' or '\\\\wsl$\\${distro}\\home\\user\\...'. `
      + `Underlying error: ${reason}`,
    );
  }
}
