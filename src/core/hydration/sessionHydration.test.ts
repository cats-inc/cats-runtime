import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRuntimeSkillManifestFromState,
  hydrateSessionState,
  type WorkspaceHydrationSubstrateService,
} from './sessionHydration.js';
import { resolveRuntimeSkillManifest } from '../skills/catalog.js';

describe('session hydration', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  function writeSkillPackage(skillsRoot: string, skillId: string, body = 'Use the skill.') {
    const skillDir = join(skillsRoot, skillId);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      `name: ${skillId}`,
      `description: ${skillId} description.`,
      '---',
      '',
      body,
      '',
    ].join('\n'));
  }

  it('rehydrates persisted skill state for a new backend target during fork', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-hydration-'));
    cleanupPaths.push(root);
    const sessionBaseDir = join(root, 'sessions');
    const skillsRoot = join(root, 'skills');
    const parentCwd = join(root, 'repo');
    const childCwd = join(sessionBaseDir, 'child');
    mkdirSync(parentCwd, { recursive: true });
    mkdirSync(childCwd, { recursive: true });
    writeSkillPackage(skillsRoot, 'companion', 'Persisted skill body.');

    const existingSkills = resolveRuntimeSkillManifest({
      requestedSkills: ['companion'],
    }, {
      sessionId: 'parent',
      providerName: 'pi',
      providerBackend: 'cli',
      cwd: parentCwd,
      workspaceMode: 'shared',
      sessionBaseDir,
      skillsRoot,
    });

    const hydrated = await hydrateSessionState({
      trigger: 'fork',
      sessionId: 'child',
      providerName: 'codex',
      providerBackend: 'cli',
      runtimeCwd: childCwd,
      workspaceMode: 'isolated',
      sessionBaseDir,
      existingSkills,
      requestedWorkspaceSourceCwd: parentCwd,
      skillsRoot,
    });

    expect(buildRuntimeSkillManifestFromState(existingSkills)).toEqual({
      requestedSkills: ['companion'],
      strict: false,
    });
    expect(hydrated.skills).toEqual(expect.objectContaining({
      requestedSkills: ['companion'],
      delivery: expect.objectContaining({
        provider: 'codex',
        backend: 'cli',
        mode: 'filesystem',
        status: 'applied',
      }),
    }));
    expect(hydrated.hydration.skills).toEqual(expect.objectContaining({
      source: 'session_state',
      provider: 'codex',
      backend: 'cli',
      mode: 'filesystem',
    }));
    expect(hydrated.hydration.workspace).toEqual(expect.objectContaining({
      runtimeCwd: childCwd,
      sourceCwd: parentCwd,
      sourceOfTruth: 'source_workspace',
      substrate: expect.objectContaining({
        auditPath: parentCwd,
      }),
    }));
    expect(existsSync(join(childCwd, '.agents', 'skills', 'companion', 'SKILL.md'))).toBe(true);
  });

  it('marks isolated sandboxes without a source workspace as session-scoped state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-hydration-'));
    cleanupPaths.push(root);
    const runtimeCwd = join(root, 'sandbox');
    mkdirSync(runtimeCwd, { recursive: true });

    const hydrated = await hydrateSessionState({
      trigger: 'create',
      sessionId: 'sandbox-only',
      providerName: 'codex',
      providerBackend: 'cli',
      runtimeCwd,
      workspaceMode: 'isolated',
      sessionBaseDir: join(root, 'sessions'),
    });

    expect(hydrated.skills).toBeUndefined();
    expect(hydrated.hydration.workspace).toEqual(expect.objectContaining({
      runtimeCwd,
      sourceOfTruth: 'runtime_cwd',
      substrate: expect.objectContaining({
        auditPath: runtimeCwd,
      }),
    }));
    expect(hydrated.hydration.workspace.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('session-scoped state only'),
    ]));
  });

  it('preserves existing hydration metadata and overlays new metadata on top', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-hydration-'));
    cleanupPaths.push(root);
    const runtimeCwd = join(root, 'repo');
    mkdirSync(runtimeCwd, { recursive: true });

    const hydrated = await hydrateSessionState({
      trigger: 'message',
      sessionId: 'metadata-session',
      providerName: 'codex',
      providerBackend: 'cli',
      runtimeCwd,
      workspaceMode: 'shared',
      sessionBaseDir: join(root, 'sessions'),
      existingHydration: {
        trigger: 'create',
        updatedAt: '2026-03-23T00:00:00.000Z',
        workspace: {
          runtimeCwd,
          sourceCwd: runtimeCwd,
          sourceOfTruth: 'runtime_cwd',
          substrate: {
            auditPath: runtimeCwd,
            profile: 'standard',
            status: 'present',
            checkedAt: '2026-03-23T00:00:00.000Z',
            changedPaths: [],
            reviewCopyPaths: [],
            findingCounts: {
              missing: 0,
              present: 0,
              drifted: 0,
              conflicting: 0,
            },
          },
          warnings: [],
        },
        metadata: {
          companionSession: {
            boxId: 'companion-box-1',
          },
          preserved: true,
        },
      },
      metadata: {
        requestId: 'req-123',
      },
    });

    expect(hydrated.hydration.metadata).toEqual({
      companionSession: {
        boxId: 'companion-box-1',
      },
      preserved: true,
      requestId: 'req-123',
    });
  });

  it('downgrades operational workspace audit failures into warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-hydration-'));
    cleanupPaths.push(root);
    const runtimeCwd = join(root, 'sandbox');
    mkdirSync(runtimeCwd, { recursive: true });

    const ioFailure = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    const substrateService: WorkspaceHydrationSubstrateService = {
      execute: async () => {
        throw ioFailure;
      },
    };

    const hydrated = await hydrateSessionState({
      trigger: 'create',
      sessionId: 'io-failure',
      providerName: 'codex',
      providerBackend: 'cli',
      runtimeCwd,
      workspaceMode: 'shared',
      sessionBaseDir: join(root, 'sessions'),
      substrateService,
    });

    expect(hydrated.hydration.workspace.substrate.status).toBe('conflicting');
    expect(hydrated.hydration.workspace.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('permission denied'),
    ]));
  });

  it('rethrows programming errors from workspace audit execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-hydration-'));
    cleanupPaths.push(root);
    const runtimeCwd = join(root, 'sandbox');
    mkdirSync(runtimeCwd, { recursive: true });

    const substrateService: WorkspaceHydrationSubstrateService = {
      execute: async () => {
        throw new TypeError('broken substrate');
      },
    };

    await expect(hydrateSessionState({
      trigger: 'create',
      sessionId: 'programming-error',
      providerName: 'codex',
      providerBackend: 'cli',
      runtimeCwd,
      workspaceMode: 'shared',
      sessionBaseDir: join(root, 'sessions'),
      substrateService,
    })).rejects.toThrow('broken substrate');
  });
});
