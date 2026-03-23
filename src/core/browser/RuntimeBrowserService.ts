import { randomUUID } from 'node:crypto';
import type { RuntimeBrowserDriver, RuntimeBrowserPageTarget } from './driver.js';
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
}

export interface RuntimeBrowserServiceOptions {
  drivers: RuntimeBrowserDriver[];
  sessionExists?: (sessionId: string) => boolean;
  now?: () => Date;
  maxSessions?: number;
  maxPagesPerSession?: number;
}

export class RuntimeBrowserNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeBrowserNotFoundError';
  }
}

export class RuntimeBrowserValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeBrowserValidationError';
  }
}

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
  }

  listDrivers(): RuntimeBrowserDriverDescriptor[] {
    return Array.from(this.drivers.values()).map((driver) => cloneDriverDescriptor(driver.descriptor));
  }

  createSession(input: CreateRuntimeBrowserSessionInput = {}): Promise<RuntimeBrowserSessionView> {
    return this.createSessionInternal(input);
  }

  listSessions(options: ListRuntimeBrowserSessionsOptions = {}): RuntimeBrowserSessionView[] {
    return Array.from(this.sessions.values())
      .filter((session) => {
        if (options.driverId && session.driverId !== options.driverId) {
          return false;
        }
        if (options.runtimeSessionId && session.runtimeSessionId !== options.runtimeSessionId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => this.buildSessionView(session));
  }

  getSession(id: string): RuntimeBrowserSessionView | undefined {
    const session = this.sessions.get(id);
    return session ? this.buildSessionView(session) : undefined;
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

    return this.buildSessionView(session);
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
    return this.buildSessionView(session);
  }

  private ensureSessionCapacity(): void {
    if (this.sessions.size < this.maxSessions) {
      return;
    }

    this.pruneClosedSessions();
    if (this.sessions.size < this.maxSessions) {
      return;
    }

    throw new RuntimeBrowserValidationError(
      `Browser session capacity reached (${this.maxSessions}). Close existing browser sessions before creating another.`,
    );
  }

  private pruneClosedSessions(): void {
    const closedSessions = Array.from(this.sessions.values())
      .filter((session) => session.status === 'closed')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

    while (this.sessions.size >= this.maxSessions && closedSessions.length > 0) {
      const session = closedSessions.shift();
      if (!session) {
        break;
      }
      this.deleteStoredSession(session.id);
    }
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
