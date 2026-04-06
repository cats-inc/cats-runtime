import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveRuntimePublicAssetPath } from '../src/http/app.js';

describe('resolveRuntimePublicAssetPath', () => {
  it('supports both source and compiled app module locations', () => {
    const expectedIndexPath = join(process.cwd(), 'public', 'index.html');
    const expectedPlaygroundPath = join(process.cwd(), 'public', 'playground.html');
    const sourceModuleUrl = pathToFileURL(
      join(process.cwd(), 'src', 'http', 'app.ts'),
    ).href;
    const builtModuleUrl = pathToFileURL(
      join(process.cwd(), 'build', 'runtime', 'http', 'app.js'),
    ).href;

    expect(resolveRuntimePublicAssetPath('index.html', sourceModuleUrl)).toBe(expectedIndexPath);
    expect(resolveRuntimePublicAssetPath('index.html', builtModuleUrl)).toBe(expectedIndexPath);
    expect(resolveRuntimePublicAssetPath('playground.html', sourceModuleUrl)).toBe(expectedPlaygroundPath);
    expect(resolveRuntimePublicAssetPath('playground.html', builtModuleUrl)).toBe(expectedPlaygroundPath);
  });
});
