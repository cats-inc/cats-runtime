import { describe, expect, it } from 'vitest';
import { ManualBrowserDriver } from '../../backends/browser/manualDriver.js';
import { RuntimeBrowserService } from './RuntimeBrowserService.js';

describe('RuntimeBrowserService', () => {
  it('creates manual browser sessions/pages and derives normalized browser-page preview surfaces', async () => {
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => new Date('2026-03-23T00:00:00.000Z'),
    });

    const session = await browser.createSession({
      runtimeSessionId: 'session-1',
      label: 'Preview Browser',
    });
    expect(session.driverId).toBe('manual');
    expect(session.inspection.driver.id).toBe('manual');

    const created = await browser.createPage(session.id, {
      url: 'http://127.0.0.1:4173',
      label: 'App Preview',
      binding: {
        kind: 'manual_url',
        runtimeSessionId: 'session-1',
      },
    });

    expect(created.page.previewSurface).toEqual(expect.objectContaining({
      kind: 'browser_page',
      source: 'browser_page',
      status: 'ready',
      renderHint: 'iframe',
      url: 'http://127.0.0.1:4173',
      provenance: expect.objectContaining({
        sessionId: 'session-1',
        browserSessionId: session.id,
      }),
    }));
    expect(created.session.inspection.previewSurfaces).toEqual([
      expect.objectContaining({
        kind: 'browser_page',
        status: 'ready',
      }),
    ]);
  });

  it('closes all pages when the browser session closes', async () => {
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => new Date('2026-03-23T00:00:00.000Z'),
    });

    const session = await browser.createSession();
    await browser.createPage(session.id, {
      path: '/tmp/report.html',
      binding: {
        kind: 'manual_url',
      },
    });

    const closed = await browser.closeSession(session.id);
    expect(closed.status).toBe('closed');
    expect(closed.pages).toEqual([
      expect.objectContaining({
        status: 'closed',
      }),
    ]);
    expect(closed.inspection.openPageCount).toBe(0);
    expect(closed.inspection.closedPageCount).toBe(1);
  });

  it('prunes closed browser sessions before creating beyond the configured capacity', async () => {
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      maxSessions: 1,
      now: () => new Date('2026-03-23T00:00:00.000Z'),
    });

    const first = await browser.createSession({
      label: 'First',
    });
    await browser.closeSession(first.id);

    const second = await browser.createSession({
      label: 'Second',
    });

    expect(browser.getSession(first.id)).toBeUndefined();
    expect(second.label).toBe('Second');
    expect(browser.listSessions()).toHaveLength(1);
  });

  it('rejects new browser sessions or pages when the configured capacity is exhausted', async () => {
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      maxSessions: 1,
      maxPagesPerSession: 1,
      now: () => new Date('2026-03-23T00:00:00.000Z'),
    });

    const session = await browser.createSession({
      label: 'Only Session',
    });
    await expect(browser.createSession({
      label: 'Overflow Session',
    })).rejects.toThrow('Browser session capacity reached (1).');

    await browser.createPage(session.id, {
      url: 'http://127.0.0.1:4173',
      binding: {
        kind: 'manual_url',
      },
    });
    await expect(browser.createPage(session.id, {
      url: 'http://127.0.0.1:4174',
      binding: {
        kind: 'manual_url',
      },
    })).rejects.toThrow("Browser session '" + session.id + "' reached the maximum page capacity of 1.");
  });

  it('summarizes browser sessions/pages and cleanup candidates', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => now,
    });

    const readySession = await browser.createSession({
      runtimeSessionId: 'session-1',
      label: 'Ready Browser',
    });
    await browser.createPage(readySession.id, {
      url: 'http://127.0.0.1:4173',
      binding: {
        kind: 'manual_url',
        runtimeSessionId: 'session-1',
      },
    });

    now = new Date('2026-03-23T00:10:00.000Z');
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
    expect(browser.summarizeSessions({
      olderThanMs: 5 * 60 * 1000,
    })).toEqual({
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
        olderThanMs: 5 * 60 * 1000,
        sessionCount: 1,
        pageCount: 1,
        sessionIds: [closedSession.id],
      },
    });
  });

  it('cleans up closed browser sessions older than the requested threshold', async () => {
    let now = new Date('2026-03-23T00:00:00.000Z');
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => now,
    });

    const readySession = await browser.createSession({
      label: 'Keep Me',
    });

    now = new Date('2026-03-23T00:05:00.000Z');
    const closedSession = await browser.createSession({
      label: 'Remove Me',
    });
    await browser.createPage(closedSession.id, {
      path: '/tmp/report.html',
      binding: {
        kind: 'manual_url',
      },
    });
    await browser.closeSession(closedSession.id);

    now = new Date('2026-03-23T00:15:00.000Z');
    expect(browser.cleanupSessions({
      olderThanMs: 5 * 60 * 1000,
    })).toEqual({
      action: 'cleanup_browser_sessions',
      filters: {
        olderThanMs: 5 * 60 * 1000,
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
    expect(browser.getSession(readySession.id)).toEqual(expect.objectContaining({
      id: readySession.id,
      status: 'ready',
    }));
  });
});
