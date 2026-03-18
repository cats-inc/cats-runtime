import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  isProviderNotConfiguredError,
  isUnknownProviderInstanceError,
} from '../backends/cli/config.js';
import { isProviderTargetResolutionError } from '../core/providerCatalog.js';

export function getRouteErrorStatus(error: unknown): ContentfulStatusCode {
  if (
    isUnknownProviderInstanceError(error)
    || isProviderNotConfiguredError(error)
    || isProviderTargetResolutionError(error)
  ) {
    return 400;
  }
  return 500;
}
