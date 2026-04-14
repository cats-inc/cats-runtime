import type {
  RuntimeSessionInspection,
  SessionInfo,
} from '../types.js';

type AgentDiagnosticMcpServerSummary = {
  name: string;
  type: 'stdio' | 'http' | 'sse';
};

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
  workspace?: {
    cwd: string;
    outputDir?: string;
    workspaceMode?: string;
  };
  agentState?: {
    sessionTitle?: string;
    currentModeId?: string;
    availableCommands?: string[];
    configOptions?: Array<{
      id: string;
      label?: string;
      value?: string;
    }>;
    contextWindowUsage?: {
      used: number;
      size: number;
      costAmount?: number;
      costCurrency?: string;
    };
    stopReason?: string;
    mcpServers?: AgentDiagnosticMcpServerSummary[];
  };
  latestRun?: {
    id: string;
    status: string;
    resultSummary?: string;
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
    openPages: Array<{
      id: string;
      renderHint: string;
      label?: string;
      title?: string;
      url?: string;
      path?: string;
      mediaType?: string;
    }>;
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
  workspace?: {
    cwd: string;
    outputDir?: string;
    workspaceMode?: string;
  };
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
    workspace: buildAgentDiagnosticWorkspace(session),
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
  const agentState = buildAgentDiagnosticStateSummary(session);
  const inspectionAgentSession = inspection.agentSession;
  const providerAgentSession = session.providerState?.agentSession;

  return {
    source,
    sessionId: session.id,
    ...(session.sessionKey ? { sessionKey: session.sessionKey } : {}),
    ...((inspectionAgentSession?.providerSessionId || providerAgentSession?.providerSessionId)
      ? { providerSessionId: inspectionAgentSession?.providerSessionId || providerAgentSession?.providerSessionId }
      : {}),
    ...((inspectionAgentSession?.status || providerAgentSession?.status)
      ? { status: inspectionAgentSession?.status || providerAgentSession?.status }
      : {}),
    ...(resolveAgentDiagnosticObservedAt(session)
      ? { observedAt: resolveAgentDiagnosticObservedAt(session) }
      : {}),
    workspace: buildAgentDiagnosticWorkspace(session),
    ...(agentState ? { agentState } : {}),
    ...(latestRun ? {
      latestRun: {
        id: latestRun.id,
        status: latestRun.status,
        ...(latestRun.resultSummary ? { resultSummary: latestRun.resultSummary } : {}),
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
      openPages: browserSession.pages
        .filter((page) => page.status !== 'closed')
        .slice(0, 2)
        .map((page) => ({
          id: page.id,
          renderHint: page.previewSurface.renderHint,
          ...(page.label ? { label: page.label } : {}),
          ...(page.title ? { title: page.title } : {}),
          ...(page.url ? { url: page.url } : {}),
          ...(page.path ? { path: page.path } : {}),
          ...(page.mediaType ? { mediaType: page.mediaType } : {}),
        })),
    })),
  };
}

function resolveAgentDiagnosticObservedAt(
  session: SessionInfo,
): string | undefined {
  return session.lastActivity || session.updatedAt || session.createdAt || undefined;
}

function buildAgentDiagnosticStateSummary(
  session: SessionInfo,
): AgentDiagnosticSessionEvidenceSummary['agentState'] | undefined {
  const record = parseRecord(session.providerState?.agentSession?.adapterState);
  if (!record) {
    return undefined;
  }

  const configOptions = Array.isArray(record.configOptions)
    ? record.configOptions.flatMap((entry) => {
      const option = parseRecord(entry);
      const id = readString(option?.id);
      if (!id) {
        return [];
      }
      return [{
        id,
        ...(readString(option?.label) ? { label: readString(option?.label) } : {}),
        ...(readString(option?.value) ? { value: readString(option?.value) } : {}),
      }];
    })
    : [];
  const availableCommands = Array.isArray(record.availableCommands)
    ? record.availableCommands.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
  const sessionMcpServers: AgentDiagnosticMcpServerSummary[] = Array.isArray(record.sessionMcpServers)
    ? record.sessionMcpServers.flatMap((entry) => {
      const server = parseRecord(entry);
      const type = readString(server?.type);
      const name = readString(server?.name);
      return (name && (type === 'stdio' || type === 'http' || type === 'sse'))
        ? [{ name, type }]
        : [];
    })
    : [];
  const contextWindowUsageRecord = parseRecord(record.contextWindowUsage);
  const contextWindowUsage = contextWindowUsageRecord
    && typeof contextWindowUsageRecord.used === 'number'
    && typeof contextWindowUsageRecord.size === 'number'
    ? {
        used: contextWindowUsageRecord.used,
        size: contextWindowUsageRecord.size,
        ...(typeof contextWindowUsageRecord.costAmount === 'number'
          ? { costAmount: contextWindowUsageRecord.costAmount }
          : {}),
        ...(readString(contextWindowUsageRecord.costCurrency)
          ? { costCurrency: readString(contextWindowUsageRecord.costCurrency) }
          : {}),
      }
    : undefined;
  const summary = {
    ...(readString(record.sessionTitle) ? { sessionTitle: readString(record.sessionTitle) } : {}),
    ...(readString(record.currentModeId) ? { currentModeId: readString(record.currentModeId) } : {}),
    ...(availableCommands.length ? { availableCommands: [...availableCommands] } : {}),
    ...(configOptions.length ? { configOptions } : {}),
    ...(contextWindowUsage ? { contextWindowUsage } : {}),
    ...(readString(record.stopReason) ? { stopReason: readString(record.stopReason) } : {}),
    ...(sessionMcpServers.length ? { mcpServers: sessionMcpServers } : {}),
  };

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function buildAgentDiagnosticWorkspace(
  session: SessionInfo,
): {
  cwd: string;
  outputDir?: string;
  workspaceMode?: string;
} {
  return {
    cwd: session.cwd,
    ...(session.outputDir ? { outputDir: session.outputDir } : {}),
    ...(session.workspaceMode ? { workspaceMode: session.workspaceMode } : {}),
  };
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
