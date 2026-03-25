import type { ProviderTargetDescriptor } from '../../../../core/providerCatalog.js';
import type { RuntimeExecutionStrategyRequest, StreamEvent } from '../../../../core/types.js';
import type { RuntimeExecutionStrategyResolution } from '../../../../core/runtime/strategies/resolution.js';
import type { SessionRegistry } from '../../../cli/pool/SessionRegistry.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type {
  ApiConversationMessage,
  ApiToolCallPart,
  ApiTransportClient,
} from '../../types.js';
import type { LocalToolRuntime } from '../../../../core/tools/LocalToolRuntime.js';
import type { SessionInfo } from '../../../cli/pool/types.js';

export interface ApiRuntimeStrategyConstraints {
  stepLimit: number;
  timeoutMs?: number;
  stuckThreshold: number;
}

export interface ApiStrategyExecutionContextOptions {
  session: SessionInfo;
  registry: SessionRegistry;
  target: ProviderTargetDescriptor;
  remoteInstance: RemoteProviderInstanceConfig;
  transport: ApiTransportClient;
  tools: LocalToolRuntime;
  toolProfile?: string;
  permissionMode: SessionInfo['permissionMode'];
  request: RuntimeExecutionStrategyRequest | undefined;
  resolution: RuntimeExecutionStrategyResolution;
  requestBodyPatch?: Record<string, unknown>;
  model: string;
  conversation: ApiConversationMessage[];
  signal: AbortSignal;
  constraints: ApiRuntimeStrategyConstraints;
  emitLifecycleEvents: boolean;
}

export interface ApiCompletedModelStep {
  initEvent?: StreamEvent;
  progressEvents: StreamEvent[];
  textEvents: StreamEvent[];
  toolCalls: ApiToolCallPart[];
}

export interface ApiExecutedToolBatch {
  toolUseEvents: StreamEvent[];
  toolResultEvents: StreamEvent[];
  signatures: string[];
}
