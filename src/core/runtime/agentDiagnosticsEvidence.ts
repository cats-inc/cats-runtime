import type {
  RuntimeSessionInspection,
  SessionInfo,
} from '../types.js';

export interface AgentDiagnosticSessionEvidenceSummary {
  source:
    | 'runtime_session_inspection'
    | 'runtime_registry_latest_session'
    | 'retained_target_evidence';
  sessionId: string;
  sessionKey?: string;
  providerSessionId?: string;
  status?: string;
  observedAt?: string;
  retainedAt?: string;
  latestRun?: {
    id: string;
    status: string;
  };
  counts: {
    artifactCount: number;
    serviceCount: number;
    previewSurfaceCount: number;
    readyPreviewSurfaceCount: number;
    browserSessionCount: number;
    openBrowserPageCount: number;
  };
  artifacts: Array<{
    id: string;
    kind?: string;
    label?: string;
    mediaType?: string;
    hasPath: boolean;
    hasUri: boolean;
  }>;
  services: Array<{
    id: string;
    name: string;
    status?: string;
    url?: string;
  }>;
  previewSurfaces: Array<{
    id: string;
    kind: string;
    source: string;
    status: string;
    renderHint: string;
    label?: string;
    url?: string;
    artifactId?: string;
    mediaType?: string;
  }>;
  browserSessions: Array<{
    id: string;
    driverId: string;
    status: string;
    openPageCount: number;
    previewSurfaceCount: number;
  }>;
}

export interface AgentDiagnosticSessionActivitySummary {
  source: 'runtime_session' | 'runtime_registry_latest_session' | 'retained_target_evidence';
  sessionId: string;
  sessionKey?: string;
  providerSessionId?: string;
  status?: string;
  observedAt?: string;
  retainedAt?: string;
  activity: {
    toolUseCount: number;
    toolResultCount: number;
    serviceUpdateCount: number;
    observedToolNames: string[];
    observedServiceIds: string[];
  };
}

export function hasAgentSessionActivitySummary(
  value: unknown,
): value is {
  toolUseCount: number;
  toolResultCount: number;
  serviceUpdateCount: number;
  observedToolNames: string[];
  observedServiceIds: string[];
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const observedToolNames = Array.isArray(record.observedToolNames)
    ? record.observedToolNames.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
  const observedServiceIds = Array.isArray(record.observedServiceIds)
    ? record.observedServiceIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];

  return (
    typeof record.toolUseCount === 'number'
    && typeof record.toolResultCount === 'number'
    && typeof record.serviceUpdateCount === 'number'
    && (
      record.toolUseCount > 0
      || record.toolResultCount > 0
      || record.serviceUpdateCount > 0
      || observedToolNames.length > 0
      || observedServiceIds.length > 0
    )
  );
}

export function buildAgentDiagnosticSessionActivity(
  session: SessionInfo,
  source: AgentDiagnosticSessionActivitySummary['source'],
): AgentDiagnosticSessionActivitySummary | undefined {
  const agentSession = session.providerState?.agentSession;
  if (!hasAgentSessionActivitySummary(agentSession?.activity)) {
    return undefined;
  }

  return {
    source,
    sessionId: session.id,
    ...(session.sessionKey ? { sessionKey: session.sessionKey } : {}),
    ...(agentSession?.providerSessionId ? { providerSessionId: agentSession.providerSessionId } : {}),
    ...(agentSession?.status ? { status: agentSession.status } : {}),
    ...(resolveAgentDiagnosticObservedAt(session)
      ? { observedAt: resolveAgentDiagnosticObservedAt(session) }
      : {}),
    activity: {
      toolUseCount: agentSession.activity.toolUseCount,
      toolResultCount: agentSession.activity.toolResultCount,
      serviceUpdateCount: agentSession.activity.serviceUpdateCount,
      observedToolNames: [...agentSession.activity.observedToolNames],
      observedServiceIds: [...agentSession.activity.observedServiceIds],
    },
  };
}

export function buildAgentDiagnosticSessionEvidence(
  session: SessionInfo,
  inspection: RuntimeSessionInspection,
  source: AgentDiagnosticSessionEvidenceSummary['source'],
): AgentDiagnosticSessionEvidenceSummary | undefined {
  const browserSessions = inspection.browserSessions || [];
  const counts = {
    artifactCount: inspection.artifacts.length,
    serviceCount: inspection.services.length,
    previewSurfaceCount: inspection.previewSurfaces.length,
    readyPreviewSurfaceCount: inspection.previewSurfaces.filter((surface) => surface.status === 'ready').length,
    browserSessionCount: browserSessions.length,
    openBrowserPageCount: browserSessions.reduce(
      (total, browserSession) => total + browserSession.inspection.openPageCount,
      0,
    ),
  };

  if (
    counts.artifactCount === 0
    && counts.serviceCount === 0
    && counts.previewSurfaceCount === 0
    && counts.browserSessionCount === 0
  ) {
    return undefined;
  }

  const latestRun = inspection.currentRun || inspection.lastRun;

  return {
    source,
    sessionId: session.id,
    ...(session.sessionKey ? { sessionKey: session.sessionKey } : {}),
    ...(inspection.agentSession?.providerSessionId
      ? { providerSessionId: inspection.agentSession.providerSessionId }
      : {}),
    ...(inspection.agentSession?.status ? { status: inspection.agentSession.status } : {}),
    ...(resolveAgentDiagnosticObservedAt(session)
      ? { observedAt: resolveAgentDiagnosticObservedAt(session) }
      : {}),
    ...(latestRun ? {
      latestRun: {
        id: latestRun.id,
        status: latestRun.status,
      },
    } : {}),
    counts,
    artifacts: inspection.artifacts.slice(0, 3).map((artifact) => ({
      id: artifact.id,
      ...(artifact.kind ? { kind: artifact.kind } : {}),
      ...(artifact.label ? { label: artifact.label } : {}),
      ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
      hasPath: Boolean(artifact.path),
      hasUri: Boolean(artifact.uri),
    })),
    services: inspection.services.slice(0, 3).map((service) => ({
      id: service.id,
      name: service.name,
      ...(service.status ? { status: service.status } : {}),
      ...(service.url ? { url: service.url } : {}),
    })),
    previewSurfaces: inspection.previewSurfaces.slice(0, 3).map((surface) => ({
      id: surface.id,
      kind: surface.kind,
      source: surface.source,
      status: surface.status,
      renderHint: surface.renderHint,
      ...(surface.label ? { label: surface.label } : {}),
      ...(surface.url ? { url: surface.url } : {}),
      ...(surface.artifactId ? { artifactId: surface.artifactId } : {}),
      ...(surface.mediaType ? { mediaType: surface.mediaType } : {}),
    })),
    browserSessions: browserSessions.slice(0, 2).map((browserSession) => ({
      id: browserSession.id,
      driverId: browserSession.driverId,
      status: browserSession.status,
      openPageCount: browserSession.inspection.openPageCount,
      previewSurfaceCount: browserSession.inspection.previewSurfaces.length,
    })),
  };
}

function resolveAgentDiagnosticObservedAt(
  session: SessionInfo,
): string | undefined {
  return session.lastActivity || session.updatedAt || session.createdAt || undefined;
}
