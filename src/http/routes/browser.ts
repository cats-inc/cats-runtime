import { Hono, type Context } from 'hono';
import type {
  AgentRuntimeService,
  RuntimeBrowserPageBinding,
  RuntimeBrowserPageBindingKind,
  SessionArtifact,
} from '../../core/types.js';
import {
  getRuntimeBrowserService,
  getRuntimeSessionManager,
  type AppContext,
} from '../app.js';
import {
  RuntimeBrowserNotFoundError,
  RuntimeBrowserValidationError,
} from '../../core/browser/RuntimeBrowserService.js';
import {
  guessBrowserPreviewMediaType,
  resolveBrowserArtifactPath,
} from '../../core/browser/previewSurfaces.js';

export const browserRoutes = new Hono();

browserRoutes.get('/browser/drivers', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  return c.json({
    drivers: getRuntimeBrowserService(ctx).listDrivers(),
  });
});

browserRoutes.get('/browser/sessions', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const browser = getRuntimeBrowserService(ctx);
  const runtimeSessionId = parseOptionalString(c.req.query('runtimeSessionId'));
  const driverId = parseOptionalString(c.req.query('driverId'));
  return c.json({
    sessions: browser.listSessions({
      ...(runtimeSessionId ? { runtimeSessionId } : {}),
      ...(driverId ? { driverId } : {}),
    }),
  });
});

browserRoutes.post('/browser/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json().catch(() => ({}));

  try {
    const session = await getRuntimeBrowserService(ctx).createSession({
      driverId: parseOptionalString(body?.driverId),
      runtimeSessionId: parseOptionalString(body?.runtimeSessionId),
      label: parseOptionalString(body?.label),
      metadata: parseOptionalRecord(body?.metadata),
    });
    return c.json({ session }, 201);
  } catch (error) {
    return toBrowserErrorResponse(c, error);
  }
});

browserRoutes.get('/browser/sessions/:id', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const session = getRuntimeBrowserService(ctx).getSession(c.req.param('id'));
  if (!session) {
    return c.json({ error: `Browser session '${c.req.param('id')}' was not found.` }, 404);
  }
  return c.json({ session });
});

browserRoutes.post('/browser/sessions/:id/pages', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const browser = getRuntimeBrowserService(ctx);
  const browserSessionId = c.req.param('id');
  const browserSession = browser.getSession(browserSessionId);
  if (!browserSession) {
    return c.json({ error: `Browser session '${browserSessionId}' was not found.` }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  try {
    const pageTarget = resolvePageTarget(ctx, browserSession, body);
    const result = await browser.createPage(browserSessionId, pageTarget);
    return c.json(result, 201);
  } catch (error) {
    return toBrowserErrorResponse(c, error);
  }
});

browserRoutes.post('/browser/sessions/:id/close', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  try {
    const session = await getRuntimeBrowserService(ctx).closeSession(c.req.param('id'));
    return c.json({ session });
  } catch (error) {
    return toBrowserErrorResponse(c, error);
  }
});

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return structuredClone(value) as Record<string, unknown>;
}

function parseBinding(value: unknown): RuntimeBrowserPageBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const kind = parseOptionalString(record.kind) as RuntimeBrowserPageBindingKind | undefined;
  if (!kind) {
    return undefined;
  }
  if (!['manual_url', 'session_service', 'session_artifact'].includes(kind)) {
    throw new RuntimeBrowserValidationError(
      `Unsupported browser page binding kind '${kind}'.`,
    );
  }

  return {
    kind,
    ...(parseOptionalString(record.runtimeSessionId)
      ? { runtimeSessionId: parseOptionalString(record.runtimeSessionId) }
      : {}),
    ...(parseOptionalString(record.serviceId)
      ? { serviceId: parseOptionalString(record.serviceId) }
      : {}),
    ...(parseOptionalString(record.artifactId)
      ? { artifactId: parseOptionalString(record.artifactId) }
      : {}),
  };
}

function resolvePageTarget(
  ctx: AppContext,
  browserSession: { runtimeSessionId?: string },
  value: unknown,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeBrowserValidationError('Browser page payload must be an object.');
  }

  const record = value as Record<string, unknown>;
  const binding = parseBinding(record.binding);
  if (!binding || binding.kind === 'manual_url') {
    const url = parseOptionalString(record.url);
    const path = parseOptionalString(record.path);
    if (!url && !path) {
      throw new RuntimeBrowserValidationError(
        'Browser pages require either a url/path or a supported binding.',
      );
    }

    return {
      ...(parseOptionalString(record.label) ? { label: parseOptionalString(record.label) } : {}),
      ...(parseOptionalString(record.title) ? { title: parseOptionalString(record.title) } : {}),
      ...(url ? { url } : {}),
      ...(path ? { path } : {}),
      ...(parseOptionalString(record.mediaType)
        ? { mediaType: parseOptionalString(record.mediaType) }
        : {}),
      binding: binding || {
        kind: 'manual_url' as const,
      },
      metadata: parseOptionalRecord(record.metadata),
    };
  }

  const runtimeSessionId = binding.runtimeSessionId || browserSession.runtimeSessionId;
  if (!runtimeSessionId) {
    throw new RuntimeBrowserValidationError(
      'session_service and session_artifact bindings require a runtimeSessionId.',
    );
  }

  const session = ctx.registry.get(runtimeSessionId);
  if (!session) {
    throw new RuntimeBrowserNotFoundError(
      `Runtime session '${runtimeSessionId}' was not found for browser page binding.`,
    );
  }

  const { services, artifacts } = collectRuntimeSessionPreviewSources(ctx, runtimeSessionId);

  if (binding.kind === 'session_service') {
    if (!binding.serviceId) {
      throw new RuntimeBrowserValidationError('session_service binding requires serviceId.');
    }
    const service = services.find((candidate) => candidate.id === binding.serviceId);
    if (!service) {
      throw new RuntimeBrowserValidationError(
        `Runtime session '${runtimeSessionId}' does not expose service '${binding.serviceId}'.`,
      );
    }

    return {
      label: parseOptionalString(record.label) || service.name || service.id,
      ...(parseOptionalString(record.title) ? { title: parseOptionalString(record.title) } : {}),
      ...(service.url ? { url: service.url } : {}),
      binding: {
        ...binding,
        runtimeSessionId,
      },
      metadata: mergeRecords(parseOptionalRecord(record.metadata), {
        sourceKind: 'session_service',
      }),
    };
  }

  if (!binding.artifactId) {
    throw new RuntimeBrowserValidationError('session_artifact binding requires artifactId.');
  }
  const artifact = artifacts.find((candidate) => candidate.id === binding.artifactId);
  if (!artifact) {
    throw new RuntimeBrowserValidationError(
      `Runtime session '${runtimeSessionId}' does not expose artifact '${binding.artifactId}'.`,
    );
  }

  const resolvedPath = resolveBrowserArtifactPath(session.cwd, artifact.path);
  const artifactUrl = parseOptionalString(artifact.uri);
  if (!resolvedPath && !artifactUrl) {
    throw new RuntimeBrowserValidationError(
      `Runtime session artifact '${binding.artifactId}' does not expose a usable path or URL.`,
    );
  }
  const mediaType = guessBrowserPreviewMediaType(
    resolvedPath || artifact.path || artifact.uri,
    artifact.mediaType,
  );

  return {
    label: parseOptionalString(record.label) || artifact.label || artifact.id,
    ...(parseOptionalString(record.title) ? { title: parseOptionalString(record.title) } : {}),
    ...(artifactUrl ? { url: artifactUrl } : {}),
    ...(resolvedPath ? { path: resolvedPath } : {}),
    ...(mediaType ? { mediaType } : {}),
    binding: {
      ...binding,
      runtimeSessionId,
    },
    metadata: mergeRecords(parseOptionalRecord(record.metadata), {
      sourceKind: 'session_artifact',
    }),
  };
}

function collectRuntimeSessionPreviewSources(
  ctx: AppContext,
  runtimeSessionId: string,
): {
  services: AgentRuntimeService[];
  artifacts: SessionArtifact[];
} {
  const session = ctx.registry.get(runtimeSessionId);
  if (!session) {
    return {
      services: [],
      artifacts: [],
    };
  }

  const trackedState = getRuntimeSessionManager(ctx).getTrackedState(runtimeSessionId);
  return {
    services: dedupeServices([
      ...(session.providerState?.agentSession?.services || []),
      ...(trackedState?.currentRun?.services || []),
      ...(trackedState?.lastRun?.services || []),
    ]),
    artifacts: dedupeArtifacts([
      ...(session.artifacts || []),
      ...(trackedState?.currentRun?.artifacts || []),
      ...(trackedState?.lastRun?.artifacts || []),
    ]),
  };
}

function dedupeServices(services: AgentRuntimeService[]): AgentRuntimeService[] {
  const deduped = new Map<string, AgentRuntimeService>();
  for (const service of services) {
    if (!service.id || deduped.has(service.id)) {
      continue;
    }
    deduped.set(service.id, {
      ...service,
      ...(service.metadata ? { metadata: { ...service.metadata } } : {}),
    });
  }
  return Array.from(deduped.values());
}

function dedupeArtifacts(artifacts: SessionArtifact[]): SessionArtifact[] {
  const deduped = new Map<string, SessionArtifact>();
  for (const artifact of artifacts) {
    if (!artifact.id || deduped.has(artifact.id)) {
      continue;
    }
    deduped.set(artifact.id, {
      ...artifact,
      ...(artifact.metadata ? { metadata: { ...artifact.metadata } } : {}),
    });
  }
  return Array.from(deduped.values());
}

function mergeRecords(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!left && !right) {
    return undefined;
  }
  return {
    ...(left || {}),
    ...(right || {}),
  };
}

function toBrowserErrorResponse(
  c: Context,
  error: unknown,
) {
  if (error instanceof RuntimeBrowserNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof RuntimeBrowserValidationError) {
    return c.json({ error: error.message }, 400);
  }
  const message = error instanceof Error ? error.message : 'Unknown browser runtime error.';
  return c.json({ error: message }, 500);
}
