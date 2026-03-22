import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeSkillManifest } from './catalog.js';

describe('runtime skill catalog', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it('materializes filesystem skills for Codex isolated workspaces', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const cwd = join(sessionBaseDir, 'session-1');
    mkdirSync(cwd, { recursive: true });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['companion', 'repo-maintainer'],
    }, {
      sessionId: 'session-1',
      providerName: 'codex',
      providerBackend: 'cli',
      cwd,
      workspaceMode: 'isolated',
      sessionBaseDir,
    });

    expect(skillState).toEqual(expect.objectContaining({
      requestedSkills: ['companion', 'repo-maintainer'],
      appliedSkillIds: ['companion', 'repo-maintainer'],
      delivery: expect.objectContaining({
        preferredMode: 'filesystem',
        mode: 'filesystem',
        status: 'applied',
      }),
    }));
    expect(skillState?.delivery.filesystem?.rootPath).toBe(join(cwd, '.agents', 'skills'));
    expect(existsSync(join(cwd, '.agents', 'skills', 'companion', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.agents', 'skills', 'repo-maintainer', 'SKILL.md'))).toBe(true);
  });

  it('downgrades Codex shared workspaces to instruction delivery with warnings', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const cwd = join(sessionBaseDir, 'repo');
    mkdirSync(cwd, { recursive: true });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['companion'],
    }, {
      sessionId: 'session-shared',
      providerName: 'codex',
      providerBackend: 'cli',
      cwd,
      workspaceMode: 'shared',
      sessionBaseDir,
    });

    expect(skillState?.delivery).toEqual(expect.objectContaining({
      preferredMode: 'filesystem',
      mode: 'instructions',
      status: 'degraded',
    }));
    expect(skillState?.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('downgrade to instruction delivery'),
    ]));
  });

  it('builds a Pi runtime-owned instruction file that layers base instructions before skills', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const cwd = join(sessionBaseDir, 'repo');
    mkdirSync(cwd, { recursive: true });
    const baseInstructionsFile = join(sessionBaseDir, 'pi-base.md');
    writeFileSync(baseInstructionsFile, 'Base Pi instructions.', 'utf8');

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['delivery-auditor'],
    }, {
      sessionId: 'pi-session',
      providerName: 'pi',
      providerBackend: 'cli',
      cwd,
      workspaceMode: 'shared',
      sessionBaseDir,
      baseInstructionsFile,
    });

    const instructionsFile = skillState?.delivery.instructions?.filePath;
    expect(skillState?.delivery).toEqual(expect.objectContaining({
      preferredMode: 'instructions',
      mode: 'instructions',
      status: 'applied',
    }));
    expect(instructionsFile).toBeTruthy();
    expect(readFileSync(instructionsFile!, 'utf8')).toContain('Base Pi instructions.');
    expect(readFileSync(instructionsFile!, 'utf8')).toContain('Runtime Skill: Delivery Auditor');
  });

  it('rejects unknown skills with a client-safe runtime error', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);

    expect(() => resolveRuntimeSkillManifest({
      requestedSkills: ['missing-skill'],
    }, {
      sessionId: 'session-unknown',
      providerName: 'codex',
      providerBackend: 'cli',
      cwd: join(sessionBaseDir, 'repo'),
      workspaceMode: 'shared',
      sessionBaseDir,
    })).toThrowError("Unknown runtime skill 'missing-skill'.");
  });

  it('rejects malformed skill packages during resolution', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const invalidSkillDir = join(process.cwd(), 'skills', 'invalid-runtime-skill-test');
    cleanupPaths.push(invalidSkillDir);
    mkdirSync(invalidSkillDir, { recursive: true });
    writeFileSync(join(invalidSkillDir, 'SKILL.md'), [
      '---',
      'name: wrong-name',
      'description: Invalid skill for tests.',
      '---',
      '',
      'Broken skill body.',
      '',
    ].join('\n'), 'utf8');

    expect(() => resolveRuntimeSkillManifest({
      requestedSkills: ['invalid-runtime-skill-test'],
    }, {
      sessionId: 'session-invalid',
      providerName: 'codex',
      providerBackend: 'cli',
      cwd: join(sessionBaseDir, 'repo'),
      workspaceMode: 'shared',
      sessionBaseDir,
    })).toThrowError(expect.objectContaining({
      name: 'RuntimeSkillError',
      code: 'invalid_skill_package',
    }));
  });
});
