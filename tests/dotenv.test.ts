import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDotEnv, loadRuntimeEnvFiles } from '../src/core/dotenv.js';

describe('runtime dotenv loading', () => {
  const touchedKeys = [
    'CATS_RUNTIME_STARTUP_TRACE',
    'CATS_RUNTIME_PORT',
  ];

  afterEach(() => {
    for (const key of touchedKeys) {
      delete process.env[key];
    }
  });

  it('loads a single .env file without overriding explicit env vars', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cats-runtime-dotenv-'));
    const envFilePath = join(tempDir, '.env');

    try {
      await writeFile(
        envFilePath,
        [
          'CATS_RUNTIME_STARTUP_TRACE=true',
          'CATS_RUNTIME_PORT=43110',
        ].join('\n'),
        'utf8',
      );

      process.env.CATS_RUNTIME_PORT = '3110';
      loadDotEnv(envFilePath);

      expect(process.env.CATS_RUNTIME_STARTUP_TRACE).toBe('true');
      expect(process.env.CATS_RUNTIME_PORT).toBe('3110');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads packaged runtime config env values from the runtime config directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cats-runtime-packaged-env-'));
    const runtimeConfigDir = join(tempDir, '.cats', 'runtime', 'config');
    const envFilePath = join(runtimeConfigDir, '.env');

    try {
      await mkdir(runtimeConfigDir, { recursive: true });
      await writeFile(envFilePath, 'CATS_RUNTIME_STARTUP_TRACE=true\n', 'utf8');

      const loadedPaths = loadRuntimeEnvFiles({
        cwd: tempDir,
        runtimeConfigDir,
      });

      expect(loadedPaths).toEqual([envFilePath]);
      expect(process.env.CATS_RUNTIME_STARTUP_TRACE).toBe('true');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
