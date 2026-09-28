import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WorkerProcess } from '../src/backends/cli/pool/WorkerProcess.js';
import type { Provider, StreamEvent } from '../src/backends/cli/providers/types.js';
import { createRuntimeTestPaths } from './support/runtimeTestPaths.js';

it('reports a real child close separately from results, synthetic exit and cancel requests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cats-plugin-process-'));
  createRuntimeTestPaths(root);
  const provider: Provider = {
    name: 'codex', capabilities: { resume: true, fork: false, permissions: false },
    buildSpawnArgs: () => ['-e', 'process.stdout.write(JSON.stringify({type:"init",sessionId:"test-native"})+"\\n"); process.stdin.on("data",()=>process.stdout.write(JSON.stringify({type:"result",text:"done"})+"\\n")); setInterval(()=>{},1000);'],
    buildStdinMessage: () => 'message\n',
    getPendingTurnStart: () => 'pending\n',
    parseStreamLine: line => JSON.parse(line) as StreamEvent,
  };
  const worker = new WorkerProcess(provider, { cwd: root }, { path: process.execPath, runner: 'direct', runtime: { mode: 'native' } }, { retries: 1, timeoutMs: 5000 }, true);
  const stopped = vi.fn(); const order: string[] = [];
  worker.on('error', () => {}); worker.on('process-stopped', stopped);
  worker.on('native-session', () => { order.push('durable-native'); });
  worker.on('event', event => { if (event.type === 'result') order.push('result'); });
  try {
    const result = new Promise<void>(resolve => worker.on('event', event => { if (event.type === 'result') resolve(); }));
    worker.start(); await result;
    expect(order).toEqual(['durable-native', 'result']); expect(stopped).not.toHaveBeenCalled();
    worker.emit('exit', 0, null); expect(stopped).not.toHaveBeenCalled();
    const closed = once(worker, 'process-stopped'); worker.cancel(); expect(stopped).not.toHaveBeenCalled();
    await closed; expect(stopped).toHaveBeenCalledOnce();
  } finally { worker.kill(); rmSync(root, { recursive: true, force: true }); }
});
