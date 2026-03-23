import { createRuntimeApp, type AppContext } from '../http/app.js';

const APP_CACHE = new WeakMap<AppContext, ReturnType<typeof createRuntimeApp>>();

interface RuntimeRequestOptions {
  method?: string;
  body?: unknown;
  accept?: string;
}

export interface RuntimeJsonRequestResult {
  status: number;
  body: unknown;
}

export interface RuntimeNdjsonRequestResult {
  status: number;
  body: unknown;
  events: Array<Record<string, unknown>>;
}

function getRuntimeApp(ctx: AppContext) {
  const cached = APP_CACHE.get(ctx);
  if (cached) {
    return cached;
  }

  const app = createRuntimeApp(ctx);
  APP_CACHE.set(ctx, app);
  return app;
}

function buildHeaders(
  ctx: AppContext,
  options: RuntimeRequestOptions,
): Headers {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  if (options.accept) {
    headers.set('accept', options.accept);
  }
  if (ctx.config.apiKey) {
    headers.set('authorization', `Bearer ${ctx.config.apiKey}`);
  }
  return headers;
}

function buildRequestBody(method: string, body: unknown): string | undefined {
  return method === 'GET' || method === 'HEAD'
    ? undefined
    : JSON.stringify(body ?? {});
}

function tryParseJson(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export async function requestRuntimeJson(
  ctx: AppContext,
  path: string,
  options: RuntimeRequestOptions = {},
): Promise<RuntimeJsonRequestResult> {
  const method = options.method ?? 'POST';
  const response = await getRuntimeApp(ctx).request(path, {
    method,
    headers: buildHeaders(ctx, options),
    body: buildRequestBody(method, options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: tryParseJson(text),
  };
}

export async function requestRuntimeNdjson(
  ctx: AppContext,
  path: string,
  options: RuntimeRequestOptions = {},
): Promise<RuntimeNdjsonRequestResult> {
  const method = options.method ?? 'POST';
  const response = await getRuntimeApp(ctx).request(path, {
    method,
    headers: buildHeaders(ctx, {
      ...options,
      accept: options.accept ?? 'application/x-ndjson',
    }),
    body: buildRequestBody(method, options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      status: response.status,
      body: tryParseJson(text),
      events: [],
    };
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  return {
    status: response.status,
    body: events,
    events,
  };
}
