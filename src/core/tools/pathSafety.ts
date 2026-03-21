import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function toRelativeDisplay(root: string, fullPath: string): string {
  const rel = relative(root, fullPath);
  return rel === '' ? '.' : rel.split('\\').join('/');
}

export function resolveWorkspacePathUnchecked(
  root: string,
  inputPath: string,
): { fullPath: string; displayPath: string } {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error('Path must not be empty');
  }

  const fullPath = resolve(root, trimmed);
  const rel = relative(root, fullPath);
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error(`Path '${inputPath}' is outside the workspace`);
  }

  return {
    fullPath,
    displayPath: toRelativeDisplay(root, fullPath),
  };
}

async function assertResolvedWithinWorkspace(
  root: string,
  fullPath: string,
  displayPath: string,
): Promise<void> {
  const workspaceRoot = await realpath(root).catch(() => resolve(root));
  let current = fullPath;

  while (true) {
    try {
      const candidate = await realpath(current);
      if (!isPathInside(workspaceRoot, candidate)) {
        throw new Error(`Path '${displayPath}' resolves outside the workspace`);
      }
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const parent = dirname(current);
        if (parent === current || parent === resolve(root)) {
          return;
        }
        current = parent;
        continue;
      }
      throw error;
    }
  }
}

async function assertNoSymbolicLinkSegments(
  root: string,
  fullPath: string,
  displayPath: string,
): Promise<void> {
  const rel = relative(resolve(root), fullPath);
  if (!rel || rel === '.') {
    return;
  }

  const segments = rel.split(/[\\/]+/).filter(Boolean);
  let current = resolve(root);
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(
          `Path '${displayPath}' uses a symbolic-link or junction alias, which is not allowed`,
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

export async function resolveSafeWorkspacePath(
  root: string,
  inputPath: string,
): Promise<{ fullPath: string; displayPath: string }> {
  const resolved = resolveWorkspacePathUnchecked(root, inputPath);
  await assertNoSymbolicLinkSegments(root, resolved.fullPath, resolved.displayPath);
  await assertResolvedWithinWorkspace(root, resolved.fullPath, resolved.displayPath);
  return resolved;
}

export async function assertSafeExistingFileMutation(
  fullPath: string,
  displayPath: string,
): Promise<void> {
  const info = await stat(fullPath);
  if (info.isFile() && info.nlink > 1) {
    throw new Error(
      `Refusing to mutate aliased file '${displayPath}' because it has ${info.nlink} links`,
    );
  }
}

export async function assertDistinctWorkspaceFiles(
  sourcePath: string,
  sourceDisplayPath: string,
  destinationPath: string,
  destinationDisplayPath: string,
): Promise<void> {
  const [sourceInfo, destinationInfo] = await Promise.all([
    stat(sourcePath),
    stat(destinationPath),
  ]);

  if (
    sourceInfo.isFile()
    && destinationInfo.isFile()
    && sourceInfo.dev === destinationInfo.dev
    && sourceInfo.ino === destinationInfo.ino
  ) {
    throw new Error(
      `Source '${sourceDisplayPath}' and destination '${destinationDisplayPath}' refer to the same file`,
    );
  }
}
