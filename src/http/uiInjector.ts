// ---------------------------------------------------------------------------
// Shared Runtime UI Injector
//
// Inlines the shared CSS tokens, provider badge styles, and CatsUI
// browser helpers into any runtime-served HTML page.  Follows the
// same pattern as dashboardHealthOverlay.ts.
// ---------------------------------------------------------------------------

import {
  SHARED_TOKENS_CSS,
  PROVIDER_BADGE_CSS,
  SHARED_UI_SCRIPT,
} from './ui/shared.js';

const MARKER = 'data-cats-ui';

/**
 * Inject the shared runtime UI foundation (CSS + JS) into an HTML
 * string.  Idempotent — returns the input unchanged if already
 * injected.
 */
export function injectSharedUI(html: string): string {
  if (html.includes(MARKER)) {
    return html;
  }

  const css = `<style ${MARKER}>\n${SHARED_TOKENS_CSS}\n${PROVIDER_BADGE_CSS}\n</style>`;
  const js = `<script ${MARKER}>\n${SHARED_UI_SCRIPT}\n</script>`;

  // Inject CatsUI before page-level scripts execute. Several runtime pages call
  // window.CatsUI helpers during their first init pass, so appending this at
  // </body> creates a first-load race that falsely marks runtime targets as
  // unavailable.
  html = html.replace('</head>', `${css}\n${js}\n</head>`);

  return html;
}
