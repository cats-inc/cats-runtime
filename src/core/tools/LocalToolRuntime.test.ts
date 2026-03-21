import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from './LocalToolRuntime.js';
import { LocalToolRuntime } from './LocalToolRuntime.js';

function createWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'cats-runtime-tools-'));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  mkdirSync(join(cwd, 'src', 'utils'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const value = 1;\nconsole.log(value);\n');
  writeFileSync(join(cwd, 'src', 'utils', 'helper.ts'), 'export function help() {}\n');
  writeFileSync(join(cwd, 'src', 'utils', 'format.js'), 'module.exports = {};\n');
  return {
    cwd,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

function sharedCtx(cwd: string, overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    sessionId: 'session-1',
    cwd,
    workspaceMode: 'shared',
    permissionMode: 'skip',
    ...overrides,
  };
}

function readOnlyCtx(cwd: string): ToolExecutionContext {
  return {
    sessionId: 'session-1',
    cwd,
    workspaceMode: 'read_only',
    permissionMode: 'default',
  };
}

function extendedCtx(cwd: string): ToolExecutionContext {
  return {
    sessionId: 'session-1',
    cwd,
    workspaceMode: 'shared',
    permissionMode: 'skip',
    toolProfile: 'extended',
  };
}

describe('LocalToolRuntime', () => {
  it('lists, reads, and writes files inside the workspace', async () => {
    const { cwd, cleanup } = createWorkspace();
    const runtime = new LocalToolRuntime();

    try {
      const listed = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-1',
        name: 'list_files',
        arguments: { path: '.', recursive: true },
      });
      expect(listed.isError).toBeUndefined();
      expect(listed.output).toContain('src/');
      expect(listed.output).toContain('src/app.ts');

      const read = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-2',
        name: 'read_file',
        arguments: { path: 'src/app.ts' },
      });
      expect(read.output).toContain('export const value = 1;');

      const write = await runtime.execute(sharedCtx(cwd), {
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
      const write = await runtime.execute(readOnlyCtx(cwd), {
        id: 'tool-1',
        name: 'write_file',
        arguments: { path: 'src/app.ts', content: 'blocked\n' },
      });
      expect(write.isError).toBe(true);
      expect(write.output).toContain('not allowed');

      const escaped = await runtime.execute(sharedCtx(cwd), {
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
      const grep = await runtime.execute(
        sharedCtx(cwd, { permissionMode: 'whitelist', allowedTools: ['grep'] }),
        {
          id: 'tool-1',
          name: 'grep',
          arguments: { pattern: 'value', path: 'src' },
        },
      );
      expect(grep.isError).toBeUndefined();
      expect(grep.output).toContain('src/app.ts:1:export const value = 1;');

      const shell = await runtime.execute(
        sharedCtx(cwd, { permissionMode: 'whitelist', allowedTools: ['grep'] }),
        {
          id: 'tool-2',
          name: 'run_shell',
          arguments: { command: 'pwd' },
        },
      );
      expect(shell.isError).toBe(true);
      expect(shell.output).toContain('allowedTools whitelist');
    } finally {
      cleanup();
    }
  });

  describe('edit_file', () => {
    it('replaces a single occurrence', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'edit-1',
          name: 'edit_file',
          arguments: {
            path: 'src/app.ts',
            old_string: 'const value = 1',
            new_string: 'const value = 42',
          },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('Replaced 1 occurrence');
        expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toContain('const value = 42');
      } finally {
        cleanup();
      }
    });

    it('errors when old_string not found', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'edit-2',
          name: 'edit_file',
          arguments: {
            path: 'src/app.ts',
            old_string: 'this does not exist',
            new_string: 'whatever',
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('old_string not found');
      } finally {
        cleanup();
      }
    });

    it('errors on multiple matches without allow_multiple', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'edit-3',
          name: 'edit_file',
          arguments: {
            path: 'src/app.ts',
            old_string: 'value',
            new_string: 'val',
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('Found 2 occurrences');
        expect(result.output).toContain('allow_multiple');
      } finally {
        cleanup();
      }
    });

    it('replaces all occurrences with allow_multiple', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'edit-4',
          name: 'edit_file',
          arguments: {
            path: 'src/app.ts',
            old_string: 'value',
            new_string: 'val',
            allow_multiple: true,
          },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('Replaced 2 occurrences');
        const content = readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8');
        expect(content).toContain('const val = 1');
        expect(content).toContain('console.log(val)');
        expect(content).not.toContain('value');
      } finally {
        cleanup();
      }
    });

    it('blocks path traversal', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'edit-5',
          name: 'edit_file',
          arguments: {
            path: '../outside.txt',
            old_string: 'a',
            new_string: 'b',
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('outside the workspace');
      } finally {
        cleanup();
      }
    });

    it('blocks in read_only workspace mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'edit-6',
          name: 'edit_file',
          arguments: {
            path: 'src/app.ts',
            old_string: 'value',
            new_string: 'val',
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('not allowed');
      } finally {
        cleanup();
      }
    });
  });

  describe('apply_patch', () => {
    it('applies a multi-file patch', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-1',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Update File: src/app.ts
@@
-export const value = 1;
+export const value = 7;
*** Add File: src/new.ts
+export const created = true;
*** Delete File: src/utils/format.js
*** End Patch`,
          },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('M src/app.ts');
        expect(result.output).toContain('A src/new.ts');
        expect(result.output).toContain('D src/utils/format.js');
        expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toContain('value = 7');
        expect(readFileSync(join(cwd, 'src', 'new.ts'), 'utf-8')).toContain('created = true');
        expect(existsSync(join(cwd, 'src', 'utils', 'format.js'))).toBe(false);
      } finally {
        cleanup();
      }
    });

    it('supports move via update hunk', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-2',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Update File: src/utils/helper.ts
*** Move to: src/helper.ts
@@
-export function help() {}
+export function help() { return 'ok'; }
*** End Patch`,
          },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('M src/helper.ts');
        expect(existsSync(join(cwd, 'src', 'utils', 'helper.ts'))).toBe(false);
        expect(readFileSync(join(cwd, 'src', 'helper.ts'), 'utf-8')).toContain(`return 'ok'`);
      } finally {
        cleanup();
      }
    });

    it('blocks path traversal in patch hunks', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-3',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Add File: ../escape.txt
+pwned
*** End Patch`,
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('outside the workspace');
      } finally {
        cleanup();
      }
    });

    it('rejects malformed patches', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-4',
          name: 'apply_patch',
          arguments: {
            input: '*** Update File: src/app.ts\n@@\n-export const value = 1;\n+export const value = 2;\n',
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('first line of the patch');
      } finally {
        cleanup();
      }
    });

    it('blocks in read_only workspace mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'patch-5',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Update File: src/app.ts
@@
-export const value = 1;
+export const value = 2;
*** End Patch`,
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('not allowed');
      } finally {
        cleanup();
      }
    });
  });

  describe('glob', () => {
    it('matches files by pattern', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'glob-1',
          name: 'glob',
          arguments: { pattern: '**/*.ts' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('src/app.ts');
        expect(result.output).toContain('src/utils/helper.ts');
        expect(result.output).not.toContain('format.js');
      } finally {
        cleanup();
      }
    });

    it('matches nested directory files', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'glob-2',
          name: 'glob',
          arguments: { pattern: 'src/utils/*' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('src/utils/format.js');
        expect(result.output).toContain('src/utils/helper.ts');
        expect(result.output).not.toContain('src/app.ts');
      } finally {
        cleanup();
      }
    });

    it('respects max_results', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'glob-3',
          name: 'glob',
          arguments: { pattern: '**/*', max_results: 1 },
        });
        expect(result.isError).toBeUndefined();
        const lines = result.output.split('\n');
        expect(lines.length).toBe(1);
      } finally {
        cleanup();
      }
    });

    it('returns empty for no matches', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'glob-4',
          name: 'glob',
          arguments: { pattern: '**/*.xyz' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toBe('[no matches]');
      } finally {
        cleanup();
      }
    });

    it('is allowed in read_only mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'glob-5',
          name: 'glob',
          arguments: { pattern: '**/*.ts' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('src/app.ts');
      } finally {
        cleanup();
      }
    });

    it('finds late matches beyond initial entries', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        // Create many non-matching files before the target
        for (let i = 0; i < 50; i++) {
          mkdirSync(join(cwd, 'filler', `d${String(i).padStart(3, '0')}`), { recursive: true });
          writeFileSync(join(cwd, 'filler', `d${String(i).padStart(3, '0')}`, 'data.txt'), 'x');
        }
        // The target is buried deep
        mkdirSync(join(cwd, 'zzz'), { recursive: true });
        writeFileSync(join(cwd, 'zzz', 'target.needle'), 'found');

        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'glob-6',
          name: 'glob',
          arguments: { pattern: '**/*.needle' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('zzz/target.needle');
      } finally {
        cleanup();
      }
    });
  });

  describe('delete_file', () => {
    it('deletes a file', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'del-1',
          name: 'delete_file',
          arguments: { path: 'src/utils/format.js' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('Deleted');
        expect(existsSync(join(cwd, 'src', 'utils', 'format.js'))).toBe(false);
      } finally {
        cleanup();
      }
    });

    it('deletes an empty directory', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        mkdirSync(join(cwd, 'empty-dir'));
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'del-2',
          name: 'delete_file',
          arguments: { path: 'empty-dir' },
        });
        expect(result.isError).toBeUndefined();
        expect(existsSync(join(cwd, 'empty-dir'))).toBe(false);
      } finally {
        cleanup();
      }
    });

    it('errors on non-empty directory', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'del-3',
          name: 'delete_file',
          arguments: { path: 'src/utils' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('not empty');
      } finally {
        cleanup();
      }
    });

    it('is blocked by standard profile', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'del-4',
          name: 'delete_file',
          arguments: { path: 'src/utils/format.js' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('disabled by toolProfile');
      } finally {
        cleanup();
      }
    });
  });

  describe('rename_file', () => {
    it('renames a file', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'ren-1',
          name: 'rename_file',
          arguments: { source: 'src/utils/format.js', destination: 'src/utils/fmt.js' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('Renamed');
        expect(existsSync(join(cwd, 'src', 'utils', 'format.js'))).toBe(false);
        expect(existsSync(join(cwd, 'src', 'utils', 'fmt.js'))).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('creates destination parent directories', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'ren-2',
          name: 'rename_file',
          arguments: { source: 'src/utils/format.js', destination: 'lib/format.js' },
        });
        expect(result.isError).toBeUndefined();
        expect(existsSync(join(cwd, 'lib', 'format.js'))).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('rejects directory as source', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'ren-3',
          name: 'rename_file',
          arguments: { source: 'src/utils', destination: 'lib/utils' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('must be a file');
      } finally {
        cleanup();
      }
    });

    it('rejects overwrite when destination exists', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'ren-4',
          name: 'rename_file',
          arguments: { source: 'src/utils/format.js', destination: 'src/app.ts' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('already exists');
        // Source should still exist (no side effect)
        expect(existsSync(join(cwd, 'src', 'utils', 'format.js'))).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('allows overwrite with explicit flag', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'ren-5',
          name: 'rename_file',
          arguments: { source: 'src/utils/format.js', destination: 'src/app.ts', overwrite: true },
        });
        expect(result.isError).toBeUndefined();
        expect(existsSync(join(cwd, 'src', 'utils', 'format.js'))).toBe(false);
        expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toContain('module.exports');
      } finally {
        cleanup();
      }
    });
  });

  describe('copy_file', () => {
    it('copies a file', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'cp-1',
          name: 'copy_file',
          arguments: { source: 'src/app.ts', destination: 'backup/app.ts' },
        });
        expect(result.isError).toBeUndefined();
        expect(result.output).toContain('Copied');
        expect(existsSync(join(cwd, 'src', 'app.ts'))).toBe(true);
        expect(readFileSync(join(cwd, 'backup', 'app.ts'), 'utf-8')).toBe(
          readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8'),
        );
      } finally {
        cleanup();
      }
    });

    it('rejects directory as source', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'cp-2',
          name: 'copy_file',
          arguments: { source: 'src/utils', destination: 'backup/utils' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('must be a file');
      } finally {
        cleanup();
      }
    });

    it('rejects overwrite when destination exists', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'cp-3',
          name: 'copy_file',
          arguments: { source: 'src/utils/format.js', destination: 'src/app.ts' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('already exists');
      } finally {
        cleanup();
      }
    });

    it('allows overwrite with explicit flag', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'cp-4',
          name: 'copy_file',
          arguments: { source: 'src/utils/format.js', destination: 'src/app.ts', overwrite: true },
        });
        expect(result.isError).toBeUndefined();
        expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toContain('module.exports');
      } finally {
        cleanup();
      }
    });
  });

  describe('profiles', () => {
    it('standard profile lists 11 tools', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('standard');
      expect(tools.map((t) => t.name)).toEqual([
        'list_files', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'grep', 'glob', 'run_shell',
        'audit-workspace', 'init-workspace', 'update-workspace',
      ]);
    });

    it('extended profile lists 14 tools', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('extended');
      expect(tools.map((t) => t.name)).toEqual([
        'list_files', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'grep', 'glob', 'run_shell',
        'delete_file', 'rename_file', 'copy_file',
        'audit-workspace', 'init-workspace', 'update-workspace',
      ]);
    });

    it('read_only profile lists 5 tools', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('read_only');
      expect(tools.map((t) => t.name)).toEqual([
        'list_files', 'read_file', 'grep', 'glob', 'audit-workspace',
      ]);
    });

    it('none/chat profiles return empty', () => {
      const runtime = new LocalToolRuntime();
      expect(runtime.listTools('none')).toEqual([]);
      expect(runtime.listTools('chat')).toEqual([]);
    });

    it('unknown profile falls back to standard', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('unknown_profile');
      expect(tools.length).toBe(11);
      expect(tools.map((t) => t.name)).toContain('apply_patch');
      expect(tools.map((t) => t.name)).toContain('edit_file');
      expect(tools.map((t) => t.name)).toContain('glob');
      expect(tools.map((t) => t.name)).toContain('audit-workspace');
    });

    it('default profile (undefined) is standard', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools();
      expect(tools.length).toBe(11);
    });
  });

  describe('workspace substrate tools', () => {
    it('audits missing workspace substrate in preview mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'substrate-1',
          name: 'audit-workspace',
          arguments: {
            profile: 'standard',
            enabled_agents: ['codex'],
          },
        });
        expect(result.isError).toBeUndefined();

        const payload = JSON.parse(result.output) as {
          contract: { mode: string; applyDecision: string; readOnly: boolean };
          plan: { requiresApproval: boolean; changedPaths: string[] };
          approval: { required: boolean; applyPayload?: unknown };
          status: string;
          applied: boolean;
          actions: Array<{
            type: string;
            path: string;
            outputPath?: string;
            mergeStrategy?: string;
            diffStats?: { changed: boolean };
          }>;
        };
        expect(payload.status).toBe('missing');
        expect(payload.applied).toBe(false);
        expect(payload.contract).toMatchObject({
          mode: 'preview',
          applyDecision: 'not_requested',
          readOnly: true,
        });
        expect(payload.plan.requiresApproval).toBe(false);
        expect(payload.approval.required).toBe(false);
        expect(payload.actions).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'create',
            path: 'AGENTS.md',
            outputPath: 'AGENTS.md',
            mergeStrategy: 'create',
            diffStats: expect.objectContaining({ changed: true }),
          }),
          expect.objectContaining({ type: 'create', path: 'CODEX.md' }),
        ]));
        expect(payload.plan.changedPaths).toEqual(expect.arrayContaining(['AGENTS.md', 'CODEX.md']));
      } finally {
        cleanup();
      }
    });

    it('writes review copies for conflicting files on apply', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      writeFileSync(join(cwd, 'AGENTS.md'), '# local custom rules\n');

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'substrate-2',
          name: 'update-workspace',
          arguments: {
            profile: 'standard',
            enabled_agents: ['codex'],
            apply: true,
            actor_role: 'boss_cat',
          },
        });
        expect(result.isError).toBeUndefined();

        const payload = JSON.parse(result.output) as {
          approval: { required: boolean };
          applied: boolean;
          status: string;
          summary: { changedPaths: string[] };
          actions: Array<{ type: string; path: string; requiresApproval?: boolean; outputPath?: string }>;
        };
        expect(payload.applied).toBe(true);
        expect(payload.status).toBe('conflicting');
        expect(payload.approval.required).toBe(false);
        expect(payload.summary.changedPaths).toContain('AGENTS.md.bootstrap');
        expect(payload.actions).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'write_sidecar',
            path: 'AGENTS.md',
            outputPath: 'AGENTS.md.bootstrap',
            requiresApproval: false,
          }),
        ]));
        expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf-8')).toBe('# local custom rules\n');
        expect(readFileSync(join(cwd, 'AGENTS.md.bootstrap'), 'utf-8'))
          .toContain('cats-runtime:workspace-substrate');
      } finally {
        cleanup();
      }
    });

    it('allows preview-only init under permissionMode=default', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd, { permissionMode: 'default' }), {
          id: 'substrate-3',
          name: 'init-workspace',
          arguments: {
            profile: 'minimal',
            apply: false,
          },
        });
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toMatchObject({
          operation: 'init-workspace',
          applied: false,
          contract: {
            mode: 'preview',
            applyDecision: 'not_requested',
            readOnly: false,
          },
          plan: {
            requiresApproval: true,
          },
          approval: {
            required: true,
            applyPayload: {
              operation: 'init-workspace',
              apply: true,
            },
          },
        });
      } finally {
        cleanup();
      }
    });

    it('returns preview-only output when audit apply is requested', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'substrate-4',
          name: 'audit-workspace',
          arguments: {
            profile: 'standard',
            enabled_agents: ['codex'],
            apply: true,
            actor_role: 'boss_cat',
          },
        });
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toMatchObject({
          applied: false,
          contract: {
            mode: 'apply',
            applyDecision: 'read_only_operation',
            readOnly: true,
          },
          approval: {
            required: false,
          },
        });
        expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
      } finally {
        cleanup();
      }
    });
  });
});
