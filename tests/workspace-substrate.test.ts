import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      expect(result.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'AGENTS.md', status: 'missing' }),
        expect.objectContaining({ path: 'CODEX.md', status: 'missing' }),
      ]));
      expect(result.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'create', path: 'AGENTS.md' }),
        expect.objectContaining({ type: 'create', path: 'docs/AGENT-GUIDE.md' }),
      ]));
      expect(result.summary.findingCounts.missing).toBeGreaterThan(0);
      expect(result.summary.actionCounts.create).toBeGreaterThan(0);
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
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toBe('# local rules\n');
      expect(readFileSync(join(root, 'AGENTS.md.bootstrap'), 'utf-8'))
        .toContain('cats-runtime:workspace-substrate');
    } finally {
      cleanup();
    }
  });
});
