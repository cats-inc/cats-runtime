import type { RuntimeConfig, RuntimeHealth } from '../core/types.js';

export interface BackendRequestOptions {
  method?: string;
  body?: Buffer;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class AgentFleetBackend {
  constructor(private readonly config: RuntimeConfig) {}

  async getHealth(): Promise<RuntimeHealth> {
    try {
      const response = await this.request('/health');
      const payload = await response
        .json()
        .catch(() => ({})) as Record<string, unknown>;

      return {
        service: 'cats-runtime',
        status: response.ok ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        backend: {
          kind: 'agent-fleet',
          baseUrl: this.config.backendBaseUrl,
          reachable: response.ok,
          status: typeof payload.status === 'string' ? payload.status : undefined,
          version: typeof payload.version === 'string' ? payload.version : undefined,
          error: response.ok ? undefined : `agent-fleet returned ${response.status}`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        service: 'cats-runtime',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        backend: {
          kind: 'agent-fleet',
          baseUrl: this.config.backendBaseUrl,
          reachable: false,
          error: message,
        },
      };
    }
  }

  async request(path: string, options: BackendRequestOptions = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new Error(
          `Upstream request timed out after ${this.config.backendTimeoutMs}ms`,
        ),
      );
    }, this.config.backendTimeoutMs);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => controller.abort(options.signal?.reason),
        { once: true },
      );
    }

    const headers = new Headers(options.headers ?? {});
    if (this.config.backendApiKey) {
      headers.set('authorization', `Bearer ${this.config.backendApiKey}`);
    }

    try {
      return await fetch(new URL(path, this.config.backendBaseUrl), {
        method: options.method ?? 'GET',
        headers,
        body: options.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
