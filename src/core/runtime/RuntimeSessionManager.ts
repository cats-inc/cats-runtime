import type {
  ExecutionHandle,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from '../types.js';
import type { WorkerPool } from '../../backends/cli/pool/WorkerPool.js';
import type { WorkerProcess } from '../../backends/cli/pool/WorkerProcess.js';

type ExecutionEventName = 'event' | 'exit' | 'error';
type ExecutionListener = (...args: unknown[]) => void;

interface PoolExecutionLike {
  alive?: boolean;
  busy?: boolean;
  streamMessage?(message: string): AsyncGenerator<StreamEvent>;
  on?(event: ExecutionEventName, listener: ExecutionListener): unknown;
  off?(event: ExecutionEventName, listener: ExecutionListener): unknown;
}

class CliExecutionHandle implements ExecutionHandle {
  constructor(private readonly worker: PoolExecutionLike) {}

  get active(): boolean {
    return this.worker.alive === true;
  }

  get busy(): boolean {
    return this.worker.busy === true;
  }

  streamMessage(message: string): AsyncGenerator<StreamEvent> {
    if (!this.worker.streamMessage) {
      throw new Error('Execution handle does not support streamMessage');
    }
    return this.worker.streamMessage(message);
  }

  kill(): void {
    // Route-level shutdown still goes through the manager/pool. A handle kill
    // hook can be added later if routes need direct control.
  }

  on(event: ExecutionEventName, listener: ExecutionListener): this {
    this.worker.on?.(event, listener);
    return this;
  }

  off(event: ExecutionEventName, listener: ExecutionListener): this {
    this.worker.off?.(event, listener);
    return this;
  }
}

export class RuntimeSessionManager {
  constructor(private readonly pool: WorkerPool) {}

  get(sessionId: string): ExecutionHandle | undefined {
    const worker = this.pool.get(sessionId) as WorkerProcess | undefined;
    return worker ? new CliExecutionHandle(worker) : undefined;
  }

  spawn(
    sessionId: string,
    providerName: string,
    opts: ProviderSpawnOptions,
    providerInstanceId?: string,
  ): ExecutionHandle | undefined {
    const worker = this.pool.spawn(
      sessionId,
      providerName,
      opts,
      providerInstanceId,
    ) as WorkerProcess | undefined;
    return worker ? new CliExecutionHandle(worker) : undefined;
  }

  getCapabilities(providerName: string, providerInstanceId?: string): ProviderCapabilities {
    return this.pool.getCapabilities(providerName, providerInstanceId);
  }

  isAttached(sessionId: string): boolean {
    if (typeof this.pool.isAttached === 'function') {
      return this.pool.isAttached(sessionId);
    }
    const worker = this.pool.get(sessionId) as PoolExecutionLike | undefined;
    return worker?.alive === true;
  }

  kill(sessionId: string): void {
    this.pool.kill(sessionId);
  }

  killAll(): void {
    this.pool.killAll();
  }

  status() {
    return this.pool.status();
  }
}
