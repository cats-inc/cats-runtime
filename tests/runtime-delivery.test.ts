import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import {
  inspectRuntimeDeliveryContract,
  RuntimeDeliveryService,
} from '../src/core/runtime/RuntimeDeliveryService.js';
import type { SessionInfo } from '../src/core/types.js';
import { createRuntimeServer } from '../src/server.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from './support/runtimeTestPaths.js';

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
  const paths = createRuntimeTestPaths(root);
  const env = createRuntimeTestEnv(root, {
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  });

  ensureRuntimeTestDirs(paths);
  for (const dir of [
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
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
  it('summarizes runtime delivery contract metadata for diagnostics', () => {
    expect(inspectRuntimeDeliveryContract()).toEqual({
      actions: {
        readOnly: ['audit-delivery-target', 'inspect-repo-status'],
        mutating: ['publish-artifacts', 'create-commit', 'push-branch'],
      },
      approval: {
        privilegedActorRoles: ['boss_cat', 'system', 'owner'],
        previewDefault: true,
        summary: 'Runtime delivery defaults every action to preview mode; artifact publication, commit, and push require privileged actorRole or explicit approval before apply.',
      },
      capabilities: [
        'artifactPublication',
        'repoStatus',
        'commit',
        'push',
        'previewSurfaces',
      ],
      previewSurfaceKinds: ['artifact', 'service'],
      summary: {
        totalActions: 5,
        readOnlyActions: 2,
        mutatingActions: 3,
      },
    });
  });

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

  it('creates a runtime delivery branch before committing in a detached session worktree', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-source-');
    const worktree = createWorkspace('cats-runtime-delivery-worktree-');
    const repo = initGitRepo(root, { withRemote: true });
    const worktreePath = join(worktree.root, 'session');
    const sessionId = 'golden-path-session';
    runGit(root, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
    writeFileSync(join(worktreePath, 'README.md'), '# repo\n\ndelivered\n', 'utf-8');

    const session: SessionInfo = {
      id: sessionId,
      providerName: 'claude',
      status: 'ready',
      origin: 'runtime',
      cwd: worktreePath,
      workspace: {
        kind: 'worktree',
        access: 'read_write',
        runtimeCwd: worktreePath,
        sourceCwd: root,
        worktree: {
          id: 'delivery-worktree',
          sourceRepoRoot: root,
          sourceHeadOid: runGit(root, ['rev-parse', 'HEAD']),
          sourceHeadRef: 'main',
          worktreePath,
          preparedAt: '2026-09-02T00:00:00.000Z',
        },
      },
      messageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    };
    const service = new RuntimeDeliveryService({
      registry: { get: (id) => id === sessionId ? session : undefined },
    });

    try {
      expect(runGit(worktreePath, ['branch', '--show-current'])).toBe('');

      const committed = await service.execute({
        action: 'create-commit',
        sessionId,
        apply: true,
        authorization: { actorRole: 'owner', approved: true },
        repo: { message: 'feat: deliver work', stageAll: true },
      });

      expect(committed.state).toBe('completed');
      expect(committed.repo).toMatchObject({
        branch: 'cats/runtime/golden-path-session',
        detached: false,
        clean: true,
      });
      expect(committed.metadata).toMatchObject({
        commit: {
          branch: 'cats/runtime/golden-path-session',
          message: 'feat: deliver work',
        },
      });

      const pushed = await service.execute({
        action: 'push-branch',
        sessionId,
        apply: true,
        authorization: { actorRole: 'owner', approved: true },
      });

      expect(pushed.state).toBe('completed');
      expect(runGit(worktreePath, ['branch', '--show-current']))
        .toBe('cats/runtime/golden-path-session');
      expect(runGit(worktreePath, [
        'ls-remote',
        '--heads',
        'origin',
        'cats/runtime/golden-path-session',
      ])).toContain('refs/heads/cats/runtime/golden-path-session');
    } finally {
      if (existsSync(worktreePath)) {
        runGit(root, ['worktree', 'remove', '--force', worktreePath]);
      }
      cleanup();
      worktree.cleanup();
      if (repo.remotePath) {
        rmSync(repo.remotePath, { recursive: true, force: true });
      }
    }
  }, 15_000);

  it('rejects an invalid requested branch before committing detached work', async () => {
    const { root, cleanup } = createWorkspace('cats-runtime-delivery-invalid-branch-');
    const service = createService();
    initGitRepo(root);
    const baselineHead = runGit(root, ['rev-parse', 'HEAD']);
    runGit(root, ['checkout', '--detach']);
    writeFileSync(join(root, 'README.md'), '# repo\n\nnot committed\n', 'utf-8');

    try {
      const result = await service.execute({
        action: 'create-commit',
        workspacePath: root,
        apply: true,
        authorization: { actorRole: 'owner', approved: true },
        repo: {
          branch: 'not a valid branch',
          message: 'feat: should not commit',
          stageAll: true,
        },
      });

      expect(result.state).toBe('blocked');
      expect(result.blockedReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_commit_branch' }),
      ]));
      expect(runGit(root, ['rev-parse', 'HEAD'])).toBe(baselineHead);
      expect(runGit(root, ['branch', '--show-current'])).toBe('');
      expect(runGit(root, ['status', '--porcelain'])).toContain('README.md');
    } finally {
      cleanup();
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
