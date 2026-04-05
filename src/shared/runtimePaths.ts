import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

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

export function resolveRuntimeDataDir(runtimeRoot: string): string {
  return join(runtimeRoot, 'data');
}

export function resolveRuntimeSessionsDir(runtimeRoot: string): string {
  return join(runtimeRoot, 'sessions');
}

export function resolveRuntimePathWithinRoot(
  runtimeRoot: string,
  overridePath: string | undefined,
  defaultPath: string,
): string {
  const trimmed = overridePath?.trim();
  if (!trimmed) {
    return defaultPath;
  }

  return isAbsolute(trimmed)
    ? trimmed
    : join(runtimeRoot, trimmed);
}

export function resolveRuntimeProvidersConfigPath(
  runtimeRoot: string,
  overridePath?: string,
): string {
  return resolveRuntimePathWithinRoot(
    runtimeRoot,
    overridePath,
    join(resolveRuntimeConfigDir(runtimeRoot), 'providers.yaml'),
  );
}

export function resolveRuntimeManagementConfigPath(
  runtimeRoot: string,
  overridePath?: string,
): string {
  return resolveRuntimePathWithinRoot(
    runtimeRoot,
    overridePath,
    join(resolveRuntimeConfigDir(runtimeRoot), 'management.yaml'),
  );
}
