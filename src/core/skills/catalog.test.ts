import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRuntimeSkillInstructionOverlay,
  listRuntimeSkillCatalog,
  mergeRuntimeSkillInstructions,
  resolveRuntimeSkillManifest,
} from './catalog.js';

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
    skillId: string,
    options: {
      family?: string;
      body?: string;
      name?: string;
      description?: string;
      slug?: string;
      role?: string;
      packageKind?: string;
      version?: string;
      capabilityTags?: string[];
      productTags?: string[];
      deliveryHints?: string[];
      recommendedCompanions?: string[];
    } = {},
  ) {
    const skillDir = options.family
      ? join(skillsRoot, options.family, skillId)
      : join(skillsRoot, skillId);
    mkdirSync(skillDir, { recursive: true });
    const lines = [
      '---',
      `name: ${options.name ?? skillId}`,
      `description: ${options.description ?? `${skillId} description.`}`,
      ...(options.family ? [`family: ${options.family}`] : []),
      ...(options.slug ? [`slug: ${options.slug}`] : []),
      ...(options.role ? [`role: ${options.role}`] : []),
      ...(options.packageKind ? [`packageKind: ${options.packageKind}`] : []),
      ...(options.version ? [`version: ${options.version}`] : []),
      ...(options.capabilityTags
        ? ['capabilityTags:', ...options.capabilityTags.map((tag) => `  - ${tag}`)]
        : []),
      ...(options.productTags
        ? ['productTags:', ...options.productTags.map((tag) => `  - ${tag}`)]
        : []),
      ...(options.deliveryHints
        ? ['deliveryHints:', ...options.deliveryHints.map((hint) => `  - ${hint}`)]
        : []),
      ...(options.recommendedCompanions
        ? [
            'recommendedCompanions:',
            ...options.recommendedCompanions.map((companion) => `  - ${companion}`),
          ]
        : []),
      '---',
      '',
      options.body ?? `Use the ${skillId} workflow.`,
      '',
    ];
    writeFileSync(join(skillDir, 'SKILL.md'), lines.join('\n'), 'utf8');
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

  it('lists a family-aware runtime skill catalog with normalized metadata', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    writeSkillPackage(skillsRoot, 'coordinator', {
      family: 'orchestration',
      role: 'coordinator',
      capabilityTags: ['sequencing', 'dependency-tracking'],
      productTags: ['orchestration'],
      deliveryHints: ['filesystem', 'instructions'],
      recommendedCompanions: ['companion-guardian'],
    });
    writeSkillPackage(skillsRoot, 'companion', {
      family: 'chat',
      packageKind: 'base',
      role: 'companion_core',
      capabilityTags: ['memory-continuity'],
    });

    const catalog = listRuntimeSkillCatalog(skillsRoot);
    expect(catalog).toEqual([
      expect.objectContaining({
        id: 'companion',
        library: {
          family: 'chat',
          slug: 'companion',
          role: 'companion_core',
          packageKind: 'base',
          version: '1.0.0',
          capabilityTags: ['memory-continuity'],
          productTags: [],
          deliveryHints: [],
          recommendedCompanions: [],
        },
      }),
      expect.objectContaining({
        id: 'coordinator',
        library: {
          family: 'orchestration',
          slug: 'coordinator',
          role: 'coordinator',
          packageKind: 'role',
          version: '1.0.0',
          capabilityTags: ['sequencing', 'dependency-tracking'],
          productTags: ['orchestration'],
          deliveryHints: ['filesystem', 'instructions'],
          recommendedCompanions: ['companion-guardian'],
        },
      }),
    ]);
  });

  it('resolves nested family packages by requested skill id', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    const cwd = join(sessionBaseDir, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeSkillPackage(skillsRoot, 'advanced-programmer-runtime', {
      family: 'code',
      role: 'advanced_programmer_runtime',
      deliveryHints: ['filesystem', 'instructions'],
      body: 'Protect runtime seams and lifecycle contracts.',
    });

    const skillState = resolveRuntimeSkillManifest({
      requestedSkills: ['advanced-programmer-runtime'],
    }, {
      sessionId: 'session-runtime',
      providerName: 'claude',
      providerBackend: 'api',
      cwd,
      workspaceMode: 'shared',
      sessionBaseDir,
      skillsRoot,
    });

    expect(skillState?.resolvedSkills).toEqual([
      expect.objectContaining({
        id: 'advanced-programmer-runtime',
        entryFile: join(
          skillsRoot,
          'code',
          'advanced-programmer-runtime',
          'SKILL.md',
        ),
        library: expect.objectContaining({
          family: 'code',
          role: 'advanced_programmer_runtime',
          deliveryHints: ['filesystem', 'instructions'],
        }),
      }),
    ]);
  });

  it('rejects duplicate skill ids declared in multiple family directories', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const skillsRoot = join(sessionBaseDir, 'skills');
    writeSkillPackage(skillsRoot, 'coordinator', { family: 'orchestration' });
    writeSkillPackage(skillsRoot, 'coordinator', { family: 'work' });

    expect(() => listRuntimeSkillCatalog(skillsRoot)).toThrowError(
      "Runtime skill 'coordinator' is declared more than once",
    );
  });

  it('fails clearly when a persisted instruction-delivery skill sits outside a recognizable skills root', () => {
    const sessionBaseDir = mkdtempSync(join(tmpdir(), 'cats-runtime-skill-catalog-'));
    cleanupPaths.push(sessionBaseDir);
    const detachedEntryDir = join(sessionBaseDir, 'detached', 'detached-skill');
    mkdirSync(detachedEntryDir, { recursive: true });
    writeFileSync(join(detachedEntryDir, 'SKILL.md'), [
      '---',
      'name: detached-skill',
      'description: Detached skill for tests.',
      'family: code',
      '---',
      '',
      'Detached instructions.',
      '',
    ].join('\n'), 'utf8');

    const skillState = {
      requestedSkills: ['detached-skill'],
      resolvedSkills: [{
        id: 'detached-skill',
        slug: 'detached-skill',
        family: 'code' as const,
        version: '1.0.0',
        title: 'Detached Skill',
        description: 'Detached skill for tests.',
        status: 'resolved' as const,
        source: 'runtime_catalog' as const,
        sourcePath: detachedEntryDir,
        entryFile: join(detachedEntryDir, 'SKILL.md'),
        fingerprint: 'detached-skill-fingerprint',
        library: {
          family: 'code' as const,
          slug: 'detached-skill',
          role: 'detached_skill',
          packageKind: 'role' as const,
          version: '1.0.0',
          capabilityTags: [],
          productTags: [],
          deliveryHints: ['instructions' as const],
          recommendedCompanions: [],
        },
      }],
      strict: false,
      delivery: {
        provider: 'claude',
        backend: 'api' as const,
        preferredMode: 'instructions' as const,
        mode: 'instructions' as const,
        status: 'applied' as const,
        warnings: [],
        instructions: {
          byteLength: 1,
        },
      },
      warnings: [],
      appliedSkillIds: ['detached-skill'],
      updatedAt: '2026-03-24T00:00:00.000Z',
    };

    expect(() => buildRuntimeSkillInstructionOverlay(skillState)).toThrowError(
      "Runtime skill 'detached-skill' is stored outside a recognizable skills root.",
    );
  });
});
