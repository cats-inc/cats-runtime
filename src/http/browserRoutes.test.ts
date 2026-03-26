import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { createRuntimeStartupState } from '../startup.js';
import { RuntimeBrowserService } from '../core/browser/RuntimeBrowserService.js';
import { ManualBrowserDriver } from '../backends/browser/manualDriver.js';

describe('browser HTTP contract', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let browser: RuntimeBrowserService | undefined;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3110,
      apiKey: '',
      dataDir,
      sessionBaseDir,
      auggiePath: 'auggie',
      claudePath: 'claude',
      codexPath: 'codex',
      copilotPath: 'copilot',
      cursorPath: 'cursor-agent',
      geminiPath: 'gemini',
      goosePath: 'goose',
      juniePath: 'junie',
      kiroPath: 'kiro-cli',
      opencodePath: 'opencode',
      piPath: 'pi',
      opencodeServerHost: '127.0.0.1',
      opencodeServerPort: 4097,
      opencodeServerStartupTimeoutMs: 10_000,
      auggieSessionsDir: join(rootDir, '.augment', 'sessions'),
      claudeProjectsDir: join(rootDir, '.claude', 'projects'),
      codexSessionsDir: join(rootDir, '.codex', 'sessions'),
      copilotSessionsDir: join(rootDir, '.copilot', 'session-state'),
      cursorChatsDir: join(rootDir, '.cursor', 'chats'),
      cursorRuntime: { mode: 'native' },
      geminiSessionsDir: join(rootDir, '.gemini', 'tmp'),
      kiroDbPath: join(rootDir, '.kiro', 'data.sqlite3'),
      kiroRuntime: { mode: 'native' },
      piSessionsDir: join(rootDir, '.pi', 'sessions'),
      nativeDiscoveryIntervalMs: 0,
      externalSessionLiveWindowMs: 0,
      maxSessions: 10,
      providerCommands: {
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      },
    } as unknown as CliRuntimeConfig;
  }

  function createTestApp() {
    return createApp({
      config: makeConfig(),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      ...(browser ? { browser } : {}),
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog: {} as never,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-browser-http-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(rootDir, 'repo-service'), { recursive: true });
    mkdirSync(join(rootDir, 'repo-artifact'), { recursive: true });
    registry = new SessionRegistry();
    const serviceSession = registry.create({
      id: 'session-service',
      providerName: 'claude',
      providerBackend: 'agent',
      cwd: join(rootDir, 'repo-service'),
    });
    registry.setProviderState(serviceSession.id, {
      agentSession: {
        providerSessionId: 'agent-session-1',
        status: 'idle',
        services: [{
          id: 'preview',
          name: 'Preview Server',
          url: 'http://127.0.0.1:4173',
        }],
      },
    });
    registry.create({
      id: 'session-artifact',
      providerName: 'claude',
      providerBackend: 'api',
      cwd: join(rootDir, 'repo-artifact'),
      artifacts: [{
        id: 'report',
        label: 'Report',
        path: 'dist/report.html',
        mediaType: 'text/html',
      }],
    });

    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
    browser = undefined;
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('reports manual-driver capabilities and manages browser pages with normalized preview surfaces', async () => {
    const app = createTestApp();

    const driversResponse = await app.request('/browser/drivers');
    expect(driversResponse.status).toBe(200);
    await expect(driversResponse.json()).resolves.toEqual({
      drivers: [
        expect.objectContaining({
          id: 'manual',
          status: 'ready',
          capabilities: expect.objectContaining({
            manualUrlEntry: true,
            serviceBindings: true,
            artifactBindings: true,
            liveAutomation: false,
          }),
        }),
      ],
    });

    const createResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Manual Preview Session',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await app.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:3000',
        label: 'Manual Preview',
      }),
    });
    expect(pageResponse.status).toBe(201);
    await expect(pageResponse.json()).resolves.toEqual(expect.objectContaining({
      page: expect.objectContaining({
        previewSurface: expect.objectContaining({
          kind: 'browser_page',
          source: 'browser_page',
          status: 'ready',
          renderHint: 'iframe',
          url: 'http://127.0.0.1:3000',
        }),
      }),
      session: expect.objectContaining({
        inspection: expect.objectContaining({
          openPageCount: 1,
          previewSurfaces: [
            expect.objectContaining({
              kind: 'browser_page',
              status: 'ready',
            }),
          ],
        }),
      }),
    }));
  });

  it('closes a single browser page without closing the browser session', async () => {
    const app = createTestApp();

    const createResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Manual Preview Session',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await app.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:3000',
        label: 'Manual Preview',
      }),
    });
    expect(pageResponse.status).toBe(201);
    const pagePayload = await pageResponse.json() as {
      page: { id: string };
    };

    const closePageResponse = await app.request(
      `/browser/sessions/${created.session.id}/pages/${pagePayload.page.id}/close`,
      { method: 'POST' },
    );
    expect(closePageResponse.status).toBe(200);
    await expect(closePageResponse.json()).resolves.toEqual(expect.objectContaining({
      page: expect.objectContaining({
        id: pagePayload.page.id,
        status: 'closed',
        previewSurface: expect.objectContaining({
          status: 'blocked',
          renderHint: 'none',
        }),
      }),
      session: expect.objectContaining({
        id: created.session.id,
        status: 'ready',
        inspection: expect.objectContaining({
          openPageCount: 0,
          closedPageCount: 1,
        }),
      }),
    }));
  });

  it('navigates an existing browser page without creating a second page', async () => {
    const app = createTestApp();

    const createResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeSessionId: 'session-service',
        label: 'Manual Preview Session',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await app.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:3000',
        label: 'Manual Preview',
      }),
    });
    expect(pageResponse.status).toBe(201);
    const pagePayload = await pageResponse.json() as {
      page: { id: string };
    };

    const navigateResponse = await app.request(
      `/browser/sessions/${created.session.id}/pages/${pagePayload.page.id}/navigate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          binding: {
            kind: 'session_service',
            serviceId: 'preview',
          },
          label: 'Service Preview',
        }),
      },
    );
    expect(navigateResponse.status).toBe(200);
    await expect(navigateResponse.json()).resolves.toEqual(expect.objectContaining({
      page: expect.objectContaining({
        id: pagePayload.page.id,
        label: 'Service Preview',
        binding: expect.objectContaining({
          kind: 'session_service',
          runtimeSessionId: 'session-service',
          serviceId: 'preview',
        }),
        previewSurface: expect.objectContaining({
          kind: 'browser_page',
          status: 'ready',
          renderHint: 'iframe',
          url: 'http://127.0.0.1:4173',
        }),
      }),
      session: expect.objectContaining({
        id: created.session.id,
        status: 'ready',
        inspection: expect.objectContaining({
          openPageCount: 1,
          closedPageCount: 0,
        }),
      }),
    }));
  });

  it('binds browser pages to runtime session services and artifacts without changing the preview-surface schema', async () => {
    const app = createTestApp();

    const serviceBrowserResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeSessionId: 'session-service',
        label: 'Service Browser Session',
      }),
    });
    const serviceBrowser = await serviceBrowserResponse.json() as {
      session: { id: string };
    };

    const servicePageResponse = await app.request(`/browser/sessions/${serviceBrowser.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        binding: {
          kind: 'session_service',
          serviceId: 'preview',
        },
      }),
    });
    expect(servicePageResponse.status).toBe(201);
    await expect(servicePageResponse.json()).resolves.toEqual(expect.objectContaining({
      page: expect.objectContaining({
        binding: expect.objectContaining({
          kind: 'session_service',
          runtimeSessionId: 'session-service',
          serviceId: 'preview',
        }),
        previewSurface: expect.objectContaining({
          kind: 'browser_page',
          renderHint: 'iframe',
          url: 'http://127.0.0.1:4173',
          provenance: expect.objectContaining({
            sessionId: 'session-service',
            serviceId: 'preview',
          }),
        }),
      }),
    }));

    const artifactBrowserResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeSessionId: 'session-artifact',
        label: 'Artifact Browser Session',
      }),
    });
    const artifactBrowser = await artifactBrowserResponse.json() as {
      session: { id: string };
    };

    const artifactPageResponse = await app.request(`/browser/sessions/${artifactBrowser.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        binding: {
          kind: 'session_artifact',
          artifactId: 'report',
        },
      }),
    });
    expect(artifactPageResponse.status).toBe(201);
    await expect(artifactPageResponse.json()).resolves.toEqual(expect.objectContaining({
      page: expect.objectContaining({
        binding: expect.objectContaining({
          kind: 'session_artifact',
          runtimeSessionId: 'session-artifact',
          artifactId: 'report',
        }),
        previewSurface: expect.objectContaining({
          kind: 'browser_page',
          renderHint: 'iframe',
          mediaType: 'text/html',
          provenance: expect.objectContaining({
            sessionId: 'session-artifact',
            artifactId: 'report',
          }),
        }),
      }),
    }));

    const observeResponse = await app.request('/sessions/session-service/observe');
    expect(observeResponse.status).toBe(200);
    await expect(observeResponse.json()).resolves.toEqual(expect.objectContaining({
      session: expect.objectContaining({
        id: 'session-service',
        inspection: expect.objectContaining({
          browserSessions: [
            expect.objectContaining({
              id: serviceBrowser.session.id,
              runtimeSessionId: 'session-service',
              inspection: expect.objectContaining({
                openPageCount: 1,
              }),
            }),
          ],
          previewSurfaces: expect.arrayContaining([
            expect.objectContaining({
              kind: 'browser_page',
              source: 'browser_page',
              provenance: expect.objectContaining({
                sessionId: 'session-service',
                serviceId: 'preview',
              }),
            }),
          ]),
        }),
      }),
    }));
  });

  it('rejects unsupported browser page bindings with a machine-readable client error', async () => {
    const app = createTestApp();
    const createResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created = await createResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await app.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        binding: {
          kind: 'room_preview',
        },
      }),
    });
    expect(pageResponse.status).toBe(400);
    await expect(pageResponse.json()).resolves.toEqual({
      error: "Unsupported browser page binding kind 'room_preview'.",
    });
  });

  it('summarizes browser sessions and cleanup candidates through runtime-owned routes', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => now,
    });
    const readySession = await browser.createSession({
      runtimeSessionId: 'session-service',
      label: 'Attached Browser',
    });
    await browser.createPage(readySession.id, {
      url: 'http://127.0.0.1:4173',
      binding: {
        kind: 'manual_url',
        runtimeSessionId: 'session-service',
      },
    });

    now = new Date('2026-03-23T00:05:00.000Z');
    const closedSession = await browser.createSession({
      label: 'Closed Browser',
    });
    await browser.createPage(closedSession.id, {
      path: '/tmp/report.html',
      binding: {
        kind: 'manual_url',
      },
    });
    await browser.closeSession(closedSession.id);

    now = new Date('2026-03-23T00:20:00.000Z');
    const app = createTestApp();

    const response = await app.request('/browser/summary?olderThanMs=300000');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      filters: {},
      sessions: {
        total: 2,
        ready: 1,
        closed: 1,
      },
      pages: {
        total: 2,
        open: 1,
        closed: 1,
      },
      attachedRuntimeSessionCount: 1,
      drivers: [
        {
          driverId: 'manual',
          sessions: {
            total: 2,
            ready: 1,
            closed: 1,
          },
          pages: {
            total: 2,
            open: 1,
            closed: 1,
          },
        },
      ],
      cleanupCandidates: {
        olderThanMs: 300000,
        sessionCount: 1,
        pageCount: 1,
        sessionIds: [closedSession.id],
      },
    });

    const filteredSessions = await app.request('/browser/sessions?status=closed');
    expect(filteredSessions.status).toBe(200);
    await expect(filteredSessions.json()).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          id: closedSession.id,
          status: 'closed',
        }),
      ],
    });
  });

  it('cleans up closed browser sessions through the runtime-owned maintenance route', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => now,
    });

    const keepSession = await browser.createSession({
      label: 'Keep Browser',
    });
    now = new Date('2026-03-23T00:05:00.000Z');
    const closedSession = await browser.createSession({
      label: 'Cleanup Browser',
    });
    await browser.createPage(closedSession.id, {
      path: '/tmp/report.html',
      binding: {
        kind: 'manual_url',
      },
    });
    await browser.closeSession(closedSession.id);

    now = new Date('2026-03-23T00:20:00.000Z');
    const app = createTestApp();
    const cleanupResponse = await app.request('/browser/sessions/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        olderThanMs: 300000,
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toEqual({
      action: 'cleanup_browser_sessions',
      filters: {
        olderThanMs: 300000,
        status: 'closed',
      },
      matchedSessionCount: 1,
      matchedPageCount: 1,
      removedSessionCount: 1,
      removedPageCount: 1,
      removedSessionIds: [closedSession.id],
      remainingSessionCount: 1,
      remainingClosedSessionCount: 0,
    });

    expect(browser.getSession(closedSession.id)).toBeUndefined();
    expect(browser.getSession(keepSession.id)).toEqual(expect.objectContaining({
      id: keepSession.id,
      status: 'ready',
    }));
  });

  it('cleans up ready browser sessions that no longer have open pages when requested', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => now,
    });

    const keepSession = await browser.createSession({
      label: 'Keep Browser',
    });
    await browser.createPage(keepSession.id, {
      url: 'http://127.0.0.1:4173',
      binding: {
        kind: 'manual_url',
      },
    });

    now = new Date('2026-03-23T00:05:00.000Z');
    const idleSession = await browser.createSession({
      label: 'Idle Browser',
    });
    const idlePage = await browser.createPage(idleSession.id, {
      path: '/tmp/report.html',
      binding: {
        kind: 'manual_url',
      },
    });
    await browser.closePage(idleSession.id, idlePage.page.id);

    now = new Date('2026-03-23T00:20:00.000Z');
    const app = createTestApp();
    const cleanupResponse = await app.request('/browser/sessions/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'ready',
        olderThanMs: 300000,
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toEqual({
      action: 'cleanup_browser_sessions',
      filters: {
        olderThanMs: 300000,
        status: 'ready',
      },
      matchedSessionCount: 1,
      matchedPageCount: 1,
      removedSessionCount: 1,
      removedPageCount: 1,
      removedSessionIds: [idleSession.id],
      remainingSessionCount: 1,
      remainingClosedSessionCount: 0,
    });

    expect(browser.getSession(idleSession.id)).toBeUndefined();
    expect(browser.getSession(keepSession.id)).toEqual(expect.objectContaining({
      id: keepSession.id,
      status: 'ready',
    }));
  });

  it('reloads persisted browser sessions from the runtime data dir on a fresh app instance', async () => {
    const firstApp = createTestApp();

    const createResponse = await firstApp.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeSessionId: 'session-service',
        label: 'Persisted Browser Session',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await firstApp.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:4173',
        binding: {
          kind: 'manual_url',
          runtimeSessionId: 'session-service',
        },
      }),
    });
    expect(pageResponse.status).toBe(201);

    const closeResponse = await firstApp.request(`/browser/sessions/${created.session.id}/close`, {
      method: 'POST',
    });
    expect(closeResponse.status).toBe(200);

    browser = undefined;
    const secondApp = createTestApp();
    const restoredResponse = await secondApp.request('/browser/sessions?status=closed');
    expect(restoredResponse.status).toBe(200);
    await expect(restoredResponse.json()).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          id: created.session.id,
          runtimeSessionId: 'session-service',
          label: 'Persisted Browser Session',
          status: 'closed',
          pages: [
            expect.objectContaining({
              status: 'closed',
              url: 'http://127.0.0.1:4173',
            }),
          ],
        }),
      ],
    });
  });

  it('returns a machine-readable client error when browser session capacity is exhausted', async () => {
    browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      maxSessions: 1,
    });
    const app = createTestApp();

    const firstResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'First Browser Session',
      }),
    });
    expect(firstResponse.status).toBe(201);

    const secondResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Second Browser Session',
      }),
    });
    expect(secondResponse.status).toBe(400);
    await expect(secondResponse.json()).resolves.toEqual({
      error: 'Browser session capacity reached (1). Close existing browser sessions before creating another.',
    });
  });
});
