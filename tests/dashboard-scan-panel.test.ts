import { describe, expect, it } from 'vitest';
import { injectDashboardScanPanel } from '../src/http/dashboardScanPanel.js';

const MINIMAL_HTML = '<!DOCTYPE html><html><head></head><body><header></header></body></html>';

describe('injectDashboardScanPanel', () => {
  it('injects scan panel CSS before </head>', () => {
    const result = injectDashboardScanPanel(MINIMAL_HTML);
    expect(result).toContain('data-cats-scan-panel');
    expect(result).toContain('.scan-panel-btn');
    expect(result).toContain('.scan-panel-drawer');

    const cssIndex = result.indexOf('data-cats-scan-panel');
    const headClose = result.indexOf('</head>');
    expect(cssIndex).toBeLessThan(headClose);
  });

  it('injects scan panel JS before </body>', () => {
    const result = injectDashboardScanPanel(MINIMAL_HTML);
    expect(result).toContain('scanPanelManualBtn');
    expect(result).toContain('/providers/setup/scan');
    expect(result).toContain('/providers/setup/state');

    const jsIndex = result.indexOf('scanPanelManualBtn');
    const bodyClose = result.indexOf('</body>');
    expect(jsIndex).toBeLessThan(bodyClose);
  });

  it('is idempotent', () => {
    const once = injectDashboardScanPanel(MINIMAL_HTML);
    const twice = injectDashboardScanPanel(once);
    expect(once).toBe(twice);
  });

  it('contains manual scan POST action', () => {
    const result = injectDashboardScanPanel(MINIMAL_HTML);
    expect(result).toContain("{ manual: true }");
  });

  it('uses data.scan as canonical snapshot, not manualScan', () => {
    const result = injectDashboardScanPanel(MINIMAL_HTML);
    // The scan panel should use data.scan (always the most recent) rather
    // than data.manualScan || data.scan which can show stale data.
    expect(result).toContain('var scan = data.scan;');
    expect(result).not.toContain('data.manualScan || data.scan');
  });
});
