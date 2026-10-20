import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import type { WorkspaceIdentityContext } from './activityTypes.js';
import { resolveWorkspaceIdentity } from './workspaceIdentity.js';

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  if (result.status !== 0) throw new Error(result.stderr || 'Fixture Git command failed');
  return result.stdout.trim();
}

describe('workspace identity from admitted operation targets', () => {
  let fixture: string;
  let root: string;
  let repo: string;
  let clone: string;
  let worktree: string;
  let branchWorktree: string;
  let externalWorktree: string;
  let context: WorkspaceIdentityContext;

  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'cats-workspace-identity-'));
    root = join(fixture, 'cats-inc');
    repo = join(root, 'clients', 'customer', 'services', 'cats-runtime');
    clone = join(root, 'independent', 'cats-runtime');
    worktree = join(root, 'worktrees', 'agent-a');
    branchWorktree = join(root, 'worktrees', 'agent-b');
    externalWorktree = join(fixture, 'external', 'agent-c');
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(root, 'documents'), { recursive: true });
    await writeFile(join(repo, 'src', 'example.ts'), 'export const value = 1;\n');
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.name', 'Workspace identity fixture');
    git(repo, 'config', 'user.email', 'workspace@example.test');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'fixture');
    await mkdir(dirname(clone), { recursive: true });
    git(root, 'clone', '--no-hardlinks', repo, clone);
    git(repo, 'worktree', 'add', '--detach', worktree, 'HEAD');
    git(repo, 'worktree', 'add', '-b', 'topic/work', branchWorktree, 'HEAD');
    git(repo, 'worktree', 'add', '--detach', externalWorktree, 'HEAD');
    context = { cwd: root, executionLocationId: 'native:test-host', local: true };
  }, 60_000);

  afterAll(() => { if (fixture) cleanupTempDirWithRetries(fixture); });

  it('resolves a fourth-level repo and missing nested file without changing the common cwd', async () => {
    const original = structuredClone(context);
    const result = await resolveWorkspaceIdentity(context, join(repo, 'src', 'missing', 'nested', 'new.ts'));
    expect(result.reason).toBeUndefined();
    expect(result.workspace).toMatchObject({
      path: await realpath(repo), kind: 'original', branch: 'main', detachedCommit: null,
      verification: 'verified', management: 'unmanaged',
      repository: { label: 'cats-runtime', sourceRoot: await realpath(repo) },
    });
    expect(context).toEqual(original);
  });

  it('groups linked worktrees by repository while keeping checkout and clone identities distinct', async () => {
    const results = await Promise.all([repo, worktree, branchWorktree, clone]
      .map(path => resolveWorkspaceIdentity(context, path)));
    const [source, first, second, independent] = results.map(result => result.workspace!);
    expect(source.repository!.id).toBe(first.repository!.id);
    expect(first.repository!.id).toBe(second.repository!.id);
    expect(independent.repository!.id).not.toBe(source.repository!.id);
    expect(new Set(results.map(result => result.workspace!.checkoutId)).size).toBe(4);
    expect(first).toMatchObject({ kind: 'worktree', branch: null, management: 'unmanaged' });
    expect(first.detachedCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(second).toMatchObject({ kind: 'worktree', branch: 'topic/work', detachedCommit: null });
    expect(first.repository!.label).toBe('cats-runtime');
  });

  it('rechecks branch metadata rather than retaining a stale branch label', async () => {
    const before = await resolveWorkspaceIdentity(context, branchWorktree);
    git(branchWorktree, 'branch', '-m', 'topic/renamed');
    const result = await resolveWorkspaceIdentity(context, join(branchWorktree, 'src', 'example.ts'));
    expect(result.workspace?.branch).toBe('topic/renamed');
    expect(result.workspace?.checkoutId).toBe(before.workspace?.checkoutId);
  });

  it('does not reuse repository/checkout identity after Git metadata is replaced at the same path', async () => {
    const reused = join(root, 'reused'); await mkdir(reused);
    git(reused, 'init', '--initial-branch=main');
    const before = await resolveWorkspaceIdentity(context, reused);
    await rename(join(reused, '.git'), join(root, 'retired-git-metadata'));
    git(reused, 'init', '--initial-branch=replacement');
    const after = await resolveWorkspaceIdentity(context, reused);
    expect(after.workspace?.path).toBe(before.workspace?.path);
    expect(after.workspace?.repository?.id).not.toBe(before.workspace?.repository?.id);
    expect(after.workspace?.checkoutId).not.toBe(before.workspace?.checkoutId);
    expect(after.workspace?.branch).toBe('replacement');
  });

  it('keeps submodule Git-file identities separate from the parent and independent clone', async () => {
    git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', clone, 'submodule');
    const child = await resolveWorkspaceIdentity(context, join(repo, 'submodule', 'src', 'example.ts'));
    const parent = await resolveWorkspaceIdentity(context, repo);
    const independent = await resolveWorkspaceIdentity(context, clone);
    expect(child.workspace).toMatchObject({ kind: 'original', management: 'unmanaged', verification: 'verified' });
    expect(child.workspace?.repository?.id).not.toBe(parent.workspace?.repository?.id);
    expect(child.workspace?.repository?.id).not.toBe(independent.workspace?.repository?.id);
  }, 30_000); // Local submodule creation invokes several Git processes, especially costly on Windows.

  it('distinguishes repositories whose names differ only by case on a capable filesystem', async test => {
    const upper = join(root, 'CaseRepo'); const lower = join(root, 'caserepo');
    await mkdir(upper, { recursive: true }); await mkdir(lower, { recursive: true });
    const [first, second] = await Promise.all([stat(upper, { bigint: true }), stat(lower, { bigint: true })]);
    if (first.dev === second.dev && first.ino === second.ino) { test.skip(); return; }
    git(upper, 'init', '--initial-branch=main'); git(lower, 'init', '--initial-branch=main');
    const a = await resolveWorkspaceIdentity(context, upper); const b = await resolveWorkspaceIdentity(context, lower);
    expect(a.workspace?.checkoutId).not.toBe(b.workspace?.checkoutId);
    expect(a.workspace?.repository?.id).not.toBe(b.workspace?.repository?.id);
  });

  it('does not broaden metadata authority when a managed source is itself a linked worktree', async () => {
    const result = await resolveWorkspaceIdentity({ ...context, cwd: externalWorktree,
      managedWorktree: { path: externalWorktree, sourceRepoRoot: worktree } }, '.');
    expect(result).toMatchObject({ workspace: { kind: 'unknown', management: 'unknown', repository: null },
      reason: 'git_metadata_unavailable' });
  });

  it('qualifies identities by verified execution location', async () => {
    const first = await resolveWorkspaceIdentity(context, repo);
    const second = await resolveWorkspaceIdentity({ ...context, executionLocationId: 'native:other-host' }, repo);
    expect(first.workspace?.checkoutId).not.toBe(second.workspace?.checkoutId);
    expect(first.workspace?.repository?.id).not.toBe(second.workspace?.repository?.id);
  });

  it('reports an admitted ordinary directory without claiming unseen outer Git identity', async () => {
    const result = await resolveWorkspaceIdentity(context, 'documents');
    expect(result.workspace).toMatchObject({ kind: 'unknown', repository: null,
      path: await realpath(join(root, 'documents')), verification: 'unavailable', management: 'unknown' });
  });

  it('does not turn a parent listing into discovery of child repositories', async () => {
    const result = await resolveWorkspaceIdentity(context, '.');
    expect(result.workspace).toMatchObject({ kind: 'unknown', repository: null, path: await realpath(root) });
  });

  it('keeps outer repository identity unknown when cwd is a checkout subdirectory', async () => {
    for (const checkout of [repo, worktree]) {
      const result = await resolveWorkspaceIdentity({ ...context, cwd: join(checkout, 'src') }, 'example.ts');
      expect(result).toMatchObject({ workspace: { repository: null, kind: 'unknown', management: 'unknown' },
        reason: 'git_metadata_unavailable' });
    }
  });

  it('keeps an outside path and unmapped execution location outside observation authority', async () => {
    expect(await resolveWorkspaceIdentity(context, externalWorktree))
      .toEqual({ workspace: null, reason: 'path_unavailable' });
    expect(await resolveWorkspaceIdentity({ ...context, local: false }, repo))
      .toEqual({ workspace: null, reason: 'unmapped_execution_location' });
  });

  it('uses source metadata authority only for a trusted current managed worktree', async () => {
    const isolated = { ...context, cwd: externalWorktree };
    const unmanaged = await resolveWorkspaceIdentity(isolated, '.');
    expect(unmanaged).toMatchObject({ workspace: { repository: null, kind: 'unknown' },
      reason: 'git_metadata_unavailable' });
    const managed = await resolveWorkspaceIdentity({ ...isolated,
      managedWorktree: { path: externalWorktree, sourceRepoRoot: repo } }, 'src/example.ts');
    expect(managed.workspace).toMatchObject({ kind: 'worktree', management: 'runtime_managed',
      repository: { sourceRoot: await realpath(repo) } });
    const fromSubdirectory = await resolveWorkspaceIdentity({ ...isolated, cwd: join(externalWorktree, 'src'),
      managedWorktree: { path: externalWorktree, sourceRepoRoot: repo } }, 'example.ts');
    expect(fromSubdirectory.workspace?.checkoutId).toBe(managed.workspace?.checkoutId);
    expect(fromSubdirectory.workspace?.management).toBe('runtime_managed');
    const wrongOwner = await resolveWorkspaceIdentity({ ...isolated,
      managedWorktree: { path: worktree, sourceRepoRoot: repo } }, '.');
    expect(wrongOwner.workspace?.management).not.toBe('runtime_managed');
  });

  it('rejects a foreign Git pointer without exposing or probing arbitrary metadata', async () => {
    const hostile = join(root, 'hostile');
    const outside = join(fixture, 'private-metadata');
    await mkdir(hostile);
    await mkdir(outside);
    await writeFile(join(outside, 'HEAD'), 'private marker not admitted as repository data');
    await writeFile(join(hostile, '.git'), `gitdir: ${outside}\n`);
    const result = await resolveWorkspaceIdentity(context, hostile);
    expect(result).toMatchObject({ workspace: { repository: null, kind: 'unknown', verification: 'unavailable' },
      reason: 'git_metadata_unavailable' });
    expect(JSON.stringify(result)).not.toContain('private marker');
  });

  it('does not authorize source contents through trusted managed-worktree provenance', async () => {
    const forged = join(repo, 'not-git-metadata');
    await mkdir(join(forged, 'objects'), { recursive: true });
    await mkdir(join(forged, 'refs'));
    await writeFile(join(forged, 'HEAD'), 'ref: refs/heads/private-source-content\n');
    const admitted = join(fixture, 'forged-managed');
    await mkdir(admitted);
    await writeFile(join(admitted, '.git'), `gitdir: ${forged}\n`);
    const result = await resolveWorkspaceIdentity({ ...context, cwd: admitted,
      managedWorktree: { path: admitted, sourceRepoRoot: repo } }, '.');
    expect(result).toMatchObject({ workspace: { kind: 'unknown', management: 'unknown', repository: null },
      reason: 'git_metadata_unavailable' });
    expect(JSON.stringify(result)).not.toContain('private-source-content');
  });

  it('does not authorize sibling checkout contents when managed cwd is a subdirectory', async () => {
    const admitted = join(fixture, 'forged-managed-subdirectory');
    const forged = join(admitted, 'private');
    await mkdir(join(forged, 'objects'), { recursive: true });
    await mkdir(join(forged, 'refs'));
    await mkdir(join(admitted, 'src'));
    await writeFile(join(forged, 'HEAD'), 'ref: refs/heads/private-sibling\n');
    await writeFile(join(admitted, '.git'), `gitdir: ${forged}\n`);
    const result = await resolveWorkspaceIdentity({ ...context, cwd: join(admitted, 'src'),
      managedWorktree: { path: admitted, sourceRepoRoot: repo } }, '.');
    expect(result).toMatchObject({ workspace: { kind: 'unknown', management: 'unknown', repository: null },
      reason: 'git_metadata_unavailable' });
    expect(JSON.stringify(result)).not.toContain('private-sibling');
  });

  it('bounds metadata reads and rejects unsupported repository layouts', async () => {
    const oversized = join(root, 'oversized');
    await mkdir(oversized);
    await writeFile(join(oversized, '.git'), 'gitdir: ' + 'a'.repeat(8193));
    expect((await resolveWorkspaceIdentity(context, oversized)).reason).toBe('git_metadata_unavailable');
    const bare = join(root, 'bare.git');
    await mkdir(bare);
    git(bare, 'init', '--bare');
    expect((await resolveWorkspaceIdentity(context, bare)).workspace).toMatchObject({
      kind: 'unknown', repository: null, verification: 'unavailable',
    });
  });

  it('does not attribute explicit worktree Git metadata to the ancestor source checkout', async () => {
    const gitDirectory = git(worktree, 'rev-parse', '--absolute-git-dir');
    const result = await resolveWorkspaceIdentity(context, join(gitDirectory, 'HEAD'));
    expect(result).toMatchObject({ workspace: { repository: null, kind: 'unknown' },
      reason: 'git_metadata_target' });
  });

  it('rejects a junction/symlink operation alias while supporting an admitted root alias', async () => {
    const alias = join(root, 'alias');
    await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await resolveWorkspaceIdentity(context, join(alias, 'src', 'example.ts')))
      .toEqual({ workspace: null, reason: 'path_unavailable' });
    const rootAlias = join(fixture, 'admitted-root-alias');
    await symlink(root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const fromAlias = await resolveWorkspaceIdentity({ ...context, cwd: rootAlias },
      join('clients', 'customer', 'services', 'cats-runtime', 'src', 'example.ts'));
    const physical = await resolveWorkspaceIdentity(context, join(repo, 'src', 'example.ts'));
    expect(fromAlias.workspace?.checkoutId).toBe(physical.workspace?.checkoutId);
    expect(fromAlias.workspace?.repository?.id).toBe(physical.workspace?.repository?.id);
  });
});
