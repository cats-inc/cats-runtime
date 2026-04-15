import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveDefaultCatsRuntimeRoot(homeDir: string = homedir()): string {
  return join(homeDir || homedir(), '.cats', 'runtime');
}

export function resolveRuntimeRoot(
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string,
): string {
  const trimmedRoot = env.CATS_RUNTIME_DIR?.trim();
  if (trimmedRoot) {
    return isAbsolute(trimmedRoot)
      ? trimmedRoot
      : resolve(process.cwd(), trimmedRoot);
  }

  return resolveDefaultCatsRuntimeRoot(
    homeDir ?? env.HOME ?? env.USERPROFILE ?? '',
  );
}

export function resolveRuntimeConfigDir(runtimeRoot: string): string {
  return join(runtimeRoot, 'config');
}

export function resolveRuntimePackageRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmedRoot = env.CATS_RUNTIME_PACKAGE_ROOT?.trim();
  if (trimmedRoot) {
    return isAbsolute(trimmedRoot)
      ? trimmedRoot
      : resolve(process.cwd(), trimmedRoot);
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    resolve(moduleDir, '..', '..', 'package.json'),
    resolve(moduleDir, '..', '..', '..', 'package.json'),
  ];
  const packageJsonPath = candidatePaths.find((candidate) => existsSync(candidate));
  return packageJsonPath ? dirname(packageJsonPath) : resolve(moduleDir, '..', '..', '..');
}

export function resolveRuntimeDataDir(runtimeRoot: string): string {
  return join(runtimeRoot, 'data');
}

export function resolveRuntimeSessionsDir(runtimeRoot: string): string {
  return join(runtimeRoot, 'sessions');
}

export function resolveRuntimeProvidersConfigPath(runtimeRoot: string): string {
  return join(resolveRuntimeConfigDir(runtimeRoot), 'providers.yaml');
}

export function resolveRuntimeManagementConfigPath(runtimeRoot: string): string {
  return join(resolveRuntimeConfigDir(runtimeRoot), 'management.yaml');
}

export function resolveRuntimeCuratedModelCatalogPath(runtimeRoot: string): string {
  return join(resolveRuntimeConfigDir(runtimeRoot), 'curated-model-catalogs.yaml');
}

export function resolveBundledRuntimeConfigExamplePath(
  fileName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveRuntimePackageRoot(env), 'config', `${fileName}.example`);
}
