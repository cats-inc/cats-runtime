import { describe, expect, it } from 'vitest';
import { ManualBrowserDriver } from '../../backends/browser/manualDriver.js';
import { RuntimeBrowserService } from './RuntimeBrowserService.js';
import { RuntimeBrowserMaintenanceService } from './RuntimeBrowserMaintenanceService.js';

describe('RuntimeBrowserMaintenanceService', () => {
  it('sweeps closed browser sessions older than the configured TTL', async () => {
    let now = new Date('2026-03-24T00:00:00.000Z');
    const browser = new RuntimeBrowserService({
      drivers: [
        new ManualBrowserDriver(),
      ],
      now: () => now,
    });

    const keepSession = await browser.createSession({
      label: 'keep',
    });
    now = new Date('2026-03-24T00:05:00.000Z');
    const closedSession = await browser.createSession({
      label: 'remove',
    });
    await browser.createPage(closedSession.id, {
      path: '/tmp/report.html',
      binding: {
        kind: 'manual_url',
      },
    });
    await browser.closeSession(closedSession.id);

    now = new Date('2026-03-24T00:20:00.000Z');
    const maintenance = new RuntimeBrowserMaintenanceService({
      browser,
      now: () => now,
      closedSessionTtlMs: 5 * 60 * 1000,
    });

    const sweep = maintenance.sweep();

    expect(sweep).toEqual(expect.objectContaining({
      action: 'cleanup_browser_sessions',
      observedAt: '2026-03-24T00:20:00.000Z',
      removedSessionCount: 1,
      removedSessionIds: [closedSession.id],
    }));
    expect(browser.getSession(closedSession.id)).toBeUndefined();
    expect(browser.getSession(keepSession.id)).toEqual(expect.objectContaining({
      id: keepSession.id,
    }));
    expect(maintenance.snapshot()).toEqual(expect.objectContaining({
      lastSweep: expect.objectContaining({
        removedSessionIds: [closedSession.id],
      }),
    }));
  });
});
