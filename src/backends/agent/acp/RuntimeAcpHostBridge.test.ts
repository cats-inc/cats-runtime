import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAcpHostContext } from '../types.js';
import { RuntimeAcpHostBridge } from './RuntimeAcpHostBridge.js';

function createContext(root: string): AgentAcpHostContext {
  return {
    sessionId: 'session-1',
    providerName: 'codex',
    providerInstanceId: 'acp-local',
    cwd: root,
    workspace: {
      kind: 'source',
      access: 'read_write',
      runtimeCwd: root,
      sourceCwd: root,
    },
    workspaceMode: 'shared',
    permissionMode: 'whitelist',
    allowedTools: ['read_file'],
    toolProfile: 'standard',
  };
}

describe('RuntimeAcpHostBridge', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop()!, { recursive: true, force: true });
    }
  });

  it('describes workspace and tool policy through the runtime-owned host bridge', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-host-'));
    roots.push(root);
    const bridge = new RuntimeAcpHostBridge();

    const description = bridge.describe(createContext(root));

    expect(description.summary).toContain('full-access tool(s)');
    expect(description.workspace).toEqual({
      kind: 'source',
      access: 'read_write',
      runtimeCwd: root,
      sourceCwd: root,
    });
    expect(description.toolPolicy).toEqual(expect.objectContaining({
      profile: 'standard',
      permissionMode: 'whitelist',
      whitelistActive: true,
      allowedTools: ['read_file'],
    }));
    expect(description.capabilities).toEqual({
      permissionPolicy: true,
      filesystem: true,
      terminal: true,
      toolExecution: true,
      clientMcpServers: false,
    });
  });

  it('routes read-only tool execution through LocalToolRuntime policy enforcement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-host-'));
    roots.push(root);
    writeFileSync(join(root, 'note.txt'), 'runtime acp host bridge\n', 'utf8');
    const bridge = new RuntimeAcpHostBridge();
    const context = createContext(root);

    const tools = bridge.listTools(context);
    expect(tools.some((tool) => tool.name === 'read_file')).toBe(true);

    await expect(bridge.executeTool(context, {
      id: 'call-read',
      name: 'read_file',
      arguments: { path: 'note.txt' },
    })).resolves.toEqual(expect.objectContaining({
      callId: 'call-read',
      name: 'read_file',
      output: expect.stringContaining('runtime acp host bridge'),
    }));

    await expect(bridge.executeTool(context, {
      id: 'call-shell',
      name: 'run_shell',
      arguments: { command: 'pwd' },
    })).resolves.toEqual(expect.objectContaining({
      callId: 'call-shell',
      name: 'run_shell',
      isError: true,
      output: expect.stringContaining('allowedTools whitelist'),
    }));
  });

  it('keeps client MCP server exposure disabled in the default runtime bridge', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-host-'));
    roots.push(root);
    const bridge = new RuntimeAcpHostBridge();

    expect(bridge.listMcpServers(createContext(root))).toEqual([]);
  });
});
