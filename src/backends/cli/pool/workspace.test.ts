import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveWorkspace, cleanupIsolatedWorkspace, copyIsolatedWorkspace } from './workspace.js';

describe('resolveWorkspace', () => {
  let testBaseDir: string;

  beforeEach(() => {
    testBaseDir = join(tmpdir(), `workspace-test-${randomUUID()}`);
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testBaseDir, { recursive: true, force: true });
  });

  it('defaults to isolated when no cwd and no workspaceMode', () => {
    const sessionId = randomUUID();
    const result = resolveWorkspace({
      sessionId,
      sessionBaseDir: testBaseDir,
    });

    expect(result.workspaceMode).toBe('isolated');
    expect(result.permissionMode).toBe('skip');
    expect(result.cwd).toBe(join(testBaseDir, sessionId));
    expect(existsSync(result.cwd)).toBe(true);
  });

  it('defaults to shared when cwd is provided and no workspaceMode', () => {
    const result = resolveWorkspace({
      sessionId: randomUUID(),
      sessionBaseDir: testBaseDir,
      cwd: '/some/project',
    });

    expect(result.workspaceMode).toBe('shared');
    expect(result.cwd).toBe('/some/project');
    expect(result.sourceCwd).toBe('/some/project');
    expect(result.permissionMode).toBe('skip');
  });

  it('isolated mode creates sandbox directory', () => {
    const sessionId = randomUUID();
    const result = resolveWorkspace({
      sessionId,
      sessionBaseDir: testBaseDir,
      workspaceMode: 'isolated',
      cwd: '/source/project',
    });

    expect(result.workspaceMode).toBe('isolated');
    expect(result.cwd).toBe(join(testBaseDir, sessionId));
    expect(result.sourceCwd).toBe('/source/project');
    expect(result.permissionMode).toBe('skip');
    expect(existsSync(result.cwd)).toBe(true);
  });

  it('isolated mode forces permissionMode to skip regardless of input', () => {
    const result = resolveWorkspace({
      sessionId: randomUUID(),
      sessionBaseDir: testBaseDir,
      workspaceMode: 'isolated',
      permissionMode: 'default',
    });

    expect(result.permissionMode).toBe('skip');
  });

  it('shared mode requires cwd', () => {
    expect(() => resolveWorkspace({
      sessionId: randomUUID(),
      sessionBaseDir: testBaseDir,
      workspaceMode: 'shared',
    })).toThrow('cwd is required for shared workspace mode');
  });

  it('shared mode passes through permissionMode', () => {
    const result = resolveWorkspace({
      sessionId: randomUUID(),
      sessionBaseDir: testBaseDir,
      cwd: '/project',
      workspaceMode: 'shared',
      permissionMode: 'whitelist',
    });

    expect(result.permissionMode).toBe('whitelist');
    expect(result.cwd).toBe('/project');
    expect(result.sourceCwd).toBe('/project');
  });

  it('read_only mode requires cwd', () => {
    expect(() => resolveWorkspace({
      sessionId: randomUUID(),
      sessionBaseDir: testBaseDir,
      workspaceMode: 'read_only',
    })).toThrow('cwd is required for read_only workspace mode');
  });

  it('read_only mode forces permissionMode to default', () => {
    const result = resolveWorkspace({
      sessionId: randomUUID(),
      sessionBaseDir: testBaseDir,
      cwd: '/project',
      workspaceMode: 'read_only',
    });

    expect(result.workspaceMode).toBe('read_only');
    expect(result.permissionMode).toBe('default');
    expect(result.cwd).toBe('/project');
    expect(result.sourceCwd).toBe('/project');
  });
});

describe('cleanupIsolatedWorkspace', () => {
  let testBaseDir: string;

  beforeEach(() => {
    testBaseDir = join(tmpdir(), `cleanup-test-${randomUUID()}`);
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testBaseDir, { recursive: true, force: true });
  });

  it('removes an existing sandbox directory', () => {
    const sessionId = randomUUID();
    const sandboxDir = join(testBaseDir, sessionId);
    mkdirSync(sandboxDir, { recursive: true });
    writeFileSync(join(sandboxDir, 'test.txt'), 'hello');

    const result = cleanupIsolatedWorkspace(testBaseDir, sessionId);
    expect(result).toBe(true);
    expect(existsSync(sandboxDir)).toBe(false);
  });

  it('returns true for non-existing directory (force: true)', () => {
    const result = cleanupIsolatedWorkspace(testBaseDir, 'nonexistent');
    expect(result).toBe(true);
  });
});

describe('copyIsolatedWorkspace', () => {
  let testBaseDir: string;

  beforeEach(() => {
    testBaseDir = join(tmpdir(), `copy-test-${randomUUID()}`);
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testBaseDir, { recursive: true, force: true });
  });

  it('copies parent sandbox files to child sandbox', () => {
    const parentId = randomUUID();
    const childId = randomUUID();
    const parentDir = join(testBaseDir, parentId);
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(parentDir, 'file.txt'), 'content');
    mkdirSync(join(parentDir, 'subdir'), { recursive: true });
    writeFileSync(join(parentDir, 'subdir', 'nested.txt'), 'nested');

    // Create child sandbox first (as resolveWorkspace would)
    mkdirSync(join(testBaseDir, childId), { recursive: true });

    copyIsolatedWorkspace(testBaseDir, parentId, childId);

    expect(existsSync(join(testBaseDir, childId, 'file.txt'))).toBe(true);
    expect(readFileSync(join(testBaseDir, childId, 'file.txt'), 'utf-8')).toBe('content');
    expect(readFileSync(join(testBaseDir, childId, 'subdir', 'nested.txt'), 'utf-8')).toBe('nested');
  });

  it('handles empty parent gracefully', () => {
    const parentId = randomUUID();
    const childId = randomUUID();
    mkdirSync(join(testBaseDir, parentId), { recursive: true });

    // Should not throw
    copyIsolatedWorkspace(testBaseDir, parentId, childId);
    expect(existsSync(join(testBaseDir, childId))).toBe(true);
  });
});
