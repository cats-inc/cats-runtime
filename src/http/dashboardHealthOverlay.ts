import { RUNTIME_DIAGNOSTICS_PATHS } from '../startup.js';

interface RuntimeHealthProviderSummary {
  status?: string;
  ok?: number;
  targets?: number;
  summary?: string;
}

export function formatRuntimeHealthLabel(
  runtimeStatus: string | undefined,
  runtimeSummary: string,
  providerSummary: RuntimeHealthProviderSummary,
): string {
  if (runtimeStatus === 'unavailable') {
    return runtimeSummary;
  }

  const ok = providerSummary.ok || 0;
  const targets = providerSummary.targets || 0;
  const providerLabel = providerSummary.status && providerSummary.status !== 'ok'
    ? providerSummary.summary || `providers ${ok}/${targets} ok`
    : `providers ${ok}/${targets} ok`;

  return `${runtimeSummary} · ${providerLabel}`;
}

const DASHBOARD_HEALTH_OVERLAY = `
<script>
(() => {
  const formatRuntimeHealthLabel = ${formatRuntimeHealthLabel.toString()};
  const summaryPath = ${JSON.stringify(RUNTIME_DIAGNOSTICS_PATHS.health)};
  let runtimeHealthPayload = null;
  let refreshInFlight = false;
  let runtimeProxyWarningEmitted = false;

  function healthHeaders() {
    return typeof window.headers === 'function' ? window.headers() : {};
  }

  function runtimeApiUrl(path) {
    const configuredBase = typeof window.__CATS_RUNTIME_API_BASE__ === 'string'
      ? window.__CATS_RUNTIME_API_BASE__.trim()
      : '';
    const proxyMode = window.__CATS_RUNTIME_PROXY_MODE__ === true;
    if (proxyMode && !configuredBase && !runtimeProxyWarningEmitted) {
      runtimeProxyWarningEmitted = true;
      console.warn(
        'Cats runtime health overlay: platform proxy mode active but '
        + 'window.__CATS_RUNTIME_API_BASE__ is missing. Falling back to window.location.origin.',
      );
    }
    const base = configuredBase
      ? configuredBase.replace(/\\/+$/, '')
      : window.location.origin;
    return base + path;
  }

  function mapRuntimeHealthState(status) {
    switch (status) {
      case 'ok':
        return 'active';
      case 'degraded':
        return 'skipped';
      case 'unavailable':
        return 'failed';
      default:
        return 'idle';
    }
  }

  function runtimeHealthDisplay(status, startup) {
    if (startup && startup.phase !== 'ready') {
      return 'Bootstrap';
    }
    switch (status) {
      case 'ok':
        return 'Healthy';
      case 'degraded':
        return 'Degraded';
      case 'unavailable':
        return 'Unavailable';
      default:
        return 'Unknown';
    }
  }

  function setTooltip(target, tooltip) {
    if (!target) return;
    if (window.CatsUI && typeof window.CatsUI.setRuntimeTooltip === 'function') {
      window.CatsUI.setRuntimeTooltip(target, tooltip);
      return;
    }
    if (tooltip) {
      target.setAttribute('data-runtime-tooltip', tooltip);
    } else {
      target.removeAttribute('data-runtime-tooltip');
    }
    target.removeAttribute('title');
  }

  function readTooltip(target) {
    if (!target) return '';
    return target.getAttribute('data-runtime-tooltip') || target.title || '';
  }

  function readDiscoveryTooltip() {
    if (typeof window.__runtimeDiscoveryTooltip === 'string') {
      return window.__runtimeDiscoveryTooltip;
    }
    const group = document.getElementById('runtimeStatus');
    return group?.dataset.discoveryTooltip || readTooltip(group) || '';
  }

  function renderRuntimeShellHealth(label, tooltip) {
    var root = document.querySelector('[data-runtime-shell-health]');
    if (!root) return;

    var dot = root.querySelector('[data-runtime-shell-health-dot]');
    var stateEl = root.querySelector('[data-runtime-shell-health-state]');
    var summaryEl = root.querySelector('[data-runtime-shell-health-summary]');

    if (dot) {
      dot.dataset.state = mapRuntimeHealthState(runtimeHealthPayload.status);
    }
    if (stateEl) {
      stateEl.textContent = runtimeHealthDisplay(
        runtimeHealthPayload.status,
        runtimeHealthPayload.runtime?.startup,
      );
    }
    if (summaryEl) {
      summaryEl.textContent = label;
    }
    setTooltip(root, tooltip);
  }

  function renderRuntimeHealthOverlay() {
    if (!runtimeHealthPayload) return;

    const group = document.getElementById('runtimeStatus');
    const dot = document.getElementById('runtimeStatusDot');
    const titleEl = document.getElementById('runtimeStatusTitle');
    const labelEl = document.getElementById('runtimeStatusLabel');

    const providerSummary = runtimeHealthPayload.providers?.summary || {};
    const runtimeSummary = runtimeHealthPayload.runtime?.summary || 'Runtime diagnostics unavailable';
    const defaults = Array.isArray(runtimeHealthPayload.providers?.defaults)
      ? runtimeHealthPayload.providers.defaults
      : [];
    const discoveryTooltip = readDiscoveryTooltip();
    const label = formatRuntimeHealthLabel(
      runtimeHealthPayload.runtime?.status,
      runtimeSummary,
      providerSummary,
    );

    if (dot) {
      dot.dataset.state = mapRuntimeHealthState(runtimeHealthPayload.status);
    }
    if (titleEl) {
      titleEl.textContent = 'Runtime / providers';
    }
    if (labelEl) {
      labelEl.textContent = label;
    }

    const tooltipLines = [
      'Runtime: ' + (runtimeHealthPayload.runtime?.status || 'unknown') + ' - ' + runtimeSummary,
      'Startup: ' + (runtimeHealthPayload.runtime?.startup?.mode || 'unknown') + ' / ' + (runtimeHealthPayload.runtime?.startup?.phase || 'unknown'),
      'Providers (' + (runtimeHealthPayload.providers?.probe || 'light') + '): ' + (providerSummary.summary || 'No provider diagnostics available'),
    ];

    for (const provider of defaults) {
      tooltipLines.push('- ' + provider.provider + ' [' + provider.target + '] ' + provider.status + ': ' + provider.summary);
    }

    if (discoveryTooltip) {
      tooltipLines.push('', 'Discovery:', discoveryTooltip);
    }

    var tooltip = tooltipLines.join('\\n');
    if (group) {
      setTooltip(group, tooltip);
    }
    renderRuntimeShellHealth(label, tooltip);
  }

  async function refreshRuntimeHealthStatus() {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;
    try {
      const response = await fetch(runtimeApiUrl(summaryPath), {
        headers: healthHeaders(),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          runtimeHealthPayload = {
            status: 'degraded',
            runtime: {
              status: 'degraded',
              summary: 'API key required for runtime diagnostics.',
              startup: {},
            },
            providers: {
              probe: 'light',
              summary: {
                ok: 0,
                targets: 0,
                summary: 'Provider diagnostics are locked until the API key is provided.',
              },
              defaults: [],
            },
          };
          renderRuntimeHealthOverlay();
          return;
        }

        throw new Error('HTTP ' + response.status);
      }

      runtimeHealthPayload = await response.json();
      renderRuntimeHealthOverlay();
    } catch (error) {
      runtimeHealthPayload = {
        status: 'unavailable',
        runtime: {
          status: 'unavailable',
          summary: 'Runtime diagnostics unavailable: ' + error.message,
          startup: {},
        },
        providers: {
          probe: 'light',
          summary: {
            ok: 0,
            targets: 0,
            summary: 'Provider diagnostics unavailable.',
          },
          defaults: [],
        },
      };
      renderRuntimeHealthOverlay();
    } finally {
      refreshInFlight = false;
    }
  }

  const originalRenderDiscoveryStatus = window.renderDiscoveryStatus;
  if (typeof originalRenderDiscoveryStatus === 'function') {
    window.renderDiscoveryStatus = function(payload) {
      const result = originalRenderDiscoveryStatus.apply(this, arguments);
      const group = document.getElementById('runtimeStatus');
      if (group) {
        group.dataset.discoveryTooltip = readDiscoveryTooltip();
      }
      renderRuntimeHealthOverlay();
      return result;
    };
  }

  const originalRefreshProviderCatalog = window.refreshProviderCatalog;
  if (typeof originalRefreshProviderCatalog === 'function') {
    window.refreshProviderCatalog = async function() {
      const result = await originalRefreshProviderCatalog.apply(this, arguments);
      renderRuntimeHealthOverlay();
      return result;
    };
  }

  window.refreshRuntimeHealthStatus = refreshRuntimeHealthStatus;
  queueMicrotask(() => {
    const group = document.getElementById('runtimeStatus');
    if (group) {
      group.dataset.discoveryTooltip = readDiscoveryTooltip();
    }
    void refreshRuntimeHealthStatus();
  });
  setInterval(() => {
    void refreshRuntimeHealthStatus();
  }, 5000);
})();
</script>`;

export function injectRuntimeDashboardHealthOverlay(html: string): string {
  if (html.includes(summaryPathMarker())) {
    return html;
  }

  return html.replace('</body>', `${DASHBOARD_HEALTH_OVERLAY}\n</body>`);
}

function summaryPathMarker(): string {
  return `${RUNTIME_DIAGNOSTICS_PATHS.health}`;
}
