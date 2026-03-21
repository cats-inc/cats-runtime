import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type {
  AgentRuntimeService,
  RuntimeArtifactPublicationRecord,
  RuntimeDeliveryAction,
  RuntimeDeliveryApprovalPayload,
  RuntimeDeliveryAuthorization,
  RuntimeDeliveryAuthorizationInput,
  RuntimeDeliveryCapabilities,
  RuntimeDeliveryCapability,
  RuntimeDeliveryCapabilityState,
  RuntimeDeliveryContract,
  RuntimeDeliveryIssue,
  RuntimeDeliveryRequest,
  RuntimeDeliveryResult,
  RuntimeDeliverySummary,
  RuntimeDeliveryWarning,
  RuntimePreviewSurface,
  RuntimePreviewSurfaceRenderHint,
  RuntimePreviewSurfaceSource,
  RuntimeRepoRemoteStatus,
  RuntimeRepoStatus,
  SessionArtifact,
  SessionInfo,
  WorkspaceSubstrateActorRole,
} from '../types.js';

const PRIVILEGED_ACTOR_ROLES = ['boss_cat', 'system', 'owner'] as const;
const DEFAULT_GIT_TIMEOUT_MS = 15_000;
const DEFAULT_ARTIFACT_MANIFEST_FILE_NAME = 'delivery-manifest.json';
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const DOWNLOADABLE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
]);
const HTTP_URL_PREFIX = /^https?:\/\//i;
const MUTATING_ACTIONS = new Set<RuntimeDeliveryAction>([
  'publish-artifacts',
  'create-commit',
  'push-branch',
]);

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface ResolvedDeliveryInput {
  session?: SessionInfo;
  workspacePath?: string;
  artifacts: SessionArtifact[];
  services: AgentRuntimeService[];
}

interface RepoInspection {
  repo: RuntimeRepoStatus;
  blockedReasons: RuntimeDeliveryIssue[];
  capabilityGaps: RuntimeDeliveryIssue[];
}

interface PublicationPlan {
  publishableRecords: RuntimeArtifactPublicationRecord[];
  blockedArtifacts: RuntimeDeliveryIssue[];
  degradedArtifacts: RuntimeDeliveryIssue[];
  warnings: RuntimeDeliveryWarning[];
  manifestPath?: string;
  targetDirectory?: string;
}

export interface RuntimeDeliveryDependencies {
  registry?: Pick<SessionRegistry, 'get'>;
}

function normalizeWorkspacePath(workspacePath: string | undefined): string | undefined {
  if (!workspacePath || !workspacePath.trim()) {
    return undefined;
  }
  return resolve(workspacePath);
}

function resolveFromWorkspace(
  workspacePath: string | undefined,
  candidate: string | undefined,
): string | undefined {
  if (!candidate || !candidate.trim()) {
    return undefined;
  }
  if (isAbsolute(candidate)) {
    return resolve(candidate);
  }
  return resolve(workspacePath || process.cwd(), candidate);
}

function createIssue(
  code: string,
  state: Exclude<RuntimeDeliveryCapabilityState, 'ready'>,
  message: string,
  details?: Record<string, unknown>,
): RuntimeDeliveryIssue {
  return { code, state, message, ...(details ? { details } : {}) };
}

function createWarning(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeDeliveryWarning {
  return { code, message, ...(details ? { details } : {}) };
}

function createCapability(
  state: RuntimeDeliveryCapabilityState,
  reason?: string,
): RuntimeDeliveryCapability {
  return {
    supported: state !== 'unsupported',
    available: state === 'ready' || state === 'degraded',
    state,
    ...(reason ? { reason } : {}),
  };
}

function createEmptyRepoStatus(supported = true): RuntimeRepoStatus {
  return {
    supported,
    repository: false,
    detached: false,
    remotes: [],
  };
}

function createDefaultCapabilities(): RuntimeDeliveryCapabilities {
  return {
    artifactPublication: createCapability('blocked', 'No artifacts are available yet.'),
    repoStatus: createCapability('blocked', 'No repository target is available yet.'),
    commit: createCapability('blocked', 'Commit creation requires a repository target.'),
    push: createCapability('blocked', 'Branch push requires a repository target and remote.'),
    previewSurfaces: createCapability('blocked', 'No preview-capable surfaces were found.'),
  };
}

function createSummary(result: {
  artifacts: RuntimeArtifactPublicationRecord[];
  previewSurfaces: RuntimePreviewSurface[];
  blockedReasons: RuntimeDeliveryIssue[];
  capabilityGaps: RuntimeDeliveryIssue[];
}): RuntimeDeliverySummary {
  return {
    artifactCount: result.artifacts.length,
    publishedArtifactCount: result.artifacts.filter((artifact) => artifact.copied).length,
    previewSurfaceCount: result.previewSurfaces.length,
    readyPreviewSurfaceCount: result.previewSurfaces.filter((surface) => surface.status === 'ready').length,
    blockedReasonCount: result.blockedReasons.length,
    capabilityGapCount: result.capabilityGaps.length,
  };
}

function isPrivilegedActorRole(
  actorRole: WorkspaceSubstrateActorRole | undefined,
): actorRole is (typeof PRIVILEGED_ACTOR_ROLES)[number] {
  return actorRole !== undefined
    && PRIVILEGED_ACTOR_ROLES.includes(actorRole as (typeof PRIVILEGED_ACTOR_ROLES)[number]);
}

function createAuthorization(
  action: RuntimeDeliveryAction,
  authorization: RuntimeDeliveryAuthorizationInput | undefined,
): RuntimeDeliveryAuthorization {
  const actorRole = authorization?.actorRole;
  const approved = authorization?.approved === true;
  const readOnly = !MUTATING_ACTIONS.has(action);

  if (readOnly) {
    return {
      actorRole,
      approved,
      canApply: false,
      requiresApproval: false,
      reason: `${action} is read-only.`,
    };
  }

  const privileged = isPrivilegedActorRole(actorRole);
  if (privileged || approved) {
    return {
      actorRole,
      approved,
      canApply: true,
      requiresApproval: false,
      reason: privileged
        ? `Apply is authorized for actorRole='${actorRole}'.`
        : 'Apply is authorized because approval has been recorded.',
    };
  }

  return {
    actorRole,
    approved,
    canApply: false,
    requiresApproval: true,
    reason: 'Apply requires Boss Cat, system, owner, or explicit approval.',
  };
}

function createContract(
  action: RuntimeDeliveryAction,
  applyRequested: boolean,
  authorization: RuntimeDeliveryAuthorization,
): RuntimeDeliveryContract {
  const readOnly = !MUTATING_ACTIONS.has(action);
  return {
    mode: applyRequested ? 'apply' : 'preview',
    safeDefaultMode: 'preview',
    applyRequested,
    applyDecision: !applyRequested
      ? 'not_requested'
      : readOnly
        ? 'read_only_operation'
        : authorization.canApply
          ? 'applied'
          : 'blocked',
    readOnly,
  };
}

function createApprovalPayload(
  request: RuntimeDeliveryRequest,
  authorization: RuntimeDeliveryAuthorization,
): RuntimeDeliveryApprovalPayload {
  const readOnly = !MUTATING_ACTIONS.has(request.action);
  const requiresApproval = !readOnly && authorization.requiresApproval;
  const applyPayload = readOnly
    ? undefined
    : {
        action: request.action,
        workspacePath: request.workspacePath,
        sessionId: request.sessionId,
        artifactIds: request.artifactIds,
        apply: true as const,
        authorization: request.authorization,
        publication: request.publication,
        repo: request.repo,
        preview: request.preview,
        context: request.context,
      };

  return {
    required: requiresApproval,
    reason: readOnly
      ? `${request.action} never writes state.`
      : requiresApproval
        ? 'Apply is blocked until Boss Cat, system, owner, or explicit approval authorizes the action.'
        : 'Current actor context may apply this delivery action without additional approval.',
    privilegedActorRoles: [...PRIVILEGED_ACTOR_ROLES],
    applyPayload,
  };
}

function dedupeArtifacts(artifacts: SessionArtifact[]): SessionArtifact[] {
  const deduped = new Map<string, SessionArtifact>();
  for (const artifact of artifacts) {
    if (!artifact.id || deduped.has(artifact.id)) {
      continue;
    }
    deduped.set(artifact.id, artifact);
  }
  return Array.from(deduped.values());
}

function dedupeServices(services: AgentRuntimeService[]): AgentRuntimeService[] {
  const deduped = new Map<string, AgentRuntimeService>();
  for (const service of services) {
    if (!service.id || deduped.has(service.id)) {
      continue;
    }
    deduped.set(service.id, service);
  }
  return Array.from(deduped.values());
}

function getSessionServices(session: SessionInfo | undefined): AgentRuntimeService[] {
  return session?.providerState?.agentSession?.services || [];
}

function guessMediaType(pathValue: string | undefined, explicitMediaType: string | undefined): string | undefined {
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

function createArtifactPreviewSurface(
  artifact: SessionArtifact,
  source: RuntimePreviewSurfaceSource,
  workspacePath: string | undefined,
  overrides: {
    path?: string;
    url?: string;
    publicationDirectory?: string;
  } = {},
  session?: SessionInfo,
): RuntimePreviewSurface {
  const resolvedPath = overrides.path || resolveFromWorkspace(workspacePath, artifact.path);
  const mediaType = guessMediaType(resolvedPath || artifact.path || artifact.uri, artifact.mediaType);
  const candidateUrl = overrides.url || artifact.uri;
  const extension = extname(resolvedPath || artifact.path || '').toLowerCase();

  let status: RuntimeDeliveryCapabilityState = 'unsupported';
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
    id: `${source}:${artifact.id}`,
    kind: 'artifact',
    source,
    status,
    label: artifact.label || artifact.id,
    renderHint,
    ...(candidateUrl ? { url: candidateUrl } : {}),
    artifactId: artifact.id,
    ...(resolvedPath ? { path: resolvedPath } : {}),
    ...(mediaType ? { mediaType } : {}),
    provenance: {
      ...(session ? { sessionId: session.id, provider: session.providerName } : {}),
      ...(workspacePath ? { workspacePath } : {}),
      artifactId: artifact.id,
      ...(overrides.publicationDirectory ? { publicationDirectory: overrides.publicationDirectory } : {}),
    },
    metadata: artifact.metadata,
  };
}

function createServicePreviewSurface(
  service: AgentRuntimeService,
  source: RuntimePreviewSurfaceSource,
  workspacePath: string | undefined,
  session?: SessionInfo,
): RuntimePreviewSurface {
  let status: RuntimeDeliveryCapabilityState = 'blocked';
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
    id: `${source}:${service.id}`,
    kind: 'service',
    source,
    status,
    label: service.name || service.id,
    renderHint,
    ...(service.url ? { url: service.url } : {}),
    provenance: {
      ...(session ? { sessionId: session.id, provider: session.providerName } : {}),
      ...(workspacePath ? { workspacePath } : {}),
      serviceId: service.id,
    },
    metadata: service.metadata,
  };
}

function summarizePreviewSurfaceCapability(previewSurfaces: RuntimePreviewSurface[]): RuntimeDeliveryCapability {
  if (previewSurfaces.length === 0) {
    return createCapability('blocked', 'No preview-capable artifacts or services were found.');
  }
  if (previewSurfaces.some((surface) => surface.status === 'ready')) {
    return createCapability('ready');
  }
  if (previewSurfaces.some((surface) => surface.status === 'degraded')) {
    return createCapability('degraded', 'Only degraded preview surfaces are available.');
  }
  if (previewSurfaces.some((surface) => surface.status === 'blocked')) {
    return createCapability('blocked', 'Preview candidates exist but lack usable URL or artifact path data.');
  }
  return createCapability('unsupported', 'Preview candidates are not embeddable in the first runtime slice.');
}

function determineDefaultRemote(remotes: RuntimeRepoRemoteStatus[]): string | undefined {
  return remotes.find((remote) => remote.name === 'origin')?.name || remotes[0]?.name;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
  } = {},
): Promise<CommandResult> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (result: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise(result);
    };

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill();
          } catch {
            // Ignore best-effort kill failures and surface timeout below.
          }
          finish({
            code: null,
            stdout,
            stderr,
            timedOut: true,
          });
        }, options.timeoutMs)
      : undefined;

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      finish({
        code: null,
        stdout,
        stderr: error.message,
        timedOut,
      });
    });
    child.once('close', (code) => {
      finish({
        code,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

let gitAvailabilityPromise: Promise<boolean> | undefined;

async function isGitAvailable(): Promise<boolean> {
  if (!gitAvailabilityPromise) {
    gitAvailabilityPromise = runCommand('git', ['--version'], {
      timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
    }).then((result) => result.code === 0);
  }
  return gitAvailabilityPromise;
}

async function runGit(
  workspacePath: string,
  args: string[],
): Promise<CommandResult> {
  return await runCommand('git', args, {
    cwd: workspacePath,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
}

function parseRemotes(output: string): RuntimeRepoRemoteStatus[] {
  const remotes = new Map<string, RuntimeRepoRemoteStatus>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/);
    if (!match) {
      continue;
    }

    const [, name, url, kind] = match;
    const existing = remotes.get(name) || { name };
    remotes.set(name, {
      ...existing,
      ...(kind === 'fetch' ? { fetchUrl: url } : { pushUrl: url }),
    });
  }

  return Array.from(remotes.values());
}

function parseRepoStatus(workspacePath: string, output: string, remotes: RuntimeRepoRemoteStatus[]): RuntimeRepoStatus {
  let branch: string | null = null;
  let detached = false;
  let headOid: string | undefined;
  let ahead = 0;
  let behind = 0;
  let stagedCount = 0;
  let modifiedCount = 0;
  let untrackedCount = 0;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim();
      branch = value === '(detached)' || value === 'HEAD' ? null : value;
      detached = value === '(detached)' || value === 'HEAD';
      continue;
    }

    if (line.startsWith('# branch.oid ')) {
      const value = line.slice('# branch.oid '.length).trim();
      if (value !== '(initial)') {
        headOid = value;
      }
      continue;
    }

    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/# branch\.ab \+(\d+) -(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }

    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.split(' ')[1] || '..';
      if (xy[0] && xy[0] !== '.') {
        stagedCount += 1;
      }
      if (xy[1] && xy[1] !== '.') {
        modifiedCount += 1;
      }
      continue;
    }

    if (line.startsWith('? ')) {
      untrackedCount += 1;
    }
  }

  return {
    supported: true,
    repository: true,
    rootPath: workspacePath,
    branch,
    detached,
    clean: stagedCount === 0 && modifiedCount === 0 && untrackedCount === 0,
    stagedCount,
    modifiedCount,
    untrackedCount,
    ahead,
    behind,
    remotes,
    defaultRemote: determineDefaultRemote(remotes),
    headOid,
  };
}

function buildRepoCapabilities(repo: RuntimeRepoStatus): Pick<RuntimeDeliveryCapabilities, 'repoStatus' | 'commit' | 'push'> {
  if (!repo.supported) {
    return {
      repoStatus: createCapability('unsupported', 'Git is not available on this runtime host.'),
      commit: createCapability('unsupported', 'Git is not available on this runtime host.'),
      push: createCapability('unsupported', 'Git is not available on this runtime host.'),
    };
  }

  if (!repo.repository) {
    return {
      repoStatus: createCapability('blocked', 'The target workspace is not a Git repository.'),
      commit: createCapability('blocked', 'Commit creation requires a Git repository.'),
      push: createCapability('blocked', 'Branch push requires a Git repository.'),
    };
  }

  return {
    repoStatus: createCapability('ready'),
    commit: createCapability('ready'),
    push: repo.detached
      ? createCapability('blocked', 'Branch push is blocked while HEAD is detached.')
      : repo.remotes.length === 0
        ? createCapability('degraded', 'The repository has no configured remotes yet.')
        : createCapability('ready'),
  };
}

function joinPublicUrl(baseUrl: string, fileName: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileName)}`;
}

function sanitizeFileSegment(value: string): string {
  const trimmed = value.trim();
  const replaced = trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-');
  return replaced || 'artifact';
}

function buildPublishedArtifactFileName(artifact: SessionArtifact, index: number): string {
  if (artifact.path) {
    return sanitizeFileSegment(basename(artifact.path));
  }

  const extension = guessMediaType(undefined, artifact.mediaType) === 'text/html'
    ? '.html'
    : guessMediaType(undefined, artifact.mediaType) === 'application/pdf'
      ? '.pdf'
      : '';
  return `${sanitizeFileSegment(artifact.label || artifact.id || `artifact-${index + 1}`)}${extension}`;
}

export class RuntimeDeliveryService {
  constructor(private readonly deps: RuntimeDeliveryDependencies) {}

  async execute(request: RuntimeDeliveryRequest): Promise<RuntimeDeliveryResult> {
    switch (request.action) {
      case 'audit-delivery-target':
        return await this.auditDeliveryTarget(request);
      case 'publish-artifacts':
        return await this.publishArtifacts(request);
      case 'inspect-repo-status':
        return await this.inspectRepoStatus(request);
      case 'create-commit':
        return await this.createCommit(request);
      case 'push-branch':
        return await this.pushBranch(request);
    }
  }

  private resolveInput(request: RuntimeDeliveryRequest): ResolvedDeliveryInput {
    const session = request.sessionId && this.deps.registry
      ? this.deps.registry.get(request.sessionId)
      : undefined;
    const workspacePath = normalizeWorkspacePath(request.workspacePath || session?.cwd);
    const includeSessionArtifacts = request.preview?.includeSessionArtifacts !== false;
    const includeSessionServices = request.preview?.includeSessionServices !== false;
    const artifacts = dedupeArtifacts([
      ...(includeSessionArtifacts ? session?.artifacts || [] : []),
      ...(request.artifacts || []),
    ]);
    const artifactIds = request.artifactIds && request.artifactIds.length > 0
      ? new Set(request.artifactIds)
      : undefined;
    const filteredArtifacts = artifactIds
      ? artifacts.filter((artifact) => artifactIds.has(artifact.id))
      : artifacts;

    return {
      session,
      workspacePath,
      artifacts: filteredArtifacts,
      services: dedupeServices([
        ...(includeSessionServices ? getSessionServices(session) : []),
        ...(request.services || []),
      ]),
    };
  }

  private createBaseResult(
    request: RuntimeDeliveryRequest,
    resolved: ResolvedDeliveryInput,
    authorization: RuntimeDeliveryAuthorization,
  ): RuntimeDeliveryResult {
    return {
      action: request.action,
      state: 'ready',
      contract: createContract(request.action, request.apply === true, authorization),
      authorization: {
        ...authorization,
        requiresApproval: !MUTATING_ACTIONS.has(request.action)
          ? false
          : authorization.requiresApproval,
      },
      approval: createApprovalPayload(request, authorization),
      ...(resolved.session ? { sessionId: resolved.session.id } : {}),
      ...(resolved.workspacePath ? { workspacePath: resolved.workspacePath } : {}),
      capabilities: createDefaultCapabilities(),
      warnings: [],
      blockedReasons: [],
      capabilityGaps: [],
      repo: createEmptyRepoStatus(),
      artifacts: [],
      previewSurfaces: [],
      summary: createSummary({
        artifacts: [],
        previewSurfaces: [],
        blockedReasons: [],
        capabilityGaps: [],
      }),
      ...(request.context ? { metadata: { context: request.context } } : {}),
    };
  }

  private async inspectRepo(
    workspacePath: string | undefined,
  ): Promise<RepoInspection> {
    const gitAvailable = await isGitAvailable();
    if (!gitAvailable) {
      return {
        repo: createEmptyRepoStatus(false),
        blockedReasons: [],
        capabilityGaps: [
          createIssue(
            'git_unavailable',
            'unsupported',
            'Git is not available on this runtime host.',
          ),
        ],
      };
    }

    if (!workspacePath) {
      return {
        repo: createEmptyRepoStatus(true),
        blockedReasons: [
          createIssue(
            'workspace_path_required',
            'blocked',
            'A workspacePath or sessionId is required for repository inspection.',
          ),
        ],
        capabilityGaps: [],
      };
    }

    if (!await pathExists(workspacePath)) {
      return {
        repo: createEmptyRepoStatus(true),
        blockedReasons: [
          createIssue(
            'workspace_missing',
            'blocked',
            `Workspace path '${workspacePath}' does not exist.`,
          ),
        ],
        capabilityGaps: [],
      };
    }

    const rootResult = await runGit(workspacePath, ['rev-parse', '--show-toplevel']);
    if (rootResult.code !== 0) {
      return {
        repo: createEmptyRepoStatus(true),
        blockedReasons: [
          createIssue(
            'not_git_repository',
            'blocked',
            `Workspace '${workspacePath}' is not a Git repository.`,
          ),
        ],
        capabilityGaps: [],
      };
    }

    const repoRoot = rootResult.stdout.trim() || workspacePath;
    const remoteResult = await runGit(repoRoot, ['remote', '-v']);
    const statusResult = await runGit(repoRoot, ['status', '--porcelain=2', '--branch']);
    return {
      repo: parseRepoStatus(repoRoot, statusResult.stdout, parseRemotes(remoteResult.stdout)),
      blockedReasons: [],
      capabilityGaps: [],
    };
  }

  private collectPreviewSurfaces(resolved: ResolvedDeliveryInput): RuntimePreviewSurface[] {
    const surfaces = [
      ...resolved.artifacts.map((artifact) =>
        createArtifactPreviewSurface(
          artifact,
          resolved.session ? 'session_artifact' : 'request_artifact',
          resolved.workspacePath,
          {},
          resolved.session,
        )),
      ...resolved.services.map((service) =>
        createServicePreviewSurface(
          service,
          resolved.session ? 'session_service' : 'request_service',
          resolved.workspacePath,
          resolved.session,
        )),
    ];

    const deduped = new Map<string, RuntimePreviewSurface>();
    for (const surface of surfaces) {
      if (!deduped.has(surface.id)) {
        deduped.set(surface.id, surface);
      }
    }
    return Array.from(deduped.values());
  }

  private updateSummary(result: RuntimeDeliveryResult): RuntimeDeliveryResult {
    return {
      ...result,
      summary: createSummary({
        artifacts: result.artifacts,
        previewSurfaces: result.previewSurfaces,
        blockedReasons: result.blockedReasons,
        capabilityGaps: result.capabilityGaps,
      }),
    };
  }

  private async auditDeliveryTarget(request: RuntimeDeliveryRequest): Promise<RuntimeDeliveryResult> {
    const authorization = createAuthorization(request.action, request.authorization);
    const resolved = this.resolveInput(request);
    const result = this.createBaseResult(request, resolved, authorization);

    if (request.sessionId && !resolved.session) {
      result.blockedReasons.push(createIssue(
        'session_not_found',
        'blocked',
        `Session '${request.sessionId}' was not found.`,
      ));
    }

    const repoInspection = await this.inspectRepo(resolved.workspacePath);
    result.repo = repoInspection.repo;
    result.blockedReasons.push(...repoInspection.blockedReasons);
    result.capabilityGaps.push(...repoInspection.capabilityGaps);

    result.previewSurfaces = this.collectPreviewSurfaces(resolved);
    result.capabilities.previewSurfaces = summarizePreviewSurfaceCapability(result.previewSurfaces);
    result.capabilities.artifactPublication = resolved.artifacts.length > 0
      ? createCapability('ready')
      : createCapability('blocked', 'No artifacts are currently available to publish.');

    const repoCapabilities = buildRepoCapabilities(result.repo);
    result.capabilities.repoStatus = repoCapabilities.repoStatus;
    result.capabilities.commit = repoCapabilities.commit;
    result.capabilities.push = repoCapabilities.push;

    if (result.capabilities.repoStatus.state !== 'ready') {
      result.capabilityGaps.push(createIssue(
        'repo_status_unavailable',
        result.capabilities.repoStatus.state,
        result.capabilities.repoStatus.reason || 'Repository status is not fully available.',
      ));
    }
    if (result.capabilities.commit.state !== 'ready') {
      result.capabilityGaps.push(createIssue(
        'commit_capability_gap',
        result.capabilities.commit.state,
        result.capabilities.commit.reason || 'Commit capability is not currently ready.',
      ));
    }
    if (result.capabilities.push.state !== 'ready') {
      result.capabilityGaps.push(createIssue(
        'push_capability_gap',
        result.capabilities.push.state,
        result.capabilities.push.reason || 'Push capability is not currently ready.',
      ));
    }
    if (result.capabilities.previewSurfaces.state !== 'ready') {
      result.capabilityGaps.push(createIssue(
        'preview_surface_gap',
        result.capabilities.previewSurfaces.state,
        result.capabilities.previewSurfaces.reason || 'Preview surfaces are not fully ready.',
      ));
    }

    result.state = result.blockedReasons.length > 0
      ? resolved.artifacts.length > 0 || result.previewSurfaces.length > 0
        ? 'degraded'
        : 'blocked'
      : result.capabilityGaps.length > 0
        ? 'degraded'
        : 'ready';

    return this.updateSummary(result);
  }

  private async inspectRepoStatus(request: RuntimeDeliveryRequest): Promise<RuntimeDeliveryResult> {
    const authorization = createAuthorization(request.action, request.authorization);
    const resolved = this.resolveInput(request);
    const result = this.createBaseResult(request, resolved, authorization);

    if (request.sessionId && !resolved.session) {
      result.blockedReasons.push(createIssue(
        'session_not_found',
        'blocked',
        `Session '${request.sessionId}' was not found.`,
      ));
    }

    const repoInspection = await this.inspectRepo(resolved.workspacePath);
    result.repo = repoInspection.repo;
    result.blockedReasons.push(...repoInspection.blockedReasons);
    result.capabilityGaps.push(...repoInspection.capabilityGaps);
    result.previewSurfaces = this.collectPreviewSurfaces(resolved);

    result.capabilities.previewSurfaces = summarizePreviewSurfaceCapability(result.previewSurfaces);
    result.capabilities.artifactPublication = resolved.artifacts.length > 0
      ? createCapability('ready')
      : createCapability('blocked', 'No artifacts are currently available to publish.');

    const repoCapabilities = buildRepoCapabilities(result.repo);
    result.capabilities.repoStatus = repoCapabilities.repoStatus;
    result.capabilities.commit = repoCapabilities.commit;
    result.capabilities.push = repoCapabilities.push;

    result.state = result.capabilities.repoStatus.state === 'unsupported'
      ? 'unsupported'
      : result.blockedReasons.length > 0
        ? 'blocked'
        : 'ready';

    return this.updateSummary(result);
  }

  private async planPublication(
    request: RuntimeDeliveryRequest,
    resolved: ResolvedDeliveryInput,
  ): Promise<PublicationPlan> {
    const targetDirectory = resolveFromWorkspace(
      resolved.workspacePath,
      request.publication?.directory,
    );
    const manifestPath = targetDirectory
      ? join(targetDirectory, request.publication?.manifestFileName || DEFAULT_ARTIFACT_MANIFEST_FILE_NAME)
      : undefined;

    const publishableRecords: RuntimeArtifactPublicationRecord[] = [];
    const blockedArtifacts: RuntimeDeliveryIssue[] = [];
    const degradedArtifacts: RuntimeDeliveryIssue[] = [];
    const warnings: RuntimeDeliveryWarning[] = [];

    for (const [index, artifact] of resolved.artifacts.entries()) {
      const sourcePath = resolveFromWorkspace(resolved.workspacePath, artifact.path);
      const fileName = buildPublishedArtifactFileName(artifact, index);
      const outputPath = targetDirectory ? join(targetDirectory, fileName) : undefined;
      const mediaType = guessMediaType(sourcePath || artifact.path || artifact.uri, artifact.mediaType);

      if (sourcePath && await pathExists(sourcePath)) {
        publishableRecords.push({
          id: artifact.id,
          label: artifact.label,
          sourcePath,
          outputPath,
          publicUrl: request.publication?.publicBaseUrl
            ? joinPublicUrl(request.publication.publicBaseUrl, fileName)
            : undefined,
          mediaType,
          sizeBytes: artifact.sizeBytes,
          copied: false,
          metadata: artifact.metadata,
        });
        continue;
      }

      if (artifact.uri) {
        publishableRecords.push({
          id: artifact.id,
          label: artifact.label,
          sourceUri: artifact.uri,
          outputPath,
          publicUrl: artifact.uri,
          mediaType,
          sizeBytes: artifact.sizeBytes,
          copied: false,
          metadata: artifact.metadata,
        });
        warnings.push(createWarning(
          'artifact_reference_only',
          `Artifact '${artifact.id}' has no local file path; publication falls back to manifest/reference metadata.`,
        ));
        continue;
      }

      const issue = createIssue(
        'artifact_source_missing',
        'blocked',
        sourcePath
          ? `Artifact '${artifact.id}' source path '${sourcePath}' does not exist.`
          : `Artifact '${artifact.id}' does not expose a publishable path or URI.`,
      );
      if (publishableRecords.length === 0) {
        blockedArtifacts.push(issue);
      } else {
        degradedArtifacts.push(issue);
      }
    }

    return {
      publishableRecords,
      blockedArtifacts,
      degradedArtifacts,
      warnings,
      manifestPath,
      targetDirectory,
    };
  }

  private buildPublishedPreviewSurfaces(
    resolved: ResolvedDeliveryInput,
    publication: PublicationPlan,
  ): RuntimePreviewSurface[] {
    return publication.publishableRecords.map((record) =>
      createArtifactPreviewSurface(
        {
          id: record.id,
          label: record.label,
          path: record.outputPath || record.sourcePath,
          uri: record.publicUrl || record.sourceUri,
          mediaType: record.mediaType,
          sizeBytes: record.sizeBytes,
          metadata: record.metadata,
        },
        'published_artifact',
        resolved.workspacePath,
        {
          path: record.outputPath || record.sourcePath,
          url: record.publicUrl || record.sourceUri,
          publicationDirectory: publication.targetDirectory,
        },
        resolved.session,
      ));
  }

  private async publishArtifacts(request: RuntimeDeliveryRequest): Promise<RuntimeDeliveryResult> {
    const authorization = createAuthorization(request.action, request.authorization);
    const resolved = this.resolveInput(request);
    const result = this.createBaseResult(request, resolved, authorization);

    const repoInspection = await this.inspectRepo(resolved.workspacePath);
    result.repo = repoInspection.repo;
    const repoCapabilities = buildRepoCapabilities(result.repo);
    result.capabilities.repoStatus = repoCapabilities.repoStatus;
    result.capabilities.commit = repoCapabilities.commit;
    result.capabilities.push = repoCapabilities.push;

    if (request.sessionId && !resolved.session) {
      result.blockedReasons.push(createIssue(
        'session_not_found',
        'blocked',
        `Session '${request.sessionId}' was not found.`,
      ));
    }
    if (resolved.artifacts.length === 0) {
      result.blockedReasons.push(createIssue(
        'no_artifacts_available',
        'blocked',
        'No artifacts are available for publication/export.',
      ));
    }

    const publication = await this.planPublication(request, resolved);
    if (!publication.targetDirectory) {
      result.blockedReasons.push(createIssue(
        'publication_directory_required',
        'blocked',
        'publication.directory is required for artifact publication/export.',
      ));
    }

    result.blockedReasons.push(...publication.blockedArtifacts);
    result.capabilityGaps.push(...publication.degradedArtifacts);
    result.warnings.push(...publication.warnings);
    result.artifacts = publication.publishableRecords;
    result.previewSurfaces = this.buildPublishedPreviewSurfaces(resolved, publication);
    result.capabilities.previewSurfaces = summarizePreviewSurfaceCapability(result.previewSurfaces);
    result.capabilities.artifactPublication = result.artifacts.length > 0
      ? publication.degradedArtifacts.length > 0
        ? createCapability('degraded', 'Some artifacts cannot be copied and will publish as references only.')
        : createCapability('ready')
      : createCapability('blocked', 'No publishable artifacts were resolved.');

    if (request.apply === true && !authorization.canApply) {
      result.blockedReasons.push(createIssue(
        'approval_required',
        'blocked',
        'Artifact publication/export apply requires approval.',
      ));
    }

    if (request.apply !== true) {
      result.state = result.blockedReasons.length > 0
        ? 'blocked'
        : result.capabilityGaps.length > 0 || result.warnings.length > 0
          ? 'degraded'
          : 'ready';
      return this.updateSummary(result);
    }

    if (result.blockedReasons.length > 0) {
      result.state = 'blocked';
      return this.updateSummary(result);
    }

    await mkdir(publication.targetDirectory!, { recursive: true });
    const manifestArtifacts: RuntimeArtifactPublicationRecord[] = [];
    for (const artifact of result.artifacts) {
      const copied = Boolean(artifact.sourcePath && artifact.outputPath);
      if (copied) {
        await copyFile(artifact.sourcePath!, artifact.outputPath!);
      }
      manifestArtifacts.push({
        ...artifact,
        copied,
      });
    }

    const publishedSurfaces = this.buildPublishedPreviewSurfaces(resolved, {
      ...publication,
      publishableRecords: manifestArtifacts,
    });
    const surfacesById = new Map(publishedSurfaces.map((surface) => [surface.artifactId, surface.id]));
    result.artifacts = manifestArtifacts.map((artifact) => ({
      ...artifact,
      previewSurfaceId: surfacesById.get(artifact.id),
    }));
    result.previewSurfaces = publishedSurfaces;

    if (publication.manifestPath) {
      await writeFile(
        publication.manifestPath,
        JSON.stringify({
          action: request.action,
          sessionId: resolved.session?.id,
          workspacePath: resolved.workspacePath,
          generatedAt: new Date().toISOString(),
          artifacts: result.artifacts,
          previewSurfaces: result.previewSurfaces,
        }, null, 2) + '\n',
        'utf-8',
      );
    }

    result.state = 'completed';
    result.metadata = {
      ...(result.metadata || {}),
      publication: {
        directory: publication.targetDirectory,
        manifestPath: publication.manifestPath,
      },
    };
    return this.updateSummary(result);
  }

  private async createCommit(request: RuntimeDeliveryRequest): Promise<RuntimeDeliveryResult> {
    const authorization = createAuthorization(request.action, request.authorization);
    const resolved = this.resolveInput(request);
    const result = this.createBaseResult(request, resolved, authorization);

    const message = request.repo?.message?.trim();
    if (!message) {
      result.blockedReasons.push(createIssue(
        'commit_message_required',
        'blocked',
        'repo.message is required to create a commit.',
      ));
    }
    if (request.sessionId && !resolved.session) {
      result.blockedReasons.push(createIssue(
        'session_not_found',
        'blocked',
        `Session '${request.sessionId}' was not found.`,
      ));
    }

    const repoInspection = await this.inspectRepo(resolved.workspacePath);
    result.repo = repoInspection.repo;
    result.blockedReasons.push(...repoInspection.blockedReasons);
    result.capabilityGaps.push(...repoInspection.capabilityGaps);
    result.previewSurfaces = this.collectPreviewSurfaces(resolved);

    const repoCapabilities = buildRepoCapabilities(result.repo);
    result.capabilities.repoStatus = repoCapabilities.repoStatus;
    result.capabilities.commit = repoCapabilities.commit;
    result.capabilities.push = repoCapabilities.push;
    result.capabilities.previewSurfaces = summarizePreviewSurfaceCapability(result.previewSurfaces);
    result.capabilities.artifactPublication = resolved.artifacts.length > 0
      ? createCapability('ready')
      : createCapability('blocked', 'No artifacts are currently available to publish.');

    if (result.repo.repository && result.repo.clean && request.repo?.allowEmpty !== true) {
      result.blockedReasons.push(createIssue(
        'nothing_to_commit',
        'blocked',
        'The repository is clean; there is nothing to commit.',
      ));
    }

    if (request.apply === true && !authorization.canApply) {
      result.blockedReasons.push(createIssue(
        'approval_required',
        'blocked',
        'Commit creation apply requires approval.',
      ));
    }

    if (request.apply !== true) {
      result.state = result.capabilities.commit.state === 'unsupported'
        ? 'unsupported'
        : result.blockedReasons.length > 0
          ? 'blocked'
          : 'ready';
      result.metadata = {
        ...(result.metadata || {}),
        repo: {
          message,
          stageAll: request.repo?.stageAll !== false,
          allowEmpty: request.repo?.allowEmpty === true,
        },
      };
      return this.updateSummary(result);
    }

    if (result.blockedReasons.length > 0) {
      result.state = result.capabilities.commit.state === 'unsupported' ? 'unsupported' : 'blocked';
      return this.updateSummary(result);
    }

    if (request.repo?.stageAll !== false) {
      const addResult = await runGit(result.repo.rootPath!, ['add', '-A']);
      if (addResult.code !== 0) {
        result.state = 'blocked';
        result.blockedReasons.push(createIssue(
          'git_add_failed',
          'blocked',
          addResult.stderr.trim() || 'git add -A failed.',
        ));
        return this.updateSummary(result);
      }
    }

    const commitArgs = ['commit', '-m', message!];
    if (request.repo?.allowEmpty === true) {
      commitArgs.push('--allow-empty');
    }
    const commitResult = await runGit(result.repo.rootPath!, commitArgs);
    if (commitResult.code !== 0) {
      result.state = 'blocked';
      result.blockedReasons.push(createIssue(
        'git_commit_failed',
        'blocked',
        commitResult.stderr.trim() || commitResult.stdout.trim() || 'git commit failed.',
      ));
      return this.updateSummary(result);
    }

    const headResult = await runGit(result.repo.rootPath!, ['rev-parse', 'HEAD']);
    const refreshed = await this.inspectRepo(result.repo.rootPath);
    result.repo = refreshed.repo;
    result.state = 'completed';
    result.metadata = {
      ...(result.metadata || {}),
      commit: {
        oid: headResult.stdout.trim() || result.repo.headOid,
        message,
        stageAll: request.repo?.stageAll !== false,
      },
    };
    return this.updateSummary(result);
  }

  private async pushBranch(request: RuntimeDeliveryRequest): Promise<RuntimeDeliveryResult> {
    const authorization = createAuthorization(request.action, request.authorization);
    const resolved = this.resolveInput(request);
    const result = this.createBaseResult(request, resolved, authorization);

    if (request.sessionId && !resolved.session) {
      result.blockedReasons.push(createIssue(
        'session_not_found',
        'blocked',
        `Session '${request.sessionId}' was not found.`,
      ));
    }

    const repoInspection = await this.inspectRepo(resolved.workspacePath);
    result.repo = repoInspection.repo;
    result.blockedReasons.push(...repoInspection.blockedReasons);
    result.capabilityGaps.push(...repoInspection.capabilityGaps);
    result.previewSurfaces = this.collectPreviewSurfaces(resolved);

    const repoCapabilities = buildRepoCapabilities(result.repo);
    result.capabilities.repoStatus = repoCapabilities.repoStatus;
    result.capabilities.commit = repoCapabilities.commit;
    result.capabilities.push = repoCapabilities.push;
    result.capabilities.previewSurfaces = summarizePreviewSurfaceCapability(result.previewSurfaces);
    result.capabilities.artifactPublication = resolved.artifacts.length > 0
      ? createCapability('ready')
      : createCapability('blocked', 'No artifacts are currently available to publish.');

    const branch = request.repo?.branch || result.repo.branch;
    const remote = request.repo?.remote || result.repo.defaultRemote;
    if (result.repo.detached) {
      result.blockedReasons.push(createIssue(
        'detached_head',
        'blocked',
        'Branch push is blocked while HEAD is detached.',
      ));
    }
    if (!branch) {
      result.blockedReasons.push(createIssue(
        'branch_required',
        'blocked',
        'A local branch is required for push.',
      ));
    }
    if (!remote) {
      result.blockedReasons.push(createIssue(
        'remote_required',
        'blocked',
        'A configured remote is required for push.',
      ));
    }
    if (request.apply === true && !authorization.canApply) {
      result.blockedReasons.push(createIssue(
        'approval_required',
        'blocked',
        'Branch push apply requires approval.',
      ));
    }

    if (request.apply !== true) {
      result.state = result.capabilities.push.state === 'unsupported'
        ? 'unsupported'
        : result.blockedReasons.length > 0
          ? 'blocked'
          : 'ready';
      result.metadata = {
        ...(result.metadata || {}),
        push: {
          remote,
          branch,
          setUpstream: request.repo?.setUpstream !== false,
          forceWithLease: request.repo?.forceWithLease === true,
        },
      };
      return this.updateSummary(result);
    }

    if (result.blockedReasons.length > 0) {
      result.state = result.capabilities.push.state === 'unsupported' ? 'unsupported' : 'blocked';
      return this.updateSummary(result);
    }

    const pushArgs = ['push'];
    if (request.repo?.setUpstream !== false) {
      pushArgs.push('--set-upstream');
    }
    if (request.repo?.forceWithLease === true) {
      pushArgs.push('--force-with-lease');
    }
    pushArgs.push(remote!, branch!);

    const pushResult = await runGit(result.repo.rootPath!, pushArgs);
    if (pushResult.code !== 0) {
      result.state = 'blocked';
      result.blockedReasons.push(createIssue(
        'git_push_failed',
        'blocked',
        pushResult.stderr.trim() || pushResult.stdout.trim() || 'git push failed.',
      ));
      return this.updateSummary(result);
    }

    const refreshed = await this.inspectRepo(result.repo.rootPath);
    result.repo = refreshed.repo;
    result.state = 'completed';
    result.metadata = {
      ...(result.metadata || {}),
      push: {
        remote,
        branch,
        setUpstream: request.repo?.setUpstream !== false,
        forceWithLease: request.repo?.forceWithLease === true,
      },
    };
    return this.updateSummary(result);
  }
}
