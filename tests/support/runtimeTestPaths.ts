import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface RuntimeTestPaths {
  runtimeDir: string;
  configDir: string;
  configPath: string;
  managementConfigPath: string;
  curatedModelCatalogPath: string;
  dataDir: string;
  sessionBaseDir: string;
}

export function createRuntimeTestPaths(root: string): RuntimeTestPaths {
  const runtimeDir = join(root, '.cats', 'runtime');
  return {
    runtimeDir,
    configDir: join(runtimeDir, 'config'),
    configPath: join(runtimeDir, 'config', 'providers.yaml'),
    managementConfigPath: join(runtimeDir, 'config', 'management.yaml'),
    curatedModelCatalogPath: join(runtimeDir, 'config', 'curated-model-catalogs.yaml'),
    dataDir: join(runtimeDir, 'data'),
    sessionBaseDir: join(runtimeDir, 'sessions'),
  };
}

export function createRuntimeTestEnv(
  root: string,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const paths = createRuntimeTestPaths(root);
  return {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_DIR: paths.runtimeDir,
    ...overrides,
  };
}

export function ensureRuntimeTestDirs(paths: RuntimeTestPaths): void {
  mkdirSync(paths.configDir, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.sessionBaseDir, { recursive: true });
}
