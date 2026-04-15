import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

interface RuntimeEnvLoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runtimeConfigDir?: string;
}

function parseValue(rawValue: string): string {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadDotEnv(
  filePath = resolve(process.cwd(), '.env'),
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separator = line.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      const value = parseValue(line.slice(separator + 1));
      if (key && env[key] === undefined) {
        env[key] = value;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ENOENT')) {
      throw error;
    }
  }
}

function resolveRuntimeEnvFilePaths(
  options: RuntimeEnvLoadOptions = {},
): string[] {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const runtimeConfigDir = options.runtimeConfigDir
    ?? resolve(
      env.CATS_RUNTIME_DIR?.trim()
        || resolve(homedir(), '.cats', 'runtime'),
      'config',
    );

  return [
    resolve(cwd, '.env'),
    resolve(runtimeConfigDir, '.env'),
  ];
}

export function loadRuntimeEnvFiles(
  options: RuntimeEnvLoadOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const loaded: string[] = [];

  for (const envFilePath of resolveRuntimeEnvFilePaths(options)) {
    if (!existsSync(envFilePath)) {
      continue;
    }

    loadDotEnv(envFilePath, env);
    loaded.push(envFilePath);
  }

  return loaded.filter((value, index, values) => values.indexOf(value) === index);
}
