import { extname, isAbsolute, resolve } from 'node:path';
import type {
  AgentRuntimeService,
  RuntimePreviewSurface,
  RuntimePreviewSurfaceRenderHint,
  RuntimeSessionInspection,
  RuntimeSessionMeteringSnapshot,
  SessionArtifact,
  SessionInfo,
  SessionView,
} from '../types.js';
import type { RuntimeTrackedSessionStateSnapshot } from './RuntimeSessionManager.js';
import { extractWakeReason } from './wakeReason.js';

const HTML_EXTENSIONS = new Set(['.htm', '.html']);
const DOWNLOADABLE_EXTENSIONS = new Set([
  '.csv',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.pdf',
  '.png',
  '.svg',
  '.txt',
  '.webp',
]);
const HTTP_URL_PREFIX = /^https?:\/\//i;

export interface BuildSessionInspectionInput {
  session: SessionInfo;
  view: SessionView;
  trackedState?: RuntimeTrackedSessionStateSnapshot;
  metering: RuntimeSessionMeteringSnapshot;
}

export function buildSessionInspection(
  input: BuildSessionInspectionInput,
): RuntimeSessionInspection {
  const currentRun = input.trackedState?.currentRun
    ? enrichRunInspection(input.trackedState.currentRun, input.session)
    : undefined;
  const lastRun = input.trackedState?.lastRun
    ? enrichRunInspection(input.trackedState.lastRun, input.session)
    : undefined;
  const artifacts = dedupeArtifacts([
    ...(input.session.artifacts || []),
    ...(currentRun?.artifacts || []),
    ...(lastRun?.artifacts || []),
  ]);
  const services = dedupeServices([
    ...(input.session.providerState?.agentSession?.services || []),
    ...(currentRun?.services || []),
    ...(lastRun?.services || []),
  ]);
  const previewSurfaces = [
    ...artifacts.map((artifact) => createArtifactPreviewSurface(artifact, input.session)),
    ...services.map((service) => createServicePreviewSurface(service, input.session)),
  ];
  const busy = input.session.status === 'busy'
    || input.trackedState?.state === 'running'
    || input.trackedState?.state === 'canceling';

  return {
    state: resolveExecutionState(input),
    attached: input.view.attached,
    busy,
    wake: input.trackedState?.wake
      || currentRun?.wake
      || lastRun?.wake
      || extractWakeReason(input.session.context),
    ...(currentRun ? { currentRun } : {}),
    ...(lastRun ? { lastRun } : {}),
    ...(input.trackedState?.progress ? { progress: input.trackedState.progress } : {}),
    recentEvents: input.trackedState?.recentEvents || [],
    metering: input.metering,
    artifacts,
    services,
    previewSurfaces,
    actions: {
      canClose: input.view.controls.canClose,
      canDelete: input.view.controls.canDelete,
      canResume: input.view.controls.canResume,
      canRefresh: input.view.controls.canRefresh,
      canCancel: input.view.attached && busy,
      canReset: input.session.status !== 'closing'
        && (
          input.view.attached
          || Boolean(input.session.providerSessionId)
          || Boolean(input.session.providerState)
        ),
      canRetry: Boolean(input.trackedState?.lastRun)
        && (input.view.controls.canSend || input.view.controls.canResume),
    },
  };
}

function enrichRunInspection(
  run: RuntimeSessionInspection['currentRun'],
  session: SessionInfo,
) {
  if (!run) {
    return undefined;
  }

  const previewSurfaces = dedupePreviewSurfaces([
    ...(run.artifacts || []).map((artifact) => createArtifactPreviewSurface(artifact, session)),
    ...(run.services || []).map((service) => createServicePreviewSurface(service, session)),
  ]);

  return {
    ...run,
    previewSurfaces,
  };
}

function resolveExecutionState(
  input: BuildSessionInspectionInput,
): RuntimeSessionInspection['state'] {
  const tracked = input.trackedState;
  if (tracked?.state === 'canceling' || tracked?.state === 'closing') {
    return tracked.state;
  }
  if (input.session.status === 'closing') {
    return 'closing';
  }
  if (tracked?.state === 'running' || input.session.status === 'busy') {
    return 'running';
  }
  if (!input.view.attached || input.session.status === 'closed') {
    return 'closed';
  }
  return tracked?.state || 'idle';
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

function dedupePreviewSurfaces(
  previewSurfaces: RuntimePreviewSurface[],
): RuntimePreviewSurface[] {
  const deduped = new Map<string, RuntimePreviewSurface>();
  for (const previewSurface of previewSurfaces) {
    if (!previewSurface.id || deduped.has(previewSurface.id)) {
      continue;
    }
    deduped.set(previewSurface.id, {
      ...previewSurface,
      ...(previewSurface.metadata ? { metadata: { ...previewSurface.metadata } } : {}),
      ...(previewSurface.provenance
        ? { provenance: { ...previewSurface.provenance } }
        : {}),
    });
  }
  return Array.from(deduped.values());
}

function createArtifactPreviewSurface(
  artifact: SessionArtifact,
  session: SessionInfo,
): RuntimePreviewSurface {
  const resolvedPath = resolveArtifactPath(session.cwd, artifact.path);
  const mediaType = guessMediaType(resolvedPath || artifact.path || artifact.uri, artifact.mediaType);
  const extension = extname(resolvedPath || artifact.path || '').toLowerCase();
  const candidateUrl = artifact.uri;

  let status: RuntimePreviewSurface['status'] = 'unsupported';
  let renderHint: RuntimePreviewSurfaceRenderHint = 'none';
  if (!resolvedPath && !candidateUrl) {
    status = 'blocked';
  } else if (mediaType === 'text/html' || HTML_EXTENSIONS.has(extension)) {
    status = 'ready';
    renderHint = 'iframe';
  } else if (
    (mediaType && (mediaType.startsWith('image/') || mediaType === 'application/pdf'))
    || DOWNLOADABLE_EXTENSIONS.has(extension)
  ) {
    status = 'degraded';
    renderHint = 'download';
  } else if (resolvedPath || candidateUrl) {
    status = 'unsupported';
    renderHint = 'download';
  }

  return {
    id: `session_artifact:${artifact.id}`,
    kind: 'artifact',
    source: 'session_artifact',
    status,
    label: artifact.label || artifact.id,
    renderHint,
    ...(candidateUrl ? { url: candidateUrl } : {}),
    artifactId: artifact.id,
    ...(resolvedPath ? { path: resolvedPath } : {}),
    ...(mediaType ? { mediaType } : {}),
    provenance: {
      sessionId: session.id,
      provider: session.providerName,
      workspacePath: session.cwd,
      artifactId: artifact.id,
    },
    metadata: artifact.metadata,
  };
}

function createServicePreviewSurface(
  service: AgentRuntimeService,
  session: SessionInfo,
): RuntimePreviewSurface {
  let status: RuntimePreviewSurface['status'] = 'blocked';
  let renderHint: RuntimePreviewSurfaceRenderHint = 'none';
  if (service.url) {
    if (HTTP_URL_PREFIX.test(service.url)) {
      status = 'ready';
      renderHint = 'iframe';
    } else {
      status = 'degraded';
      renderHint = 'open_external';
    }
  }

  return {
    id: `session_service:${service.id}`,
    kind: 'service',
    source: 'session_service',
    status,
    label: service.name || service.id,
    renderHint,
    ...(service.url ? { url: service.url } : {}),
    provenance: {
      sessionId: session.id,
      provider: session.providerName,
      workspacePath: session.cwd,
      serviceId: service.id,
    },
    metadata: service.metadata,
  };
}

function resolveArtifactPath(
  workspacePath: string,
  artifactPath: string | undefined,
): string | undefined {
  if (!artifactPath) {
    return undefined;
  }
  if (isAbsolute(artifactPath)) {
    return artifactPath;
  }
  return resolve(workspacePath, artifactPath);
}

function guessMediaType(
  pathValue: string | undefined,
  explicitMediaType: string | undefined,
): string | undefined {
  if (explicitMediaType) {
    return explicitMediaType;
  }

  const extension = extname(pathValue || '').toLowerCase();
  if (HTML_EXTENSIONS.has(extension)) {
    return 'text/html';
  }
  if (extension === '.pdf') {
    return 'application/pdf';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return `image/${extension.slice(1) === 'jpg' ? 'jpeg' : extension.slice(1)}`;
  }
  return undefined;
}
