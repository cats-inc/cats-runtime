import { randomUUID } from 'node:crypto';
import type {
  AgentRuntimeService,
  ExecutionHandle,
  RuntimeEventExcerpt,
  RuntimeGuardrailResult,
  RuntimeProgressSnapshot,
  ProviderCapabilities,
  ProviderSpawnOptions,
  RuntimeRateLimitIncident,
  RuntimeRunInspection,
  RuntimeRunStatus,
  RuntimeSessionExecutionState,
  RuntimeUsageSignal,
  RuntimeWakeReason,
  SessionInfo,
  StreamEvent,
  TurnInput,
} from '../types.js';
import type { RuntimeConfig } from '../config.js';
import { asRecord, readNumber, readString } from '../usage/utils.js';
import type { WorkerPool } from '../../backends/cli/pool/WorkerPool.js';
import type { WorkerProcess } from '../../backends/cli/pool/WorkerProcess.js';
import { resolveProviderTarget } from '../providerCatalog.js';
import type { BackendKind } from '../../backends/cli/config.js';
import { ApiBackendManager } from '../../backends/api/runtime/ApiBackendManager.js';
import { AgentBackendManager } from '../../backends/agent/runtime/AgentBackendManager.js';

type ExecutionEventName = 'event' | 'exit' | 'error';
type ExecutionListener = (...args: unknown[]) => void;
const MAX_RECENT_EVENTS = 12;

interface PoolExecutionLike {
  alive?: boolean;
  busy?: boolean;
  streamMessage?(message: string | TurnInput): AsyncGenerator<StreamEvent>;
  on?(event: ExecutionEventName, listener: ExecutionListener): unknown;
  off?(event: ExecutionEventName, listener: ExecutionListener): unknown;
}

export interface RuntimeTrackedSessionStateSnapshot {
  state: RuntimeSessionExecutionState;
  wake: RuntimeWakeReason | null;
  currentRun?: RuntimeRunInspection;
  lastRun?: RuntimeRunInspection;
  progress?: RuntimeProgressSnapshot;
  recentEvents: RuntimeEventExcerpt[];
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
  private readonly sessionStates = new Map<string, RuntimeTrackedSessionStateSnapshot>();

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

  beginRun(
    session: SessionInfo,
    turn: TurnInput,
    options: {
      guardrail?: RuntimeGuardrailResult;
    } = {},
  ): RuntimeRunInspection {
    const tracked = this.ensureTrackedState(session.id);
    const wake = extractWakeReason(turn.context || session.context);
    const startedAt = new Date().toISOString();
    const run: RuntimeRunInspection = {
      id: randomUUID(),
      status: 'running',
      startedAt,
      wake,
      inputPreview: summarizeInput(turn.message),
      ...(options.guardrail ? { guardrail: options.guardrail } : {}),
    };

    tracked.state = 'running';
    tracked.wake = wake;
    tracked.currentRun = run;
    return cloneRun(run);
  }

  recordRejectedRun(
    session: SessionInfo,
    turn: TurnInput,
    guardrail: RuntimeGuardrailResult,
  ): RuntimeRunInspection {
    const tracked = this.ensureTrackedState(session.id);
    const wake = extractWakeReason(turn.context || session.context);
    const now = new Date().toISOString();
    const status: RuntimeRunStatus = guardrail.outcome === 'cooldown' ? 'cooldown' : 'blocked';
    const progress = guardrailToProgressSnapshot(guardrail, now);
    const run: RuntimeRunInspection = {
      id: randomUUID(),
      status,
      startedAt: now,
      endedAt: now,
      wake,
      inputPreview: summarizeInput(turn.message),
      resultSummary: guardrail.reason,
      guardrail,
      ...(progress ? { progress } : {}),
    };

    tracked.state = this.isAttached(session.id) ? 'idle' : 'closed';
    tracked.wake = wake;
    tracked.progress = progress;
    tracked.currentRun = undefined;
    tracked.lastRun = run;
    this.pushRecentEvent(tracked, {
      observedAt: now,
      eventType: 'progress',
      text: guardrail.reason,
      kind: 'guardrail',
      status: guardrail.action === 'cooldown'
        ? 'cooldown'
        : guardrail.action === 'block'
          ? 'blocked'
          : 'warned',
    });
    return cloneRun(run);
  }

  observeEvent(sessionId: string, event: StreamEvent): void {
    const tracked = this.ensureTrackedState(sessionId);
    const observedAt = new Date().toISOString();
    const progress = eventToProgressSnapshot(event, observedAt);
    if (progress) {
      tracked.progress = progress;
      if (tracked.currentRun) {
        tracked.currentRun.progress = progress;
      }
    }

    const excerpt = eventToExcerpt(event, observedAt);
    if (excerpt) {
      this.pushRecentEvent(tracked, excerpt);
    }

    const currentRun = tracked.currentRun;
    if (!currentRun) {
      return;
    }

    currentRun.providerSessionId = event.providerSessionId || event.sessionId || currentRun.providerSessionId;
    if (event.summary) {
      currentRun.resultSummary = event.summary;
    }
    if (event.artifacts) {
      currentRun.artifacts = cloneArtifacts(event.artifacts);
    }
    if (event.services) {
      currentRun.services = cloneServices(event.services);
    }

    const metadata = asRecord(event.metadata);
    const incident = asRuntimeIncident(metadata?.incident);
    if (incident) {
      currentRun.incident = incident;
    }
    const guardrail = asRuntimeGuardrail(metadata?.guardrail);
    if (guardrail) {
      currentRun.guardrail = guardrail;
    }

    const usage = extractRuntimeUsageSignal(event);
    if (usage) {
      currentRun.usage = usage;
    }

    if (event.type === 'result') {
      this.finalizeCurrentRun(sessionId, tracked, 'succeeded', observedAt, {
        resultSummary: event.summary,
      });
      return;
    }

    if (event.type === 'error') {
      this.finalizeCurrentRun(
        sessionId,
        tracked,
        tracked.state === 'canceling' || tracked.state === 'closing' || looksLikeAbort(event.text)
          ? 'canceled'
          : 'failed',
        observedAt,
        {
          error: event.text,
        },
      );
    }
  }

  getTrackedState(sessionId: string): RuntimeTrackedSessionStateSnapshot | undefined {
    const tracked = this.sessionStates.get(sessionId);
    return tracked ? cloneTrackedState(tracked) : undefined;
  }

  async cancel(session: SessionInfo): Promise<{ attached: boolean }> {
    const tracked = this.ensureTrackedState(session.id);
    tracked.state = 'canceling';

    switch (session.providerBackend) {
      case 'agent':
        await this.agentBackend?.cancel(session.id, 'cancel');
        break;
      case 'api':
      case 'local':
        await this.apiBackend?.cancel(session.id, 'cancel');
        break;
      case 'cli':
      default:
        this.pool.cancel(session.id);
        break;
    }

    return {
      attached: this.isAttached(session.id),
    };
  }

  async close(
    session: SessionInfo,
    reason: 'close' | 'delete' | 'reset' | 'shutdown' = 'close',
  ): Promise<void> {
    const tracked = this.ensureTrackedState(session.id);
    tracked.state = 'closing';

    switch (session.providerBackend) {
      case 'agent':
        await this.agentBackend?.close(session.id, reason);
        break;
      case 'api':
      case 'local':
        await this.apiBackend?.close(session.id, reason);
        break;
      case 'cli':
      default:
        this.pool.kill(session.id);
        break;
    }

    if (!this.isAttached(session.id)) {
      tracked.state = 'closed';
    }
  }

  markClosed(sessionId: string): void {
    const tracked = this.ensureTrackedState(sessionId);
    tracked.state = 'closed';
  }

  clearProviderState(sessionId: string): void {
    const tracked = this.ensureTrackedState(sessionId);
    tracked.state = this.isAttached(sessionId) ? 'idle' : 'closed';
  }

  dropSession(sessionId: string): void {
    this.sessionStates.delete(sessionId);
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
    this.markClosed(sessionId);
  }

  killAll(): void {
    this.agentBackend?.killAll();
    this.apiBackend?.killAll();
    this.pool.killAll();
    for (const sessionId of this.sessionStates.keys()) {
      this.markClosed(sessionId);
    }
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

  private ensureTrackedState(sessionId: string): RuntimeTrackedSessionStateSnapshot {
    let tracked = this.sessionStates.get(sessionId);
    if (!tracked) {
      tracked = {
        state: 'idle',
        wake: null,
        recentEvents: [],
      };
      this.sessionStates.set(sessionId, tracked);
    }
    return tracked;
  }

  private finalizeCurrentRun(
    sessionId: string,
    tracked: RuntimeTrackedSessionStateSnapshot,
    status: RuntimeRunStatus,
    endedAt: string,
    patch: {
      resultSummary?: string;
      error?: string;
    } = {},
  ): void {
    if (!tracked.currentRun) {
      return;
    }

    tracked.currentRun = {
      ...tracked.currentRun,
      status,
      endedAt,
      ...(patch.resultSummary !== undefined ? { resultSummary: patch.resultSummary } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
    };
    tracked.lastRun = cloneRun(tracked.currentRun);
    tracked.currentRun = undefined;
    tracked.state = this.isAttached(sessionId) ? 'idle' : 'closed';
  }

  private pushRecentEvent(
    tracked: RuntimeTrackedSessionStateSnapshot,
    excerpt: RuntimeEventExcerpt,
  ): void {
    tracked.recentEvents.push(excerpt);
    if (tracked.recentEvents.length > MAX_RECENT_EVENTS) {
      tracked.recentEvents.splice(0, tracked.recentEvents.length - MAX_RECENT_EVENTS);
    }
  }
}

function extractWakeReason(
  context: SessionInfo['context'] | TurnInput['context'],
): RuntimeWakeReason | null {
  if (!context) {
    return null;
  }

  return {
    source: context.source,
    reason: context.reason,
    taskId: context.taskId,
    issueId: context.issueId,
    commentId: context.commentId,
    approvalId: context.approvalId,
    ...(context.labels ? { labels: [...context.labels] } : {}),
    ...(context.metadata ? { metadata: { ...context.metadata } } : {}),
  };
}

function summarizeInput(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function eventToProgressSnapshot(
  event: StreamEvent,
  observedAt: string,
): RuntimeProgressSnapshot | undefined {
  const metadata = asRecord(event.metadata);
  const kind = readString(metadata?.kind);
  const status = readString(metadata?.status);

  if (
    event.type !== 'progress'
    && event.type !== 'text'
    && event.type !== 'tool_use'
    && event.type !== 'tool_result'
    && event.type !== 'result'
    && event.type !== 'error'
  ) {
    return undefined;
  }

  return {
    updatedAt: observedAt,
    eventType: event.type,
    text: event.text,
    summary: event.summary,
    toolName: event.toolName,
    toolId: event.toolId,
    isError: event.isError,
    ...(kind ? { kind: kind as RuntimeProgressSnapshot['kind'] } : {}),
    ...(status ? { status: status as RuntimeProgressSnapshot['status'] } : {}),
    ...(metadata ? { metadata: { ...metadata } } : {}),
  };
}

function eventToExcerpt(
  event: StreamEvent,
  observedAt: string,
): RuntimeEventExcerpt | undefined {
  const progress = eventToProgressSnapshot(event, observedAt);
  if (!progress) {
    return undefined;
  }

  return {
    observedAt,
    eventType: progress.eventType,
    text: progress.text,
    summary: progress.summary,
    toolName: progress.toolName,
    toolId: progress.toolId,
    isError: progress.isError,
    kind: progress.kind,
    status: progress.status,
  };
}

function guardrailToProgressSnapshot(
  guardrail: RuntimeGuardrailResult,
  observedAt: string,
): RuntimeProgressSnapshot {
  return {
    updatedAt: observedAt,
    eventType: 'progress',
    text: guardrail.reason,
    kind: 'guardrail',
    status: guardrail.action === 'cooldown'
      ? 'cooldown'
      : guardrail.action === 'block'
        ? 'blocked'
        : 'warned',
  };
}

function cloneTrackedState(
  tracked: RuntimeTrackedSessionStateSnapshot,
): RuntimeTrackedSessionStateSnapshot {
  return {
    state: tracked.state,
    wake: tracked.wake ? { ...tracked.wake, ...(tracked.wake.labels ? { labels: [...tracked.wake.labels] } : {}) } : null,
    ...(tracked.currentRun ? { currentRun: cloneRun(tracked.currentRun) } : {}),
    ...(tracked.lastRun ? { lastRun: cloneRun(tracked.lastRun) } : {}),
    ...(tracked.progress ? { progress: { ...tracked.progress, ...(tracked.progress.metadata ? { metadata: { ...tracked.progress.metadata } } : {}) } } : {}),
    recentEvents: tracked.recentEvents.map((event) => ({ ...event })),
  };
}

function cloneRun(run: RuntimeRunInspection): RuntimeRunInspection {
  return {
    ...run,
    ...(run.wake ? { wake: { ...run.wake, ...(run.wake.labels ? { labels: [...run.wake.labels] } : {}) } } : {}),
    ...(run.progress ? { progress: { ...run.progress, ...(run.progress.metadata ? { metadata: { ...run.progress.metadata } } : {}) } } : {}),
    ...(run.usage ? { usage: { ...run.usage } } : {}),
    ...(run.guardrail ? { guardrail: { ...run.guardrail, ...(run.guardrail.metadata ? { metadata: { ...run.guardrail.metadata } } : {}) } } : {}),
    ...(run.incident ? { incident: { ...run.incident, ...(run.incident.metadata ? { metadata: { ...run.incident.metadata } } : {}) } } : {}),
    ...(run.artifacts ? { artifacts: cloneArtifacts(run.artifacts) } : {}),
    ...(run.services ? { services: cloneServices(run.services) } : {}),
  };
}

function cloneArtifacts(
  artifacts: SessionInfo['artifacts'],
): SessionInfo['artifacts'] {
  return artifacts?.map((artifact) => ({
    ...artifact,
    ...(artifact.metadata ? { metadata: { ...artifact.metadata } } : {}),
  }));
}

function cloneServices(
  services: AgentRuntimeService[] | undefined,
): AgentRuntimeService[] | undefined {
  return services?.map((service) => ({
    ...service,
    ...(service.metadata ? { metadata: { ...service.metadata } } : {}),
  }));
}

function extractRuntimeUsageSignal(
  event: StreamEvent,
): RuntimeUsageSignal | undefined {
  const metadata = asRecord(event.metadata);
  const runtimeUsage = asRecord(metadata?.runtimeUsage);
  const inputTokens = event.usage?.inputTokens;
  const outputTokens = event.usage?.outputTokens;
  const totalTokens = readNumber(runtimeUsage?.totalTokens)
    ?? event.usage?.totalTokens
    ?? (
      typeof inputTokens === 'number' || typeof outputTokens === 'number'
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined
    );
  const estimatedCost = readNumber(runtimeUsage?.estimatedCost) ?? event.usage?.estimatedCost;
  const latencyMs = readNumber(runtimeUsage?.latencyMs) ?? event.usage?.latencyMs;
  const currency = readString(runtimeUsage?.currency) ?? event.usage?.currency;
  const sourceConfidence = readString(runtimeUsage?.sourceConfidence) ?? event.usage?.sourceConfidence;

  if (
    totalTokens === undefined
    && estimatedCost === undefined
    && latencyMs === undefined
    && currency === undefined
    && sourceConfidence === undefined
  ) {
    return undefined;
  }

  return {
    totalTokens,
    estimatedCost,
    latencyMs,
    currency,
    sourceConfidence: sourceConfidence as RuntimeUsageSignal['sourceConfidence'],
  };
}

function looksLikeAbort(text: string | undefined): boolean {
  if (!text) {
    return false;
  }

  return /abort|aborted|cancel|cancelled|canceled|signal/i.test(text);
}

function asRuntimeIncident(value: unknown): RuntimeRateLimitIncident | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const id = readString(record.id);
  const provider = readString(record.provider);
  const instance = readString(record.instance);
  const backend = readString(record.backend);
  const classification = readString(record.classification);
  const scope = readString(record.scope);
  const observedAt = readString(record.observedAt);
  if (!id || !provider || !instance || !backend || !classification || !scope || !observedAt) {
    return undefined;
  }

  return {
    id,
    provider,
    instance,
    backend: backend as RuntimeRateLimitIncident['backend'],
    classification: classification as RuntimeRateLimitIncident['classification'],
    scope: scope as RuntimeRateLimitIncident['scope'],
    observedAt,
    ...(readString(record.sessionId) ? { sessionId: readString(record.sessionId) } : {}),
    ...(readString(record.providerSessionId) ? { providerSessionId: readString(record.providerSessionId) } : {}),
    ...(readString(record.workspaceKey) ? { workspaceKey: readString(record.workspaceKey) } : {}),
    ...(readNumber(record.retryAfterMs) !== undefined ? { retryAfterMs: readNumber(record.retryAfterMs) } : {}),
    ...(readString(record.retryAt) ? { retryAt: readString(record.retryAt) } : {}),
    ...(readString(record.evidenceSummary) ? { evidenceSummary: readString(record.evidenceSummary) } : {}),
    ...(asRecord(record.metadata) ? { metadata: { ...asRecord(record.metadata)! } } : {}),
  };
}

function asRuntimeGuardrail(value: unknown): RuntimeGuardrailResult | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const outcome = readString(record.outcome);
  const scope = readString(record.scope);
  const metric = readString(record.metric);
  const action = readString(record.action);
  const observedAt = readString(record.observedAt);
  const reason = readString(record.reason);
  if (!outcome || !scope || !metric || !action || !observedAt || !reason) {
    return undefined;
  }

  return {
    outcome: outcome as RuntimeGuardrailResult['outcome'],
    scope: scope as RuntimeGuardrailResult['scope'],
    metric: metric as RuntimeGuardrailResult['metric'],
    action: action as RuntimeGuardrailResult['action'],
    observedAt,
    reason,
    ...(readString(record.provider) ? { provider: readString(record.provider) } : {}),
    ...(readString(record.instance) ? { instance: readString(record.instance) } : {}),
    ...(readString(record.backend) ? { backend: readString(record.backend) as RuntimeGuardrailResult['backend'] } : {}),
    ...(readString(record.sessionId) ? { sessionId: readString(record.sessionId) } : {}),
    ...(readString(record.workspaceKey) ? { workspaceKey: readString(record.workspaceKey) } : {}),
    ...(readNumber(record.threshold) !== undefined ? { threshold: readNumber(record.threshold) } : {}),
    ...(readNumber(record.currentValue) !== undefined ? { currentValue: readNumber(record.currentValue) } : {}),
    ...(readString(record.cooldownUntil) ? { cooldownUntil: readString(record.cooldownUntil) } : {}),
    ...(readString(record.incidentId) ? { incidentId: readString(record.incidentId) } : {}),
    ...(asRecord(record.metadata) ? { metadata: { ...asRecord(record.metadata)! } } : {}),
  };
}
