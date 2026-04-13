import { randomUUID } from 'node:crypto';
import type {
  AgentRuntimeService,
  ExecutionHandle,
  RuntimeEventExcerpt,
  RuntimeGuardrailResult,
  RuntimeSessionCompactionRecord,
  RuntimeSessionMaintenanceFollowThrough,
  RuntimeSessionMaintenanceRequest,
  RuntimeSessionLifecycleAction,
  RuntimeSessionLifecycleCleanupSummary,
  RuntimeSessionLifecycleContract,
  RuntimeSessionMaintenanceMarker,
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
import { extractWakeReason } from './wakeReason.js';
import {
  cloneMaintenanceFollowThrough,
  cloneMaintenanceRequest,
  type RuntimeTrackedSessionMaintenanceState,
} from './sessionMaintenance.js';

type ExecutionEventName = 'event' | 'exit' | 'error';
type ExecutionListener = (...args: unknown[]) => void;
const MAX_RECENT_EVENTS = 12;
const MAX_MAINTENANCE_MARKERS = 12;
const MAX_MAINTENANCE_HISTORY_ENTRIES = 12;
const MAX_STREAM_REPLAY_EVENTS = 128;

interface PoolExecutionLike {
  alive?: boolean;
  busy?: boolean;
  streamMessage?(message: string | TurnInput): AsyncGenerator<StreamEvent>;
  on?(event: ExecutionEventName, listener: ExecutionListener): unknown;
  off?(event: ExecutionEventName, listener: ExecutionListener): unknown;
}

export interface RuntimeObservedStreamEventEntry {
  seq: number;
  event: StreamEvent;
}

type RuntimeObservedStreamListener = (entry: RuntimeObservedStreamEventEntry) => void;

interface RuntimeObservedStreamState {
  nextSeq: number;
  entries: RuntimeObservedStreamEventEntry[];
  listeners: Set<RuntimeObservedStreamListener>;
  updatedAt: string | null;
  terminal: boolean;
}

export interface RuntimeTrackedSessionStateSnapshot {
  state: RuntimeSessionExecutionState;
  wake: RuntimeWakeReason | null;
  maintenance: RuntimeTrackedSessionMaintenanceState;
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

  private readonly handleOverrides = new Map<string, ExecutionHandle>();

  private readonly observedStreamStates = new Map<string, RuntimeObservedStreamState>();

  constructor(
    private readonly config: RuntimeConfig,
    private readonly pool: WorkerPool,
    private readonly apiBackend?: ApiBackendManager,
    private readonly agentBackend?: AgentBackendManager,
  ) {}

  get(sessionId: string): ExecutionHandle | undefined {
    const override = this.getOverride(sessionId);
    if (override) {
      return override;
    }

    const worker = this.pool.get(sessionId) as WorkerProcess | undefined;
    if (worker) {
      return new CliExecutionHandle(worker, () => this.pool.kill(sessionId));
    }

    return this.apiBackend?.get(sessionId) || this.agentBackend?.get(sessionId);
  }

  attachExecutionHandle(
    sessionId: string,
    handle: ExecutionHandle,
  ): ExecutionHandle {
    this.handleOverrides.set(sessionId, handle);
    return handle;
  }

  detachExecutionHandle(
    sessionId: string,
    handle?: ExecutionHandle,
  ): void {
    const existing = this.handleOverrides.get(sessionId);
    if (!existing) {
      return;
    }

    if (handle && existing !== handle) {
      return;
    }

    this.handleOverrides.delete(sessionId);
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

    this.resetObservedStreamState(session.id);
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

    this.clearObservedStreamState(session.id);
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
    this.recordObservedStreamEvent(sessionId, event, observedAt);
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

  subscribeObservedStream(
    sessionId: string,
    listener: RuntimeObservedStreamListener,
  ): () => void {
    const state = this.ensureObservedStreamState(sessionId);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  getObservedStreamReplay(
    sessionId: string,
  ): RuntimeObservedStreamEventEntry[] {
    const state = this.observedStreamStates.get(sessionId);
    if (!state || state.entries.length === 0) {
      return [];
    }

    const tracked = this.sessionStates.get(sessionId);
    if (tracked?.currentRun || !state.terminal) {
      return state.entries.map(cloneObservedStreamEntry);
    }

    return [];
  }

  async cancel(session: SessionInfo): Promise<{ attached: boolean }> {
    const tracked = this.ensureTrackedState(session.id);
    tracked.state = 'canceling';

    const override = this.getOverride(session.id);
    if (override) {
      await this.cancelExecutionHandle(override, 'cancel');
      this.detachExecutionHandle(session.id, override);
      tracked.state = this.isAttached(session.id) ? 'idle' : 'closed';
      return {
        attached: this.isAttached(session.id),
      };
    }

    try {
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
    } catch {
      await this.close(session, 'close');
      return {
        attached: this.isAttached(session.id),
      };
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

    const override = this.getOverride(session.id);
    if (override) {
      await this.closeExecutionHandle(override, reason);
      this.detachExecutionHandle(session.id, override);
    }

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
    this.detachExecutionHandle(sessionId);
    const tracked = this.ensureTrackedState(sessionId);
    this.clearObservedStreamState(sessionId);
    tracked.state = 'closed';
  }

  recordMaintenanceRequest(
    request: RuntimeSessionMaintenanceRequest,
  ): RuntimeSessionMaintenanceRequest {
    const tracked = this.ensureTrackedState(request.sessionId);
    const sanitizedRequest = cloneMaintenanceRequest(request);
    tracked.maintenance.lastRequest = sanitizedRequest;
    tracked.maintenance.requestHistory = appendMaintenanceHistory(
      tracked.maintenance.requestHistory,
      sanitizedRequest,
      cloneMaintenanceRequest,
    );
    this.pushMaintenanceMarker(tracked, {
      code: `${request.action}_requested`,
      observedAt: request.requestedAt,
      status: 'observed',
      details: {
        isolationMode: request.isolationMode,
        ...(request.worktreeDisposition
          ? { worktreeDisposition: request.worktreeDisposition }
          : {}),
        ...(sanitizedRequest.reason ? { reason: sanitizedRequest.reason } : {}),
        ...(sanitizedRequest.reasonTruncated ? { reasonTruncated: true } : {}),
        hookPayloadKinds: request.hookPayloads.map((payload) => payload.kind),
      },
    });
    return cloneMaintenanceRequest(sanitizedRequest);
  }

  recordMaintenanceFollowThrough(
    followThrough: RuntimeSessionMaintenanceFollowThrough,
  ): RuntimeSessionMaintenanceFollowThrough {
    const tracked = this.ensureTrackedState(followThrough.sessionId);
    const sanitizedFollowThrough = cloneMaintenanceFollowThrough(followThrough);
    tracked.maintenance.lastFollowThrough = sanitizedFollowThrough;
    tracked.maintenance.followThroughHistory = appendMaintenanceHistory(
      tracked.maintenance.followThroughHistory,
      sanitizedFollowThrough,
      cloneMaintenanceFollowThrough,
    );
    this.pushMaintenanceMarker(tracked, {
      code: `${followThrough.action}_follow_through_${followThrough.outcome}`,
      observedAt: followThrough.observedAt,
      status: followThrough.outcome === 'completed' ? 'completed' : 'observed',
      details: {
        phase: followThrough.phase,
        ...(sanitizedFollowThrough.reason ? { reason: sanitizedFollowThrough.reason } : {}),
        ...(sanitizedFollowThrough.reasonTruncated ? { reasonTruncated: true } : {}),
        hookPayloadKinds: sanitizedFollowThrough.hookPayloads.map((payload) => payload.kind),
      },
    });
    return cloneMaintenanceFollowThrough(sanitizedFollowThrough);
  }

  clearProviderState(sessionId: string): void {
    const tracked = this.ensureTrackedState(sessionId);
    tracked.state = this.isAttached(sessionId) ? 'idle' : 'closed';
  }

  recordLifecycle(
    sessionId: string,
    input: {
      action: RuntimeSessionLifecycleAction;
      boundary: RuntimeSessionLifecycleContract['boundary'];
      status: RuntimeSessionLifecycleContract['status'];
      observedAt?: string;
      reasonCodes?: string[];
      cleanup?: RuntimeSessionLifecycleCleanupSummary;
      clearExecutionState?: boolean;
    },
  ): RuntimeSessionLifecycleContract {
    const tracked = this.ensureTrackedState(sessionId);
    const observedAt = input.observedAt || new Date().toISOString();

    if (tracked.currentRun) {
      this.finalizeCurrentRun(sessionId, tracked, 'canceled', observedAt, {
        resultSummary: buildLifecycleRunSummary(input.action),
      });
    }

    if (input.clearExecutionState) {
      tracked.currentRun = undefined;
      tracked.lastRun = undefined;
      tracked.progress = undefined;
      tracked.recentEvents = [];
      tracked.wake = null;
      tracked.state = this.isAttached(sessionId) ? 'idle' : 'closed';
      this.clearObservedStreamState(sessionId);
    }

    const lifecycle: RuntimeSessionLifecycleContract = {
      action: input.action,
      boundary: input.boundary,
      status: input.status,
      observedAt,
      reasonCodes: [...(input.reasonCodes || [])],
      cleanup: {
        ...(input.cleanup || {}),
        ...(input.clearExecutionState ? { runStateCleared: true } : {}),
      },
    };

    tracked.maintenance.lastLifecycle = lifecycle;
    if (input.action === 'reset' && input.status === 'completed') {
      tracked.maintenance.lastResetAt = observedAt;
    }

    this.pushMaintenanceMarker(tracked, {
      code: `${input.action}_${input.status}`,
      observedAt,
      status: input.status === 'completed' ? 'completed' : 'observed',
      details: {
        boundary: input.boundary,
        reasonCodes: lifecycle.reasonCodes,
      },
    });

    return cloneLifecycle(lifecycle);
  }

  recordCompaction(
    sessionId: string,
    record: RuntimeSessionCompactionRecord,
  ): RuntimeSessionCompactionRecord {
    const tracked = this.ensureTrackedState(sessionId);
    tracked.maintenance.lastCompaction = cloneCompactionRecord(record);
    this.pushMaintenanceMarker(tracked, {
      code: 'compact_completed',
      observedAt: record.compactedAt,
      status: 'completed',
      details: {
        transcriptPath: record.transcriptPath,
        compactedEntryCount: record.compactedEntryCount,
        retainedEntryCount: record.retainedEntryCount,
        repairedLineCount: record.repairedLineCount,
        aggressivePassCount: record.aggressivePassCount,
        ...(record.archivePath ? { archivePath: record.archivePath } : {}),
      },
    });
    return cloneCompactionRecord(record);
  }

  dropSession(sessionId: string): void {
    this.handleOverrides.delete(sessionId);
    this.observedStreamStates.delete(sessionId);
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
    const override = this.getOverride(sessionId);
    if (override) {
      return true;
    }

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
    const override = this.getOverride(sessionId);
    if (override) {
      override.kill();
      this.detachExecutionHandle(sessionId, override);
    }
    this.agentBackend?.kill(sessionId);
    this.apiBackend?.kill(sessionId);
    this.pool.kill(sessionId);
    this.clearObservedStreamState(sessionId);
    this.markClosed(sessionId);
  }

  killAll(): void {
    for (const [sessionId, handle] of this.handleOverrides.entries()) {
      handle.kill();
      this.handleOverrides.delete(sessionId);
    }
    this.agentBackend?.killAll();
    this.apiBackend?.killAll();
    this.pool.killAll();
    this.observedStreamStates.clear();
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
        maintenance: {
          markers: [],
        },
        recentEvents: [],
      };
      this.sessionStates.set(sessionId, tracked);
    }
    return tracked;
  }

  private ensureObservedStreamState(sessionId: string): RuntimeObservedStreamState {
    let state = this.observedStreamStates.get(sessionId);
    if (!state) {
      state = {
        nextSeq: 1,
        entries: [],
        listeners: new Set(),
        updatedAt: null,
        terminal: false,
      };
      this.observedStreamStates.set(sessionId, state);
    }
    return state;
  }

  private resetObservedStreamState(sessionId: string): void {
    const state = this.ensureObservedStreamState(sessionId);
    state.entries = [];
    state.updatedAt = null;
    state.terminal = false;
  }

  private clearObservedStreamState(sessionId: string): void {
    const state = this.observedStreamStates.get(sessionId);
    if (!state) {
      return;
    }
    state.entries = [];
    state.updatedAt = null;
    state.terminal = false;
  }

  private recordObservedStreamEvent(
    sessionId: string,
    event: StreamEvent,
    observedAt: string,
  ): void {
    const state = this.ensureObservedStreamState(sessionId);
    const entry = {
      seq: state.nextSeq,
      event: cloneStreamEvent(event),
    } satisfies RuntimeObservedStreamEventEntry;
    state.nextSeq += 1;
    state.entries.push(entry);
    if (state.entries.length > MAX_STREAM_REPLAY_EVENTS) {
      state.entries.splice(0, state.entries.length - MAX_STREAM_REPLAY_EVENTS);
    }
    state.updatedAt = observedAt;
    state.terminal = event.type === 'result' || event.type === 'error';

    for (const listener of state.listeners) {
      listener(cloneObservedStreamEntry(entry));
    }
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

  private pushMaintenanceMarker(
    tracked: RuntimeTrackedSessionStateSnapshot,
    marker: RuntimeSessionMaintenanceMarker,
  ): void {
    tracked.maintenance.markers.push(marker);
    if (tracked.maintenance.markers.length > MAX_MAINTENANCE_MARKERS) {
      tracked.maintenance.markers.splice(
        0,
        tracked.maintenance.markers.length - MAX_MAINTENANCE_MARKERS,
      );
    }
  }

  private getOverride(
    sessionId: string,
  ): ExecutionHandle | undefined {
    const override = this.handleOverrides.get(sessionId);
    if (!override) {
      return undefined;
    }

    if (!override.active) {
      this.handleOverrides.delete(sessionId);
      return undefined;
    }

    return override;
  }

  private async cancelExecutionHandle(
    handle: ExecutionHandle,
    reason: 'cancel',
  ): Promise<void> {
    const candidate = handle as ExecutionHandle & {
      cancel?: (reason?: string) => Promise<void> | void;
    };
    if (typeof candidate.cancel === 'function') {
      await candidate.cancel(reason);
      return;
    }

    handle.kill();
  }

  private async closeExecutionHandle(
    handle: ExecutionHandle,
    reason: 'close' | 'delete' | 'reset' | 'shutdown',
  ): Promise<void> {
    const candidate = handle as ExecutionHandle & {
      close?: (reason?: string) => Promise<void> | void;
    };
    if (typeof candidate.close === 'function') {
      await candidate.close(reason);
      return;
    }

    handle.kill();
  }
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
    maintenance: cloneMaintenanceState(tracked.maintenance),
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

function cloneMaintenanceState(
  maintenance: RuntimeTrackedSessionMaintenanceState,
): RuntimeTrackedSessionMaintenanceState {
  return {
    ...(maintenance.lastRequest ? { lastRequest: cloneMaintenanceRequest(maintenance.lastRequest) } : {}),
    ...(maintenance.lastFollowThrough
      ? { lastFollowThrough: cloneMaintenanceFollowThrough(maintenance.lastFollowThrough) }
      : {}),
    ...(maintenance.requestHistory
      ? { requestHistory: maintenance.requestHistory.map(cloneMaintenanceRequest) }
      : {}),
    ...(maintenance.followThroughHistory
      ? { followThroughHistory: maintenance.followThroughHistory.map(cloneMaintenanceFollowThrough) }
      : {}),
    ...(maintenance.lastResetAt ? { lastResetAt: maintenance.lastResetAt } : {}),
    ...(maintenance.lastLifecycle ? { lastLifecycle: cloneLifecycle(maintenance.lastLifecycle) } : {}),
    ...(maintenance.lastCompaction
      ? { lastCompaction: cloneCompactionRecord(maintenance.lastCompaction) }
      : {}),
    markers: maintenance.markers.map((marker) => ({
      ...marker,
      ...(marker.details ? { details: { ...marker.details } } : {}),
    })),
  };
}

function cloneCompactionRecord(
  record: RuntimeSessionCompactionRecord,
): RuntimeSessionCompactionRecord {
  return {
    ...record,
    ...(record.archivePath ? { archivePath: record.archivePath } : {}),
  };
}

function cloneLifecycle(
  lifecycle: RuntimeSessionLifecycleContract,
): RuntimeSessionLifecycleContract {
  return {
    ...lifecycle,
    reasonCodes: [...lifecycle.reasonCodes],
    cleanup: { ...lifecycle.cleanup },
  };
}

function cloneObservedStreamEntry(
  entry: RuntimeObservedStreamEventEntry,
): RuntimeObservedStreamEventEntry {
  return {
    seq: entry.seq,
    event: cloneStreamEvent(entry.event),
  };
}

function cloneStreamEvent(
  event: StreamEvent,
): StreamEvent {
  return structuredClone(event);
}

function buildLifecycleRunSummary(action: RuntimeSessionLifecycleAction): string {
  switch (action) {
    case 'reset':
      return 'Session reset cleared the current execution boundary.';
    case 'delete':
      return 'Session delete terminated the current execution boundary.';
    case 'close':
    default:
      return 'Session close terminated the current execution boundary.';
  }
}

function appendMaintenanceHistory<T>(
  history: T[] | undefined,
  value: T,
  clone: (entry: T) => T,
): T[] {
  const next = [...(history?.map(clone) ?? []), clone(value)];
  if (next.length <= MAX_MAINTENANCE_HISTORY_ENTRIES) {
    return next;
  }
  return next.slice(next.length - MAX_MAINTENANCE_HISTORY_ENTRIES);
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
