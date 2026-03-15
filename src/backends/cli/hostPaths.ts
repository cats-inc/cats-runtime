import { posix as pathPosix, win32 as pathWin32 } from 'node:path';
import type { ProviderRuntimeConfig } from './config.js';

interface HostFilesystemPathOptions {
  runtime?: Pick<ProviderRuntimeConfig, 'mode' | 'distro'>;
  label?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  cwd?: string;
}

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

  if (platform === 'win32' && runtime?.mode === 'wsl' && isAmbiguousWindowsWslPath(trimmed)) {
    const distroExample = runtime.distro || '<distro>';
    throw new Error(
      `${label} for WSL-backed instances on Windows must be a host-accessible path. `
      + `Use a Windows path such as 'C:\\path\\to\\sessions' or a WSL UNC path like `
      + `'\\\\wsl$\\${distroExample}\\home\\user\\...'. Received '${pathValue}'.`,
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
