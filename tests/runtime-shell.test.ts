import { describe, expect, it } from 'vitest';

import { injectRuntimeShellState } from '../src/http/ui/runtimeShell.js';

const MINIMAL_RUNTIME_PAGE = `<!DOCTYPE html>
<html lang="en">
<head></head>
<body data-runtime-surface="__CATS_RUNTIME_SURFACE__" data-bootstrap-required="__CATS_RUNTIME_BOOTSTRAP_REQUIRED__">
  <div class="runtime-brand-row"><!-- CATS_RUNTIME_SURFACE_SWITCHER --></div>
</body>
</html>`;

describe('injectRuntimeShellState', () => {
  it('renders the active surface switcher state for non-bootstrap pages', () => {
    const result = injectRuntimeShellState(MINIMAL_RUNTIME_PAGE, {
      surface: 'playground',
      bootstrapRequired: false,
    });

    expect(result).toContain('data-runtime-surface-switcher');
    expect(result).toContain('data-active-surface="playground"');
    expect(result).toContain('data-bootstrap-required="false"');
    expect(result).toContain('runtime-surface-trigger-label">Playground');
    expect(result).toContain('href="/dashboard"');
    expect(result).toContain('href="/setup"');
    expect(result).toContain('Current');
  });

  it('locks dashboard and playground in bootstrap mode while keeping setup active', () => {
    const result = injectRuntimeShellState(MINIMAL_RUNTIME_PAGE, {
      surface: 'setup',
      bootstrapRequired: true,
    });

    expect(result).toContain('data-runtime-surface-switcher');
    expect(result).toContain('data-active-surface="setup"');
    expect(result).toContain('data-bootstrap-required="true"');
    expect(result).toContain('runtime-surface-trigger-label">Setup');
    expect((result.match(/>Locked</g) || []).length).toBe(2);
    expect(result).not.toContain('href="/dashboard"');
    expect(result).not.toContain('href="/playground"');
    expect(result).toContain('Current');
  });
});
