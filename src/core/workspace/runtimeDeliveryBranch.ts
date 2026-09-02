export const RUNTIME_DELIVERY_BRANCH_PREFIX = 'cats/runtime/';

export function buildRuntimeDeliveryBranch(sessionId: string): string {
  const segment = sessionId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `${RUNTIME_DELIVERY_BRANCH_PREFIX}${segment || 'session'}`;
}

export function isRuntimeDeliveryBranch(branch: string | undefined): branch is string {
  return branch?.startsWith(RUNTIME_DELIVERY_BRANCH_PREFIX) === true
    && branch.length > RUNTIME_DELIVERY_BRANCH_PREFIX.length;
}
