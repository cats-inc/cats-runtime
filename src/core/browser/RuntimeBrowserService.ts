import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { RuntimeBrowserDriver, RuntimeBrowserPageTarget } from './driver.js';
import {
  RuntimeBrowserNotFoundError,
  RuntimeBrowserValidationError,
} from './errors.js';
import { createBrowserPagePreviewSurface } from './previewSurfaces.js';
import type {
  RuntimeBrowserDriverDescriptor,
  RuntimeBrowserPage,
  RuntimeBrowserPageBinding,
  RuntimeBrowserSessionInspection,
  RuntimeBrowserSessionView,
} from '../types.js';

const DEFAULT_MAX_BROWSER_SESSIONS = 32;
const DEFAULT_MAX_BROWSER_PAGES_PER_SESSION = 32;

interface StoredBrowserSession {
  id: string;
  driverId: string;
  status: RuntimeBrowserSessionView['status'];
  runtimeSessionId?: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  pageIds: string[];
  metadata?: Record<string, unknown>;
}

interface StoredBrowserPage {
  id: string;
  browserSessionId: string;
  status: RuntimeBrowserPage['status'];
  label?: string;
  title?: string;
  url?: string;
  path?: string;
  mediaType?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  binding: RuntimeBrowserPageBinding;
  metadata?: Record<string, unknown>;
}

interface PersistedRuntimeBrowserState {
  version: 1;
  sessions: StoredBrowserSession[];
  pages: StoredBrowserPage[];
}

export interface CreateRuntimeBrowserSessionInput {
  driverId?: string;
  runtimeSessionId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRuntimeBrowserPageInput extends RuntimeBrowserPageTarget {}

export interface ListRuntimeBrowserSessionsOptions {
  driverId?: string;
  runtimeSessionId?: string;
  status?: RuntimeBrowserSessionView['status'];
}

export interface SummarizeRuntimeBrowserSessionsOptions
  extends ListRuntimeBrowserSessionsOptions {
  olderThanMs?: number;
}

export interface CleanupRuntimeBrowserSessionsOptions
  extends ListRuntimeBrowserSessionsOptions {
  olderThanMs?: number;
}

export interface RuntimeBrowserSessionCountSummary {
  total: number;
  ready: number;
  closed: number;
}

export interface RuntimeBrowserPageCountSummary {
  total: number;
  open: number;
  closed: number;
}

export interface RuntimeBrowserDriverSummary {
  driverId: string;
  sessions: RuntimeBrowserSessionCountSummary;
  pages: RuntimeBrowserPageCountSummary;
}

export interface RuntimeBrowserCleanupCandidateSummary {
  olderThanMs: number;
  sessionCount: number;
  pageCount: number;
  sessionIds: string[];
}

export interface RuntimeBrowserSummary {
  filters: ListRuntimeBrowserSessionsOptions;
  sessions: RuntimeBrowserSessionCountSummary;
  pages: RuntimeBrowserPageCountSummary;
  attachedRuntimeSessionCount: number;
  drivers: RuntimeBrowserDriverSummary[];
  cleanupCandidates: RuntimeBrowserCleanupCandidateSummary;
}

export interface RuntimeBrowserCleanupResult {
  action: 'cleanup_browser_sessions';
  filters: {
    driverId?: string;
    runtimeSessionId?: string;
    status: 'closed';
    olderThanMs: number;
  };
  matchedSessionCount: number;
  matchedPageCount: number;
  removedSessionCount: number;
  removedPageCount: number;
  removedSessionIds: string[];
  remainingSessionCount: number;
  remainingClosedSessionCount: number;
}

export interface RuntimeBrowserServiceOptions {
  drivers: RuntimeBrowserDriver[];
  sessionExists?: (sessionId: string) => boolean;
  now?: () => Date;
  maxSessions?: number;
  maxPagesPerSession?: number;
  storageFile?: string;
}

export {
  RuntimeBrowserNotFoundError,
  RuntimeBrowserValidationError,
} from './errors.js';

export class RuntimeBrowserService {
  private readonly now: () => Date;
  private readonly maxSessions: number;
  private readonly maxPagesPerSession: number;
  private readonly drivers = new Map<string, RuntimeBrowserDriver>();
  private readonly sessions = new Map<string, StoredBrowserSession>();
  private readonly pages = new Map<string, StoredBrowserPage>();

  constructor(private readonly options: RuntimeBrowserServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_BROWSER_SESSIONS);
    this.maxPagesPerSession = Math.max(1, options.maxPagesPerSession ?? DEFAULT_MAX_BROWSER_PAGES_PER_SESSION);
    for (const driver of options.drivers) {
      this.drivers.set(driver.descriptor.id, driver);
    }
    this.loadPersistedState();
  }

  listDrivers(): RuntimeBrowserDriverDescriptor[] {
    return Array.from(this.drivers.values()).map((driver) => cloneDriverDescriptor(driver.descriptor));
  }

  createSession(input: CreateRuntimeBrowserSessionInput = {}): Promise<RuntimeBrowserSessionView> {
    return this.createSessionInternal(input);
  }

  listSessions(options: ListRuntimeBrowserSessionsOptions = {}): RuntimeBrowserSessionView[] {
    return this.listStoredSessions(options)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => this.buildSessionView(session));
  }

  summarizeSessions(
    options: SummarizeRuntimeBrowserSessionsOptions = {},
  ): RuntimeBrowserSummary {
    const sessions = this.listStoredSessions(options);
    const cleanupCandidates = this.selectCleanupSessions({
      ...options,
      status: 'closed',
      olderThanMs: options.olderThanMs ?? 0,
    });

    const drivers = new Map<string, StoredBrowserSession[]>();
    for (const session of sessions) {
      const bucket = drivers.get(session.driverId);
      if (bucket) {
        bucket.push(session);
        continue;
      }
      drivers.set(session.driverId, [session]);
    }

    return {
      filters: buildBrowserSessionFilters(options),
      sessions: summarizeSessionCounts(sessions),
      pages: summarizePageCounts(sessions, this.pages),
      attachedRuntimeSessionCount: sessions.filter((session) => session.runtimeSessionId).length,
      drivers: Array.from(drivers.entries())
        .map(([driverId, driverSessions]) => ({
          driverId,
          sessions: summarizeSessionCounts(driverSessions),
          pages: summarizePageCounts(driverSessions, this.pages),
        }))
        .sort((left, right) => left.driverId.localeCompare(right.driverId)),
      cleanupCandidates: {
        olderThanMs: options.olderThanMs ?? 0,
        sessionCount: cleanupCandidates.length,
        pageCount: cleanupCandidates.reduce((total, session) => total + session.pageIds.length, 0),
        sessionIds: cleanupCandidates.map((session) => session.id),
      },
    };
  }

  getSession(id: string): RuntimeBrowserSessionView | undefined {
    const session = this.sessions.get(id);
    return session ? this.buildSessionView(session) : undefined;
  }

  cleanupSessions(
    options: CleanupRuntimeBrowserSessionsOptions = {},
  ): RuntimeBrowserCleanupResult {
    const olderThanMs = Math.max(0, options.olderThanMs ?? 0);
    const candidates = this.selectCleanupSessions({
      ...options,
      status: 'closed',
      olderThanMs,
    });
    const matchedPageCount = candidates.reduce((total, session) => total + session.pageIds.length, 0);
    const removedSessionIds: string[] = [];
    let removedPageCount = 0;

    for (const session of candidates) {
      removedSessionIds.push(session.id);
      removedPageCount += session.pageIds.length;
      this.deleteStoredSession(session.id);
    }
    if (removedSessionIds.length > 0) {
      this.persistState();
    }

    return {
      action: 'cleanup_browser_sessions',
      filters: {
        ...buildBrowserSessionFilters(options),
        status: 'closed',
        olderThanMs,
      },
      matchedSessionCount: candidates.length,
      matchedPageCount,
      removedSessionCount: removedSessionIds.length,
      removedPageCount,
      removedSessionIds,
      remainingSessionCount: this.sessions.size,
      remainingClosedSessionCount: Array.from(this.sessions.values())
        .filter((session) => session.status === 'closed').length,
    };
  }

  async clearRuntimeSessions(runtimeSessionId: string): Promise<number> {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => session.runtimeSessionId === runtimeSessionId);
    for (const session of sessions) {
      if (session.status !== 'closed') {
        await this.closeSession(session.id);
      }
      this.deleteStoredSession(session.id);
    }
    if (sessions.length > 0) {
      this.persistState();
    }
    return sessions.length;
  }

  async createPage(
    browserSessionId: string,
    input: CreateRuntimeBrowserPageInput,
  ): Promise<{ session: RuntimeBrowserSessionView; page: RuntimeBrowserPage }> {
    const session = this.sessions.get(browserSessionId);
    if (!session) {
      throw new RuntimeBrowserNotFoundError(`Browser session '${browserSessionId}' was not found.`);
    }
    if (session.status === 'closed') {
      throw new RuntimeBrowserValidationError(
        `Browser session '${browserSessionId}' is already closed.`,
      );
    }
    if (session.pageIds.length >= this.maxPagesPerSession) {
      throw new RuntimeBrowserValidationError(
        `Browser session '${browserSessionId}' reached the maximum page capacity of ${this.maxPagesPerSession}.`,
      );
    }

    validateBrowserPageTarget(input);

    const driver = this.requireDriver(session.driverId);
    const pageId = randomUUID();
    const now = this.now().toISOString();
    const driverPageState = await driver.openPage({
      browserSessionId,
      browserPageId: pageId,
      target: input,
    });
    const page: StoredBrowserPage = {
      id: pageId,
      browserSessionId,
      status: 'open',
      label: input.label,
      title: driverPageState.title ?? input.title,
      url: input.url,
      path: input.path,
      mediaType: input.mediaType,
      createdAt: now,
      updatedAt: now,
      binding: cloneBinding(input.binding),
      metadata: mergeMetadata(input.metadata, driverPageState.metadata),
    };

    this.pages.set(pageId, page);
    session.pageIds.push(pageId);
    session.updatedAt = now;
    this.persistState();
    return {
      session: this.buildSessionView(session),
      page: this.buildPageView(page),
    };
  }

  async closeSession(id: string): Promise<RuntimeBrowserSessionView> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new RuntimeBrowserNotFoundError(`Browser session '${id}' was not found.`);
    }
    if (session.status === 'closed') {
      return this.buildSessionView(session);
    }

    const driver = this.requireDriver(session.driverId);
    await driver.closeSession({
      browserSessionId: id,
    });

    const now = this.now().toISOString();
    session.status = 'closed';
    session.closedAt = now;
    session.updatedAt = now;
    for (const pageId of session.pageIds) {
      const page = this.pages.get(pageId);
      if (!page || page.status === 'closed') {
        continue;
      }
      page.status = 'closed';
      page.closedAt = now;
      page.updatedAt = now;
    }
    this.persistState();

    return this.buildSessionView(session);
  }

  async closePage(
    browserSessionId: string,
    browserPageId: string,
  ): Promise<{ session: RuntimeBrowserSessionView; page: RuntimeBrowserPage }> {
    const session = this.sessions.get(browserSessionId);
    if (!session) {
      throw new RuntimeBrowserNotFoundError(
        `Browser session '${browserSessionId}' was not found.`,
      );
    }
    const page = this.pages.get(browserPageId);
    if (!page || page.browserSessionId !== browserSessionId) {
      throw new RuntimeBrowserNotFoundError(
        `Browser page '${browserPageId}' was not found in session '${browserSessionId}'.`,
      );
    }
    if (page.status === 'closed') {
      return {
        session: this.buildSessionView(session),
        page: this.buildPageView(page),
      };
    }

    const driver = this.requireDriver(session.driverId);
    await driver.closePage?.({
      browserSessionId,
      browserPageId,
    });

    const now = this.now().toISOString();
    page.status = 'closed';
    page.closedAt = now;
    page.updatedAt = now;
    session.updatedAt = now;
    this.persistState();

    return {
      session: this.buildSessionView(session),
      page: this.buildPageView(page),
    };
  }

  private async createSessionInternal(
    input: CreateRuntimeBrowserSessionInput = {},
  ): Promise<RuntimeBrowserSessionView> {
    this.ensureSessionCapacity();
    const driverId = input.driverId?.trim() || 'manual';
    const driver = this.requireDriver(driverId);
    const runtimeSessionId = input.runtimeSessionId?.trim() || undefined;
    if (runtimeSessionId && this.options.sessionExists && !this.options.sessionExists(runtimeSessionId)) {
      throw new RuntimeBrowserValidationError(
        `Unknown runtime session '${runtimeSessionId}' for browser session association.`,
      );
    }

    const browserSessionId = randomUUID();
    const now = this.now().toISOString();
    const driverSessionState = await driver.createSession({
      browserSessionId,
      runtimeSessionId,
      label: input.label,
      metadata: input.metadata,
    });
    const session: StoredBrowserSession = {
      id: browserSessionId,
      driverId,
      status: 'ready',
      ...(runtimeSessionId ? { runtimeSessionId } : {}),
      ...(input.label ? { label: input.label } : {}),
      createdAt: now,
      updatedAt: now,
      pageIds: [],
      metadata: mergeMetadata(input.metadata, driverSessionState.metadata),
    };
    this.sessions.set(browserSessionId, session);
    this.persistState();
    return this.buildSessionView(session);
  }

  private ensureSessionCapacity(): void {
    if (this.sessions.size < this.maxSessions) {
      return;
    }

    const pruned = this.pruneClosedSessions();
    if (pruned) {
      this.persistState();
    }
    if (this.sessions.size < this.maxSessions) {
      return;
    }

    throw new RuntimeBrowserValidationError(
      `Browser session capacity reached (${this.maxSessions}). Close existing browser sessions before creating another.`,
    );
  }

  private pruneClosedSessions(): boolean {
    const closedSessions = Array.from(this.sessions.values())
      .filter((session) => session.status === 'closed')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    let pruned = false;

    while (this.sessions.size >= this.maxSessions && closedSessions.length > 0) {
      const session = closedSessions.shift();
      if (!session) {
        break;
      }
      this.deleteStoredSession(session.id);
      pruned = true;
    }
    return pruned;
  }

  private deleteStoredSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    for (const pageId of session.pageIds) {
      this.pages.delete(pageId);
    }
    this.sessions.delete(sessionId);
  }

  private requireDriver(id: string): RuntimeBrowserDriver {
    const driver = this.drivers.get(id);
    if (!driver) {
      throw new RuntimeBrowserValidationError(
        `Unknown browser driver '${id}'.`,
      );
    }
    return driver;
  }

  private buildSessionView(session: StoredBrowserSession): RuntimeBrowserSessionView {
    const pages = session.pageIds
      .map((pageId) => this.pages.get(pageId))
      .filter((page): page is StoredBrowserPage => Boolean(page))
      .map((page) => this.buildPageView(page));
    const inspection: RuntimeBrowserSessionInspection = {
      driver: cloneDriverDescriptor(this.requireDriver(session.driverId).descriptor),
      openPageCount: pages.filter((page) => page.status === 'open').length,
      closedPageCount: pages.filter((page) => page.status === 'closed').length,
      previewSurfaces: pages.map((page) => clonePreviewSurface(page.previewSurface)),
    };

    return {
      id: session.id,
      driverId: session.driverId,
      status: session.status,
      ...(session.runtimeSessionId ? { runtimeSessionId: session.runtimeSessionId } : {}),
      ...(session.label ? { label: session.label } : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ...(session.closedAt ? { closedAt: session.closedAt } : {}),
      pages,
      inspection,
      ...(session.metadata ? { metadata: { ...session.metadata } } : {}),
    };
  }

  private buildPageView(page: StoredBrowserPage): RuntimeBrowserPage {
    const snapshot = toBrowserPageSnapshot(page);
    return {
      ...snapshot,
      previewSurface: createBrowserPagePreviewSurface(snapshot),
    };
  }

  private listStoredSessions(options: ListRuntimeBrowserSessionsOptions = {}): StoredBrowserSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => matchesBrowserSessionFilters(session, options));
  }

  private selectCleanupSessions(
    options: CleanupRuntimeBrowserSessionsOptions = {},
  ): StoredBrowserSession[] {
    const olderThanMs = Math.max(0, options.olderThanMs ?? 0);
    const now = this.now().getTime();
    return this.listStoredSessions({
      ...options,
      status: 'closed',
    }).filter((session) => isClosedBrowserSessionOlderThan(session, olderThanMs, now));
  }

  private loadPersistedState(): void {
    const storageFile = this.options.storageFile;
    if (!storageFile || !existsSync(storageFile)) {
      return;
    }

    let recoveredNonPersistentSessions = false;
    try {
      const parsed = JSON.parse(readFileSync(storageFile, 'utf8')) as Partial<PersistedRuntimeBrowserState>;
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const pages = Array.isArray(parsed.pages) ? parsed.pages : [];

      for (const session of sessions) {
        if (!isStoredBrowserSession(session) || !this.drivers.has(session.driverId)) {
          continue;
        }
        this.sessions.set(session.id, cloneStoredSession(session));
      }

      for (const page of pages) {
        if (!isStoredBrowserPage(page) || !this.sessions.has(page.browserSessionId)) {
          continue;
        }
        this.pages.set(page.id, cloneStoredPage(page));
      }

      for (const session of this.sessions.values()) {
        session.pageIds = session.pageIds.filter((pageId) => {
          const page = this.pages.get(pageId);
          return Boolean(page && page.browserSessionId === session.id);
        });
      }

      const recoveredAt = this.now().toISOString();
      for (const session of this.sessions.values()) {
        const driver = this.drivers.get(session.driverId);
        if (!driver || session.status !== 'ready' || driver.descriptor.capabilities.persistentSessions) {
          continue;
        }
        session.status = 'closed';
        session.closedAt = recoveredAt;
        session.updatedAt = recoveredAt;
        session.metadata = mergeMetadata(session.metadata, {
          recovery: {
            recoveredAt,
            reason: 'driver_session_not_persistent',
            driverId: session.driverId,
          },
        });
        for (const pageId of session.pageIds) {
          const page = this.pages.get(pageId);
          if (!page || page.status === 'closed') {
            continue;
          }
          page.status = 'closed';
          page.closedAt = recoveredAt;
          page.updatedAt = recoveredAt;
        }
        recoveredNonPersistentSessions = true;
      }
    } catch {
      this.sessions.clear();
      this.pages.clear();
      return;
    }

    if (recoveredNonPersistentSessions) {
      this.persistState();
    }
  }

  private persistState(): void {
    const storageFile = this.options.storageFile;
    if (!storageFile) {
      return;
    }

    const payload: PersistedRuntimeBrowserState = {
      version: 1,
      sessions: Array.from(this.sessions.values()).map((session) => cloneStoredSession(session)),
      pages: Array.from(this.pages.values()).map((page) => cloneStoredPage(page)),
    };
    mkdirSync(dirname(storageFile), { recursive: true });
    const nextContent = `${JSON.stringify(payload, null, 2)}\n`;
    const tempFile = `${storageFile}.tmp`;
    writeFileSync(tempFile, nextContent, 'utf8');
    renameSync(tempFile, storageFile);
  }
}

function toBrowserPageSnapshot(page: StoredBrowserPage): Omit<RuntimeBrowserPage, 'previewSurface'> {
  return {
      id: page.id,
      browserSessionId: page.browserSessionId,
      status: page.status,
      ...(page.label ? { label: page.label } : {}),
      ...(page.title ? { title: page.title } : {}),
      ...(page.url ? { url: page.url } : {}),
      ...(page.path ? { path: page.path } : {}),
      ...(page.mediaType ? { mediaType: page.mediaType } : {}),
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      ...(page.closedAt ? { closedAt: page.closedAt } : {}),
      binding: cloneBinding(page.binding),
      ...(page.metadata ? { metadata: { ...page.metadata } } : {}),
    };
}

function validateBrowserPageTarget(input: CreateRuntimeBrowserPageInput): void {
  if (!input.url && !input.path) {
    throw new RuntimeBrowserValidationError(
      'Browser pages require either a url or a path.',
    );
  }
}

function mergeMetadata(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...(base || {}),
    ...(extra || {}),
  };
}

function cloneBinding(binding: RuntimeBrowserPageBinding): RuntimeBrowserPageBinding {
  return {
    kind: binding.kind,
    ...(binding.runtimeSessionId ? { runtimeSessionId: binding.runtimeSessionId } : {}),
    ...(binding.serviceId ? { serviceId: binding.serviceId } : {}),
    ...(binding.artifactId ? { artifactId: binding.artifactId } : {}),
  };
}

function cloneDriverDescriptor(
  descriptor: RuntimeBrowserDriverDescriptor,
): RuntimeBrowserDriverDescriptor {
  return {
    ...descriptor,
    capabilities: {
      ...descriptor.capabilities,
    },
    warnings: [...descriptor.warnings],
    ...(descriptor.metadata ? { metadata: { ...descriptor.metadata } } : {}),
  };
}

function clonePreviewSurface(
  previewSurface: RuntimeBrowserPage['previewSurface'],
): RuntimeBrowserPage['previewSurface'] {
  return {
    ...previewSurface,
    ...(previewSurface.provenance ? { provenance: { ...previewSurface.provenance } } : {}),
    ...(previewSurface.metadata ? { metadata: { ...previewSurface.metadata } } : {}),
  };
}

function cloneStoredSession(session: StoredBrowserSession): StoredBrowserSession {
  return {
    ...session,
    pageIds: [...session.pageIds],
    ...(session.metadata ? { metadata: { ...session.metadata } } : {}),
  };
}

function cloneStoredPage(page: StoredBrowserPage): StoredBrowserPage {
  return {
    ...page,
    binding: cloneBinding(page.binding),
    ...(page.metadata ? { metadata: { ...page.metadata } } : {}),
  };
}

function buildBrowserSessionFilters(
  options: ListRuntimeBrowserSessionsOptions,
): ListRuntimeBrowserSessionsOptions {
  return {
    ...(options.driverId ? { driverId: options.driverId } : {}),
    ...(options.runtimeSessionId ? { runtimeSessionId: options.runtimeSessionId } : {}),
    ...(options.status ? { status: options.status } : {}),
  };
}

function matchesBrowserSessionFilters(
  session: StoredBrowserSession,
  options: ListRuntimeBrowserSessionsOptions,
): boolean {
  if (options.driverId && session.driverId !== options.driverId) {
    return false;
  }
  if (options.runtimeSessionId && session.runtimeSessionId !== options.runtimeSessionId) {
    return false;
  }
  if (options.status && session.status !== options.status) {
    return false;
  }
  return true;
}

function summarizeSessionCounts(
  sessions: StoredBrowserSession[],
): RuntimeBrowserSessionCountSummary {
  return {
    total: sessions.length,
    ready: sessions.filter((session) => session.status === 'ready').length,
    closed: sessions.filter((session) => session.status === 'closed').length,
  };
}

function summarizePageCounts(
  sessions: StoredBrowserSession[],
  pages: Map<string, StoredBrowserPage>,
): RuntimeBrowserPageCountSummary {
  let total = 0;
  let open = 0;
  let closed = 0;

  for (const session of sessions) {
    for (const pageId of session.pageIds) {
      const page = pages.get(pageId);
      if (!page) {
        continue;
      }
      total += 1;
      if (page.status === 'open') {
        open += 1;
        continue;
      }
      closed += 1;
    }
  }

  return {
    total,
    open,
    closed,
  };
}

function isClosedBrowserSessionOlderThan(
  session: StoredBrowserSession,
  olderThanMs: number,
  now: number,
): boolean {
  if (session.status !== 'closed') {
    return false;
  }
  const referenceTime = Date.parse(session.closedAt || session.updatedAt);
  if (!Number.isFinite(referenceTime)) {
    return false;
  }
  return now - referenceTime >= olderThanMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStoredBrowserSession(value: unknown): value is StoredBrowserSession {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string'
    && typeof value.driverId === 'string'
    && typeof value.status === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && Array.isArray(value.pageIds)
  );
}

function isStoredBrowserPage(value: unknown): value is StoredBrowserPage {
  if (!isRecord(value) || !isRecord(value.binding)) {
    return false;
  }
  return (
    typeof value.id === 'string'
    && typeof value.browserSessionId === 'string'
    && typeof value.status === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.binding.kind === 'string'
  );
}
