import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupSessionWorkspace, prepareSessionWorkspace } from '../workspace/sessionWorkspace.js';
import { hydrateSessionState, type HydrateSessionStateInput } from '../hydration/sessionHydration.js';
import { listRuntimeSkillCatalog } from './catalog.js';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function fixture(ignored = true, nested = false) {
  const root = mkdtempSync(join(tmpdir(), 'cats-worktree-skills-')); roots.push(root);
  const repo = join(root, 'repo'), sessionBaseDir = join(root, 'sessions'), skillsRoot = join(root, 'skills');
  mkdirSync(join(repo, 'subdir'), { recursive: true });
  writeFileSync(join(repo, 'subdir', 'source.txt'), 'original\n');
  writeFileSync(join(repo, '.gitignore'), ignored ? '.agents/\n' : 'unrelated/\n');
  git(repo, 'init'); git(repo, 'config', 'user.name', 'Cats Fixture'); git(repo, 'config', 'user.email', 'fixture@example.test');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Fixture baseline');
  const source = join(skillsRoot, 'preview', 'companion');
  mkdirSync(join(source, 'references'), { recursive: true });
  writeFileSync(join(skillsRoot, 'content-profile.json'), '{"schemaVersion":1,"profile":"preview"}');
  writeFileSync(join(source, 'SKILL.md'), '---\nname: companion\ndescription: Test skill.\n---\nUse references/checkpoint.md.\n');
  writeFileSync(join(source, 'references', 'checkpoint.md'), 'Keep a checkpoint.\n');
  const sessionId = 'owned-session';
  const prepared = await prepareSessionWorkspace({ sessionId, sessionBaseDir, cwd: nested ? join(repo, 'subdir') : repo,
    workspaceKind: 'worktree', workspaceAccess: 'read_write', permissionMode: 'whitelist' });
  const skill = listRuntimeSkillCatalog(skillsRoot)[0];
  const input: HydrateSessionStateInput = { trigger: 'create', sessionId, sessionBaseDir, runtimeCwd: prepared.cwd,
    providerName: 'codex', providerBackend: 'cli', skillsRoot, workspace: prepared.workspace,
    requestedSkills: { strict: true, requestedSkills: [{ id: skill.id, fingerprint: skill.fingerprint }] } };
  return { root, repo, input, prepared, target: join(prepared.cwd, '.agents', 'skills', 'companion') };
}

describe('Codex skills in a Runtime-owned worktree', () => {
  it.each([false, true])('hydrates create/message/resume including references without source or Git changes (nested %s)', async nested => {
    const f = await fixture(true, nested);
    let result = await hydrateSessionState(f.input);
    const first = structuredClone(result.skills);
    for (const trigger of ['message', 'resume'] as const) {
      result = await hydrateSessionState({ ...f.input, trigger, existingSkills: result.skills, existingHydration: result.hydration });
      expect(result.skills?.requestedSkillRefs).toEqual(first?.requestedSkillRefs);
      expect(result.skills?.resolvedSkills).toEqual(first?.resolvedSkills);
    }
    expect(result.skills?.delivery).toMatchObject({ status: 'applied', mode: 'filesystem', warnings: [] });
    expect(result.hydration.workspace).toMatchObject({ kind: 'worktree', access: 'read_write' });
    expect(f.prepared.permissionMode).toBe('whitelist');
    expect(readFileSync(join(f.target, 'references', 'checkpoint.md'), 'utf8')).toBe('Keep a checkpoint.\n');
    expect(git(f.prepared.cwd, 'status', '--porcelain')).toBe('');
    git(f.prepared.cwd, 'add', '--all');
    expect(git(f.prepared.cwd, 'diff', '--cached', '--name-only')).toBe('');
    expect(existsSync(join(f.repo, '.agents'))).toBe(false);
    expect(git(f.repo, 'status', '--porcelain')).toBe('');
  }, 20000);

  it('rehydrates a nested worktree preserved at its root by normal workspace cleanup', async () => {
    const f = await fixture(true, true), first = await hydrateSessionState(f.input);
    const retained = await cleanupSessionWorkspace({ sessionId: f.input.sessionId, sessionBaseDir: f.input.sessionBaseDir,
      workspace: f.prepared.workspace, worktreeCleanupPolicy: 'preserve' });
    expect(retained.status).toBe('retained');
    expect(retained.nextCwd).toBe(f.prepared.workspace.worktree!.worktreePath);
    const resumed = await hydrateSessionState({ ...f.input, trigger: 'resume', runtimeCwd: retained.nextCwd!,
      workspace: retained.nextWorkspace, existingSkills: first.skills, existingHydration: first.hydration });
    expect(resumed.skills?.delivery).toMatchObject({ status: 'applied', mode: 'filesystem' });
    expect(git(retained.nextCwd!, 'status', '--porcelain')).toBe('');
  }, 20000);

  it.each(['unowned', 'wrong-session', 'wrong-root', 'outside-cwd', 'source', 'not-ignored', 'tracked', 'marker-tracked'])(
    'refuses %s before copying skill files', async kind => {
      const f = await fixture(kind !== 'not-ignored');
      const input = structuredClone(f.input);
      if (kind === 'unowned') delete input.workspace!.worktree;
      if (kind === 'wrong-session') input.sessionId = 'different-session';
      if (kind === 'wrong-root') input.workspace!.worktree!.worktreePath = f.repo;
      if (kind === 'outside-cwd') input.runtimeCwd = input.workspace!.runtimeCwd = f.repo;
      if (kind === 'source') input.workspace!.kind = 'source';
      if (kind === 'tracked' || kind === 'marker-tracked') {
        mkdirSync(f.target, { recursive: true });
        const file = kind === 'tracked' ? join(f.target, 'existing.txt') : join(f.target, '..', '.cats-preview-content.json');
        writeFileSync(file, 'tracked fixture\n');
        git(f.prepared.cwd, 'add', '-f', file);
      }
      await expect(hydrateSessionState(input)).rejects.toThrow(/Strict runtime skill delivery/u);
      expect(existsSync(join(f.target, 'SKILL.md'))).toBe(false);
      expect(existsSync(join(f.repo, '.agents'))).toBe(false);
    }, 20000,
  );

  it.each(['.agents', '.agents/skills', '.agents/skills/companion', '.agents/skills/companion/references'])(
    'refuses linked target %s without touching the destination', async relative => {
      const f = await fixture();
      const outside = join(f.root, 'unrelated'); mkdirSync(outside);
      const target = join(f.prepared.cwd, relative), parent = join(target, '..');
      mkdirSync(parent, { recursive: true });
      symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(hydrateSessionState(f.input)).rejects.toThrow(/Strict runtime skill delivery/u);
      expect(existsSync(join(outside, 'SKILL.md'))).toBe(false);
      expect(existsSync(join(outside, '.cats-preview-content.json'))).toBe(false);
    }, 20000,
  );

  it('rejects a hardlinked preview marker without changing unrelated bytes', async () => {
    const f = await fixture(), outside = join(f.root, 'unrelated.txt');
    writeFileSync(outside, 'Keep these bytes.\n'); mkdirSync(join(f.target, '..'), { recursive: true });
    linkSync(outside, join(f.target, '..', '.cats-preview-content.json'));
    await expect(hydrateSessionState(f.input)).rejects.toThrow(/Strict runtime skill delivery/u);
    expect(readFileSync(outside, 'utf8')).toBe('Keep these bytes.\n');
    expect(existsSync(join(f.target, 'SKILL.md'))).toBe(false);
  }, 20000);

  it('ignores inherited Git routing and rejects changed resource bytes on re-entry', async () => {
    const f = await fixture();
    vi.stubEnv('GIT_DIR', join(f.repo, '.git'));
    vi.stubEnv('GIT_WORK_TREE', f.repo);
    const first = await hydrateSessionState(f.input);
    writeFileSync(join(f.target, 'references', 'checkpoint.md'), 'Altered resource.\n');
    await expect(hydrateSessionState({ ...f.input, trigger: 'resume', existingSkills: first.skills,
      existingHydration: first.hydration })).rejects.toThrow(/Strict runtime skill delivery/u);
    expect(existsSync(join(f.repo, '.agents'))).toBe(false);
  }, 20000);
});
