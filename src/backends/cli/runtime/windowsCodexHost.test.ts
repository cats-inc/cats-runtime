import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessSpawnConfig } from './runtime.js';

const { spawnMock, execFileMock } = vi.hoisted(() => ({ spawnMock: vi.fn(), execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock, execFile: execFileMock }));
import { startWindowsCodexHost, windowsCodexHostPath } from './windowsCodexHost.js';

function mockGuard() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
}

describe('managed Windows Codex host', () => {
  let root: string;
  let host: string;
  let config: ProcessSpawnConfig;
  let guard: ReturnType<typeof mockGuard>;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cats-codex-host-'));
    host = join(root, 'codex-code-mode-host.exe');
    const command = join(root, 'codex.exe');
    writeFileSync(host, ''); writeFileSync(command, '');
    config = { command, args: ['app-server'], shell: false, cwd: root };
    guard = mockGuard();
    spawnMock.mockReturnValue(guard);
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      queueMicrotask(() => callback(null, '--code-mode-host URL; grpc://IP:PORT'));
    });
  });
  afterEach(() => { vi.clearAllMocks(); rmSync(root, { recursive: true, force: true }); });

  it('leaves explicit hosts, shells and other providers alone', () => {
    expect(windowsCodexHostPath(config, 'codex')).toBe(process.platform === 'win32' ? host : null);
    expect(windowsCodexHostPath({ ...config, args: ['app-server', '--code-mode-host=local'] }, 'codex')).toBeNull();
    expect(windowsCodexHostPath({ ...config, args: ['app-server', '--code-mode-host', 'http://localhost:1234'] }, 'codex')).toBeNull();
    expect(windowsCodexHostPath({ ...config, shell: true }, 'codex')).toBeNull();
    expect(windowsCodexHostPath(config, 'claude')).toBeNull();
  });

  it('uses a hidden guard and an ephemeral loopback listener, then stops by EOF', async () => {
    const result = startWindowsCodexHost(config, host, {}, new AbortController().signal);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    guard.stdout.write('http://127.0.0.1:123'); guard.stdout.write('45\n');
    const managed = await result;
    expect(managed?.url).toBe('http://127.0.0.1:12345');
    expect(execFileMock.mock.calls.every((call) => call[2].windowsHide)).toBe(true);
    expect(spawnMock.mock.calls[0][1].slice(-3)).toEqual([host, '--listen', 'grpc://127.0.0.1:0']);
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ windowsHide: true, shell: false });
    managed?.stop();
    expect(guard.stdin.writableEnded).toBe(true);
    expect(guard.kill).not.toHaveBeenCalled();
    guard.emit('close', 0);
    await managed?.closed;
  });

  it('falls back without starting a host when the capability is missing', async () => {
    execFileMock.mockImplementation((_c, _a, _o, callback) => callback(null, 'legacy help'));
    expect(await startWindowsCodexHost(config, host, {}, new AbortController().signal)).toBeNull();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects non-loopback readiness and cleans the helper', async () => {
    const result = startWindowsCodexHost(config, host, {}, new AbortController().signal);
    const check = expect(result).rejects.toThrow('Invalid Codex Code Mode host address');
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    guard.stdout.write('http://0.0.0.0:12345\n');
    await check;
    expect(guard.stdin.writableEnded).toBe(true);
    guard.emit('close', 0);
  });

  it('cleans a helper cancelled before readiness', async () => {
    const controller = new AbortController();
    const result = startWindowsCodexHost(config, host, {}, controller.signal);
    const check = expect(result).rejects.toThrow('startup cancelled');
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    controller.abort();
    await check;
    expect(guard.stdin.writableEnded).toBe(true);
    guard.emit('close', 0);
  });

  it('reports a crashed host during startup', async () => {
    const result = startWindowsCodexHost(config, host, {}, new AbortController().signal);
    const check = expect(result).rejects.toThrow('host exited: bind failed');
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    guard.stderr.write('bind failed');
    guard.emit('close', 1);
    await check;
  });
});
