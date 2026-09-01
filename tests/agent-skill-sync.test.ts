import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SYNC_ENGINE = join(REPO_ROOT, 'scripts', 'sync-agent-skills.mjs');

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cats-runtime-agent-skills-'));
}

function writeSkill(root: string, name: string, body: string): void {
  const skillRoot = join(root, name);
  mkdirSync(join(skillRoot, 'references'), { recursive: true });
  writeFileSync(
    join(skillRoot, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill.\n---\n\n${body}\n`,
    'utf8',
  );
  writeFileSync(join(skillRoot, 'references', 'details.md'), `${body}\n`, 'utf8');
}

function tryCreateDirectoryLink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && ['EPERM', 'EACCES', 'UNKNOWN'].includes(String(error.code))
    ) {
      return false;
    }
    throw error;
  }
}

function runSync(
  sourceRoot: string,
  destinationRoot: string,
  extraArgs: string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [
    SYNC_ENGINE,
    '--source-root',
    sourceRoot,
    '--destination-root',
    destinationRoot,
    ...extraArgs,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

describe('repository-maintenance skill sync', () => {
  it('mirrors both agents, reconciles renames, stays idempotent, and preserves local skills', () => {
    const root = createTempRoot();
    const sourceRoot = join(root, 'canonical');
    const destinationRoot = join(root, 'workspace');
    try {
      writeSkill(sourceRoot, 'managed-old', 'first version');
      writeSkill(join(destinationRoot, '.agents', 'skills'), 'local-only', 'keep me');
      writeSkill(join(destinationRoot, '.claude', 'skills'), 'local-only', 'keep me');

      const first = runSync(sourceRoot, destinationRoot);
      expect(first.status, first.stderr).toBe(0);
      for (const mirror of ['.agents', '.claude']) {
        expect(readFileSync(
          join(destinationRoot, mirror, 'skills', 'managed-old', 'references', 'details.md'),
          'utf8',
        )).toBe('first version\n');
        expect(readFileSync(
          join(destinationRoot, mirror, 'skills', 'local-only', 'SKILL.md'),
          'utf8',
        )).toContain('keep me');
      }

      const second = runSync(sourceRoot, destinationRoot);
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout).toContain('unchanged=1');

      renameSync(join(sourceRoot, 'managed-old'), join(sourceRoot, 'managed-new'));
      writeFileSync(
        join(sourceRoot, 'managed-new', 'SKILL.md'),
        '---\nname: managed-new\ndescription: Test skill.\n---\n\nrenamed\n',
        'utf8',
      );
      const renamed = runSync(sourceRoot, destinationRoot);
      expect(renamed.status, renamed.stderr).toBe(0);
      for (const mirror of ['.agents', '.claude']) {
        expect(() => readFileSync(
          join(destinationRoot, mirror, 'skills', 'managed-old', 'SKILL.md'),
          'utf8',
        )).toThrow();
        expect(readFileSync(
          join(destinationRoot, mirror, 'skills', 'managed-new', 'SKILL.md'),
          'utf8',
        )).toContain('renamed');
        expect(readFileSync(
          join(destinationRoot, mirror, 'skills', 'local-only', 'SKILL.md'),
          'utf8',
        )).toContain('keep me');
      }

      const cleaned = runSync(sourceRoot, destinationRoot, ['--clean']);
      expect(cleaned.status, cleaned.stderr).toBe(0);
      for (const mirror of ['.agents', '.claude']) {
        expect(readFileSync(
          join(destinationRoot, mirror, 'skills', 'managed-new', 'SKILL.md'),
          'utf8',
        )).toContain('renamed');
        expect(readFileSync(
          join(destinationRoot, mirror, 'skills', 'local-only', 'SKILL.md'),
          'utf8',
        )).toContain('keep me');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an unmanaged skill with the same name', () => {
    const root = createTempRoot();
    const sourceRoot = join(root, 'canonical');
    const destinationRoot = join(root, 'workspace');
    try {
      writeSkill(sourceRoot, 'collision', 'canonical');
      writeSkill(join(destinationRoot, '.agents', 'skills'), 'collision', 'local');

      const result = runSync(sourceRoot, destinationRoot, ['--agent', 'codex']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Refusing to overwrite unmanaged skill');
      expect(readFileSync(
        join(destinationRoot, '.agents', 'skills', 'collision', 'SKILL.md'),
        'utf8',
      )).toContain('local');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps Antigravity and Grok aliases onto the shared .agents discovery path', () => {
    for (const agent of ['antigravity', 'grok']) {
      const root = createTempRoot();
      const sourceRoot = join(root, 'canonical');
      const destinationRoot = join(root, 'workspace');
      try {
        writeSkill(sourceRoot, 'shared-skill', agent);
        const result = runSync(sourceRoot, destinationRoot, ['--agent', agent]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`Synced ${agent}`);
        expect(readFileSync(
          join(destinationRoot, '.agents', 'skills', 'shared-skill', 'SKILL.md'),
          'utf8',
        )).toContain(agent);
        expect(existsSync(join(destinationRoot, '.claude'))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('rejects symbolic links in canonical skill trees before mirroring', () => {
    const root = createTempRoot();
    const sourceRoot = join(root, 'canonical');
    const destinationRoot = join(root, 'workspace');
    const linkedContent = join(root, 'linked-content');
    try {
      writeSkill(sourceRoot, 'linked-skill', 'canonical');
      mkdirSync(linkedContent, { recursive: true });
      writeFileSync(join(linkedContent, 'outside.md'), 'outside\n', 'utf8');
      if (!tryCreateDirectoryLink(
        linkedContent,
        join(sourceRoot, 'linked-skill', 'references', 'linked'),
      )) {
        return;
      }

      const result = runSync(sourceRoot, destinationRoot, ['--agent', 'codex']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Skill trees may not contain symbolic links');
      expect(existsSync(join(
        destinationRoot,
        '.agents',
        'skills',
        'linked-skill',
      ))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a linked discovery path before creating content outside the destination root', () => {
    const root = createTempRoot();
    const sourceRoot = join(root, 'canonical');
    const destinationRoot = join(root, 'workspace');
    const outsideRoot = join(root, 'outside');
    try {
      writeSkill(sourceRoot, 'managed-skill', 'canonical');
      mkdirSync(destinationRoot, { recursive: true });
      mkdirSync(outsideRoot, { recursive: true });
      if (!tryCreateDirectoryLink(outsideRoot, join(destinationRoot, '.agents'))) {
        return;
      }

      const result = runSync(sourceRoot, destinationRoot, ['--agent', 'codex']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Agent discovery paths may not contain symbolic links');
      expect(existsSync(join(outsideRoot, 'skills'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps all platform entrypoints on the same reconciliation engine', () => {
    const windows = readFileSync(
      join(REPO_ROOT, 'scripts', 'windows', 'Sync-AgentSkills.ps1'),
      'utf8',
    );
    const linux = readFileSync(
      join(REPO_ROOT, 'scripts', 'linux', 'sync-agent-skills.sh'),
      'utf8',
    );
    const macos = readFileSync(
      join(REPO_ROOT, 'scripts', 'macos', 'sync-agent-skills.sh'),
      'utf8',
    );

    expect(windows).toContain('sync-agent-skills.mjs');
    expect(linux).toContain('sync-agent-skills.mjs');
    expect(macos).toContain('sync-agent-skills.mjs');
  });

  it('runs the provider picker normalization behavior suite', () => {
    const result = spawnSync(process.execPath, [
      '--test',
      '--test-isolation=none',
      join(
        REPO_ROOT,
        'developer-skills',
        'maintain-provider-model-catalogs',
        'tests',
        'normalize-picker-paste.test.mjs',
      ),
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
