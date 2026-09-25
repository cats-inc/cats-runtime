import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTempDirWithRetries } from '../../../../tests/tempCleanup.js';
import { CodexProvider } from './codex.js';
import type { ProviderSpawnOptions } from './types.js';

describe('Codex explicit local read tools', () => {
  let root: string;
  let cwd: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cats-codex-read-'));
    cwd = join(root, 'workspace');
    outside = join(root, 'outside');
    mkdirSync(cwd);
    mkdirSync(outside);
    writeFileSync(join(cwd, 'README.md'), 'first\nsecond\nthird\n');
    writeFileSync(join(outside, 'secret.txt'), 'outside-marker');
  });
  afterEach(() => cleanupTempDirWithRetries(root));

  function configured(options: Partial<ProviderSpawnOptions> = {}) {
    const provider = new CodexProvider();
    provider.configureExecution({ localWorkspaceCwd: cwd });
    provider.buildSpawnArgs({ cwd, permissionMode: 'whitelist',
      allowedTools: ['read_file', 'list_files'], ...options });
    return provider;
  }

  function boot(provider = configured()) {
    const lines = provider.buildStdinMessage('Inspect the admitted workspace.').trim().split('\n')
      .map((line) => JSON.parse(line));
    provider.parseStreamLine(JSON.stringify({ id: lines[0].id, result: {} }));
    provider.parseStreamLine(JSON.stringify({ id: lines[2].id, result: { thread: { id: 'thread' } } }));
    const turn = JSON.parse(provider.getPendingTurnStart()!);
    provider.parseStreamLine(JSON.stringify({ id: turn.id, result: { turn: { id: 'turn' } } }));
    return provider;
  }

  async function call(provider: CodexProvider, overrides: Record<string, unknown> = {},
    signal = new AbortController().signal) {
    const response = await provider.buildServerResponse(JSON.stringify({ jsonrpc: '2.0', id: 'request',
      method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'call',
        tool: 'read_file', arguments: { path: 'README.md' }, ...overrides } }), { signal });
    return JSON.parse(response!);
  }

  it.each(['whitelist', 'default', 'skip'] as const)('only registers exact grants in %s mode', (permissionMode) => {
    const provider = configured({ permissionMode, allowedTools: ['Read', 'read_file', 'List_Files', '*'] });
    const lines = provider.buildStdinMessage('inspect').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].params.capabilities).toEqual({ experimentalApi: true });
    expect(lines[2].params.dynamicTools).toEqual([expect.objectContaining({
      type: 'function', name: 'read_file',
      inputSchema: expect.objectContaining({ additionalProperties: false }),
    })]);
    const ordinary = configured({ permissionMode, allowedTools: ['Read', 'Glob', '*', ' read_file'] });
    const ordinaryLines = ordinary.buildStdinMessage('inspect').trim().split('\n').map((line) => JSON.parse(line));
    expect(ordinaryLines[0].params.capabilities).toBeUndefined();
    expect(ordinaryLines[2].params.dynamicTools).toBeUndefined();
  });

  it('requires the internal native local path mapping before a granted session can launch', () => {
    const provider = new CodexProvider();
    expect(() => provider.buildSpawnArgs({ cwd, allowedTools: ['read_file'] }))
      .toThrow('verified native local workspace');
    provider.configureExecution({ localWorkspaceCwd: outside });
    expect(() => provider.buildSpawnArgs({ cwd, allowedTools: ['read_file'] }))
      .toThrow('verified native local workspace');
  });

  it.each([{ resumeSessionId: 'prior' }, { resumeSessionId: 'prior', forkSession: true }])(
    'stops unverified resumed/forked registration instead of dropping tools (%j)', (options) => {
      expect(() => configured(options)).toThrow('resume/fork');
    });

  it('does not release the pending turn from a notification or failed registration', () => {
    const provider = configured();
    provider.buildStdinMessage('inspect');
    provider.parseStreamLine(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thread' } } }));
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(provider.parseStreamLine(JSON.stringify({ id: 1,
      error: { code: -32600, message: 'dynamicTools is unsupported' } })))
      .toMatchObject({ type: 'error', text: expect.stringContaining('read-tool registration failed') });
    provider.parseStreamLine(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thread' } } }));
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(() => provider.buildStdinMessage('again')).toThrow('bootstrap failed');
  });

  it('stops a required bootstrap response with no thread identity', () => {
    const provider = configured();
    provider.buildStdinMessage('inspect');
    expect(provider.parseStreamLine(JSON.stringify({ id: 1, result: {} })))
      .toMatchObject({ type: 'error', text: expect.stringContaining('valid thread') });
    expect(provider.getPendingTurnStart()).toBeNull();
  });

  it('reads real admitted files and lists a bounded directory with shared tools', async () => {
    const provider = boot();
    expect((await call(provider, { arguments: { path: 'README.md', offset_line: 1, limit_lines: 1 } })).result)
      .toEqual({ success: true, contentItems: [{ type: 'inputText', text: 'second' }] });
    expect((await call(provider, { callId: 'list', tool: 'list_files', arguments: { max_entries: 1 } })).result)
      .toEqual({ success: true, contentItems: [{ type: 'inputText', text: 'README.md' }] });
  });

  it('keeps default read_only inspection while denying shell and write approval requests', async () => {
    const provider = boot(configured({ permissionMode: 'default', workspaceMode: 'read_only' }));
    expect((await call(provider)).result.success).toBe(true);
    for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']) {
      expect(JSON.parse(provider.buildAutoResponse(JSON.stringify({ id: 7, method,
        params: { command: 'Get-Content README.md' } }))!).result.decision).toBe('decline');
    }
    const writer = boot(configured({ allowedTools: ['read_file', 'apply_patch'] }));
    expect(JSON.parse(writer.buildAutoResponse(JSON.stringify({ id: 7,
      method: 'item/commandExecution/requestApproval', params: { command: 'Get-Content README.md',
        commandActions: [{ type: 'read', path: 'README.md' }] } }))!).result.decision).toBe('decline');
    expect(JSON.parse(writer.buildAutoResponse(JSON.stringify({ id: 8,
      method: 'item/fileChange/requestApproval' }))!).result.decision).toBe('accept');
    expect((await call(writer, { tool: 'write_file' })).result.success).toBe(false);
  });

  it.each([
    null, [], 'README.md', { path: 42 }, { path: 'README.md', cwd: '..' },
    { path: 'README.md', offset_line: -1 }, { path: 'README.md', limit_lines: 2001 },
    { path: 'README.md', offset_line: 0.5 }, { path: 'README.md', limit_lines: '1' },
    { path: 'README.md:stream' }, { path: 'NUL' }, { path: 'README.md\u0000' },
  ])('rejects malformed or special read arguments (%j)', async (args) => {
    const result = await call(boot(), { arguments: args });
    expect(result.result.success).toBe(false);
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  });

  it.each([{ max_entries: 0 }, { recursive: 'false' }, { max_entries: 1001 }, { offset_line: 1 }])(
    'rejects malformed list arguments (%j)', async (args) => {
      expect((await call(boot(), { tool: 'list_files', arguments: args })).result.success).toBe(false);
    });

  it('rejects relative escapes, absolute paths and links to another directory', async () => {
    symlinkSync(outside, join(cwd, 'alias'), 'junction');
    linkSync(join(outside, 'secret.txt'), join(cwd, 'hardlink.txt'));
    const provider = boot();
    for (const [index, path] of ['../outside/secret.txt', join(outside, 'secret.txt'),
      'alias/secret.txt', 'hardlink.txt'].entries()) {
      const result = await call(provider, { callId: `escape-${index}`, arguments: { path } });
      expect(result.result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('outside-marker');
    }
    expect((await call(provider, { callId: 'alias-list', tool: 'list_files',
      arguments: { path: 'alias' } })).result.success).toBe(false);
  });

  it('rejects directory reads and oversized ordinary files before shared inspection', async () => {
    writeFileSync(join(cwd, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 'x'));
    const provider = boot();
    expect((await call(provider, { arguments: { path: '.' } })).result.success).toBe(false);
    const result = await call(provider, { callId: 'large', arguments: { path: 'large.txt' } });
    expect(result.result.success).toBe(false);
    expect(result.result.contentItems[0].text).toContain('1 MiB');
  });

  it('caps read and directory result text while preserving success and truncation notice', async () => {
    writeFileSync(join(cwd, 'long.txt'), 'x'.repeat(20_000));
    for (let index = 0; index < 80; index += 1) {
      writeFileSync(join(cwd, `${String(index).padStart(3, '0')}${'n'.repeat(190)}.txt`), 'entry');
    }
    const provider = boot();
    for (const [callId, tool, args] of [
      ['read', 'read_file', { path: 'long.txt' }], ['list', 'list_files', { max_entries: 100 }],
    ] as const) {
      const result = await call(provider, { callId, tool, arguments: args });
      expect(result.result.success).toBe(true);
      expect(result.result.contentItems[0].text.length).toBeLessThanOrEqual(12_000);
      expect(result.result.contentItems[0].text).toContain('truncated');
    }
  });

  it.each([{ threadId: 'foreign' }, { turnId: 'foreign' }, { namespace: 'foreign' },
    { namespace: '' }, { callId: '' }, { tool: 'list_files', arguments: {}, namespace: 'functions' }])(
    'denies foreign or malformed native request identity (%j)', async (overrides) => {
      expect((await call(boot(), overrides)).result.success).toBe(false);
    });

  it('does not execute before turn acknowledgement, after completion or after cancellation', async () => {
    const provider = configured();
    provider.buildStdinMessage('inspect');
    provider.parseStreamLine(JSON.stringify({ id: 1, result: { threadId: 'thread' } }));
    provider.getPendingTurnStart();
    expect((await call(provider)).result.success).toBe(false);
    const ready = boot();
    const controller = new AbortController();
    controller.abort();
    expect((await call(ready, {}, controller.signal)).result.success).toBe(false);
    const pending = call(ready, { callId: 'late' });
    ready.parseStreamLine(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread' } }));
    expect((await pending).result.success).toBe(false);
    expect((await call(ready, { callId: 'closed' })).result.success).toBe(false);
  });

  it('returns bounded errors for oversized requests and does not repeat a completed call', async () => {
    const provider = boot();
    const large = await call(provider, { arguments: { path: 'x'.repeat(20_000) } });
    expect(large.result.success).toBe(false);
    expect(JSON.stringify(large).length).toBeLessThan(1000);
    expect((await call(provider)).result.success).toBe(true);
    writeFileSync(join(cwd, 'README.md'), 'changed');
    const duplicate = await call(provider);
    expect(duplicate.result.success).toBe(false);
    expect(duplicate.result.contentItems[0].text).toContain('duplicated');
  });
});
