import type { ExecutionHandle, StreamEvent, TurnInput } from '../../../core/types.js';
import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';
import type { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig, RemoteProviderInstanceConfig } from '../../cli/config.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import {
  ManagedExecutionHandle,
  type ManagedExecutionLifecycleReason,
} from '../../../core/runtime/ManagedExecutionHandle.js';
import { buildAgentAdapter } from '../adapters/registry.js';
import type {
  AgentBackendOptions,
  AgentBackendStatus,
  AgentAdapter,
} from '../types.js';
import { AGENT_PROVIDER_CAPABILITIES } from '../types.js';

function ensureAgentTarget(target: ProviderTargetDescriptor): RemoteProviderInstanceConfig {
  if (target.backend !== 'agent' || !target.remoteInstance) {
    throw new Error(
      `Provider '${target.providerName}' target '${target.backend}/${target.instanceId}' `
      + 'does not resolve to an agent-backed instance',
    );
  }

  return target.remoteInstance;
}

export class AgentBackendManager {
  private readonly handles = new Map<string, ManagedExecutionHandle>();
  private readonly targets = new Map<string, ProviderTargetDescriptor>();

  constructor(
    private readonly config: Pick<CliRuntimeConfig, 'sessionBaseDir'>,
    private readonly registry: SessionRegistry,
    private readonly options: AgentBackendOptions = {},
  ) {}

  get(sessionId: string): ExecutionHandle | undefined {
    return this.handles.get(sessionId);
  }

  isAttached(sessionId: string): boolean {
    return this.handles.get(sessionId)?.active === true;
  }

  getCapabilities() {
    return AGENT_PROVIDER_CAPABILITIES;
  }

  spawn(
    sessionId: string,
    target: ProviderTargetDescriptor,
  ): ExecutionHandle {
    const existing = this.handles.get(sessionId);
    if (existing?.active) {
      return existing;
    }

    const handle = new ManagedExecutionHandle({
      streamMessage: (input, signal) => this.streamTurn(sessionId, target, input, signal),
      onCancel: async (input) => {
        await this.cancelRemoteSession(sessionId, target, input.busy);
      },
      onClose: async () => {
        this.handles.delete(sessionId);
        this.targets.delete(sessionId);
      },
    });

    this.handles.set(sessionId, handle);
    this.targets.set(sessionId, target);
    return handle;
  }

  kill(sessionId: string): void {
    void this.close(sessionId, 'close');
  }

  async cancel(
    sessionId: string,
    reason: ManagedExecutionLifecycleReason = 'cancel',
  ): Promise<void> {
    const handle = this.handles.get(sessionId);
    if (!handle) {
      return;
    }

    await handle.cancel(reason);
  }

  async close(
    sessionId: string,
    reason: ManagedExecutionLifecycleReason = 'close',
  ): Promise<void> {
    const handle = this.handles.get(sessionId);
    if (!handle) {
      return;
    }

    await handle.close(reason);
  }

  killAll(): void {
    for (const sessionId of this.handles.keys()) {
      void this.close(sessionId, 'shutdown').catch(() => {});
    }
  }

  status(): AgentBackendStatus {
    const providers: Record<string, number> = {};
    let active = 0;
    let busy = 0;
    let idle = 0;

    for (const [sessionId, handle] of this.handles.entries()) {
      if (!handle.active) {
        continue;
      }

      active += 1;
      if (handle.busy) {
        busy += 1;
      } else {
        idle += 1;
      }

      const session = this.registry.get(sessionId);
      if (session) {
        providers[session.providerName] = (providers[session.providerName] ?? 0) + 1;
      }
    }

    return {
      active,
      busy,
      idle,
      providers,
    };
  }

  async listModels(
    target: ProviderTargetDescriptor,
  ): Promise<Array<{ id: string; label: string }>> {
    const instance = ensureAgentTarget(target);
    const adapter = this.buildAdapter(instance);
    if (!adapter.listModels) {
      throw new Error(
        `Agent adapter '${adapter.kind}' does not support model discovery for `
        + `${target.providerName}/${target.instanceId}`,
      );
    }

    return adapter.listModels(instance);
  }

  private async *streamTurn(
    sessionId: string,
    target: ProviderTargetDescriptor,
    turn: TurnInput,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const session = this.registry.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const instance = ensureAgentTarget(target);
    const adapter = this.buildAdapter(instance);
    const sessionKey = session.sessionKey || sessionId;
    const model = session.model || instance.model;
    const composedInstructions = mergeRuntimeInstructionLayers(
      turn.skills ?? session.skills,
      session.instructions,
      turn.instructions,
    );

    for await (const event of adapter.invoke({
      sessionId,
      providerName: session.providerName,
      instance,
      model,
      turn: {
        ...turn,
        instructions: composedInstructions,
        context: turn.context || session.context,
        outputDir: turn.outputDir || session.outputDir,
      },
      sessionKey,
      providerSessionId: session.providerSessionId,
      sessionState: session.providerState,
      signal,
    })) {
      if (event.providerSessionId || event.sessionId) {
        this.registry.setProviderSessionId(sessionId, event.providerSessionId || event.sessionId!);
      }
      if (event.providerState !== undefined) {
        this.registry.setProviderState(sessionId, event.providerState);
      }
      if (event.artifacts !== undefined || event.summary !== undefined) {
        this.registry.updateSessionMetadata(sessionId, {
          artifacts: event.artifacts ?? session.artifacts,
          summary: event.summary,
        });
      }
      yield event;
    }
  }

  private buildAdapter(instance: RemoteProviderInstanceConfig): AgentAdapter {
    return buildAgentAdapter(instance, this.options);
  }

  private async cancelRemoteSession(
    sessionId: string,
    target: ProviderTargetDescriptor,
    busy: boolean,
  ): Promise<void> {
    const session = this.registry.get(sessionId);
    const instance = ensureAgentTarget(target);
    const adapter = this.buildAdapter(instance);
    if (!adapter.cancel) {
      return;
    }

    const agentStatus = session?.providerState?.agentSession?.status;
    if (!busy && agentStatus !== 'active') {
      return;
    }

    await adapter.cancel(sessionId, instance, session?.providerState);
  }
}
