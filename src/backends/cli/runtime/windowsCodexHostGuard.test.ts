import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_HOST_GUARD } from './windowsCodexHost.js';

describe('Codex host guard process lifetime', () => {
  const children: ChildProcess[] = [];
  const hostPids: number[] = [];
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const line = async (child: ChildProcess) => {
    const reader = createInterface({ input: child.stdout! });
    try { return (await once(reader, 'line'))[0] as string; } finally { reader.close(); }
  };
  const fakeHost = 'console.log(process.pid); setInterval(() => {}, 1000);';
  afterEach(() => {
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill();
    for (const pid of hostPids.splice(0)) { try { process.kill(pid); } catch { /* already gone */ } }
  });

  it('kills its host when its input pipe ends', async () => {
    const guard = spawn(process.execPath, ['-e', CODEX_HOST_GUARD, process.execPath, '-e', fakeHost], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    children.push(guard);
    const pid = Number(await line(guard)); hostPids.push(pid);
    expect(alive(pid)).toBe(true);
    const closed = once(guard, 'close');
    guard.stdin!.end();
    await closed;
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  });

  it('cleans its host even when Runtime is forcibly terminated', async () => {
    const parentScript = `
      const {spawn}=require('node:child_process');
      const guard=spawn(process.execPath, ['-e', ${JSON.stringify(CODEX_HOST_GUARD)}, process.execPath, '-e', ${JSON.stringify(fakeHost)}],
        {stdio:['pipe','pipe','pipe'], windowsHide:true});
      guard.stdout.pipe(process.stdout); guard.stderr.pipe(process.stderr);
      setInterval(()=>{},1000);
    `;
    const parent = spawn(process.execPath, ['-e', parentScript], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    children.push(parent);
    const pid = Number(await line(parent)); hostPids.push(pid);
    expect(alive(pid)).toBe(true);
    parent.kill('SIGKILL');
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
  });
});
