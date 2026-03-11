import type { RuntimeConfig } from './types.js';

function parseNumber(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    host: env.CATS_RUNTIME_HOST?.trim() || '127.0.0.1',
    port: parseNumber(env.CATS_RUNTIME_PORT ?? env.PORT, 3110),
    apiKey: env.CATS_RUNTIME_API_KEY?.trim() || '',
    backendBaseUrl: env.AGENT_FLEET_BASE_URL?.trim() || 'http://localhost:3100',
    backendApiKey: env.AGENT_FLEET_API_KEY?.trim() || '',
    backendTimeoutMs: parseNumber(env.AGENT_FLEET_TIMEOUT_MS, 600000),
  };
}
