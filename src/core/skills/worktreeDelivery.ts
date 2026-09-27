import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';
import type { SessionWorkspaceState } from '../types.js';
import { buildWorktreeId, buildWorktreePath } from '../workspace/sessionWorkspace.js';

const equalPath = (a: string, b: string) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function relativeInside(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('outside');
  return relative;
}
function plainPath(root: string, target: string): void {
  const parts = relativeInside(root, target).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (!info) break;
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink > 1)) throw new Error('alias');
  }
}
function files(root: string, limit: number): string[] {
  const result: string[] = [];
  const visit = (current: string) => {
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (!info) return;
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink > 1)) throw new Error('alias');
    if (result.length >= limit) throw new Error('too_many_paths');
    result.push(current);
    if (info.isDirectory()) for (const name of readdirSync(current)) visit(path.join(current, name));
  };
  visit(root);
  return result;
}
function git(cwd: string, args: string[], input?: string): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, input, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 512 * 1024,
    env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) throw new Error('git_inspection_failed');
  return result.stdout;
}

/** Internal Runtime-owned state only; a workspace kind or caller path is not proof. */
export function canDeliverSkillsToWorktree(input: {
  workspace?: SessionWorkspaceState; cwd: string; sessionId: string; sessionBaseDir: string;
  packages: { id: string; sourcePath: string }[]; marker: string;
}): boolean {
  try {
    const workspace = input.workspace, owned = workspace?.worktree;
    if (workspace?.kind !== 'worktree' || !owned || !/^[a-zA-Z0-9_-]+$/u.test(input.sessionId)
      || !equalPath(input.cwd, workspace.runtimeCwd)
      || owned.id !== buildWorktreeId(owned.sourceRepoRoot, input.sessionId)
      || !equalPath(owned.worktreePath, buildWorktreePath(input.sessionBaseDir, owned.sourceRepoRoot, input.sessionId))
      || (!equalPath(input.cwd, owned.worktreePath)
        && !equalPath(input.cwd, path.join(owned.worktreePath, owned.relativeCwd ?? '')))) return false;
    plainPath(input.sessionBaseDir, input.cwd);
    const physicalBase = realpathSync(input.sessionBaseDir), physicalRoot = realpathSync(owned.worktreePath);
    if (!equalPath(physicalRoot, path.join(physicalBase, relativeInside(input.sessionBaseDir, owned.worktreePath)))) return false;
    const physicalCwd = realpathSync(input.cwd);
    if (!equalPath(physicalCwd, path.join(physicalRoot, relativeInside(owned.worktreePath, input.cwd)))) return false;
    if (!equalPath(git(input.cwd, ['rev-parse', '--show-toplevel']).trim(), physicalRoot)) return false;
    const common = ['rev-parse', '--path-format=absolute', '--git-common-dir'];
    if (!equalPath(realpathSync(git(input.cwd, common).trim()), realpathSync(git(owned.sourceRepoRoot, common).trim()))) return false;
    const targetRoot = path.join(input.cwd, '.agents', 'skills');
    plainPath(owned.worktreePath, targetRoot);
    const targets = [path.join(targetRoot, input.marker)];
    for (const skill of input.packages) {
      const targetDir = path.join(targetRoot, skill.id);
      relativeInside(targetRoot, targetDir);
      plainPath(owned.worktreePath, targetDir);
      files(targetDir, 2048); // Reject existing links, including optional resources.
      for (const source of files(skill.sourcePath, 2048)) {
        targets.push(path.join(targetDir, relativeInside(skill.sourcePath, source)));
      }
    }
    for (const target of targets) plainPath(owned.worktreePath, target);
    const relativeTargets = [...new Set(targets.map(target => relativeInside(input.cwd, target).split(path.sep).join('/')))];
    // No index/config writes: require the repository's existing ignore rules.
    const directories = input.packages.map(skill => `.agents/skills/${skill.id}`);
    if (git(input.cwd, ['ls-files', '--cached', '-z', '--', ...directories, `.agents/skills/${input.marker}`]).length) return false;
    const ignored = new Set(git(input.cwd, ['check-ignore', '--no-index', '-z', '--stdin'], `${relativeTargets.join('\0')}\0`).split('\0'));
    return relativeTargets.every(target => ignored.has(target));
  } catch { return false; }
}
