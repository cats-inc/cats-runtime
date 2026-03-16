import type { SessionInvocationContext } from '../backends/cli/pool/types.js';

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
