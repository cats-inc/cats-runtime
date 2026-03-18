import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  isProviderNotConfiguredError,
  isUnknownProviderInstanceError,
} from '../backends/cli/config.js';

export function getRouteErrorStatus(error: unknown): ContentfulStatusCode {
  if (isUnknownProviderInstanceError(error) || isProviderNotConfiguredError(error)) {
    return 400;
  }
  const message = error instanceof Error ? error.message : '';
  if (
    message.startsWith('Provider \'')
    || message.startsWith('Unknown ')
    || message.startsWith('Ambiguous ')
  ) {
    return 400;
  }
  return 500;
}
