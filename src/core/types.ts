export interface RuntimeConfig {
  host: string;
  port: number;
  apiKey: string;
  backendBaseUrl: string;
  backendApiKey: string;
  backendTimeoutMs: number;
}

export interface RuntimeHealth {
  service: 'cats-runtime';
  status: 'ok' | 'degraded';
  timestamp: string;
  backend: {
    kind: 'agent-fleet';
    baseUrl: string;
    reachable: boolean;
    status?: string;
    version?: string;
    error?: string;
  };
}
