import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalToolRuntime } from './LocalToolRuntime.js';

function createWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'cats-runtime-tools-'));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const value = 1;\nconsole.log(value);\n');
  return {
    cwd,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

describe('LocalToolRuntime', () => {
  it('lists, reads, and writes files inside the workspace', async () => {
    const { cwd, cleanup } = createWorkspace();
    const runtime = new LocalToolRuntime();

    try {
      const listed = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'shared',
        permissionMode: 'skip',
      }, {
        id: 'tool-1',
        name: 'list_files',
        arguments: { path: '.', recursive: true },
      });
      expect(listed.isError).toBeUndefined();
      expect(listed.output).toContain('src/');
      expect(listed.output).toContain('src/app.ts');

      const read = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'shared',
        permissionMode: 'skip',
      }, {
        id: 'tool-2',
        name: 'read_file',
        arguments: { path: 'src/app.ts' },
      });
      expect(read.output).toContain('export const value = 1;');

      const write = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'shared',
        permissionMode: 'skip',
      }, {
        id: 'tool-3',
        name: 'write_file',
        arguments: { path: 'src/app.ts', content: 'export const value = 2;\n' },
      });
      expect(write.isError).toBeUndefined();
      expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toBe('export const value = 2;\n');
    } finally {
      cleanup();
    }
  });

  it('blocks mutations in read_only mode and path escapes', async () => {
    const { cwd, cleanup } = createWorkspace();
    const runtime = new LocalToolRuntime();

    try {
      const write = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'read_only',
        permissionMode: 'default',
      }, {
        id: 'tool-1',
        name: 'write_file',
        arguments: { path: 'src/app.ts', content: 'blocked\n' },
      });
      expect(write.isError).toBe(true);
      expect(write.output).toContain('not allowed');

      const escaped = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'shared',
        permissionMode: 'skip',
      }, {
        id: 'tool-2',
        name: 'read_file',
        arguments: { path: '../outside.txt' },
      });
      expect(escaped.isError).toBe(true);
      expect(escaped.output).toContain('outside the workspace');
    } finally {
      cleanup();
    }
  });

  it('supports grep and whitelist enforcement', async () => {
    const { cwd, cleanup } = createWorkspace();
    const runtime = new LocalToolRuntime();

    try {
      const grep = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'shared',
        permissionMode: 'whitelist',
        allowedTools: ['grep'],
      }, {
        id: 'tool-1',
        name: 'grep',
        arguments: { pattern: 'value', path: 'src' },
      });
      expect(grep.isError).toBeUndefined();
      expect(grep.output).toContain('src/app.ts:1:export const value = 1;');

      const shell = await runtime.execute({
        sessionId: 'session-1',
        cwd,
        workspaceMode: 'shared',
        permissionMode: 'whitelist',
        allowedTools: ['grep'],
      }, {
        id: 'tool-2',
        name: 'run_shell',
        arguments: { command: 'pwd' },
      });
      expect(shell.isError).toBe(true);
      expect(shell.output).toContain('allowedTools whitelist');
    } finally {
      cleanup();
    }
  });
});
