import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { RuntimeDeliveryService } from '../src/core/runtime/RuntimeDeliveryService.js';
import { createRuntimeServer } from '../src/server.js';

function createWorkspace(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initGitRepo(root: string, options: { withRemote?: boolean } = {}) {
  runGit(root, ['init', '--initial-branch=main']);
  runGit(root, ['config', 'user.email', 'cats-runtime@test']);
  runGit(root, ['config', 'user.name', 'Cats Runtime']);
  writeFileSync(join(root, 'README.md'), '# repo\n', 'utf-8');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '-m', 'initial']);

  let remotePath: string | undefined;
  if (options.withRemote) {
    remotePath = mkdtempSync(join(tmpdir(), 'cats-runtime-delivery-remote-'));
    runGit(remotePath, ['init', '--bare']);
    runGit(root, ['remote', 'add', 'origin', remotePath]);
  }

  return {
    branch: runGit(root, ['branch', '--show-current']),
    remotePath,
  };
}

function createService() {
  return new RuntimeDeliveryService({});
}

function createRuntimeConfig(root: string) {
  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: join(root, 'providers.missing.yaml'),
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    GEMINI_SESSIONS_DIR: join(root, '.gemini', 'tmp'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  };

  for (const dir of [
    env.CATS_RUNTIME_DATA_DIR,
    env.CATS_RUNTIME_SESSION_BASE_DIR,
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.GEMINI_SESSIONS_DIR,
    env.PI_SESSIONS_DIR,
    join(root, '.junie', 'sessions'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  return {
    ...loadConfig(env),
    host: '127.0.0.1',
    port: 0,
  };
}

describe('RuntimeDeliveryService', () => {
  it('reports degraded artifact-only delivery audit with normalized preview surfaces', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-audit-');
    const service = createService();
    mkdirSync(join(root, 'artifacts'), { recursive: true });
    writeFileSync(join(root, 'artifacts', 'report.html'), '<html><body>preview</body></html>', 'utf-8');

    try {
      const result = await service.execute({
        action: 'audit-delivery-target',
        workspacePath: root,
        artifacts: [{
          id: 'report',
          label: 'report',
          path: 'artifacts/report.html',
          mediaType: 'text/html',
        }],
        services: [{
          id: 'preview-service',
          name: 'preview',
          url: 'http://127.0.0.1:4173',
        }],
      });

      expect(result.state).toBe('degraded');
      expect(result.capabilities.artifactPublication.state).toBe('ready');
      expect(result.capabilities.previewSurfaces.state).toBe('ready');
      expect(result.capabilities.repoStatus.state).toBe('blocked');
      expect(result.previewSurfaces).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'artifact',
          status: 'ready',
          renderHint: 'iframe',
          artifactId: 'report',
        }),
        expect.objectContaining({
          kind: 'service',
          status: 'ready',
          renderHint: 'iframe',
          url: 'http://127.0.0.1:4173',
        }),
      ]));
      expect(result.capabilityGaps).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'repo_status_unavailable' }),
      ]));
    } finally {
      cleanup();
    }
  });

  it('returns blocked state for publication without artifacts', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-publish-');
    const service = createService();

    try {
      const result = await service.execute({
        action: 'publish-artifacts',
        workspacePath: root,
        publication: {
          directory: join(root, 'dist'),
        },
      });

      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'no_artifacts_available' }),
      ]));
    } finally {
      cleanup();
    }
  });

  it('creates a commit through preview/apply delivery primitives', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-commit-');
    const service = createService();
    initGitRepo(root);
    writeFileSync(join(root, 'README.md'), '# repo\n\nupdated\n', 'utf-8');

    try {
      const preview = await service.execute({
        action: 'create-commit',
        workspacePath: root,
        repo: {
          message: 'feat: update readme',
        },
      });

      expect(preview.state).toBe('ready');
      expect(preview.approval.required).toBe(true);
      expect(preview.metadata).toMatchObject({
        repo: {
          message: 'feat: update readme',
          stageAll: false,
        },
      });

      const blocked = await service.execute({
        action: 'create-commit',
        workspacePath: root,
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
        repo: {
          message: 'feat: update readme',
        },
      });

      expect(blocked.state).toBe('blocked');
      expect(blocked.blockedReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'git_commit_failed' }),
      ]));
      expect(runGit(root, ['status', '--porcelain'])).toContain('README.md');

      const applied = await service.execute({
        action: 'create-commit',
        workspacePath: root,
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
        repo: {
          message: 'feat: update readme',
          stageAll: true,
        },
      });

      expect(applied.state).toBe('completed');
      expect(applied.metadata).toMatchObject({
        commit: {
          oid: expect.any(String),
          message: 'feat: update readme',
          stageAll: true,
        },
      });
      expect(runGit(root, ['log', '-1', '--pretty=%s'])).toBe('feat: update readme');
    } finally {
      cleanup();
    }
  }, 15_000);

  it('pushes the current branch to a configured remote', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-push-');
    const service = createService();
    const repo = initGitRepo(root, { withRemote: true });

    try {
      const result = await service.execute({
        action: 'push-branch',
        workspacePath: root,
        apply: true,
        authorization: {
          actorRole: 'boss_cat',
        },
        repo: {
          setUpstream: true,
        },
      });

      expect(result.state).toBe('completed');
      expect(result.metadata).toMatchObject({
        push: {
          remote: 'origin',
          branch: repo.branch,
          setUpstream: true,
        },
      });
      expect(runGit(root, ['branch', '--show-current'])).toBe(repo.branch);
      expect(runGit(root, ['ls-remote', '--heads', 'origin', repo.branch])).toContain(repo.branch);
    } finally {
      cleanup();
      if (repo.remotePath) {
        rmSync(repo.remotePath, { recursive: true, force: true });
      }
    }
  }, 15_000);
});

describe('delivery HTTP routes', () => {
  it('returns machine-readable blocked repo status for non-repo workspaces', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-http-');
    const runtime = createRuntimeServer(createRuntimeConfig(root));

    try {
      const response = await runtime.app.request('/delivery/repo/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: root,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: 'inspect-repo-status',
        state: 'blocked',
        blockedReasons: expect.arrayContaining([
          expect.objectContaining({ code: 'not_git_repository' }),
        ]),
        repo: {
          repository: false,
        },
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
