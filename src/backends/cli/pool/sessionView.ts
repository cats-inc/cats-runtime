import type {
  SessionActivity,
  SessionControlMode,
  SessionControls,
  SessionInfo,
  SessionOrigin,
  SessionOwnership,
  SessionResumeStrategy,
  SessionStatus,
  SessionView,
} from './types.js';

interface SessionViewOptions {
  attached?: boolean;
  now?: number;
  externalSessionLiveWindowMs?: number;
}

export function normalizeSessionOrigin(
  session: {
    origin?: SessionOrigin | 'fleet';
    managed?: boolean;
    sourcePath?: string;
    providerSourcePath?: string;
  },
  sessionBaseDir?: string,
): SessionOrigin {
  if (session.origin === 'runtime' || session.origin === 'discovered') {
    return session.origin;
  }
  if (session.origin === 'fleet') {
    return 'runtime';
  }

  if (session.managed === true) {
    return 'runtime';
  }

  const paths = [session.providerSourcePath, session.sourcePath].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const hasExternalProviderPath = paths.some((value) => {
    if (!sessionBaseDir) return true;
    return !value.startsWith(sessionBaseDir);
  });

  return hasExternalProviderPath ? 'discovered' : 'runtime';
}

function resolveNow(now?: number): number {
  return typeof now === 'number' ? now : Date.now();
}

export function sessionWorkspaceKey(cwd?: string): string {
  const normalized = (cwd || 'unknown').replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function hasRecentExternalActivity(
  session: SessionInfo,
  options: SessionViewOptions,
): boolean {
  if (session.origin !== 'discovered' || !session.lastActivity) {
    return false;
  }

  const lastActivityMs = Date.parse(session.lastActivity);
  if (!Number.isFinite(lastActivityMs)) {
    return false;
  }

  const windowMs = options.externalSessionLiveWindowMs ?? 0;
  if (windowMs <= 0) {
    return false;
  }

  const now = resolveNow(options.now);
  return lastActivityMs <= now && now - lastActivityMs <= windowMs;
}

export function sessionActivity(
  sessionOrStatus: SessionInfo | SessionStatus,
  options: SessionViewOptions = {},
): SessionActivity {
  if (typeof sessionOrStatus === 'string') {
    if (sessionOrStatus === 'closing') return 'tearing_down';
    if (sessionOrStatus === 'closed') return 'inactive';
    return 'interactive';
  }

  const session = sessionOrStatus;
  if (session.status === 'closing') return 'tearing_down';
  if (options.attached && session.status !== 'closed') return 'interactive';
  if (session.status === 'closed' && hasRecentExternalActivity(session, options)) {
    return 'interactive';
  }
  return 'inactive';
}

export function sessionOwnership(providerName: string): SessionOwnership {
  switch (providerName) {
    case 'claude':
    case 'codex':
      return 'persistent_process';
    case 'kiro':
      return 'workspace_latest';
    case 'auggie':
    case 'gemini':
    case 'copilot':
    case 'cursor':
    default:
      return 'logical_session';
  }
}

export function sessionResumeStrategy(providerName: string): SessionResumeStrategy {
  switch (providerName) {
    case 'kiro':
      return 'latest_in_workspace';
    case 'auggie':
    case 'claude':
    case 'codex':
    case 'copilot':
    case 'cursor':
    case 'gemini':
    default:
      return 'provider_session';
  }
}

export function sessionControlMode(
  session: SessionInfo,
  options: SessionViewOptions = {},
): SessionControlMode {
  const activity = sessionActivity(session, options);
  if (options.attached) return 'full';
  if (activity === 'interactive' || activity === 'tearing_down') return 'observe_only';

  const resumeStrategy = sessionResumeStrategy(session.providerName);
  if (resumeStrategy !== 'none' && session.providerSessionId) {
    return 'resume_only';
  }

  return 'observe_only';
}

export function sessionControls(
  session: SessionInfo,
  options: SessionViewOptions = {},
): SessionControls {
  const activity = sessionActivity(session, options);
  const controlMode = sessionControlMode(session, options);

  return {
    canSend: options.attached === true && activity === 'interactive' && session.status !== 'busy',
    canResume: controlMode === 'resume_only' && activity === 'inactive',
    canClose: options.attached === true && activity === 'interactive',
    canDelete: activity !== 'tearing_down' && !(activity === 'interactive' && options.attached !== true),
    canRefresh: options.attached !== true || activity !== 'interactive',
  };
}

export function toSessionView(
  session: SessionInfo,
  options: SessionViewOptions = {},
): SessionView {
  const attached = options.attached === true;
  return {
    ...session,
    workspaceKey: sessionWorkspaceKey(session.cwd),
    activity: sessionActivity(session, options),
    ownership: sessionOwnership(session.providerName),
    resumeStrategy: sessionResumeStrategy(session.providerName),
    controlMode: sessionControlMode(session, options),
    attached,
    controls: sessionControls(session, { ...options, attached }),
  };
}

export function toSessionViews(
  sessions: SessionInfo[],
  options: SessionViewOptions & { isAttached?: (session: SessionInfo) => boolean } = {},
): SessionView[] {
  const now = resolveNow(options.now);
  return sessions.map((session) => toSessionView(session, {
    attached: options.isAttached?.(session) ?? options.attached,
    now,
    externalSessionLiveWindowMs: options.externalSessionLiveWindowMs,
  }));
}
