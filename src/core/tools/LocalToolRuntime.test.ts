import { chmodSync, existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { chmod as chmodAsync, rename as renameAsync, stat as statAsync, unlink as unlinkAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from './LocalToolRuntime.js';
import {
  buildRuntimeToolCatalogInspection,
  buildRuntimeToolCatalogSummary,
  buildToolPolicyInspection,
  LocalToolRuntime,
  writeTextFileAtomically,
} from './LocalToolRuntime.js';

const PRESERVED_ATIME = new Date('2024-01-02T03:04:05.000Z');
const PRESERVED_MTIME = new Date('2024-02-03T04:05:06.000Z');

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

function listAtomicWriteArtifacts(dir: string): string[] {
  return readdirSync(dir).filter((name) =>
    name.includes('.cats-runtime-write-') || name.includes('.cats-runtime-backup-'));
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

      const batchRead = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-2a',
        name: 'read_files',
        arguments: {
          paths: ['src/app.ts', 'src/utils/helper.ts'],
          limit_lines: 1,
        },
      });
      expect(batchRead.isError).toBeUndefined();
      expect(JSON.parse(batchRead.output)).toEqual(expect.objectContaining({
        requestedCount: 2,
        uniqueCount: 2,
        limitLines: 1,
        files: expect.arrayContaining([
          expect.objectContaining({
            path: 'src/app.ts',
            exists: true,
            content: 'export const value = 1;',
          }),
          expect.objectContaining({
            path: 'src/utils/helper.ts',
            exists: true,
            content: 'export function help() {}',
          }),
        ]),
      }));

      const diff = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-2b',
        name: 'diff_file',
        arguments: {
          path: 'src/app.ts',
          content: 'export const value = 2;\nconsole.log(value);\n',
        },
      });
      expect(diff.isError).toBeUndefined();
      expect(JSON.parse(diff.output)).toEqual(expect.objectContaining({
        path: 'src/app.ts',
        exists: true,
        diffStats: {
          changed: true,
          addedLines: 1,
          removedLines: 1,
        },
      }));

      const write = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-3',
        name: 'write_file',
        arguments: { path: 'src/app.ts', content: 'export const value = 2;\n' },
      });
      expect(write.isError).toBeUndefined();
      expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toBe('export const value = 2;\n');
      expect(listAtomicWriteArtifacts(join(cwd, 'src'))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  describe('writeTextFileAtomically', () => {
    it('restores the original file when the staged replacement fails', async () => {
      const target = '/virtual/workspace/app.ts';
      const files = new Map<string, { content: string; mode: number; atime: Date; mtime: Date }>([
        [target, { content: 'before', mode: 0o644, atime: PRESERVED_ATIME, mtime: PRESERVED_MTIME }],
      ]);
      let failCommit = true;

      await expect(writeTextFileAtomically(target, 'after', {
        async chmod(path, mode) {
          const entry = files.get(path);
          if (!entry) {
            const error = Object.assign(new Error(`Missing path ${path}`), { code: 'ENOENT' });
            throw error;
          }
          entry.mode = mode;
        },
        async stat(path) {
          const entry = files.get(path);
          if (!entry) {
            const error = Object.assign(new Error(`Missing path ${path}`), { code: 'ENOENT' });
            throw error;
          }
          return { mode: entry.mode, atime: entry.atime, mtime: entry.mtime };
        },
        async utimes(path, atime, mtime) {
          const entry = files.get(path);
          if (!entry) {
            const error = Object.assign(new Error(`Missing path ${path}`), { code: 'ENOENT' });
            throw error;
          }
          entry.atime = atime;
          entry.mtime = mtime;
        },
        async writeFile(path, content) {
          files.set(path, { content, mode: 0o600, atime: PRESERVED_ATIME, mtime: PRESERVED_MTIME });
        },
        async rename(from, to) {
          const entry = files.get(from);
          if (!entry) {
            const error = Object.assign(new Error(`Missing source ${from}`), { code: 'ENOENT' });
            throw error;
          }
          if (from.includes('.cats-runtime-write-') && failCommit) {
            failCommit = false;
            throw new Error('simulated commit failure');
          }
          files.set(to, entry);
          files.delete(from);
        },
        async unlink(path) {
          files.delete(path);
        },
      })).rejects.toThrow('simulated commit failure');

      expect(files.get(target)).toEqual({
        content: 'before',
        mode: 0o644,
        atime: PRESERVED_ATIME,
        mtime: PRESERVED_MTIME,
      });
      expect(Array.from(files.keys()).filter((path) => path.includes('.cats-runtime-'))).toEqual([]);
    });

    it('preserves the existing file mode and timestamps when a staged replacement succeeds', async () => {
      const target = '/virtual/workspace/script.sh';
      const files = new Map<string, { content: string; mode: number; atime: Date; mtime: Date }>([
        [target, { content: '#!/bin/sh\necho before\n', mode: 0o755, atime: PRESERVED_ATIME, mtime: PRESERVED_MTIME }],
      ]);

      await writeTextFileAtomically(target, '#!/bin/sh\necho after\n', {
        async chmod(path, mode) {
          const entry = files.get(path);
          if (!entry) {
            const error = Object.assign(new Error(`Missing path ${path}`), { code: 'ENOENT' });
            throw error;
          }
          entry.mode = mode;
        },
        async stat(path) {
          const entry = files.get(path);
          if (!entry) {
            const error = Object.assign(new Error(`Missing path ${path}`), { code: 'ENOENT' });
            throw error;
          }
          return { mode: entry.mode, atime: entry.atime, mtime: entry.mtime };
        },
        async utimes(path, atime, mtime) {
          const entry = files.get(path);
          if (!entry) {
            const error = Object.assign(new Error(`Missing path ${path}`), { code: 'ENOENT' });
            throw error;
          }
          entry.atime = atime;
          entry.mtime = mtime;
        },
        async writeFile(path, content) {
          files.set(path, { content, mode: 0o600, atime: new Date('2026-01-01T00:00:00.000Z'), mtime: new Date('2026-01-01T00:00:00.000Z') });
        },
        async rename(from, to) {
          const entry = files.get(from);
          if (!entry) {
            const error = Object.assign(new Error(`Missing source ${from}`), { code: 'ENOENT' });
            throw error;
          }
          files.set(to, entry);
          files.delete(from);
        },
        async unlink(path) {
          files.delete(path);
        },
      });

      expect(files.get(target)).toEqual({
        content: '#!/bin/sh\necho after\n',
        mode: 0o755,
        atime: PRESERVED_ATIME,
        mtime: PRESERVED_MTIME,
      });
      expect(Array.from(files.keys()).filter((path) => path.includes('.cats-runtime-'))).toEqual([]);
    });

    it('preserves timestamps when write_file replaces an existing file', async () => {
      const { cwd, cleanup } = createWorkspace();
      const target = join(cwd, 'src', 'app.ts');
      const runtime = new LocalToolRuntime();
      utimesSync(target, PRESERVED_ATIME, PRESERVED_MTIME);

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'tool-preserve-write-timestamps',
          name: 'write_file',
          arguments: { path: 'src/app.ts', content: 'export const value = 2;\n' },
        });

        expect(result.isError).toBeUndefined();
        const info = statSync(target);
        expect(info.atime.getTime()).toBe(PRESERVED_ATIME.getTime());
        expect(info.mtime.getTime()).toBe(PRESERVED_MTIME.getTime());
      } finally {
        cleanup();
      }
    });

    it('preserves timestamps when edit_file replaces an existing file', async () => {
      const { cwd, cleanup } = createWorkspace();
      const target = join(cwd, 'src', 'app.ts');
      const runtime = new LocalToolRuntime();
      utimesSync(target, PRESERVED_ATIME, PRESERVED_MTIME);

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'tool-preserve-edit-timestamps',
          name: 'edit_file',
          arguments: {
            path: 'src/app.ts',
            old_string: 'const value = 1',
            new_string: 'const value = 2',
          },
        });

        expect(result.isError).toBeUndefined();
        const info = statSync(target);
        expect(info.atime.getTime()).toBe(PRESERVED_ATIME.getTime());
        expect(info.mtime.getTime()).toBe(PRESERVED_MTIME.getTime());
      } finally {
        cleanup();
      }
    });
  });

  it('cleans up newly created parent directories when a write_file commit fails', async () => {
    const { cwd, cleanup } = createWorkspace();
    const runtime = new LocalToolRuntime({
      atomicWriteOps: {
        chmod: chmodAsync,
        stat: statAsync,
        writeFile: writeFileAsync,
        async rename(from, to) {
          if (from.includes('.cats-runtime-write-')) {
            throw new Error('simulated commit failure');
          }
          await renameAsync(from, to);
        },
        unlink: unlinkAsync,
      },
    });

    try {
      const result = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-write-failure',
        name: 'write_file',
        arguments: {
          path: 'nested/deeper/new.txt',
          content: 'hello\n',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('simulated commit failure');
      expect(existsSync(join(cwd, 'nested'))).toBe(false);
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

      const batchEscaped = await runtime.execute(sharedCtx(cwd), {
        id: 'tool-3',
        name: 'read_files',
        arguments: { paths: ['src/app.ts', '../outside.txt'] },
      });
      expect(batchEscaped.isError).toBeUndefined();
      expect(JSON.parse(batchEscaped.output)).toEqual(expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            path: 'src/app.ts',
            exists: true,
          }),
          expect.objectContaining({
            path: '../outside.txt',
            exists: false,
            error: expect.stringContaining('outside the workspace'),
          }),
        ]),
      }));
    } finally {
      cleanup();
    }
  });

  describe('read_files', () => {
    it('returns missing and non-text entries without failing the whole batch', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      writeFileSync(join(cwd, 'image.png'), 'binary-ish');

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'read-files-1',
          name: 'read_files',
          arguments: {
            paths: ['src/app.ts', 'missing.ts', 'src', 'image.png', 'src/app.ts'],
            limit_lines: 1,
          },
        });
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual(expect.objectContaining({
          requestedCount: 5,
          uniqueCount: 4,
          files: expect.arrayContaining([
            expect.objectContaining({
              path: 'src/app.ts',
              exists: true,
              content: 'export const value = 1;',
            }),
            expect.objectContaining({
              path: 'missing.ts',
              exists: false,
            }),
            expect.objectContaining({
              path: 'src',
              exists: true,
              error: 'Path is a directory, not a file',
            }),
            expect.objectContaining({
              path: 'image.png',
              exists: true,
              error: 'read_files only supports UTF-8 text files',
            }),
          ]),
        }));
      } finally {
        cleanup();
      }
    });

    it('enforces the bounded content budget across multiple files', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      writeFileSync(join(cwd, 'large-a.txt'), 'A'.repeat(12000));
      writeFileSync(join(cwd, 'large-b.txt'), 'B'.repeat(12000));

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'read-files-2',
          name: 'read_files',
          arguments: {
            paths: ['large-a.txt', 'large-b.txt'],
            limit_lines: 2000,
          },
        });
        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.output) as {
          contentBudgetChars: number;
          files: Array<{
            path: string;
            exists: boolean;
            truncated?: boolean;
            omitted?: boolean;
            reason?: string;
          }>;
        };
        expect(payload.contentBudgetChars).toBe(16000);
        expect(payload.files[0]).toEqual(expect.objectContaining({
          path: 'large-a.txt',
          exists: true,
          content: 'A'.repeat(12000),
        }));
        expect(payload.files[1]).toEqual(expect.objectContaining({
          path: 'large-b.txt',
          exists: true,
          truncated: true,
          omittedChars: expect.any(Number),
        }));
      } finally {
        cleanup();
      }
    });
  });

  describe('inspect_path', () => {
    it('returns machine-readable metadata for directories', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'inspect-1',
          name: 'inspect_path',
          arguments: { path: 'src', max_children: 2 },
        });
        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.output) as {
          path: string;
          exists: boolean;
          kind: string;
          childCount: number;
          childrenTruncated: boolean;
          children: Array<{ name: string; path: string; kind: string }>;
        };
        expect(payload.path).toBe('src');
        expect(payload.exists).toBe(true);
        expect(payload.kind).toBe('directory');
        expect(payload.childCount).toBeGreaterThanOrEqual(2);
        expect(payload.children.length).toBe(2);
        expect(payload.children).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'app.ts', path: 'src/app.ts', kind: 'file' }),
        ]));
      } finally {
        cleanup();
      }
    });

    it('returns machine-readable metadata for files and missing paths', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const fileResult = await runtime.execute(sharedCtx(cwd), {
          id: 'inspect-2',
          name: 'inspect_path',
          arguments: { path: 'src/app.ts', include_children: false },
        });
        expect(fileResult.isError).toBeUndefined();
        const filePayload = JSON.parse(fileResult.output) as {
          path: string;
          exists: boolean;
          kind: string;
          extension?: string;
        };
        expect(filePayload).toMatchObject({
          path: 'src/app.ts',
          exists: true,
          kind: 'file',
          extension: '.ts',
        });

        const missingResult = await runtime.execute(readOnlyCtx(cwd), {
          id: 'inspect-3',
          name: 'inspect_path',
          arguments: { path: 'missing.txt' },
        });
        expect(missingResult.isError).toBeUndefined();
        const missingPayload = JSON.parse(missingResult.output) as {
          path: string;
          exists: boolean;
        };
        expect(missingPayload).toEqual({
          path: 'missing.txt',
          exists: false,
        });
      } finally {
        cleanup();
      }
    });

    it('supports bounded recursive child expansion for planning', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'inspect-4',
          name: 'inspect_path',
          arguments: { path: 'src', max_children: 5, max_depth: 2 },
        });
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual(expect.objectContaining({
          path: 'src',
          exists: true,
          kind: 'directory',
          maxDepth: 2,
          children: expect.arrayContaining([
            expect.objectContaining({
              name: 'utils',
              path: 'src/utils',
              kind: 'directory',
              childCount: 2,
              childrenTruncated: false,
              children: expect.arrayContaining([
                expect.objectContaining({
                  name: 'format.js',
                  path: 'src/utils/format.js',
                  kind: 'file',
                }),
              ]),
            }),
          ]),
        }));
      } finally {
        cleanup();
      }
    });
  });

  describe('inspect_paths', () => {
    it('returns bounded metadata for multiple paths without failing the whole batch', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'inspect-many-1',
          name: 'inspect_paths',
          arguments: {
            paths: ['src', 'src/app.ts', 'missing.txt'],
            include_children: true,
            max_children: 1,
          },
        });

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual({
          requestedCount: 3,
          uniqueCount: 3,
          includeChildren: true,
          maxChildren: 1,
          entries: [
            expect.objectContaining({
              path: 'src',
              exists: true,
              kind: 'directory',
              childCount: 2,
              childrenTruncated: true,
              children: [
                expect.objectContaining({
                  name: 'app.ts',
                  path: 'src/app.ts',
                  kind: 'file',
                }),
              ],
            }),
            expect.objectContaining({
              path: 'src/app.ts',
              exists: true,
              kind: 'file',
              extension: '.ts',
            }),
            {
              path: 'missing.txt',
              exists: false,
            },
          ],
        });
      } finally {
        cleanup();
      }
    });

    it('deduplicates paths and records per-entry errors for unsafe inputs', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'inspect-many-2',
          name: 'inspect_paths',
          arguments: {
            paths: ['src/app.ts', 'src/app.ts', '../outside.txt'],
          },
        });

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual({
          requestedCount: 3,
          uniqueCount: 2,
          includeChildren: false,
          maxChildren: 20,
          entries: [
            expect.objectContaining({
              path: 'src/app.ts',
              exists: true,
              kind: 'file',
            }),
            expect.objectContaining({
              path: '../outside.txt',
              exists: false,
              error: expect.stringContaining('outside the workspace'),
            }),
          ],
        });
      } finally {
        cleanup();
      }
    });

    it('supports bounded recursive inspection for directory batches', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'inspect-many-3',
          name: 'inspect_paths',
          arguments: {
            paths: ['src'],
            include_children: true,
            max_children: 5,
            max_depth: 2,
          },
        });

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual({
          requestedCount: 1,
          uniqueCount: 1,
          includeChildren: true,
          maxChildren: 5,
          maxDepth: 2,
          entries: [
            expect.objectContaining({
              path: 'src',
              exists: true,
              kind: 'directory',
              children: expect.arrayContaining([
                expect.objectContaining({
                  name: 'utils',
                  path: 'src/utils',
                  kind: 'directory',
                  childCount: 2,
                  childrenTruncated: false,
                  children: expect.arrayContaining([
                    expect.objectContaining({
                      name: 'format.js',
                      path: 'src/utils/format.js',
                      kind: 'file',
                    }),
                  ]),
                }),
              ]),
            }),
          ],
        });
      } finally {
        cleanup();
      }
    });
  });

  describe('create_directory', () => {
    it('creates nested directories and reports existing ones', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const created = await runtime.execute(sharedCtx(cwd), {
          id: 'mkdir-1',
          name: 'create_directory',
          arguments: { path: 'notes/drafts' },
        });
        expect(created.isError).toBeUndefined();
        expect(created.output).toContain('Created directory notes/drafts');
        expect(existsSync(join(cwd, 'notes', 'drafts'))).toBe(true);

        const existing = await runtime.execute(sharedCtx(cwd), {
          id: 'mkdir-2',
          name: 'create_directory',
          arguments: { path: 'notes/drafts' },
        });
        expect(existing.isError).toBeUndefined();
        expect(existing.output).toContain('Directory already exists');
      } finally {
        cleanup();
      }
    });

    it('blocks mutations in read_only mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'mkdir-3',
          name: 'create_directory',
          arguments: { path: 'notes' },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('not allowed');
      } finally {
        cleanup();
      }
    });
  });

  it('rejects symbolic-link and junction alias paths', async () => {
    const { cwd, cleanup } = createWorkspace();
    const outside = mkdtempSync(join(tmpdir(), 'cats-runtime-tools-outside-'));
    const runtime = new LocalToolRuntime();
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    symlinkSync(
      outside,
      join(cwd, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    try {
      const readResult = await runtime.execute(sharedCtx(cwd), {
        id: 'alias-1',
        name: 'read_file',
        arguments: { path: 'linked-outside/secret.txt' },
      });
      expect(readResult.isError).toBe(true);
      expect(readResult.output).toContain('symbolic-link or junction alias');

      const writeResult = await runtime.execute(sharedCtx(cwd), {
        id: 'alias-2',
        name: 'write_file',
        arguments: { path: 'linked-outside/pwned.txt', content: 'nope\n' },
      });
      expect(writeResult.isError).toBe(true);
      expect(writeResult.output).toContain('symbolic-link or junction alias');
    } finally {
      rmSync(outside, { recursive: true, force: true });
      cleanup();
    }
  });

  it('rejects hardlinked mutation targets and same-file copy aliases', async () => {
    const { cwd, cleanup } = createWorkspace();
    const runtime = new LocalToolRuntime();
    linkSync(join(cwd, 'src', 'app.ts'), join(cwd, 'src', 'app-hard.ts'));

    try {
      const editResult = await runtime.execute(sharedCtx(cwd), {
        id: 'alias-3',
        name: 'edit_file',
        arguments: {
          path: 'src/app-hard.ts',
          old_string: 'const value = 1',
          new_string: 'const value = 2',
        },
      });
      expect(editResult.isError).toBe(true);
      expect(editResult.output).toContain('aliased file');

      const copyResult = await runtime.execute(extendedCtx(cwd), {
        id: 'alias-4',
        name: 'copy_file',
        arguments: {
          source: 'src/app.ts',
          destination: 'src/app-hard.ts',
          overwrite: true,
        },
      });
      expect(copyResult.isError).toBe(true);
      expect(copyResult.output).toContain('refer to the same file');
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

  describe('diff_file', () => {
    it('returns machine-readable proposed diffs for existing files', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'diff-1',
          name: 'diff_file',
          arguments: {
            path: 'src/app.ts',
            content: 'export const value = 9;\nconsole.log(value);\n',
          },
        });

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual(expect.objectContaining({
          path: 'src/app.ts',
          exists: true,
          diffStats: {
            changed: true,
            addedLines: 1,
            removedLines: 1,
          },
          beforeBytes: Buffer.byteLength('export const value = 1;\nconsole.log(value);\n', 'utf-8'),
          afterBytes: Buffer.byteLength('export const value = 9;\nconsole.log(value);\n', 'utf-8'),
        }));
      } finally {
        cleanup();
      }
    });

    it('treats missing files as create previews and is allowed in read_only mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'diff-2',
          name: 'diff_file',
          arguments: {
            path: 'src/new.ts',
            content: 'export const created = true;\n',
          },
        });

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toEqual(expect.objectContaining({
          path: 'src/new.ts',
          exists: false,
          diffStats: {
            changed: true,
            addedLines: 2,
            removedLines: 0,
          },
        }));
      } finally {
        cleanup();
      }
    });
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
        expect(listAtomicWriteArtifacts(join(cwd, 'src'))).toEqual([]);
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

    it('blocks symbolic-link alias paths in patch hunks', async () => {
      const { cwd, cleanup } = createWorkspace();
      const outside = mkdtempSync(join(tmpdir(), 'cats-runtime-patch-outside-'));
      const runtime = new LocalToolRuntime();
      symlinkSync(
        outside,
        join(cwd, 'linked-outside'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      try {
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-3b',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Add File: linked-outside/escape.txt
+pwned
*** End Patch`,
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('symbolic-link or junction alias');
      } finally {
        rmSync(outside, { recursive: true, force: true });
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

    it('rolls back earlier file additions when a later hunk fails', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const original = readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8');
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-4b',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Add File: src/ephemeral.ts
+export const ephemeral = true;
*** Update File: src/app.ts
@@
-missing line
+still missing
*** End Patch`,
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('Failed to find expected lines');
        expect(existsSync(join(cwd, 'src', 'ephemeral.ts'))).toBe(false);
        expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toBe(original);
      } finally {
        cleanup();
      }
    });

    it('restores earlier updates when a later delete hunk fails', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const original = readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8');
        const result = await runtime.execute(sharedCtx(cwd), {
          id: 'patch-4c',
          name: 'apply_patch',
          arguments: {
            input: `*** Begin Patch
*** Update File: src/app.ts
@@
-export const value = 1;
+export const value = 9;
*** Delete File: src/missing.ts
*** End Patch`,
          },
        });
        expect(result.isError).toBe(true);
        expect(result.output).toContain('ENOENT');
        expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf-8')).toBe(original);
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

    it('preserves source timestamps when copying a file', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      const sourcePath = join(cwd, 'src', 'app.ts');
      const destinationPath = join(cwd, 'backup', 'app.ts');
      const preservedTime = new Date('2020-01-02T03:04:05.000Z');
      utimesSync(sourcePath, preservedTime, preservedTime);

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'cp-1b',
          name: 'copy_file',
          arguments: { source: 'src/app.ts', destination: 'backup/app.ts' },
        });
        expect(result.isError).toBeUndefined();

        const sourceStat = statSync(sourcePath);
        const destinationStat = statSync(destinationPath);
        expect(destinationStat.mtime.toISOString()).toBe(sourceStat.mtime.toISOString());
        expect(destinationStat.atime.toISOString()).toBe(sourceStat.atime.toISOString());
      } finally {
        cleanup();
      }
    });

    it('preserves source file modes when the platform supports chmod metadata', async () => {
      if (process.platform === 'win32') {
        return;
      }

      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      const sourcePath = join(cwd, 'src', 'app.ts');
      const destinationPath = join(cwd, 'backup', 'app.ts');
      chmodSync(sourcePath, 0o744);

      try {
        const result = await runtime.execute(extendedCtx(cwd), {
          id: 'cp-1c',
          name: 'copy_file',
          arguments: { source: 'src/app.ts', destination: 'backup/app.ts' },
        });
        expect(result.isError).toBeUndefined();

        const sourceStat = statSync(sourcePath);
        const destinationStat = statSync(destinationPath);
        expect(destinationStat.mode & 0o777).toBe(sourceStat.mode & 0o777);
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
    it('standard profile lists 29 tools', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('standard');
      expect(tools.map((t) => t.name)).toEqual([
        'list_files', 'inspect_path', 'inspect_paths', 'read_file', 'read_files', 'diff_file', 'write_file', 'create_directory', 'edit_file',
        'apply_patch', 'grep', 'glob', 'run_shell',
        'audit-workspace', 'init-workspace', 'update-workspace',
        'audit-delivery-target', 'publish-artifacts', 'inspect-repo-status', 'create-commit', 'push-branch',
        'audit-review-target', 'open-pull-request', 'inspect-pull-request', 'wait-review-checks',
        'audit-deployment-target', 'create-deployment', 'inspect-deployment', 'read-deployment-logs',
      ]);
    });

    it('extended profile lists 32 tools', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('extended');
      expect(tools.map((t) => t.name)).toEqual([
        'list_files', 'inspect_path', 'inspect_paths', 'read_file', 'read_files', 'diff_file', 'write_file', 'create_directory', 'edit_file',
        'apply_patch', 'grep', 'glob', 'run_shell',
        'delete_file', 'rename_file', 'copy_file',
        'audit-workspace', 'init-workspace', 'update-workspace',
        'audit-delivery-target', 'publish-artifacts', 'inspect-repo-status', 'create-commit', 'push-branch',
        'audit-review-target', 'open-pull-request', 'inspect-pull-request', 'wait-review-checks',
        'audit-deployment-target', 'create-deployment', 'inspect-deployment', 'read-deployment-logs',
      ]);
    });

    it('summarizes runtime tool profile counts for diagnostics', () => {
      expect(buildRuntimeToolCatalogSummary()).toEqual({
        profiles: {
          standard: {
            totalTools: 29,
            mutatingTools: 12,
            readOnlyCompatibleTools: 22,
            domains: {
              filesystem: 10,
              search: 2,
              shell: 1,
              workspace: 3,
              delivery: 5,
              review: 4,
              deployment: 4,
            },
          },
          extended: {
            totalTools: 32,
            mutatingTools: 15,
            readOnlyCompatibleTools: 22,
            domains: {
              filesystem: 13,
              search: 2,
              shell: 1,
              workspace: 3,
              delivery: 5,
              review: 4,
              deployment: 4,
            },
          },
          readOnly: {
            totalTools: 17,
            mutatingTools: 0,
            readOnlyCompatibleTools: 17,
            domains: {
              filesystem: 6,
              search: 2,
              shell: 0,
              workspace: 1,
              delivery: 2,
              review: 3,
              deployment: 3,
            },
          },
        },
        summary: 'Runtime tooling exposes 29 tools in the standard profile, 32 in the extended profile, and 17 in the read_only profile.',
      });
    });

    it('builds per-tool profile access inspection for runtime-owned tooling', () => {
      expect(buildRuntimeToolCatalogInspection()).toEqual(expect.objectContaining({
        toolCount: 32,
        summary: 'Runtime-local tooling exposes 32 unique tools across the standard, extended, and read_only profiles.',
        tools: expect.arrayContaining([
          {
            name: 'inspect_paths',
            domain: 'filesystem',
            mutating: false,
            readOnlyCompatible: true,
            profileAccess: {
              standard: 'full_access',
              extended: 'full_access',
              read_only: 'full_access',
            },
          },
          {
            name: 'copy_file',
            domain: 'filesystem',
            mutating: true,
            readOnlyCompatible: false,
            profileAccess: {
              standard: 'blocked',
              extended: 'full_access',
              read_only: 'blocked',
            },
          },
        ]),
      }));
    });

    it('read_only profile lists 17 tools', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools('read_only');
      expect(tools.map((t) => t.name)).toEqual([
        'list_files', 'inspect_path', 'inspect_paths', 'read_file', 'read_files', 'diff_file', 'grep', 'glob', 'audit-workspace',
        'audit-delivery-target', 'inspect-repo-status',
        'audit-review-target', 'inspect-pull-request', 'wait-review-checks',
        'audit-deployment-target', 'inspect-deployment', 'read-deployment-logs',
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
      expect(tools.length).toBe(29);
      expect(tools.map((t) => t.name)).toContain('apply_patch');
      expect(tools.map((t) => t.name)).toContain('diff_file');
      expect(tools.map((t) => t.name)).toContain('inspect_path');
      expect(tools.map((t) => t.name)).toContain('inspect_paths');
      expect(tools.map((t) => t.name)).toContain('read_files');
      expect(tools.map((t) => t.name)).toContain('edit_file');
      expect(tools.map((t) => t.name)).toContain('glob');
      expect(tools.map((t) => t.name)).toContain('audit-workspace');
      expect(tools.map((t) => t.name)).toContain('create-commit');
    });

    it('default profile (undefined) is standard', () => {
      const runtime = new LocalToolRuntime();
      const tools = runtime.listTools();
      expect(tools.length).toBe(29);
    });

    it('builds read-only compatible tool policy summaries', () => {
      const policy = buildToolPolicyInspection({
        toolProfile: 'extended',
        permissionMode: 'default',
      });

      expect(policy).toEqual(expect.objectContaining({
        profile: 'extended',
        permissionMode: 'default',
        whitelistActive: false,
      }));
        expect(policy.fullAccessTools).toEqual(expect.arrayContaining([
          'list_files',
          'inspect_path',
          'inspect_paths',
          'read_file',
          'read_files',
          'diff_file',
          'grep',
          'audit-workspace',
          'audit-review-target',
        ]));
      expect(policy.previewOnlyTools).toEqual(expect.arrayContaining([
        'init-workspace',
        'update-workspace',
        'publish-artifacts',
        'create-commit',
        'push-branch',
      ]));
      expect(policy.blockedTools).toEqual(expect.arrayContaining([
        'write_file',
        'create_directory',
        'edit_file',
        'apply_patch',
        'delete_file',
        'copy_file',
      ]));
      expect(policy.counts).toEqual({
        total: 32,
        fullAccess: 17,
        previewOnly: 5,
        blocked: 10,
      });
      expect(policy.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'read_files',
          domain: 'filesystem',
          access: 'full_access',
          readOnlyCompatible: true,
          mutating: false,
        }),
        expect.objectContaining({
          name: 'init-workspace',
          domain: 'workspace',
          access: 'preview_only',
          readOnlyCompatible: true,
          mutating: true,
        }),
        expect.objectContaining({
          name: 'push-branch',
          domain: 'delivery',
          access: 'preview_only',
          readOnlyCompatible: true,
          mutating: true,
        }),
        expect.objectContaining({
          name: 'write_file',
          domain: 'filesystem',
          access: 'blocked',
          readOnlyCompatible: false,
          mutating: true,
        }),
      ]));
    });

    it('builds whitelist-based tool policy summaries', () => {
      const policy = buildToolPolicyInspection({
        toolProfile: 'extended',
        permissionMode: 'whitelist',
        allowedTools: ['grep', ' copy_file ', 'unknown_tool', 'grep'],
      });

      expect(policy).toEqual(expect.objectContaining({
        profile: 'extended',
        permissionMode: 'whitelist',
        whitelistActive: true,
        allowedTools: ['grep', 'copy_file', 'unknown_tool'],
      }));
      expect(policy.fullAccessTools).toEqual(['grep', 'copy_file']);
      expect(policy.previewOnlyTools).toEqual([]);
      expect(policy.blockedTools).toContain('write_file');
      expect(policy.blockedTools).toContain('init-workspace');
      expect(policy.counts).toEqual({
        total: 32,
        fullAccess: 2,
        previewOnly: 0,
        blocked: 30,
      });
      expect(policy.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'grep',
          domain: 'search',
          access: 'full_access',
          readOnlyCompatible: true,
          mutating: false,
        }),
        expect.objectContaining({
          name: 'copy_file',
          domain: 'filesystem',
          access: 'full_access',
          readOnlyCompatible: false,
          mutating: true,
        }),
        expect.objectContaining({
          name: 'inspect-deployment',
          domain: 'deployment',
          access: 'blocked',
          readOnlyCompatible: true,
          mutating: false,
        }),
      ]));
    });

    it('derives read-only workspace policy overlays when permission mode is omitted', () => {
      const policy = buildToolPolicyInspection({
        toolProfile: 'extended',
        workspaceMode: 'read_only',
      });

      expect(policy).toEqual(expect.objectContaining({
        profile: 'extended',
        permissionMode: 'default',
        workspaceMode: 'read_only',
        workspaceOverlayActive: true,
        whitelistActive: false,
        counts: {
          total: 32,
          fullAccess: 17,
          previewOnly: 5,
          blocked: 10,
        },
      }));
      expect(policy.workspaceRestrictedTools).toBeUndefined();
      expect(policy.previewOnlyTools).toEqual(expect.arrayContaining([
        'init-workspace',
        'publish-artifacts',
        'create-commit',
      ]));
      expect(policy.blockedTools).toEqual(expect.arrayContaining([
        'write_file',
        'edit_file',
        'copy_file',
      ]));
    });

    it('blocks non-read-only-compatible tools when skip mode runs in a read-only workspace', () => {
      const policy = buildToolPolicyInspection({
        toolProfile: 'extended',
        workspaceMode: 'read_only',
        permissionMode: 'skip',
      });

      expect(policy).toEqual(expect.objectContaining({
        profile: 'extended',
        permissionMode: 'skip',
        workspaceMode: 'read_only',
        workspaceOverlayActive: true,
        whitelistActive: false,
        counts: {
          total: 32,
          fullAccess: 22,
          previewOnly: 0,
          blocked: 10,
        },
        workspaceRestrictedTools: expect.arrayContaining([
          'write_file',
          'edit_file',
          'copy_file',
        ]),
      }));
      expect(policy.fullAccessTools).toEqual(expect.arrayContaining([
        'read_files',
        'init-workspace',
        'publish-artifacts',
        'create-commit',
      ]));
      expect(policy.previewOnlyTools).toEqual([]);
      expect(policy.blockedTools).toEqual(expect.arrayContaining([
        'write_file',
        'delete_file',
        'copy_file',
      ]));
      expect(policy.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'publish-artifacts',
          access: 'full_access',
          readOnlyCompatible: true,
        }),
        expect.objectContaining({
          name: 'copy_file',
          access: 'blocked',
          readOnlyCompatible: false,
        }),
      ]));
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

  describe('delivery tools', () => {
    it('audits delivery capability in read_only mode', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      writeFileSync(join(cwd, 'report.html'), '<html><body>preview</body></html>', 'utf-8');

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'delivery-1',
          name: 'audit-delivery-target',
          arguments: {
            artifacts: [
              {
                id: 'report',
                path: 'report.html',
                mediaType: 'text/html',
              },
            ],
          },
        });

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.output)).toMatchObject({
          action: 'audit-delivery-target',
          capabilities: {
            artifactPublication: {
              state: 'ready',
            },
            repoStatus: {
              state: 'blocked',
            },
          },
          previewSurfaces: expect.arrayContaining([
            expect.objectContaining({
              artifactId: 'report',
              status: 'ready',
              renderHint: 'iframe',
            }),
          ]),
        });
      } finally {
        cleanup();
      }
    });

    it('rejects delivery path escapes', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();
      writeFileSync(join(cwd, 'report.html'), '<html><body>preview</body></html>', 'utf-8');

      try {
        const escapedWorkspace = await runtime.execute(sharedCtx(cwd), {
          id: 'delivery-2',
          name: 'audit-delivery-target',
          arguments: {
            path: '../outside',
          },
        });
        expect(escapedWorkspace.isError).toBe(true);
        expect(escapedWorkspace.output).toContain('outside the workspace');

        const escapedPublicationDirectory = await runtime.execute(sharedCtx(cwd), {
          id: 'delivery-3',
          name: 'publish-artifacts',
          arguments: {
            artifacts: [
              {
                id: 'report',
                path: 'report.html',
                mediaType: 'text/html',
              },
            ],
            directory: '../published',
          },
        });
        expect(escapedPublicationDirectory.isError).toBe(true);
        expect(escapedPublicationDirectory.output).toContain('outside the workspace');
      } finally {
        cleanup();
      }
    });

    it('blocks create-commit apply in read_only mode before execution', async () => {
      const { cwd, cleanup } = createWorkspace();
      const runtime = new LocalToolRuntime();

      try {
        const result = await runtime.execute(readOnlyCtx(cwd), {
          id: 'delivery-4',
          name: 'create-commit',
          arguments: {
            message: 'feat: blocked',
            apply: true,
          },
        });

        expect(result.isError).toBe(true);
        expect(result.output).toContain('not allowed');
      } finally {
        cleanup();
      }
    });
  });
});
