import type {
  RuntimeSkillManifest,
  RuntimeSkillManifestContext,
  SessionInvocationContext,
} from '../core/types.js';

export interface ParsedRuntimeSkillManifest {
  manifest?: RuntimeSkillManifest;
  clear?: boolean;
  error?: string;
}

export function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return parsed.length > 0 ? parsed : undefined;
}

export function parseInvocationContext(value: unknown): SessionInvocationContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const workspaceValue = record.workspace;
  const workspace = workspaceValue && typeof workspaceValue === 'object' && !Array.isArray(workspaceValue)
    ? {
        cwd: parseOptionalString((workspaceValue as Record<string, unknown>).cwd),
        workspaceId: parseOptionalString((workspaceValue as Record<string, unknown>).workspaceId),
        repoUrl: parseOptionalString((workspaceValue as Record<string, unknown>).repoUrl),
        repoRef: parseOptionalString((workspaceValue as Record<string, unknown>).repoRef),
      }
    : undefined;
  const labels = parseStringArray(record.labels);
  const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : undefined;

  const context: SessionInvocationContext = {
    source: parseOptionalString(record.source) as SessionInvocationContext['source'] | undefined,
    reason: parseOptionalString(record.reason),
    taskId: parseOptionalString(record.taskId),
    issueId: parseOptionalString(record.issueId),
    commentId: parseOptionalString(record.commentId),
    approvalId: parseOptionalString(record.approvalId),
    workspace,
    labels,
    metadata,
  };

  return Object.values(context).some((entry) => entry !== undefined)
    ? context
    : undefined;
}

function parseRuntimeSkillRoomMode(
  value: unknown,
): RuntimeSkillManifestContext['roomMode'] | undefined {
  return value === 'boss_chat'
    || value === 'direct_cat_chat'
    || value === 'transport_inbox'
    ? value
    : undefined;
}

function parseRuntimeSkillTransport(
  value: unknown,
): RuntimeSkillManifestContext['transport'] | undefined {
  return value === 'telegram'
    || value === 'line'
    || value === 'web'
    || value === null
    ? value
    : undefined;
}

function parseRuntimeSkillContext(value: unknown): RuntimeSkillManifestContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const context: RuntimeSkillManifestContext = {
    catId: parseOptionalString(record.catId),
    roomMode: parseRuntimeSkillRoomMode(record.roomMode),
    transport: parseRuntimeSkillTransport(record.transport),
    labels: parseStringArray(record.labels),
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : undefined,
  };

  return Object.values(context).some((entry) => entry !== undefined)
    ? context
    : undefined;
}

export function parseRuntimeSkillManifest(value: unknown): ParsedRuntimeSkillManifest {
  if (value === undefined) {
    return {};
  }

  if (value === null) {
    return {
      clear: true,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: 'skills must be an object with requestedSkills.',
    };
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.requestedSkills)) {
    return {
      error: 'skills.requestedSkills must be a non-empty string array.',
    };
  }

  if (record.requestedSkills.length === 0) {
    return {};
  }

  const requestedSkills = parseStringArray(record.requestedSkills);
  if (!requestedSkills || requestedSkills.length === 0) {
    return {
      error: 'skills.requestedSkills must be a non-empty string array.',
    };
  }

  return {
    manifest: {
      profileId: parseOptionalString(record.profileId),
      requestedSkills,
      context: parseRuntimeSkillContext(record.context),
      strict: record.strict === true,
    },
  };
}
