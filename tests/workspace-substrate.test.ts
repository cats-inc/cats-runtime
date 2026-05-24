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
  it('lists runtime-owned workspace substrate profiles for hosts', () => {
    const service = new WorkspaceSubstrateService();

    expect(service.listProfiles()).toEqual({
      defaultProfile: 'standard',
      allowedAgents: ['claude', 'codex'],
      profiles: [
        expect.objectContaining({
          id: 'minimal',
          defaultEnabledAgents: [],
          includeA2AByDefault: false,
        }),
        expect.objectContaining({
          id: 'standard',
          defaultEnabledAgents: ['claude', 'codex'],
          includeA2AByDefault: false,
        }),
        expect.objectContaining({
          id: 'a2a-enabled',
          defaultEnabledAgents: ['claude', 'codex'],
          includeA2AByDefault: true,
        }),
      ],
    });
  });

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
        expect.objectContaining({ type: 'create', path: 'docs/README.md' }),
        expect.objectContaining({ type: 'create', path: 'scripts/windows/Sync-AgentSkills.ps1' }),
        expect.objectContaining({ type: 'create', path: 'scripts/linux/sync-agent-skills.sh' }),
        expect.objectContaining({ type: 'create', path: 'scripts/macos/sync-agent-skills.sh' }),
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

  it('applies update_managed changes for drifted runtime-managed files', async () => {
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
            '- Local managed drift note for apply coverage.',
          ].join('\n'),
        ),
      );

      const result = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      expect(result.applied).toBe(true);
      expect(result.status).toBe('drifted');
      expect(result.summary.changedPaths).toContain('AGENTS.md');
      expect(result.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'update',
          path: 'AGENTS.md',
          outputPath: 'AGENTS.md',
          mergeStrategy: 'update_managed',
          managed: true,
          requiresApproval: false,
        }),
      ]));
      expect(readFileSync(agentsPath, 'utf-8')).toBe(managedContent);
      expect(readFileSync(agentsPath, 'utf-8')).not.toContain('Local managed drift note for apply coverage.');
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

  it('seeds pilot A2A v1 starter artifacts for the a2a-enabled profile', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      const result = await service.execute({
        operation: 'init-workspace',
        workspacePath: root,
        profile: 'a2a-enabled',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      expect(result.applied).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'agent-card.public.json.example'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'agent-card.authenticated.json.example'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'jsonrpc-send-message.request.json.example'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'jsonrpc-get-task.request.json.example'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'windows', 'Sync-AgentSkills.ps1'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'linux', 'sync-agent-skills.sh'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'macos', 'sync-agent-skills.sh'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'task.json.example'))).toBe(false);
      expect(readFileSync(join(root, 'docs', 'a2a', 'README.md'), 'utf-8'))
        .toContain('agent-card.public.json.example');
      expect(readFileSync(join(root, 'scripts', 'README.md'), 'utf-8'))
        .toContain('Sync-AgentSkills.ps1');
    } finally {
      cleanup();
    }
  });

  it('seeds collaboration starter indexes and readmes for the standard profile', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      const result = await service.execute({
        operation: 'init-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      expect(result.applied).toBe(true);
      expect(existsSync(join(root, 'docs', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'specs', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'plans', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'research', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'decisions', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'skills', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'README.md'))).toBe(true);
      expect(readFileSync(join(root, 'docs', 'README.md'), 'utf-8'))
        .toContain('Documentation Index');
      expect(readFileSync(join(root, 'skills', 'README.md'), 'utf-8'))
        .toContain('SKILL.md');
      expect(readFileSync(join(root, 'scripts', 'README.md'), 'utf-8'))
        .toContain('repo-owned helper entrypoints');
    } finally {
      cleanup();
    }
  });

  it('retires obsolete managed legacy A2A starter files during update-workspace', async () => {
    const { root, cleanup } = createWorkspace();
    const service = new WorkspaceSubstrateService();

    try {
      mkdirSync(join(root, 'docs', 'a2a'), { recursive: true });
      writeFileSync(
        join(root, 'docs', 'a2a', 'agent-card.json.example'),
        JSON.stringify({
          xCatsRuntimeSubstrate:
            'cats-runtime:workspace-substrate profile=a2a-enabled file=docs/a2a/agent-card.json.example',
          name: 'workspace-agent',
        }, null, 2) + '\n',
      );
      writeFileSync(
        join(root, 'docs', 'a2a', 'task.json.example'),
        JSON.stringify({
          xCatsRuntimeSubstrate:
            'cats-runtime:workspace-substrate profile=a2a-enabled file=docs/a2a/task.json.example',
          task: {
            id: 'task-example',
          },
        }, null, 2) + '\n',
      );

      const preview = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'a2a-enabled',
        enabledAgents: ['codex'],
        authorization: {
          actorRole: 'specialist_cat',
        },
      });

      expect(preview.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'remove',
          path: 'docs/a2a/agent-card.json.example',
          mergeStrategy: 'remove_managed',
        }),
        expect.objectContaining({
          type: 'remove',
          path: 'docs/a2a/task.json.example',
          mergeStrategy: 'remove_managed',
        }),
      ]));

      const applied = await service.execute({
        operation: 'update-workspace',
        workspacePath: root,
        profile: 'a2a-enabled',
        enabledAgents: ['codex'],
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
      });

      expect(applied.applied).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'agent-card.json.example'))).toBe(false);
      expect(existsSync(join(root, 'docs', 'a2a', 'task.json.example'))).toBe(false);
      expect(existsSync(join(root, 'docs', 'a2a', 'agent-card.public.json.example'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'jsonrpc-send-message.request.json.example'))).toBe(true);
      expect(applied.summary.changedPaths).toEqual(expect.arrayContaining([
        'docs/a2a/agent-card.json.example',
        'docs/a2a/task.json.example',
      ]));
    } finally {
      cleanup();
    }
  });
});
