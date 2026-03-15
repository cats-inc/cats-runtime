import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isUnknownProviderInstanceError } from '../backends/cli/config.js';

export function getRouteErrorStatus(error: unknown): ContentfulStatusCode {
  return isUnknownProviderInstanceError(error)
    ? 400
    : 500;
}
