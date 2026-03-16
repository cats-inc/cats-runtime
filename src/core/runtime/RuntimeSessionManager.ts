import type {
  ExecutionHandle,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from '../types.js';
import type { RuntimeConfig } from '../config.js';
import type { WorkerPool } from '../../backends/cli/pool/WorkerPool.js';
import type { WorkerProcess } from '../../backends/cli/pool/WorkerProcess.js';
import { resolveProviderTarget } from '../providerCatalog.js';
import type { BackendKind } from '../../backends/cli/config.js';
import { ApiBackendManager } from '../../backends/api/runtime/ApiBackendManager.js';
import { AgentBackendManager } from '../../backends/agent/runtime/AgentBackendManager.js';

type ExecutionEventName = 'event' | 'exit' | 'error';
type ExecutionListener = (...args: unknown[]) => void;

interface PoolExecutionLike {
  alive?: boolean;
  busy?: boolean;
  streamMessage?(message: string | TurnInput): AsyncGenerator<StreamEvent>;
  on?(event: ExecutionEventName, listener: ExecutionListener): unknown;
  off?(event: ExecutionEventName, listener: ExecutionListener): unknown;
}

class CliExecutionHandle implements ExecutionHandle {
  constructor(
    private readonly worker: PoolExecutionLike,
    private readonly onKill: () => void,
  ) {}

  get active(): boolean {
    return this.worker.alive === true;
  }

  get busy(): boolean {
    return this.worker.busy === true;
  }

  streamMessage(message: string | TurnInput): AsyncGenerator<StreamEvent> {
    if (!this.worker.streamMessage) {
      throw new Error('Execution handle does not support streamMessage');
    }
    return this.worker.streamMessage(message);
  }

  kill(): void {
    this.onKill();
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
  constructor(
    private readonly config: RuntimeConfig,
    private readonly pool: WorkerPool,
    private readonly apiBackend?: ApiBackendManager,
    private readonly agentBackend?: AgentBackendManager,
  ) {}

  get(sessionId: string): ExecutionHandle | undefined {
    const worker = this.pool.get(sessionId) as WorkerProcess | undefined;
    if (worker) {
      return new CliExecutionHandle(worker, () => this.pool.kill(sessionId));
    }

    return this.apiBackend?.get(sessionId) || this.agentBackend?.get(sessionId);
  }

  spawn(
    sessionId: string,
    providerName: string,
    opts: ProviderSpawnOptions,
    providerInstanceId?: string,
    providerBackend?: BackendKind,
  ): ExecutionHandle | undefined {
    const target = resolveProviderTarget(
      this.config,
      providerName,
      providerBackend && providerInstanceId
        ? `${providerBackend}/${providerInstanceId}`
        : providerInstanceId,
    );

    if (target.backend === 'cli') {
      const cliInstanceId = !providerInstanceId || providerInstanceId === 'default'
        ? undefined
        : target.instanceId;
      const worker = this.pool.spawn(
        sessionId,
        providerName,
        opts,
        cliInstanceId,
      ) as WorkerProcess | undefined;
      return worker ? new CliExecutionHandle(worker, () => this.pool.kill(sessionId)) : undefined;
    }

    if (target.backend === 'agent') {
      if (!this.agentBackend) {
        throw new Error(`Agent backend is not initialized for '${providerName}'`);
      }
      return this.agentBackend.spawn(sessionId, target);
    }

    return this.apiBackend?.spawn(sessionId, target);
  }

  getCapabilities(
    providerName: string,
    providerInstanceId?: string,
    providerBackend?: BackendKind,
  ): ProviderCapabilities {
    const target = resolveProviderTarget(
      this.config,
      providerName,
      providerBackend && providerInstanceId
        ? `${providerBackend}/${providerInstanceId}`
        : providerInstanceId,
    );

    if (target.backend === 'cli') {
      return this.pool.getCapabilities(providerName, target.instanceId);
    }

    if (target.backend === 'agent') {
      if (!this.agentBackend) {
        throw new Error(`Agent backend is not initialized for '${providerName}'`);
      }
      return this.agentBackend.getCapabilities();
    }

    if (!this.apiBackend) {
      throw new Error(`API backend is not initialized for '${providerName}'`);
    }

    return this.apiBackend.getCapabilities();
  }

  isAttached(sessionId: string): boolean {
    if (this.agentBackend?.isAttached(sessionId)) {
      return true;
    }
    if (this.apiBackend?.isAttached(sessionId)) {
      return true;
    }
    if (typeof this.pool.isAttached === 'function') {
      return this.pool.isAttached(sessionId);
    }
    const worker = this.pool.get(sessionId) as PoolExecutionLike | undefined;
    return worker?.alive === true;
  }

  kill(sessionId: string): void {
    this.agentBackend?.kill(sessionId);
    this.apiBackend?.kill(sessionId);
    this.pool.kill(sessionId);
  }

  killAll(): void {
    this.agentBackend?.killAll();
    this.apiBackend?.killAll();
    this.pool.killAll();
  }

  status() {
    const cliStatus = this.pool.status();
    const apiStatus = this.apiBackend?.status();
    const agentStatus = this.agentBackend?.status();

    if (!apiStatus && !agentStatus) {
      return cliStatus;
    }

    const providers = { ...cliStatus.providers };
    for (const backendStatus of [apiStatus, agentStatus]) {
      if (!backendStatus) continue;
      for (const [providerName, count] of Object.entries(backendStatus.providers)) {
        providers[providerName] = (providers[providerName] ?? 0) + count;
      }
    }

    return {
      ...cliStatus,
      active: cliStatus.active + (apiStatus?.active ?? 0) + (agentStatus?.active ?? 0),
      busy: cliStatus.busy + (apiStatus?.busy ?? 0) + (agentStatus?.busy ?? 0),
      idle: cliStatus.idle + (apiStatus?.idle ?? 0) + (agentStatus?.idle ?? 0),
      providers,
      backends: {
        cli: cliStatus,
        ...(apiStatus ? { api: apiStatus } : {}),
        ...(agentStatus ? { agent: agentStatus } : {}),
      },
    };
  }
}
