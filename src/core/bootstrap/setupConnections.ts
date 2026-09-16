import type { AgentBackendManager } from '../../backends/agent/runtime/AgentBackendManager.js';
import { getRuntimeConfigEnv, type RuntimeConfig } from '../config.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { buildRemoteModelDiscoveryRequest, fetchRemoteModelDiscovery, resolveRemoteEndpoint } from '../models/remoteModelDiscovery.js';
import { configuredTargets, selectedTarget, type SelectedProviderTarget } from './ProviderSelectionService.js';
import type { ProviderScanEntry } from './BootstrapService.js';
import { lookupNativeCommand } from '../process/commandLookup.js';

export interface SetupConnection extends SelectedProviderTarget {
  endpoint: string;
  editable: boolean;
  source?: string;
}

/** Expose only editable endpoint values, never resolved credentials or secret URLs. */
export function readSetupConnections(config: RuntimeConfig): SetupConnection[] {
  const env = getRuntimeConfigEnv(config);
  return configuredTargets(config).flatMap((target): SetupConnection[] => {
    const remote = target.remoteInstance;
    if (!remote || !['ollama', 'openclaw', 'openclaw_gateway'].includes(remote.transport ?? '')) return [];
    const variable = remote.urlEnv && env[remote.urlEnv] ? remote.urlEnv
      : remote.baseUrlEnv && env[remote.baseUrlEnv] ? remote.baseUrlEnv : null;
    if (variable) return [{ ...selectedTarget(target), endpoint: '', editable: false, source: `Managed by ${variable}` }];
    const endpoint = resolveRemoteEndpoint(remote, env) ?? '';
    if (endpoint) {
      try {
        const url = new URL(endpoint);
        if (url.username || url.password || url.search || url.hash) {
          return [{ ...selectedTarget(target), endpoint: '', editable: false, source: 'Managed in Runtime configuration (contains private URL fields)' }];
        }
      } catch { return [{ ...selectedTarget(target), endpoint: '', editable: false, source: 'Repair this URL in Runtime configuration' }]; }
    }
    const reference = remote.urlEnv || remote.baseUrlEnv;
    return [{ ...selectedTarget(target), endpoint, editable: true,
      ...(reference ? { source: `${reference} overrides this fallback URL when set` } : {}) }];
  });
}

export async function probeSetupNonCliTarget(
  target: ProviderTargetDescriptor,
  options: { includeConnections: boolean; env: NodeJS.ProcessEnv;
    agentBackend?: Pick<AgentBackendManager, 'probe'>; fetch?: typeof fetch;
    lookup?: typeof lookupNativeCommand },
): Promise<Partial<ProviderScanEntry> | null> {
  const remote = target.remoteInstance;
  if (!remote) return null;
  if (remote.transport === 'acp_stdio' && options.agentBackend) {
    const { result } = await options.agentBackend.probe(target, true, undefined, { mode: 'light' });
    const lookup = result?.checks?.find((entry) => entry.code === 'acp_command_lookup');
    const path = lookup?.details?.resolvedPath;
    const installed = typeof path === 'string' && path.length > 0;
    return { commandStatus: installed ? 'ready' : 'missing_install', commandPath: installed ? path : null,
      available: installed, authStatus: 'unknown' };
  }
  if (!options.includeConnections) return null;
  if (remote.transport === 'ollama') {
    const endpoint = resolveRemoteEndpoint(remote, options.env);
    let localInstallation: Partial<ProviderScanEntry> = {};
    if (endpoint && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)) {
      const lookupEnv = { ...options.env };
      if (process.platform === 'win32') {
        // runScan refreshes the registry PATH after a Desktop installer. The
        // original config environment snapshot must not shadow that refresh.
        for (const name of Object.keys(lookupEnv)) if (name.toUpperCase() === 'PATH') delete lookupEnv[name];
        const pathKey = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH');
        if (pathKey) lookupEnv[pathKey] = process.env[pathKey];
      }
      const found = await (options.lookup ?? lookupNativeCommand)('ollama', { env: lookupEnv });
      localInstallation = { commandStatus: found.available ? 'ready' : 'missing_install', commandPath: found.resolvedPath ?? null };
    }
    const request = buildRemoteModelDiscoveryRequest(remote, options.env);
    if (!request) return { connectionStatus: 'failed', available: false, detail: 'Configure an Ollama endpoint before checking its connection.' };
    try {
      const result = await fetchRemoteModelDiscovery(request, { fetch: options.fetch, timeoutMs: 5000, readJson: true });
      const payload = result.payload as { models?: unknown } | null;
      const connected = result.response.ok && Array.isArray(payload?.models);
      return { ...localInstallation, connectionStatus: connected ? 'connected' : 'failed', available: connected,
        authStatus: request.auth.applied ? 'unknown' : 'not_required',
        detail: connected ? 'Ollama responded to the model-list request. No model was started.' : 'The endpoint did not return an Ollama model list.' };
    } catch { return { ...localInstallation, connectionStatus: 'failed', available: false, detail: 'Could not connect to Ollama. Check its address and whether the service is running.' }; }
  }
  if (['openclaw', 'openclaw_gateway'].includes(remote.transport ?? '') && options.agentBackend) {
    const { result } = await options.agentBackend.probe(target, true, undefined, { mode: 'live' });
    const connected = result?.health.status === 'ok';
    return { connectionStatus: connected ? 'connected' : 'failed', available: connected,
      authStatus: 'unknown', detail: connected
        ? 'Gateway connection and health request succeeded.' : 'Gateway connection failed. Check its address and authentication settings.' };
  }
  return null;
}
