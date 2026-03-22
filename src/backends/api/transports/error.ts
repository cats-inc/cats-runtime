export class ApiTransportError extends Error {
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly responseBody?: string;

  constructor(
    provider: string,
    options: {
      statusCode?: number;
      retryAfterMs?: number;
      responseBody?: string;
    } = {},
  ) {
    super(`${provider} request failed: ${options.responseBody || 'unknown error'}`);
    this.name = 'ApiTransportError';
    this.provider = provider;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.responseBody = options.responseBody;
  }
}

export function readRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')?.trim();
  if (!raw) {
    return undefined;
  }

  const numeric = Number.parseFloat(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric * 1000);
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return Math.max(0, timestamp - Date.now());
}
