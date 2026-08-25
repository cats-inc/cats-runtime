import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import type {
  AgentProcessSpawner,
  AgentSpawnedProcess,
} from '../../src/backends/agent/types.js';

/**
 * A stdio ACP agent that never leaves the process.
 *
 * Adapter unit tests and route tests both need one, and an ACP agent is a
 * protocol peer rather than a stub: the same fake serves both so the route
 * cannot drift onto a looser handshake than the adapter is tested against.
 */
export class FakeAcpProcess extends EventEmitter implements AgentSpawnedProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0, null);
    return true;
  }
}

export function startFakeAcpServer(
  process: FakeAcpProcess,
  onMessage: (message: Record<string, unknown>) => void | Promise<void>,
): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    void onMessage(JSON.parse(line) as Record<string, unknown>);
  });
}

export function createFakeAcpSpawner(process: FakeAcpProcess): AgentProcessSpawner {
  return () => process;
}
