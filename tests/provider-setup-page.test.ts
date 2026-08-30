import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('provider setup page runtime shell sync', () => {
  it('syncs the runtime surface switcher when setup-state updates change bootstrap mode', () => {
    const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');

    expect(html).toContain('window.CatsUI.syncRuntimeBootstrapState(data.bootstrapRequired)');
  });

  it('waits out a started scan on /setup-state instead of on the POST', () => {
    const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');

    // The POST answers 202 while the probes are still running, so holding the
    // request open is what produced a proxy timeout rendered as a scan failure.
    expect(html).toContain('waitForScanToSettle');
    expect(html).toContain("data.state.status !== 'scanning'");
  });

  it('reports the runtime error for a failed scan rather than a transport status', () => {
    const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');

    expect(html).toContain("data.state.status === 'error'");
    expect(html).toContain('data.state.error');
  });

  it('renders apply feedback below the Apply Selected action', () => {
    const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');

    expect(html.indexOf('id="applyBtn"')).toBeLessThan(html.indexOf('id="resultPanel"'));
  });
});
