import { RUNTIME_DIAGNOSTICS_PATHS } from '../startup.js';

const DASHBOARD_HEALTH_OVERLAY = `
<script>
(() => {
  const summaryPath = ${JSON.stringify(RUNTIME_DIAGNOSTICS_PATHS.health)};
  let runtimeHealthPayload = null;

  function healthHeaders() {
    return typeof window.headers === 'function' ? window.headers() : {};
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

  function renderRuntimeHealthOverlay() {
    if (!runtimeHealthPayload) return;

    const group = document.getElementById('runtimeStatus');
    const dot = document.getElementById('runtimeStatusDot');
    const titleEl = document.getElementById('runtimeStatusTitle');
    const labelEl = document.getElementById('runtimeStatusLabel');
    if (!group || !dot || !titleEl || !labelEl) return;

    const providerSummary = runtimeHealthPayload.providers?.summary || {};
    const runtimeSummary = runtimeHealthPayload.runtime?.summary || 'Runtime diagnostics unavailable';
    const defaults = Array.isArray(runtimeHealthPayload.providers?.defaults)
      ? runtimeHealthPayload.providers.defaults
      : [];
    const discoveryTooltip = group.dataset.discoveryTooltip || '';

    dot.dataset.state = mapRuntimeHealthState(runtimeHealthPayload.status);
    titleEl.textContent = 'Runtime / providers';
    labelEl.textContent =
      runtimeHealthPayload.status === 'unavailable'
        ? runtimeSummary
        : runtimeSummary + ' · providers ' + (providerSummary.ok || 0) + '/' + (providerSummary.targets || 0) + ' ok';

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

    group.title = tooltipLines.join('\\n');
  }

  async function refreshRuntimeHealthStatus() {
    try {
      const response = await fetch(window.location.origin + summaryPath, {
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
    }
  }

  const originalRenderDiscoveryStatus = window.renderDiscoveryStatus;
  if (typeof originalRenderDiscoveryStatus === 'function') {
    window.renderDiscoveryStatus = function(payload) {
      const result = originalRenderDiscoveryStatus.apply(this, arguments);
      const group = document.getElementById('runtimeStatus');
      if (group) {
        group.dataset.discoveryTooltip = group.title || '';
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
      group.dataset.discoveryTooltip = group.title || '';
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
