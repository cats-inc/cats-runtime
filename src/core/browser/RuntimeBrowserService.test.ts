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
});
