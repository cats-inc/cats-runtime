import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertDistinctWorkspaceFiles,
  assertSafeExistingFileMutation,
  resolveSafeWorkspacePath,
  resolveWorkspacePathUnchecked,
} from './pathSafety.js';

function createWorkspace(prefix: string) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const value = 1;\n');
  return {
    cwd,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

describe('pathSafety', () => {
  it('rejects empty and escaped unchecked paths', () => {
    const { cwd, cleanup } = createWorkspace('cats-runtime-path-safety-');

    try {
      expect(() => resolveWorkspacePathUnchecked(cwd, '   ')).toThrow('Path must not be empty');
      expect(() => resolveWorkspacePathUnchecked(cwd, '../outside.txt'))
        .toThrow("Path '../outside.txt' is outside the workspace");
    } finally {
      cleanup();
    }
  });

  it('allows deeply nested missing paths by walking up to the nearest existing parent', async () => {
    const { cwd, cleanup } = createWorkspace('cats-runtime-path-safety-');

    try {
      await expect(
        resolveSafeWorkspacePath(cwd, 'missing/deeply/nested/file.txt'),
      ).resolves.toEqual({
        fullPath: join(cwd, 'missing', 'deeply', 'nested', 'file.txt'),
        displayPath: 'missing/deeply/nested/file.txt',
      });
    } finally {
      cleanup();
    }
  });

  it('rejects symbolic-link and junction alias segments but allows a workspace-root alias', async () => {
    const { cwd, cleanup } = createWorkspace('cats-runtime-path-safety-');
    const outside = mkdtempSync(join(tmpdir(), 'cats-runtime-path-outside-'));
    const aliasParent = mkdtempSync(join(tmpdir(), 'cats-runtime-path-alias-root-'));
    const aliasRoot = join(aliasParent, 'workspace-link');
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    symlinkSync(
      outside,
      join(cwd, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    symlinkSync(
      cwd,
      aliasRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    try {
      await expect(resolveSafeWorkspacePath(cwd, 'linked-outside/secret.txt'))
        .rejects.toThrow('symbolic-link or junction alias');

      await expect(resolveSafeWorkspacePath(aliasRoot, 'src/app.ts')).resolves.toEqual({
        fullPath: join(aliasRoot, 'src', 'app.ts'),
        displayPath: 'src/app.ts',
      });
    } finally {
      rmSync(aliasRoot, { force: true, recursive: true });
      rmSync(aliasParent, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
      cleanup();
    }
  });

  it('rejects hardlinked mutation targets', async () => {
    const { cwd, cleanup } = createWorkspace('cats-runtime-path-safety-');
    const original = join(cwd, 'src', 'app.ts');
    const hardlink = join(cwd, 'src', 'app-hard.ts');
    linkSync(original, hardlink);

    try {
      await expect(assertSafeExistingFileMutation(hardlink, 'src/app-hard.ts'))
        .rejects.toThrow('aliased file');
    } finally {
      cleanup();
    }
  });

  it('rejects same-file aliases but ignores directories in distinct-file checks', async () => {
    const { cwd, cleanup } = createWorkspace('cats-runtime-path-safety-');
    const file = join(cwd, 'src', 'app.ts');
    const directory = join(cwd, 'src');

    try {
      await expect(assertDistinctWorkspaceFiles(file, 'src/app.ts', file, 'src/app.ts'))
        .rejects.toThrow("Source 'src/app.ts' and destination 'src/app.ts' refer to the same file");
      await expect(assertDistinctWorkspaceFiles(directory, 'src', directory, 'src'))
        .resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
