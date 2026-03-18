import { posix as pathPosix, win32 as pathWin32 } from 'node:path';
import type { SessionInfo } from '../../../core/types.js';
import type { CliRuntimeConfig, ProviderInstanceConfig } from '../config.js';
import { resolveProviderInstance } from '../config.js';
import { isWslUncPath, normalizeHostFilesystemPath } from '../hostPaths.js';
import { createRuntimeAdapter } from '../runtime/runtime.js';

export interface PiResumeTarget {
  hostSourcePath: string;
  runtimeSourcePath: string;
  instance: ProviderInstanceConfig;
}

export function getPiResumeSourcePath(session: SessionInfo): string | null {
  return session.providerSourcePath || session.sourcePath || null;
}

export function resolvePiResumeTarget(
  config: CliRuntimeConfig,
  session: SessionInfo,
  platform: NodeJS.Platform = process.platform,
): PiResumeTarget {
  if (session.providerName !== 'pi') {
    throw new Error(`Pi resume target resolution only supports 'pi', got '${session.providerName}'`);
  }

  const sourcePath = getPiResumeSourcePath(session);
  if (!sourcePath) {
    throw new Error(
      'Pi resume requires a discovered session file path. Wait for discovery to attach one, '
      + 'or start a fresh Pi session.',
    );
  }

  const instance = resolveProviderInstance(config, 'pi', session.providerInstanceId);
  const hostSourcePath = normalizeHostFilesystemPath(sourcePath, {
    runtime: instance.commandConfig.runtime,
    label: 'pi session source path',
    platform,
  });
  const hostSessionsDir = normalizeHostFilesystemPath(
    instance.piSessionsDir || config.piSessionsDir,
    {
      runtime: instance.commandConfig.runtime,
      label: `pi.instances.${instance.id}.sessions_dir`,
      platform,
    },
  );

  if (!isPathWithin(hostSessionsDir, hostSourcePath)) {
    throw new Error(
      `Pi session file '${hostSourcePath}' is outside the configured sessions_dir `
      + `'${hostSessionsDir}' for instance '${instance.id}'.`,
    );
  }

  return {
    hostSourcePath,
    runtimeSourcePath: toPiRuntimeSourcePath(hostSourcePath, instance, platform),
    instance,
  };
}

export function isPiUnknownSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\bunknown session\b/i.test(message);
}

function toPiRuntimeSourcePath(
  hostSourcePath: string,
  instance: ProviderInstanceConfig,
  platform: NodeJS.Platform,
): string {
  const runtime = instance.commandConfig.runtime;

  if (runtime.mode === 'wsl' && platform === 'win32' && isWslUncPath(hostSourcePath)) {
    return wslUncToLinuxPath(hostSourcePath, runtime.distro || 'Ubuntu');
  }

  if (runtime.mode === 'docker' && platform === 'win32' && usesWindowsPathApi(hostSourcePath)) {
    throw new Error(
      'Pi session resume for Docker-backed instances on Windows is not supported yet because '
      + 'the discovered host path cannot be mapped back into the container runtime.',
    );
  }

  return createRuntimeAdapter(runtime).toRuntimePath(hostSourcePath);
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const pathApi = usesWindowsPathApi(basePath) || usesWindowsPathApi(targetPath)
    ? pathWin32
    : pathPosix;
  const relative = pathApi.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
}

function usesWindowsPathApi(pathValue: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(pathValue)
    || pathValue.startsWith('\\\\')
    || pathValue.includes('\\');
}

function wslUncToLinuxPath(pathValue: string, expectedDistro: string): string {
  const normalized = pathValue.replace(/\//g, '\\');
  const match = normalized.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)\\(.*)$/i);
  if (!match) {
    throw new Error(`Expected a WSL UNC path, got '${pathValue}'`);
  }

  const distro = match[1] || '';
  const remainder = match[2] || '';
  if (expectedDistro && distro.toLowerCase() !== expectedDistro.toLowerCase()) {
    throw new Error(
      `Pi session file belongs to WSL distro '${distro}', but instance is configured for `
      + `'${expectedDistro}'.`,
    );
  }

  return `/${remainder.replace(/\\/g, '/')}`;
}
