import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const BIN_PATH = fileURLToPath(new URL('../dist/bin/workspaceSubstrate.js', import.meta.url));

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-substrate-bin-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [BIN_PATH, ...args],
    {
      encoding: 'utf-8',
    },
  );
}

describe('workspace substrate helper', () => {
  it('returns JSON preview output for audit mode', () => {
    const { root, cleanup } = createWorkspace();

    try {
      const result = runCli([
        '--operation',
        'audit',
        '--workspace-path',
        root,
        '--profile',
        'standard',
        '--agent',
        'codex',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const payload = JSON.parse(result.stdout);
      expect(payload.operation).toBe('audit-workspace');
      expect(payload.status).toBe('missing');
      expect(payload.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'create',
          path: 'AGENTS.md',
        }),
      ]));
    } finally {
      cleanup();
    }
  });

  it('applies init mode when a privileged actor role is supplied', () => {
    const { root, cleanup } = createWorkspace();

    try {
      const result = runCli([
        '--operation',
        'init',
        '--workspace-path',
        root,
        '--profile',
        'a2a-enabled',
        '--agent',
        'codex',
        '--apply',
        '--actor-role',
        'boss_cat',
      ]);

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.applied).toBe(true);
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'skills', 'README.md'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'a2a', 'agent-card.public.json.example'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'windows', 'Sync-AgentSkills.ps1'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'linux', 'sync-agent-skills.sh'))).toBe(true);
      expect(existsSync(join(root, 'scripts', 'macos', 'sync-agent-skills.sh'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('writes review copies instead of overwriting customized files', () => {
    const { root, cleanup } = createWorkspace();
    writeFileSync(join(root, 'AGENTS.md'), '# local rules\n');

    try {
      const result = runCli([
        '--operation',
        'update',
        '--workspace-path',
        root,
        '--profile',
        'standard',
        '--agent',
        'codex',
        '--apply',
        '--actor-role',
        'boss_cat',
      ]);

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.applied).toBe(true);
      expect(payload.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'write_sidecar',
          path: 'AGENTS.md',
          outputPath: 'AGENTS.md.bootstrap',
        }),
      ]));
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toBe('# local rules\n');
      expect(readFileSync(join(root, 'AGENTS.md.bootstrap'), 'utf-8'))
        .toContain('cats-runtime:workspace-substrate');
    } finally {
      cleanup();
    }
  });
});
