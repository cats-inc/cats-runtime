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
      promptTurns: boolean;
      notifications: string[];
    };
  };
  runtimeToProvider: {
    transport: 'agent/acp';
    diagnosticsPath: '/diagnostics/providers';
    summary: string;
  };
}

export interface RuntimeAcpHealthSummary {
  protocolVersion: number;
  httpPath: string;
  httpPromptCarrier: 'application/x-ndjson';
  stdioDefaultMode: 'proxy';
  stdioDirectRuntimeFlag: '--serve-runtime';
  providerTransport: 'agent/acp';
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

export function buildRuntimeAcpDiagnosticsSummary(): RuntimeAcpDiagnosticsSummary {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    summary: 'Runtime ACP is available for client-to-runtime traffic over HTTP and stdio, while provider-side ACP remains a separate agent/acp transport surfaced through provider diagnostics.',
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
        promptTurns: true,
        notifications: [...ACP_PROMPT_NOTIFICATIONS],
      },
    },
    runtimeToProvider: {
      transport: 'agent/acp',
      diagnosticsPath: '/diagnostics/providers',
      summary: 'Provider-side ACP targets stay under the agent backend family and continue to expose launch/probe/model/tool truth through provider diagnostics and inspection surfaces.',
    },
  };
}

export function buildRuntimeAcpHealthSummary(): RuntimeAcpHealthSummary {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    httpPath: '/acp',
    httpPromptCarrier: 'application/x-ndjson',
    stdioDefaultMode: 'proxy',
    stdioDirectRuntimeFlag: '--serve-runtime',
    providerTransport: 'agent/acp',
    summary: 'ACP prompt turns are available over HTTP NDJSON and stdio, while provider-side ACP continues to use the separate agent/acp transport.',
  };
}
