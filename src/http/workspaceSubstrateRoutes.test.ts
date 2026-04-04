import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from './app.js';
import { workspaceSubstrateRoutes } from './routes/workspaceSubstrate.js';

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-workspace-route-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createTestApp() {
  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  app.use('*', async (c, next) => {
    c.set('ctx', {} as AppContext);
    await next();
  });
  app.route('/', workspaceSubstrateRoutes);
  return app;
}

describe('workspace substrate routes', () => {
  it('returns read-only audit results through POST /workspace/substrate/audit', async () => {
    const { root, cleanup } = createWorkspace();
    const app = createTestApp();

    try {
      const response = await app.request('/workspace/substrate/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: root,
          profile: 'standard',
          enabledAgents: ['codex'],
          apply: true,
          actorRole: 'boss_cat',
          hints: {
            projectType: 'monorepo',
            purpose: 'Route coverage workspace',
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(expect.objectContaining({
        operation: 'audit-workspace',
        workspacePath: root,
        profile: 'standard',
        enabledAgents: ['codex'],
        contract: expect.objectContaining({
          mode: 'apply',
          applyRequested: true,
          applyDecision: 'read_only_operation',
          readOnly: true,
        }),
        applied: false,
        findings: expect.arrayContaining([
          expect.objectContaining({
            path: 'AGENTS.md',
            status: 'missing',
          }),
        ]),
      }));
    } finally {
      cleanup();
    }
  });

  it('blocks update apply without privileged authorization through POST /workspace/substrate/update', async () => {
    const { root, cleanup } = createWorkspace();
    const app = createTestApp();
    writeFileSync(join(root, 'AGENTS.md'), '# local rules\n');

    try {
      const response = await app.request('/workspace/substrate/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: root,
          profile: 'standard',
          enabledAgents: ['codex'],
          apply: true,
          authorization: {
            actorRole: 'specialist_cat',
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(expect.objectContaining({
        operation: 'update-workspace',
        workspacePath: root,
        applied: false,
        contract: expect.objectContaining({
          applyRequested: true,
          applyDecision: 'blocked',
        }),
        authorization: expect.objectContaining({
          actorRole: 'specialist_cat',
          requiresApproval: true,
        }),
        approval: expect.objectContaining({
          required: true,
          blockedPaths: expect.arrayContaining(['AGENTS.md.bootstrap']),
        }),
        actions: expect.arrayContaining([
          expect.objectContaining({
            type: 'write_sidecar',
            path: 'AGENTS.md',
            reviewCopyPath: 'AGENTS.md.bootstrap',
          }),
        ]),
      }));
    } finally {
      cleanup();
    }
  });

  it('applies init through POST /workspace/substrate/init when privileged approval is present', async () => {
    const { root, cleanup } = createWorkspace();
    const app = createTestApp();

    try {
      const response = await app.request('/workspace/substrate/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: root,
          profile: 'standard',
          enabledAgents: ['codex'],
          includeA2A: true,
          apply: true,
          actorRole: 'boss_cat',
          approved: true,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(expect.objectContaining({
        operation: 'init-workspace',
        workspacePath: root,
        applied: true,
        includeA2A: true,
        contract: expect.objectContaining({
          applyRequested: true,
          applyDecision: 'applied',
          readOnly: false,
        }),
      }));
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toContain('cats-runtime:workspace-substrate');
    } finally {
      cleanup();
    }
  });

  it('returns 400 when workspacePath is missing', async () => {
    const app = createTestApp();
    const response = await app.request('/workspace/substrate/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: 'standard',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'workspacePath is required.',
      operation: 'audit-workspace',
    });
  });
});
