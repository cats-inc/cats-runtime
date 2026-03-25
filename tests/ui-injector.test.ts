import { describe, expect, it } from 'vitest';
import { injectSharedUI } from '../src/http/uiInjector.js';

const MINIMAL_HTML = '<!DOCTYPE html><html><head></head><body></body></html>';

describe('injectSharedUI', () => {
  it('injects shared CSS before </head>', () => {
    const result = injectSharedUI(MINIMAL_HTML);
    expect(result).toContain('data-cats-ui');
    expect(result).toContain('--bg:');
    expect(result).toContain('.provider-badge');

    // CSS should appear before </head>
    const cssIndex = result.indexOf('data-cats-ui');
    const headClose = result.indexOf('</head>');
    expect(cssIndex).toBeLessThan(headClose);
  });

  it('injects shared JS before </body>', () => {
    const result = injectSharedUI(MINIMAL_HTML);
    expect(result).toContain('window.CatsUI');

    // JS should appear before </body>
    const jsIndex = result.indexOf('window.CatsUI');
    const bodyClose = result.indexOf('</body>');
    expect(jsIndex).toBeLessThan(bodyClose);
  });

  it('is idempotent — double injection produces same result', () => {
    const once = injectSharedUI(MINIMAL_HTML);
    const twice = injectSharedUI(once);
    expect(once).toBe(twice);
  });

  it('works on realistic HTML with existing content', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Test</title>
<style>body { color: red; }</style>
</head>
<body>
<h1>Hello</h1>
<script>console.log('existing');</script>
</body>
</html>`;
    const result = injectSharedUI(html);
    expect(result).toContain('data-cats-ui');
    expect(result).toContain('window.CatsUI');
    // Existing content preserved
    expect(result).toContain('body { color: red; }');
    expect(result).toContain("console.log('existing')");
    expect(result).toContain('<h1>Hello</h1>');
  });
});
