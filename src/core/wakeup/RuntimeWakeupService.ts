import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  RuntimeWakeupRecurrence,
  RuntimeWakeupRequest,
  RuntimeWakeupStatus,
  RuntimeWakeupTarget,
  RuntimeWakeupTriggerOutcome,
  RuntimeWakeupTriggerSource,
  SessionWakeupState,
} from '../types.js';
import {
  getNextWakeupCronOccurrence,
  validateWakeupCronExpression,
} from './cron.js';

const DEFAULT_TICK_INTERVAL_MS = 1_000;
const DEFAULT_MAX_DUE_PER_TICK = 8;
const DEFAULT_MAX_TERMINAL_REQUESTS = 256;
const DEFAULT_MAX_TERMINAL_REQUESTS_PER_SESSION = 16;

const OPEN_WAKEUP_STATUSES = new Set<RuntimeWakeupStatus>([
  'scheduled',
  'triggering',
]);
const TERMINAL_WAKEUP_STATUSES = new Set<RuntimeWakeupStatus>([
  'triggered',
  'cancelled',
  'failed',
]);

export interface RuntimeWakeSessionResult {
  sessionId: string;
  providerSessionId?: string;
  outcome: RuntimeWakeupTriggerOutcome;
}

export interface CreateRuntimeWakeupInput {
  reason: string;
  target: RuntimeWakeupTarget;
  scheduleAt?: string;
  recurrence?: RuntimeWakeupRecurrence;
  coalesceKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ListRuntimeWakeupsOptions {
  status?: RuntimeWakeupStatus;
  sessionId?: string;
}

export interface ClearSessionWakeupsResult {
  removedCount: number;
  removedIds: string[];
}

export interface RuntimeWakeupServiceOptions {
  persistPath: string;
  wakeSession: (
    sessionId: string,
    request: RuntimeWakeupRequest,
  ) => Promise<RuntimeWakeSessionResult>;
  sessionExists?: (sessionId: string) => boolean;
  now?: () => Date;
  tickIntervalMs?: number;
  maxDuePerTick?: number;
  maxTerminalRequests?: number;
  maxTerminalRequestsPerSession?: number;
}

export class RuntimeWakeupValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_request' | 'unknown_session' = 'invalid_request',
  ) {
    super(message);
    this.name = 'RuntimeWakeupValidationError';
  }
}

export class RuntimeWakeupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeWakeupConflictError';
  }
}

export class RuntimeWakeupNotFoundError extends Error {
  constructor(id: string) {
    super(`Wakeup request '${id}' was not found.`);
    this.name = 'RuntimeWakeupNotFoundError';
  }
}

function cloneWakeupRequest(request: RuntimeWakeupRequest): RuntimeWakeupRequest {
  return structuredClone(request);
}

function normalizeIsoTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RuntimeWakeupValidationError('scheduleAt must be a valid ISO-8601 timestamp.');
  }

  return new Date(parsed).toISOString();
}

function normalizeOptionalIsoTimestamp(value: string | undefined): string | undefined {
  return value ? normalizeIsoTimestamp(value) : undefined;
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    throw new RuntimeWakeupValidationError('reason is required.');
  }
  return normalized;
}

function normalizeTarget(
  target: RuntimeWakeupTarget,
  sessionExists?: (sessionId: string) => boolean,
): RuntimeWakeupTarget {
  if (!target || target.kind !== 'session') {
    throw new RuntimeWakeupValidationError('target.kind must be \'session\'.');
  }

  const sessionId = target.sessionId.trim();
  if (!sessionId) {
    throw new RuntimeWakeupValidationError('target.sessionId is required.');
  }

  if (sessionExists && !sessionExists(sessionId)) {
    throw new RuntimeWakeupValidationError(
      `Unknown session '${sessionId}' for wakeup target.`,
      'unknown_session',
    );
  }

  return {
    kind: 'session',
    sessionId,
  };
}

function normalizeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return structuredClone(value);
}

function normalizeRecurrence(
  recurrence: RuntimeWakeupRecurrence | undefined,
): RuntimeWakeupRecurrence | undefined {
  if (!recurrence) {
    return undefined;
  }

  if (recurrence.kind !== 'cron') {
    throw new RuntimeWakeupValidationError('recurrence.kind must be \'cron\'.');
  }

  const timezone = recurrence.timezone ?? 'UTC';
  if (timezone !== 'UTC') {
    throw new RuntimeWakeupValidationError('recurrence.timezone must be \'UTC\' when provided.');
  }

  try {
    return {
      kind: 'cron',
      expression: validateWakeupCronExpression(recurrence.expression),
      timezone,
    };
  } catch (error) {
    throw new RuntimeWakeupValidationError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function sortRequests(left: RuntimeWakeupRequest, right: RuntimeWakeupRequest): number {
  const leftScheduleAt = Date.parse(left.scheduleAt);
  const rightScheduleAt = Date.parse(right.scheduleAt);
  if (leftScheduleAt !== rightScheduleAt) {
    return leftScheduleAt - rightScheduleAt;
  }

  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function isDuplicateWakeup(
  existing: RuntimeWakeupRequest,
  input: CreateRuntimeWakeupInput,
): boolean {
  return OPEN_WAKEUP_STATUSES.has(existing.status)
    && !existing.coalesceKey
    && !input.coalesceKey
    && existing.target.sessionId === input.target.sessionId
    && existing.reason === input.reason
    && existing.scheduleAt === input.scheduleAt
    && serializeWakeupRecurrence(existing.recurrence)
      === serializeWakeupRecurrence(input.recurrence);
}

function serializeWakeupRecurrence(
  recurrence: RuntimeWakeupRecurrence | undefined,
): string {
  return recurrence
    ? `${recurrence.kind}:${recurrence.expression}:${recurrence.timezone ?? 'UTC'}`
    : '';
}

function resolveWakeupScheduleAt(
  input: CreateRuntimeWakeupInput,
  now: Date,
): string {
  if (input.scheduleAt) {
    return input.scheduleAt;
  }

  if (input.recurrence?.kind === 'cron') {
    return getNextWakeupCronOccurrence(input.recurrence.expression, now).toISOString();
  }

  throw new RuntimeWakeupValidationError(
    'scheduleAt is required when recurrence is not provided.',
  );
}

export class RuntimeWakeupService {
  private readonly now: () => Date;
  private readonly tickIntervalMs: number;
  private readonly maxDuePerTick: number;
  private readonly maxTerminalRequests: number;
  private readonly maxTerminalRequestsPerSession: number;
  private readonly requests = new Map<string, RuntimeWakeupRequest>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(private readonly options: RuntimeWakeupServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.maxDuePerTick = options.maxDuePerTick ?? DEFAULT_MAX_DUE_PER_TICK;
    this.maxTerminalRequests = Math.max(0, options.maxTerminalRequests ?? DEFAULT_MAX_TERMINAL_REQUESTS);
    this.maxTerminalRequestsPerSession = Math.max(
      0,
      options.maxTerminalRequestsPerSession ?? DEFAULT_MAX_TERMINAL_REQUESTS_PER_SESSION,
    );
    this.load();
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runDueWakeups();
    }, this.tickIntervalMs);
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list(options: ListRuntimeWakeupsOptions = {}): RuntimeWakeupRequest[] {
    return Array.from(this.requests.values())
      .filter((request) => {
        if (options.status && request.status !== options.status) {
          return false;
        }
        if (options.sessionId && request.target.sessionId !== options.sessionId) {
          return false;
        }
        return true;
      })
      .sort(sortRequests)
      .map((request) => cloneWakeupRequest(request));
  }

  get(id: string): RuntimeWakeupRequest | undefined {
    const request = this.requests.get(id);
    return request ? cloneWakeupRequest(request) : undefined;
  }

  clearSession(sessionId: string): ClearSessionWakeupsResult {
    const removedIds: string[] = [];
    for (const [id, request] of this.requests.entries()) {
      if (request.target.sessionId !== sessionId) {
        continue;
      }
      this.requests.delete(id);
      removedIds.push(id);
    }

    if (removedIds.length > 0) {
      this.persist();
    }

    return {
      removedCount: removedIds.length,
      removedIds,
    };
  }

  create(input: CreateRuntimeWakeupInput): {
    request: RuntimeWakeupRequest;
    coalesced: boolean;
  } {
    const normalizedInput: CreateRuntimeWakeupInput = {
      reason: normalizeReason(input.reason),
      target: normalizeTarget(input.target, this.options.sessionExists),
      scheduleAt: normalizeOptionalIsoTimestamp(input.scheduleAt),
      recurrence: normalizeRecurrence(input.recurrence),
      coalesceKey: input.coalesceKey?.trim() || undefined,
      metadata: normalizeMetadata(input.metadata),
    };
    const scheduleAt = resolveWakeupScheduleAt(normalizedInput, this.now());
    normalizedInput.scheduleAt = scheduleAt;

    const coalesced = this.findCoalescibleRequest(normalizedInput);
    if (coalesced) {
      coalesced.reason = normalizedInput.reason;
      coalesced.scheduleAt = Date.parse(scheduleAt) < Date.parse(coalesced.scheduleAt)
        ? scheduleAt
        : coalesced.scheduleAt;
      coalesced.recurrence = normalizedInput.recurrence;
      coalesced.metadata = {
        ...(coalesced.metadata ?? {}),
        ...(normalizedInput.metadata ?? {}),
      };
      coalesced.updatedAt = this.now().toISOString();
      coalesced.coalescedCount += 1;
      this.persist();
      return {
        request: cloneWakeupRequest(coalesced),
        coalesced: true,
      };
    }

    const duplicate = Array.from(this.requests.values()).find((request) =>
      isDuplicateWakeup(request, normalizedInput),
    );
    if (duplicate) {
      throw new RuntimeWakeupConflictError(
        'A matching scheduled wakeup already exists. Use coalesceKey to merge duplicate wakeups.',
      );
    }

    const now = this.now().toISOString();
    const request: RuntimeWakeupRequest = {
      id: randomUUID(),
      reason: normalizedInput.reason,
      target: normalizedInput.target,
      scheduleAt,
      ...(normalizedInput.recurrence ? { recurrence: normalizedInput.recurrence } : {}),
      coalesceKey: normalizedInput.coalesceKey,
      status: 'scheduled',
      metadata: normalizedInput.metadata,
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      coalescedCount: 0,
    };

    this.requests.set(request.id, request);
    this.persist();
    return {
      request: cloneWakeupRequest(request),
      coalesced: false,
    };
  }

  cancel(id: string): RuntimeWakeupRequest {
    const request = this.requests.get(id);
    if (!request) {
      throw new RuntimeWakeupNotFoundError(id);
    }

    if (request.status !== 'scheduled') {
      throw new RuntimeWakeupConflictError(
        `Wakeup request '${id}' cannot be cancelled from status '${request.status}'.`,
      );
    }

    request.status = 'cancelled';
    request.updatedAt = this.now().toISOString();
    this.persist();
    return cloneWakeupRequest(request);
  }

  async trigger(
    id: string,
    source: RuntimeWakeupTriggerSource = 'manual',
  ): Promise<RuntimeWakeupRequest> {
    const request = this.requests.get(id);
    if (!request) {
      throw new RuntimeWakeupNotFoundError(id);
    }

    if (request.status === 'cancelled') {
      throw new RuntimeWakeupConflictError(
        `Wakeup request '${id}' is cancelled and cannot be triggered.`,
      );
    }
    if (request.status === 'triggering') {
      throw new RuntimeWakeupConflictError(
        `Wakeup request '${id}' is already being triggered.`,
      );
    }
    if (request.status === 'triggered') {
      throw new RuntimeWakeupConflictError(
        `Wakeup request '${id}' has already been triggered.`,
      );
    }

    request.status = 'triggering';
    request.updatedAt = this.now().toISOString();
    request.attemptCount += 1;
    this.persist();

    const triggeredAt = this.now().toISOString();

    try {
      const result = await this.options.wakeSession(request.target.sessionId, cloneWakeupRequest(request));
      request.lastExecution = {
        source,
        triggeredAt,
        sessionId: result.sessionId,
        providerSessionId: result.providerSessionId,
        outcome: result.outcome,
      };
      if (request.recurrence) {
        request.status = 'scheduled';
        request.scheduleAt = getNextWakeupCronOccurrence(
          request.recurrence.expression,
          new Date(triggeredAt),
        ).toISOString();
      } else {
        request.status = 'triggered';
      }
      request.updatedAt = this.now().toISOString();
      this.persist();
      return cloneWakeupRequest(request);
    } catch (error) {
      request.lastExecution = {
        source,
        triggeredAt,
        sessionId: request.target.sessionId,
        error: error instanceof Error ? error.message : String(error),
      };
      if (request.recurrence) {
        request.status = 'scheduled';
        request.scheduleAt = getNextWakeupCronOccurrence(
          request.recurrence.expression,
          new Date(triggeredAt),
        ).toISOString();
      } else {
        request.status = 'failed';
      }
      request.updatedAt = this.now().toISOString();
      this.persist();
      return cloneWakeupRequest(request);
    }
  }

  async runDueWakeups(): Promise<RuntimeWakeupRequest[]> {
    if (this.processing) {
      return [];
    }

    this.processing = true;
    try {
      const nowMs = this.now().getTime();
      const dueRequests = Array.from(this.requests.values())
        .filter((request) =>
          request.status === 'scheduled'
          && Date.parse(request.scheduleAt) <= nowMs,
        )
        .sort(sortRequests)
        .slice(0, this.maxDuePerTick);

      const triggered: RuntimeWakeupRequest[] = [];
      for (const request of dueRequests) {
        triggered.push(await this.trigger(request.id, 'timer'));
      }
      return triggered;
    } finally {
      this.processing = false;
    }
  }

  getSessionWakeState(sessionId: string): SessionWakeupState | undefined {
    let pendingRequestCount = 0;
    let nextPendingRequest: RuntimeWakeupRequest | undefined;
    let lastRequest: RuntimeWakeupRequest | undefined;

    for (const request of this.requests.values()) {
      if (request.target.sessionId !== sessionId) {
        continue;
      }

      if (!lastRequest || this.compareRecency(request, lastRequest) < 0) {
        lastRequest = request;
      }

      if (request.status === 'scheduled' || request.status === 'triggering') {
        pendingRequestCount += 1;
        if (!nextPendingRequest || sortRequests(request, nextPendingRequest) < 0) {
          nextPendingRequest = request;
        }
      }
    }

    if (!lastRequest) {
      return undefined;
    }

    return {
      pending: pendingRequestCount > 0,
      pendingRequestCount,
      nextScheduledAt: nextPendingRequest?.scheduleAt,
      lastRequest: cloneWakeupRequest(lastRequest),
    };
  }

  private findCoalescibleRequest(
    input: CreateRuntimeWakeupInput,
  ): RuntimeWakeupRequest | undefined {
    if (!input.coalesceKey) {
      return undefined;
    }

    return Array.from(this.requests.values()).find((request) =>
      request.status === 'scheduled'
      && request.coalesceKey === input.coalesceKey
      && request.target.sessionId === input.target.sessionId,
    );
  }

  private load(): void {
    if (!existsSync(this.options.persistPath)) {
      return;
    }

    try {
      const raw = readFileSync(this.options.persistPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }

        const record = entry as Partial<RuntimeWakeupRequest>;
        if (
          typeof record.id !== 'string'
          || typeof record.reason !== 'string'
          || !record.target
          || typeof record.scheduleAt !== 'string'
          || typeof record.createdAt !== 'string'
          || typeof record.updatedAt !== 'string'
        ) {
          continue;
        }

        try {
          const target = normalizeTarget(
            record.target as RuntimeWakeupTarget,
            undefined,
          );
          const request: RuntimeWakeupRequest = {
            id: record.id,
            reason: normalizeReason(record.reason),
            target,
            scheduleAt: normalizeIsoTimestamp(record.scheduleAt),
            ...(record.recurrence && typeof record.recurrence === 'object' && !Array.isArray(record.recurrence)
              ? { recurrence: normalizeRecurrence(record.recurrence as RuntimeWakeupRecurrence) }
              : {}),
            coalesceKey: typeof record.coalesceKey === 'string' && record.coalesceKey.trim()
              ? record.coalesceKey.trim()
              : undefined,
            status: record.status === 'triggering'
              ? 'scheduled'
              : record.status === 'scheduled'
                || record.status === 'triggered'
                || record.status === 'cancelled'
                || record.status === 'failed'
                ? record.status
                : 'scheduled',
            metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
              ? structuredClone(record.metadata)
              : undefined,
            createdAt: normalizeIsoTimestamp(record.createdAt),
            updatedAt: normalizeIsoTimestamp(record.updatedAt),
            attemptCount: typeof record.attemptCount === 'number' ? record.attemptCount : 0,
            coalescedCount: typeof record.coalescedCount === 'number' ? record.coalescedCount : 0,
            lastExecution: record.lastExecution && typeof record.lastExecution === 'object' && !Array.isArray(record.lastExecution)
              ? structuredClone(record.lastExecution)
              : undefined,
          };
          this.requests.set(request.id, request);
        } catch {
          continue;
        }
      }

      const countBeforePrune = this.requests.size;
      this.pruneTerminalRequests();
      if (this.requests.size !== countBeforePrune) {
        this.persist();
      }
    } catch {
      // Best effort only. Invalid persisted state should not prevent runtime startup.
    }
  }

  private persist(): void {
    if (this.shouldPruneTerminalRequests()) {
      this.pruneTerminalRequests();
    }
    mkdirSync(dirname(this.options.persistPath), { recursive: true });
    writeFileSync(
      this.options.persistPath,
      `${JSON.stringify(Array.from(this.requests.values()).sort(sortRequests), null, 2)}\n`,
      'utf8',
    );
  }

  private shouldPruneTerminalRequests(): boolean {
    if (this.maxTerminalRequests === 0 || this.maxTerminalRequestsPerSession === 0) {
      return Array.from(this.requests.values()).some((request) =>
        TERMINAL_WAKEUP_STATUSES.has(request.status),
      );
    }

    let terminalCount = 0;
    const perSessionCounts = new Map<string, number>();

    for (const request of this.requests.values()) {
      if (!TERMINAL_WAKEUP_STATUSES.has(request.status)) {
        continue;
      }

      terminalCount += 1;
      if (terminalCount > this.maxTerminalRequests) {
        return true;
      }

      const sessionCount = (perSessionCounts.get(request.target.sessionId) ?? 0) + 1;
      if (sessionCount > this.maxTerminalRequestsPerSession) {
        return true;
      }
      perSessionCounts.set(request.target.sessionId, sessionCount);
    }

    return false;
  }

  private pruneTerminalRequests(): void {
    if (this.maxTerminalRequests === 0 || this.maxTerminalRequestsPerSession === 0) {
      for (const request of Array.from(this.requests.values())) {
        if (TERMINAL_WAKEUP_STATUSES.has(request.status)) {
          this.requests.delete(request.id);
        }
      }
      return;
    }

    const terminalRequests = Array.from(this.requests.values())
      .filter((request) => TERMINAL_WAKEUP_STATUSES.has(request.status))
      .sort((left, right) => this.compareRecency(left, right));

    let kept = 0;
    const keptPerSession = new Map<string, number>();
    for (const request of terminalRequests) {
      const sessionId = request.target.sessionId;
      const sessionCount = keptPerSession.get(sessionId) ?? 0;
      if (
        kept < this.maxTerminalRequests
        && sessionCount < this.maxTerminalRequestsPerSession
      ) {
        kept += 1;
        keptPerSession.set(sessionId, sessionCount + 1);
        continue;
      }

      this.requests.delete(request.id);
    }
  }

  private compareRecency(left: RuntimeWakeupRequest, right: RuntimeWakeupRequest): number {
    const leftUpdatedAt = Date.parse(left.updatedAt);
    const rightUpdatedAt = Date.parse(right.updatedAt);
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  }
}
