// ---------------------------------------------------------------------------
// Shared Runtime UI Foundation
//
// Canonical source for design tokens, provider badge styles, and thin
// browser-side helpers shared across dashboard, playground, and
// provider-setup.  Consumed by the server-side injector
// (src/http/uiInjector.ts) which inlines the CSS and JS into each
// page before serving.
// ---------------------------------------------------------------------------

import { GENERATED_RUNTIME_TAILWIND_CSS } from './generated/runtimeTailwind.js';

// ---------------------------------------------------------------------------
// CSS: Design Tokens
// ---------------------------------------------------------------------------

export const SHARED_TOKENS_CSS = GENERATED_RUNTIME_TAILWIND_CSS;

// ---------------------------------------------------------------------------
// CSS: Provider Badge Styles
// ---------------------------------------------------------------------------

export const PROVIDER_BADGE_CSS = `
.provider-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  display: inline-block;
}
.provider-badge[data-p="claude"]   { background: rgba(224,145,69,0.2);  color: var(--claude, #e09145); }
.provider-badge[data-p="codex"]    { background: rgba(34,197,94,0.2);   color: var(--codex, #22c55e); }
.provider-badge[data-p="copilot"]  { background: rgba(163,113,247,0.2); color: var(--copilot, #a371f7); }
.provider-badge[data-p="cursor"]   { background: rgba(249,115,22,0.2);  color: var(--cursorp, #f97316); }
.provider-badge[data-p="gemini"]   { background: rgba(66,133,244,0.2);  color: var(--gemini, #4285f4); }
.provider-badge[data-p="kiro"]     { background: rgba(20,184,166,0.2);  color: var(--kiro, #14b8a6); }
.provider-badge[data-p="auggie"]   { background: rgba(6,182,212,0.2);   color: var(--auggie, #06b6d4); }
.provider-badge[data-p="opencode"] { background: rgba(244,114,182,0.2); color: var(--opencode, #f472b6); }
.provider-badge[data-p="pi"]       { background: rgba(168,162,158,0.2); color: var(--pi, #a8a29e); }
.provider-badge[data-p="goose"]    { background: rgba(139,92,246,0.2);  color: var(--goose, #8b5cf6); }
.provider-badge[data-p="junie"]    { background: rgba(252,128,29,0.2);  color: var(--junie, #fc801d); }
.provider-badge[data-p="ollama"]   { background: rgba(100,116,139,0.2); color: #64748b; }
.status-badge {
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  display: inline-block;
}
.status-badge-ok         { background: var(--green, #4ade80);  color: #000; }
.status-badge-ready      { background: var(--green, #4ade80);  color: #000; }
.status-badge-degraded   { background: var(--yellow, #facc15); color: #000; }
.status-badge-bootstrap  { background: var(--orange, #fb923c); color: #000; }
.status-badge-unavailable { background: var(--red, #f87171);   color: #fff; }
.status-badge-unknown    { background: var(--text2, #8b90a0);  color: #000; }
`.trim();

// ---------------------------------------------------------------------------
// JS: Shared Browser Helpers (IIFE — attaches to window.CatsUI)
// ---------------------------------------------------------------------------

export const SHARED_UI_SCRIPT = `
(function() {
  'use strict';

  function getApiKey() {
    var el = document.getElementById('apiKeyInput')
          || document.getElementById('api-key');
    if (el && typeof el.value === 'string') {
      return el.value.trim();
    }
    return '';
  }

  function authHeaders(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    var key = getApiKey();
    if (key) h['Authorization'] = 'Bearer ' + key;
    return h;
  }

  function apiFetch(path, init) {
    init = init || {};
    if (!init.headers) {
      init.headers = authHeaders();
    } else {
      var ah = authHeaders();
      for (var k in ah) {
        if (!init.headers[k]) init.headers[k] = ah[k];
      }
    }
    return fetch(path, init);
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderProviderBadge(provider, label) {
    var p = String(provider || '').toLowerCase();
    var text = label || p.toUpperCase();
    return '<span class="provider-badge" data-p="' + escapeAttr(p) + '">' + escapeAttr(text) + '</span>';
  }

  function renderStatusBadge(status, label) {
    var cls = 'status-badge status-badge-' + String(status || 'unknown').toLowerCase();
    return '<span class="' + escapeAttr(cls) + '">' + escapeAttr(label || status || 'Unknown') + '</span>';
  }

  function closeRuntimeSurfaceMenus() {
    var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      root.setAttribute('data-open', 'false');
      var trigger = root.querySelector('[data-runtime-surface-trigger]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      var menu = root.querySelector('[data-runtime-surface-menu]');
      if (menu) menu.classList.add('hidden');
    }
  }

  function initRuntimeSurfaceSwitchers() {
    var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (root.getAttribute('data-bound') === 'true') continue;
      root.setAttribute('data-bound', 'true');
      var trigger = root.querySelector('[data-runtime-surface-trigger]');
      var menu = root.querySelector('[data-runtime-surface-menu]');
      if (!trigger || !menu) continue;

      trigger.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var currentRoot = this.closest('[data-runtime-surface-switcher]');
        if (!currentRoot) return;
        var currentMenu = currentRoot.querySelector('[data-runtime-surface-menu]');
        var isOpen = currentRoot.getAttribute('data-open') === 'true';
        closeRuntimeSurfaceMenus();
        if (!isOpen) {
          currentRoot.setAttribute('data-open', 'true');
          this.setAttribute('aria-expanded', 'true');
          if (currentMenu) currentMenu.classList.remove('hidden');
        }
      });

      var links = root.querySelectorAll('[data-runtime-surface-menu] a');
      for (var j = 0; j < links.length; j++) {
        links[j].addEventListener('click', function() {
          closeRuntimeSurfaceMenus();
        });
      }
    }

    if (document.documentElement.getAttribute('data-runtime-surface-switchers-ready') === 'true') {
      return;
    }
    document.documentElement.setAttribute('data-runtime-surface-switchers-ready', 'true');
    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!(target instanceof Node)) {
        closeRuntimeSurfaceMenus();
        return;
      }
      var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
      for (var i = 0; i < roots.length; i++) {
        if (roots[i].contains(target)) {
          return;
        }
      }
      closeRuntimeSurfaceMenus();
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeRuntimeSurfaceMenus();
      }
    });
  }

  window.CatsUI = {
    getApiKey: getApiKey,
    authHeaders: authHeaders,
    apiFetch: apiFetch,
    renderProviderBadge: renderProviderBadge,
    renderStatusBadge: renderStatusBadge,
    initRuntimeSurfaceSwitchers: initRuntimeSurfaceSwitchers,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRuntimeSurfaceSwitchers, { once: true });
  } else {
    queueMicrotask(initRuntimeSurfaceSwitchers);
  }
})();
`.trim();
