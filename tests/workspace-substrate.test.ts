import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceSubstrateService } from '../src/core/runtime/WorkspaceSubstrateService.js';

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-substrate-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('WorkspaceSubstrateService', () => {
  it('returns machine-readable findings and actions for a missing substrate', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      const result = await service.execute({
        operation: 'audit-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
      });

      expect(result.applied).toBe(false);
      expect(result.status).toBe('missing');
      expect(result.contract).toMatchObject({
        mode: 'preview',
        safeDefaultMode: 'preview',
        applyRequested: false,
        applyDecision: 'not_requested',
        readOnly: true,
      });
      expect(result.plan).toMatchObject({
        requiresApproval: false,
      });
      expect(result.approval).toMatchObject({
        required: false,
        blockedPaths: [],
      });
      expect(result.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'AGENTS.md', status: 'missing' }),
        expect.objectContaining({ path: 'CODEX.md', status: 'missing' }),
      ]));
      expect(result.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'create',
          path: 'AGENTS.md',
          outputPath: 'AGENTS.md',
          mergeStrategy: 'create',
          diffStats: expect.objectContaining({ changed: true }),
        }),
        expect.objectContaining({ type: 'create', path: 'docs/AGENT-GUIDE.md' }),
      ]));
      expect(result.plan.changedPaths).toEqual(expect.arrayContaining([
        'AGENTS.md',
        'CODEX.md',
      ]));
      expect(result.summary.findingCounts.missing).toBeGreaterThan(0);
      expect(result.summary.actionCounts.create).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it('keeps audit-workspace read-only even when apply is requested', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      const result = await service.execute({
        operation: 'audit-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      expect(result.applied).toBe(false);
      expect(result.contract).toMatchObject({
        mode: 'apply',
        applyRequested: true,
        applyDecision: 'read_only_operation',
        readOnly: true,
      });
      expect(result.approval.applyPayload).toBeUndefined();
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('requires approval for apply and writes sidecars for conflicting files', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();
    writeFileSync(join(root, 'AGENTS.md'), '# local rules\n');

    try {
      const blocked = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'specialist_cat',
        },
      });

      expect(blocked.applied).toBe(false);
      expect(blocked.authorization.requiresApproval).toBe(true);
      expect(blocked.contract.applyDecision).toBe('blocked');
      expect(blocked.plan.requiresApproval).toBe(true);
      expect(blocked.approval).toMatchObject({
        required: true,
        blockedPaths: expect.arrayContaining(['AGENTS.md.bootstrap']),
        applyPayload: expect.objectContaining({
          operation: 'update-workspace',
          apply: true,
        }),
      });
      expect(blocked.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'write_sidecar',
          path: 'AGENTS.md',
          reviewCopyPath: 'AGENTS.md.bootstrap',
        }),
      ]));

      const applied = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      expect(applied.applied).toBe(true);
      expect(applied.status).toBe('conflicting');
      expect(applied.summary.changedPaths).toContain('AGENTS.md.bootstrap');
      expect(applied.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'write_sidecar',
          path: 'AGENTS.md',
          outputPath: 'AGENTS.md.bootstrap',
          requiresApproval: false,
        }),
      ]));
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toBe('# local rules\n');
      expect(readFileSync(join(root, 'AGENTS.md.bootstrap'), 'utf-8'))
        .toContain('cats-runtime:workspace-substrate');
    } finally {
      cleanup();
    }
  });

  it('plans update_managed actions for drifted runtime-managed files', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      await service.execute({
        operation: 'init-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      const agentsPath = join(root, 'AGENTS.md');
      const managedContent = readFileSync(agentsPath, 'utf-8');
      writeFileSync(
        agentsPath,
        managedContent.replace(
          '- Prefer conservative updates over overwriting local customizations.',
          [
            '- Prefer conservative updates over overwriting local customizations.',
            '- Local managed drift note for review coverage.',
          ].join('\n'),
        ),
      );

      const result = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        authorization: {
          actorRole: 'specialist_cat',
        },
      });

      expect(result.applied).toBe(false);
      expect(result.status).toBe('drifted');
      expect(result.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'AGENTS.md',
          status: 'drifted',
          managed: true,
        }),
      ]));
      expect(result.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'update',
          path: 'AGENTS.md',
          outputPath: 'AGENTS.md',
          mergeStrategy: 'update_managed',
          managed: true,
          requiresApproval: true,
          diffStats: expect.objectContaining({ changed: true }),
        }),
      ]));
      expect(result.plan.changedPaths).toContain('AGENTS.md');
      expect(result.plan.pendingApprovalPaths).toContain('AGENTS.md');
      expect(result.plan.reviewCopyPaths).toEqual([]);
      expect(result.approval).toMatchObject({
        required: true,
        blockedPaths: expect.arrayContaining(['AGENTS.md']),
        applyPayload: expect.objectContaining({
          operation: 'update-workspace',
          apply: true,
        }),
      });
    } finally {
      cleanup();
    }
  });

  it('does not require approval when the workspace already matches the profile', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      await service.execute({
        operation: 'init-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      const result = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        authorization: {
          actorRole: 'specialist_cat',
        },
      });

      expect(result.status).toBe('present');
      expect(result.authorization.requiresApproval).toBe(false);
      expect(result.plan.requiresApproval).toBe(false);
      expect(result.approval.required).toBe(false);
      expect(result.summary.pendingApprovalPaths).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
