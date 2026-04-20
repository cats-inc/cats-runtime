import { ACP_PROTOCOL_VERSION } from './server.js';

export interface RuntimeAcpDiagnosticsSummary {
  protocolVersion: number;
  summary: string;
  clientToRuntime: {
    http: {
      enabled: boolean;
      path: string;
      promptCarrier: 'application/x-ndjson';
      notifications: string[];
      supportedMethods: string[];
    };
    stdio: {
      enabled: boolean;
      entrypoints: string[];
      defaultMode: 'proxy';
      directRuntimeFlag: '--serve-runtime';
      inspectProxyFlag: '--inspect-proxy';
      promptTurns: boolean;
      notifications: string[];
    };
    routingSupport: {
      requestedVia: '_meta.catsRuntime.routing';
      supportedModes: Array<'local' | 'peer'>;
      shareWorkspaceFlag: 'shareWorkspace';
      requiresRuntimeSessionOrigin: true;
      peerModePolicyGate: true;
      peerModeAvailable: boolean;
      summary: string;
    };
  };
  runtimeToProvider: {
    transport: 'agent/acp';
    diagnosticsPath: '/diagnostics/providers';
    summary: string;
  };
  runtimeToPeer: {
    transport: 'a2a';
    diagnosticsPath: '/diagnostics/peers';
    executionPath: '/peer/executions';
    summary: string;
  };
}

export interface RuntimeAcpHealthSummary {
  protocolVersion: number;
  httpPath: string;
  httpPromptCarrier: 'application/x-ndjson';
  stdioDefaultMode: 'proxy';
  stdioDirectRuntimeFlag: '--serve-runtime';
  stdioInspectProxyFlag: '--inspect-proxy';
  routingMetaPath: '_meta.catsRuntime.routing';
  peerModeAvailable: boolean;
  providerTransport: 'agent/acp';
  peerTransport: 'a2a';
  peerDiagnosticsPath: '/diagnostics/peers';
  summary: string;
}

const ACP_HTTP_SUPPORTED_METHODS = [
  'initialize',
  'ping',
  'session/new',
  'session/list',
  'session/load',
  'session/cancel',
  'session/prompt',
] as const;

const ACP_PROMPT_NOTIFICATIONS = ['session/update'] as const;

export function buildRuntimeAcpDiagnosticsSummary(
  peerModeAvailable = false,
): RuntimeAcpDiagnosticsSummary {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    summary: 'Runtime ACP is available for client-to-runtime traffic over HTTP and stdio, while provider-side ACP remains a separate agent/acp transport and peer execution remains a separate A2A/runtime-to-runtime layer.',
    clientToRuntime: {
      http: {
        enabled: true,
        path: '/acp',
        promptCarrier: 'application/x-ndjson',
        notifications: [...ACP_PROMPT_NOTIFICATIONS],
        supportedMethods: [...ACP_HTTP_SUPPORTED_METHODS],
      },
      stdio: {
        enabled: true,
        entrypoints: ['cats-runtime acp', 'node build/runtime/bin/acp.js'],
        defaultMode: 'proxy',
        directRuntimeFlag: '--serve-runtime',
        inspectProxyFlag: '--inspect-proxy',
        promptTurns: true,
        notifications: [...ACP_PROMPT_NOTIFICATIONS],
      },
      routingSupport: {
        requestedVia: '_meta.catsRuntime.routing',
        supportedModes: ['local', 'peer'],
        shareWorkspaceFlag: 'shareWorkspace',
        requiresRuntimeSessionOrigin: true,
        peerModePolicyGate: true,
        peerModeAvailable,
        summary: 'ACP clients can request runtime-to-peer routing hints on prompt turns through `_meta.catsRuntime.routing`, but peer-mode execution remains policy-gated and the actual peer execution still stays on the separate A2A/runtime-to-runtime layer.',
      },
    },
    runtimeToProvider: {
      transport: 'agent/acp',
      diagnosticsPath: '/diagnostics/providers',
      summary: 'Provider-side ACP targets stay under the agent backend family and continue to expose launch/probe/model/tool truth through provider diagnostics and inspection surfaces.',
    },
    runtimeToPeer: {
      transport: 'a2a',
      diagnosticsPath: '/diagnostics/peers',
      executionPath: '/peer/executions',
      summary: 'Peer routing stays outside the client-facing ACP facade and continues to use the runtime-to-runtime A2A/peer execution layer surfaced through peer diagnostics and the dedicated peer execution route.',
    },
  };
}

export function buildRuntimeAcpHealthSummary(
  peerModeAvailable = false,
): RuntimeAcpHealthSummary {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    httpPath: '/acp',
    httpPromptCarrier: 'application/x-ndjson',
    stdioDefaultMode: 'proxy',
    stdioDirectRuntimeFlag: '--serve-runtime',
    stdioInspectProxyFlag: '--inspect-proxy',
    routingMetaPath: '_meta.catsRuntime.routing',
    peerModeAvailable,
    providerTransport: 'agent/acp',
    peerTransport: 'a2a',
    peerDiagnosticsPath: '/diagnostics/peers',
    summary: 'ACP prompt turns are available over HTTP NDJSON and stdio, peer-routing hints can be requested through `_meta.catsRuntime.routing`, but peer-mode execution remains runtime-policy-gated while provider-side ACP continues to use the separate agent/acp transport and peer routing continues to use the separate A2A layer.',
  };
}
