import type { CatalogScope } from '../../catalogs/types.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { createRuntimeAdapter } from '../../backends/cli/runtime/runtime.js';
import { resolveKimiHome } from '../../backends/cli/providers/kimi.js';
import { detectKimiSignInRegion } from '../../backends/cli/kimi/catalogBasis.js';

/** The basis ids a CLI's non-secret local markers show for its sign-in (SPEC-045 FR-6). */
export interface CatalogBasisMarker {
  region?: string;
  plan?: string;
  channel?: string;
}

export type CatalogBasisDetector = (target: ProviderTargetDescriptor) => CatalogBasisMarker | null;

/**
 * Detection reads only CLI output or non-secret markers, never a credential (ADR-038), and a
 * source is added for one CLI at a time with evidence in its provider reference. Only a local
 * native CLI is read: a WSL, Docker or remote target signs in somewhere else.
 */
export function createCatalogBasisDetector(env: NodeJS.ProcessEnv = process.env): CatalogBasisDetector {
  return target => {
    const instance = target.backend === 'cli' ? target.cliInstance : undefined;
    if (!instance || createRuntimeAdapter(instance.commandConfig.runtime).mode !== 'native') return null;
    if (target.providerName === 'kimi') {
      const region = detectKimiSignInRegion(resolveKimiHome(undefined, env));
      return region ? { region } : null;
    }
    return null;
  };
}

const MARKER_DIMENSIONS = ['region', 'plan', 'channel'] as const;

/** The one basis that every detected id matches, or -1 when none or several do. */
export function findDetectedBasisIndex(
  scopes: readonly CatalogScope[],
  marker: CatalogBasisMarker | null,
): number {
  const dimensions = MARKER_DIMENSIONS.filter(dimension => marker?.[dimension]);
  if (!marker || dimensions.length === 0) return -1;
  const matches = scopes.flatMap((scope, index) =>
    dimensions.every(dimension => scope.basis?.[dimension]?.id === marker[dimension]) ? [index] : []);
  return matches.length === 1 ? matches[0]! : -1;
}
