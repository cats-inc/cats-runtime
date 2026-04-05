import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('provider setup page runtime shell sync', () => {
  it('syncs the runtime surface switcher when setup-state updates change bootstrap mode', () => {
    const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');

    expect(html).toContain('window.CatsUI.syncRuntimeBootstrapState(data.bootstrapRequired)');
  });

  it('renders apply feedback below the Apply Selected action', () => {
    const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');

    expect(html.indexOf('id="applyBtn"')).toBeLessThan(html.indexOf('id="resultPanel"'));
  });
});
