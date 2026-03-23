import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeRuntimeSkillInstructions, resolveRuntimeSkillManifest } from './catalog.js';

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

  function writeSkillPackage(
    skillsRoot: string,
    skillPath: string,
    options: {
      body?: string;
      name?: string;
      description?: string;
      family?: string;
      title?: string;
      version?: string;
      aliases?: string[];
    } = {},
  ) {
    const pathSegments = skillPath.split('/').filter(Boolean);
    const slug = pathSegments.at(-1)!;
    const skillDir = join(skillsRoot, ...pathSegments);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      `name: ${options.name ?? slug}`,
      ...(options.title ? [`title: ${options.title}`] : []),
      `description: ${options.description ?? `${slug} description.`}`,
      ...(options.family ? [`family: ${options.family}`] : []),
      ...(options.version ? [`version: ${options.version}`] : []),
      ...(options.aliases?.length
        ? [
            'aliases:',
            ...options.aliases.map((alias) => `  - ${alias}`),
          ]
        : []),
      '---',
      '',
      options.body ?? `Use the ${slug} workflow.`,
      '',
    ].join('\n'), 'utf8');
    return skillDir;
  }

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
    const skillsRoot = join(sessionBaseDir, 'skills');
    writeSkillPackage(skillsRoot, 'invalid-runtime-skill-test', {
      name: 'wrong-name',
      description: 'Invalid skill for tests.',
      body: 'Broken skill body.',
    });

    expect(() => resolveRuntimeSkillManifest({
      requestedSkills: ['invalid-runtime-skill-test'],
    }, {
      sessionId: 'session-invalid',
      providerName: 'codex',
      providerBackend: 'cli',
      cwd: join(sessionBaseDir, 'repo'),
      workspaceMode: 'shared',
      sessionBaseDir,
      skillsRoot,
    })).toThrowError(expect.objectContaining({
      name: 'RuntimeSkillError',
      code: 'invalid_skill_package',
    }));
  });

  it('resolves family-aware library skills and preserves requested refs', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    const cwd = join(sessionBaseDir, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeSkillPackage(skillsRoot, 'work/product-manager', {
      family: 'work',
      title: 'Product Manager',
      version: '2026.03',
      aliases: ['pm'],
      body: 'Shape product outcomes.',
    });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: [{
        family: 'work',
        slug: 'product-manager',
        version: '2026.03',
      }],
    }, {
      sessionId: 'session-work-role',
      providerName: 'claude',
      providerBackend: 'api',
      cwd,
      workspaceMode: 'shared',
      sessionBaseDir,
      skillsRoot,
    });

    expect(skillState).toEqual(expect.objectContaining({
      requestedSkills: ['work/product-manager'],
      requestedSkillRefs: [{
        id: 'work/product-manager',
        family: 'work',
        slug: 'product-manager',
        version: '2026.03',
        requestedAs: 'work/product-manager',
      }],
      appliedSkillIds: ['work/product-manager'],
      resolvedSkills: [expect.objectContaining({
        id: 'work/product-manager',
        family: 'work',
        slug: 'product-manager',
        version: '2026.03',
        title: 'Product Manager',
      })],
    }));
  });

  it('rejects ambiguous slug-only requests when multiple families share the same slug', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    writeSkillPackage(skillsRoot, 'work/architect', {
      family: 'work',
    });
    writeSkillPackage(skillsRoot, 'code/architect', {
      family: 'code',
    });

    expect(() => resolveRuntimeSkillManifest({
      requestedSkills: ['architect'],
    }, {
      sessionId: 'session-ambiguous',
      providerName: 'claude',
      providerBackend: 'api',
      cwd: join(sessionBaseDir, 'repo'),
      workspaceMode: 'shared',
      sessionBaseDir,
      skillsRoot,
    })).toThrowError("Runtime skill 'architect' is ambiguous. Request it as family/slug instead.");
  });

  it('downgrades Codex filesystem delivery when selected skills collide on materialized slug', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    const cwd = join(sessionBaseDir, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeSkillPackage(skillsRoot, 'work/architect', {
      family: 'work',
    });
    writeSkillPackage(skillsRoot, 'code/architect', {
      family: 'code',
    });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['work/architect', 'code/architect'],
    }, {
      sessionId: 'session-collision',
      providerName: 'codex',
      providerBackend: 'cli',
      cwd,
      workspaceMode: 'isolated',
      sessionBaseDir,
      skillsRoot,
    });

    expect(skillState?.delivery).toEqual(expect.objectContaining({
      preferredMode: 'filesystem',
      mode: 'instructions',
      status: 'degraded',
    }));
    expect(skillState?.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("slug 'architect'"),
    ]));
  });

  it('reuses the resolved skill package when building later instruction overlays', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    writeSkillPackage(skillsRoot, 'cached-skill', {
      body: 'Original cached instructions.',
    });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['cached-skill'],
    }, {
      sessionId: 'session-cached',
      providerName: 'claude',
      providerBackend: 'api',
      cwd: join(sessionBaseDir, 'repo'),
      workspaceMode: 'shared',
      sessionBaseDir,
      skillsRoot,
    });

    writeSkillPackage(skillsRoot, 'cached-skill', {
      body: 'Mutated instructions that should not be re-read for this session.',
    });

    const mergedInstructions = mergeRuntimeSkillInstructions(undefined, skillState);
    expect(mergedInstructions).toContain('Original cached instructions.');
    expect(mergedInstructions).not.toContain('Mutated instructions');
  });
});
