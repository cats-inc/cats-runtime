import { createHash } from 'node:crypto';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveSafeWorkspacePath } from '../tools/pathSafety.js';
import type {
  RuntimeWorkspaceIdentity,
  WorkspaceIdentityContext,
  WorkspaceIdentityResult,
} from './activityTypes.js';

const MAX_METADATA_BYTES = 8192;
const MAX_PARENT_STEPS = 256;

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !rel || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(rel));
}

function identityId(kind: string, location: string, path: string): string {
  return `${kind}-${createHash('sha256').update(`${location}\0${path}`).digest('hex').slice(0, 24)}`;
}

async function directoryGeneration(path: string): Promise<string> {
  const info = await stat(path, { bigint: true });
  if (!info.isDirectory()) throw new Error('Expected directory identity');
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
}

async function metadataPath(roots: string[], candidate: string): Promise<string> {
  for (const root of roots) {
    if (!isInside(root, candidate)) continue;
    return (await resolveSafeWorkspacePath(root, candidate)).fullPath;
  }
  throw new Error('Metadata path is outside the admitted authority');
}

async function readMetadata(roots: string[], candidate: string): Promise<string | null> {
  const safe = await metadataPath(roots, candidate);
  const info = await lstat(safe).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.size > MAX_METADATA_BYTES) throw new Error('Unsupported Git metadata');
  const file = await open(safe, 'r');
  try {
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_METADATA_BYTES) throw new Error('Oversized Git metadata');
    return buffer.subarray(0, bytesRead).toString('utf8').trim();
  } finally {
    await file.close();
  }
}

async function nearestDirectory(target: string, root: string): Promise<string> {
  let current = target;
  for (let count = 0; count < MAX_PARENT_STEPS && isInside(root, current); count++) {
    try {
      const info = await stat(current);
      return await realpath(info.isDirectory() ? current : dirname(current));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (current === root) break;
      current = dirname(current);
    }
  }
  throw new Error('No admitted existing parent');
}

function headIdentity(head: string): { branch: string | null; detachedCommit: string | null } {
  const match = /^ref: refs\/heads\/(.+)$/u.exec(head);
  if (match && !/[\x00-\x20\x7f~^:?*\[\\]/u.test(match[1]) && !match[1].includes('..')
    && !match[1].includes('@{') && match[1].split('/').every(segment => segment
      && !segment.startsWith('.') && !segment.endsWith('.') && !segment.endsWith('.lock'))) {
    return { branch: match[1], detachedCommit: null };
  }
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(head)) {
    return { branch: null, detachedCommit: head.toLowerCase() };
  }
  throw new Error('Unsupported Git HEAD');
}

function plainIdentity(context: WorkspaceIdentityContext, directory: string, generation: string): RuntimeWorkspaceIdentity {
  return {
    checkoutId: identityId('checkout', context.executionLocationId, `${directory}\0${generation}`),
    executionLocationId: context.executionLocationId,
    path: directory,
    repository: null,
    kind: 'non_git',
    branch: null,
    detachedCommit: null,
    management: 'unmanaged',
    verification: 'verified',
  };
}

/** Resolves only an admitted operation target, walking upward without crawling or running Git. */
export async function resolveWorkspaceIdentity(
  context: WorkspaceIdentityContext,
  inputPath: string,
): Promise<WorkspaceIdentityResult> {
  if (!context.local || !isAbsolute(context.cwd)) {
    return { workspace: null, reason: 'unmapped_execution_location' };
  }
  let root: string;
  let target: string;
  let directory: string;
  let generation: string;
  try {
    if (!inputPath || inputPath.length > 4096 || inputPath.includes('\0')) throw new Error('Invalid path');
    const safe = await resolveSafeWorkspacePath(context.cwd, inputPath);
    root = await realpath(context.cwd);
    target = resolve(root, relative(resolve(context.cwd), safe.fullPath));
    directory = await nearestDirectory(target, root);
    generation = await directoryGeneration(directory);
  } catch {
    return { workspace: null, reason: 'path_unavailable' };
  }

  const fallback = plainIdentity(context, directory, generation);
  const unknown = { ...fallback, kind: 'unknown' as const,
    verification: 'unavailable' as const, management: 'unknown' as const };
  // A target inside Git's control directory is not ordinary checkout activity.
  if (relative(root, target).split(/[\\/]/u).includes('.git')) {
    return { workspace: unknown, reason: 'git_metadata_target' };
  }
  const roots = [root];
  let managed: { path: string; sourceRoot: string } | undefined;
  if (context.managedWorktree) {
    try {
      // Only the currently admitted managed checkout may use its source metadata authority.
      const managedPath = await realpath(context.managedWorktree.path);
      if (isInside(managedPath, root)) {
        const sourceRoot = await realpath(context.managedWorktree.sourceRepoRoot);
        const sourceMarker = (await resolveSafeWorkspacePath(sourceRoot, '.git')).fullPath;
        if ((await lstat(sourceMarker)).isDirectory()) {
          // Provenance authorizes the Git attachment, never arbitrary source contents.
          managed = { path: managedPath, sourceRoot };
          roots.push(await realpath(sourceMarker));
        }
      }
    } catch { /* Stale lifecycle paths do not establish metadata authority. */ }
  }

  let current = directory;
  const scanBoundary = managed?.path ?? root;
  let completedFilesystemRootWalk = false;
  try {
    for (let count = 0; count < MAX_PARENT_STEPS && isInside(scanBoundary, current); count++) {
      // Trusted provenance permits ancestor attachment lookup, not arbitrary ancestor contents.
      const marker = (await resolveSafeWorkspacePath(scanBoundary, join(current, '.git'))).fullPath;
      const entry = await lstat(marker).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (entry) {
        roots.push(marker);
        let gitDir = marker;
        if (entry.isFile()) {
          const pointer = await readMetadata(roots, marker);
          if (!pointer?.startsWith('gitdir: ') || /[\r\n\0]/u.test(pointer)) {
            throw new Error('Unsupported Git pointer');
          }
          gitDir = await metadataPath(roots, resolve(current, pointer.slice(8)));
        } else if (!entry.isDirectory()) {
          throw new Error('Unsupported Git marker');
        }
        gitDir = await realpath(gitDir);
        const common = await readMetadata(roots, join(gitDir, 'commondir'));
        if (common !== null && (!common || /[\r\n\0]/u.test(common))) throw new Error('Invalid common directory');
        const commonDir = common === null ? gitDir
          : await realpath(await metadataPath(roots, resolve(gitDir, common)));
        const objects = await stat(await metadataPath(roots, join(commonDir, 'objects')));
        const refs = await stat(await metadataPath(roots, join(commonDir, 'refs'))).catch(() => null);
        if (!objects.isDirectory() || !refs?.isDirectory()) throw new Error('Unsupported repository layout');
        const isWorktree = common !== null;
        if (isInside(gitDir, target) || isInside(commonDir, target) || target === marker) {
          return { workspace: unknown,
            reason: 'git_metadata_target' };
        }
        const head = await readMetadata(roots, join(gitDir, 'HEAD'));
        if (!head) throw new Error('Missing Git HEAD');
        const checkout = await realpath(current);
        let sourceRoot: string | undefined = isWorktree ? undefined : checkout;
        if (isWorktree) {
          // A source candidate must have a directory attachment that resolves to the same common metadata.
          const candidate = managed?.sourceRoot ?? dirname(commonDir);
          if (candidate === managed?.sourceRoot
            || roots.some(scope => isInside(scope, join(candidate, '.git')))) {
            const sourceMarker = await metadataPath(roots, join(candidate, '.git'));
            if ((await lstat(sourceMarker).catch(() => null))?.isDirectory()
              && await realpath(sourceMarker) === commonDir) sourceRoot = await realpath(candidate);
          }
        }
        const commonGeneration = await directoryGeneration(commonDir);
        const gitGeneration = await directoryGeneration(gitDir);
        const checkoutGeneration = await directoryGeneration(checkout);
        const repoId = identityId('repo', context.executionLocationId, `${commonDir}\0${commonGeneration}`);
        return { workspace: {
          ...fallback,
          checkoutId: identityId('checkout', context.executionLocationId,
            `${checkout}\0${checkoutGeneration}\0${gitGeneration}`),
          path: checkout,
          repository: { id: repoId, label: sourceRoot ? basename(sourceRoot) : `Repository ${repoId.slice(-8)}`,
            ...(sourceRoot ? { sourceRoot } : {}) },
          kind: isWorktree ? 'worktree' : 'original',
          ...headIdentity(head),
          management: isWorktree && managed?.path === checkout && managed.sourceRoot === sourceRoot
            ? 'runtime_managed' : 'unmanaged',
        } };
      }
      if (isInside(root, current)) {
        const bareHead = await lstat(await metadataPath(roots, join(current, 'HEAD'))).catch(() => null);
        const bareObjects = await lstat(await metadataPath(roots, join(current, 'objects'))).catch(() => null);
        if (bareHead?.isFile() && bareObjects?.isDirectory()) throw new Error('Bare metadata is not a checkout');
      }
      if (dirname(current) === current) {
        completedFilesystemRootWalk = true;
        break;
      }
      if (current === scanBoundary) break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    // No marker inside the admitted scope does not prove that an outer repo is absent.
    // Only a complete walk to a filesystem root can establish a non-Git directory.
    return completedFilesystemRootWalk ? { workspace: fallback }
      : { workspace: unknown, reason: 'git_metadata_unavailable' };
  } catch {
    return { workspace: unknown,
      reason: 'git_metadata_unavailable' };
  }
}
