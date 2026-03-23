import type { RuntimeWakeReason, SessionInvocationContext } from '../types.js';

export function extractWakeReason(
  context?: SessionInvocationContext,
): RuntimeWakeReason | null {
  if (!context) {
    return null;
  }

  return {
    source: context.source,
    reason: context.reason,
    taskId: context.taskId,
    issueId: context.issueId,
    commentId: context.commentId,
    approvalId: context.approvalId,
    ...(context.labels ? { labels: [...context.labels] } : {}),
    ...(context.metadata ? { metadata: { ...context.metadata } } : {}),
  };
}
