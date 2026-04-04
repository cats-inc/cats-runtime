// ---------------------------------------------------------------------------
// Dashboard Scan & Repair Panel
//
// Injects a collapsible provider scan panel into the dashboard that
// lets operators trigger an explicit provider scan and view repair guidance inline
// without leaving the dashboard or editing YAML by hand.
// ---------------------------------------------------------------------------

const SCAN_PANEL_MARKER = 'data-cats-scan-panel';

const SCAN_PANEL_CSS = `
<style ${SCAN_PANEL_MARKER}>
.scan-panel-btn {
  background: var(--surface2, #242836);
  border: 1px solid var(--border, #2e3345);
  color: var(--text, #e1e4ed);
  padding: 6px 12px;
  border-radius: var(--radius, 8px);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.scan-panel-btn:hover {
  background: var(--accent-dim, #4a62b3);
  border-color: var(--accent, #6c8cff);
}
.scan-panel-btn.active {
  background: var(--accent-dim, #4a62b3);
  border-color: var(--accent, #6c8cff);
}
.scan-panel-drawer {
  display: none;
  background: var(--surface, #1a1d27);
  border-bottom: 1px solid var(--border, #2e3345);
  padding: 12px 20px;
  font-size: 13px;
  max-height: 400px;
  overflow-y: auto;
}
.scan-panel-drawer.open { display: block; }
.scan-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.scan-panel-header h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.scan-panel-actions {
  display: flex;
  gap: 8px;
}
.scan-panel-actions button {
  padding: 5px 12px;
  border-radius: var(--radius, 8px);
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}
.scan-btn-manual {
  background: var(--accent, #6c8cff);
  color: #fff;
}
.scan-btn-manual:hover { background: var(--accent-dim, #4a62b3); }
.scan-btn-manual:disabled { opacity: 0.5; cursor: not-allowed; }
.scan-btn-close {
  background: transparent;
  color: var(--text2, #8b90a0);
  border: 1px solid var(--border, #2e3345) !important;
}
.scan-btn-close:hover { background: var(--surface2, #242836); color: var(--text, #e1e4ed); }
.scan-panel-provider {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border, #2e3345);
  gap: 10px;
}
.scan-panel-provider:last-child { border-bottom: none; }
.scan-panel-provider-info { flex: 1; min-width: 0; }
.scan-panel-provider-name { font-weight: 600; font-size: 13px; }
.scan-panel-provider-detail {
  font-size: 11px;
  color: var(--text2, #8b90a0);
  margin-top: 1px;
}
.scan-panel-remediation {
  font-size: 11px;
  color: var(--orange, #fb923c);
  margin-top: 2px;
}
.scan-panel-remediation code {
  background: var(--surface2, #242836);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
}
.scan-panel-meta {
  font-size: 11px;
  color: var(--text2, #8b90a0);
  margin-top: 6px;
}
.scan-panel-empty {
  color: var(--text2, #8b90a0);
  font-size: 13px;
  padding: 8px 0;
}
</style>`;

const SCAN_PANEL_SCRIPT = `
<script ${SCAN_PANEL_MARKER}>
(function() {
  'use strict';
  var CUI = window.CatsUI || {};

  // --- DOM setup ---
  var header = document.querySelector('header');
  if (!header) return;

  // "Scan Providers" button in header — visible and prominent
  var scanBtn = document.createElement('button');
  scanBtn.className = 'scan-panel-btn';
  scanBtn.textContent = '\\u21bb Scan Providers';
  scanBtn.title = 'Open provider scan & repair panel';

  // Insert into the nav link group if present, else before api-key group
  var navGroup = header.querySelector('[style*="margin-left:auto"]');
  if (navGroup) {
    navGroup.insertBefore(scanBtn, navGroup.firstChild);
  } else {
    var apiKeyGroup = header.querySelector('.api-key-group');
    if (apiKeyGroup) {
      header.insertBefore(scanBtn, apiKeyGroup);
    } else {
      header.appendChild(scanBtn);
    }
  }

  // Drawer below header
  var drawer = document.createElement('div');
  drawer.className = 'scan-panel-drawer';
  drawer.innerHTML = '<div class="scan-panel-header">'
    + '<h3>Provider Scan & Repair</h3>'
    + '<div class="scan-panel-actions">'
    + '<button class="scan-btn-manual" id="scanPanelManualBtn">\\u21bb Scan Providers</button>'
    + '<button class="scan-btn-close" id="scanPanelCloseBtn">Close</button>'
    + '</div>'
    + '</div>'
    + '<div id="scanPanelResults" class="scan-panel-empty">No scan results yet. Click "Scan Providers" to check provider availability.</div>'
    + '<div id="scanPanelMeta" class="scan-panel-meta"></div>';
  header.parentNode.insertBefore(drawer, header.nextSibling);

  // --- Toggle ---
  scanBtn.addEventListener('click', function() {
    var isOpen = drawer.classList.toggle('open');
    scanBtn.classList.toggle('active', isOpen);
    if (isOpen) loadScanState();
  });

  document.getElementById('scanPanelCloseBtn').addEventListener('click', function() {
    drawer.classList.remove('open');
    scanBtn.classList.remove('active');
  });

  // --- Load persisted scan state ---
  function loadScanState() {
    var fetchFn = CUI.apiFetch || fetch;
    fetchFn('/setup-state').then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(data) {
      // Use data.scan — it is always the most recent snapshot because
      // BootstrapService.scan() writes to provider-scan.json on every scan
      // regardless of type.  manualScan is a historical subset, not fresher.
      var scan = data.scan;
      if (scan && scan.providers) {
        renderProviders(scan.providers);
        renderMeta(scan);
      }
    }).catch(function() {
      // Silently ignore — panel shows default message
    });
  }

  // --- Explicit operator scan ---
  var manualBtn = document.getElementById('scanPanelManualBtn');
  manualBtn.addEventListener('click', function() {
    manualBtn.disabled = true;
    manualBtn.textContent = 'Scanning...';
    var resultsEl = document.getElementById('scanPanelResults');
    resultsEl.innerHTML = '<div class="scan-panel-empty">Scanning providers...</div>';

    var fetchFn = CUI.apiFetch || fetch;
    fetchFn('/setup-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual: true }),
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(data) {
      if (data.scan && data.scan.providers) {
        renderProviders(data.scan.providers);
        renderMeta(data.scan);
      }
    }).catch(function(err) {
      resultsEl.innerHTML = '<div class="scan-panel-empty" style="color:var(--red)">Scan failed: ' + escapeHtml(err.message) + '</div>';
    }).finally(function() {
      manualBtn.disabled = false;
      manualBtn.textContent = '\\u21bb Scan Providers';
    });
  });

  // --- Render helpers ---
  function renderProviders(providers) {
    var html = '';
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      var badge = CUI.renderStatusBadge
        ? CUI.renderStatusBadge(p.available ? 'ready' : (p.commandStatus === 'probe_failed' ? 'unavailable' : 'degraded'),
            p.available ? 'Ready' : (p.commandStatus === 'missing_install' ? 'Not installed' : p.commandStatus))
        : '';
      var provBadge = CUI.renderProviderBadge ? CUI.renderProviderBadge(p.provider) : escapeHtml(p.provider);
      var detail = escapeHtml(p.provider) + (p.version ? ' v' + escapeHtml(p.version) : '') + (p.commandPath ? ' \\u2014 ' + escapeHtml(p.commandPath) : '');
      var remediation = '';
      if (p.remediation && p.remediation.length) {
        for (var j = 0; j < p.remediation.length; j++) {
          var r = p.remediation[j];
          remediation += '<div class="scan-panel-remediation">' + escapeHtml(r.summary) + (r.command ? ' <code>' + escapeHtml(r.command) + '</code>' : '') + '</div>';
        }
      }
      html += '<div class="scan-panel-provider">'
        + '<div class="scan-panel-provider-info">'
        + '<div class="scan-panel-provider-name">' + provBadge + ' ' + escapeHtml(p.family || p.provider) + '</div>'
        + '<div class="scan-panel-provider-detail">' + detail + '</div>'
        + remediation
        + '</div>'
        + '<div>' + badge + '</div>'
        + '</div>';
    }
    document.getElementById('scanPanelResults').innerHTML = html || '<div class="scan-panel-empty">No providers found.</div>';
  }

  function renderMeta(scan) {
    var meta = 'Scanned: ' + (scan.scannedAt ? new Date(scan.scannedAt).toLocaleString() : 'unknown');
    meta += ' \\u00b7 Type: ' + (scan.scanType || 'unknown');
    document.getElementById('scanPanelMeta').textContent = meta;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
</script>`;

/**
 * Inject the scan & repair panel into dashboard HTML.
 * Idempotent — returns the input unchanged if already injected.
 */
export function injectDashboardScanPanel(html: string): string {
  if (html.includes(SCAN_PANEL_MARKER)) {
    return html;
  }

  html = html.replace('</head>', `${SCAN_PANEL_CSS}\n</head>`);
  html = html.replace('</body>', `${SCAN_PANEL_SCRIPT}\n</body>`);

  return html;
}
