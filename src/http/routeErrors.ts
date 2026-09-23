import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { CatalogRevisionConflict, CatalogUnavailableError } from '../catalogs/errors.js';
import {
  isProviderNotConfiguredError,
  isUnknownProviderInstanceError,
} from '../backends/cli/config.js';
import { isProviderTargetResolutionError } from '../core/providerCatalog.js';

export function getRouteErrorStatus(error: unknown): ContentfulStatusCode {
  if (error instanceof CatalogRevisionConflict) return 409;
  if (error instanceof CatalogUnavailableError) return 503;
  if (
    isUnknownProviderInstanceError(error)
    || isProviderNotConfiguredError(error)
    || isProviderTargetResolutionError(error)
  ) {
    return 400;
  }
  return 500;
}
