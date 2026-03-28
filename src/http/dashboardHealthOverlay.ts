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
    labelEl.textContent = formatRuntimeHealthLabel(
      runtimeHealthPayload.runtime?.status,
      runtimeSummary,
      providerSummary,
    );

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
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;
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
