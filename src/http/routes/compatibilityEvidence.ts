import { Hono } from 'hono';
import type { RuntimeMode } from '../../backends/cli/config.js';
import {
  createCompatibilityEvidenceService,
  summarizeCompatibilityEvidenceArtifactForListReadModel,
} from '../../core/compatibility/compatibilityEvidenceReadModel.js';
import type { CompatibilityClassification } from '../../core/compatibility/types.js';
import type { AppContext } from '../app.js';

const compatibilityEvidenceRoutes = new Hono();

const COMPATIBILITY_CLASSIFICATIONS: readonly CompatibilityClassification[] = [
  'degraded',
  'unsupported_version',
  'unrecognized_protocol',
  'probe_failed',
];

const RUNTIME_MODES: readonly RuntimeMode[] = ['native', 'wsl', 'docker'];

function parseOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid compatibility evidence limit');
  }
  return parsed;
}

function parseRuntimeMode(value: string | undefined): RuntimeMode | undefined {
  const trimmed = parseOptionalString(value);
  if (!trimmed) {
    return undefined;
  }
  if (RUNTIME_MODES.includes(trimmed as RuntimeMode)) {
    return trimmed as RuntimeMode;
  }
  throw new Error('Invalid compatibility evidence runtime mode');
}

function parseClassifications(url: URL): CompatibilityClassification[] | undefined {
  const values = url.searchParams.getAll('classification')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    return undefined;
  }

  const invalid = values.find((value) => !COMPATIBILITY_CLASSIFICATIONS.includes(value as CompatibilityClassification));
  if (invalid) {
    throw new Error(`Invalid compatibility evidence classification '${invalid}'`);
  }

  return values as CompatibilityClassification[];
}

function parseArtifactQuery(url: URL) {
  return {
    provider: parseOptionalString(url.searchParams.get('provider') ?? undefined),
    instance: parseOptionalString(url.searchParams.get('instance') ?? undefined),
    classifications: parseClassifications(url),
    parserId: parseOptionalString(url.searchParams.get('parserId') ?? undefined),
    profileId: parseOptionalString(url.searchParams.get('profileId') ?? undefined),
    runtimeMode: parseRuntimeMode(url.searchParams.get('runtimeMode') ?? undefined),
    limit: parsePositiveLimit(url.searchParams.get('limit') ?? undefined),
  };
}

compatibilityEvidenceRoutes.get('/diagnostics/providers/evidence', async (c) => {
  try {
    const ctx = c.get('ctx' as never) as AppContext;
    const query = parseArtifactQuery(new URL(c.req.url));
    const service = createCompatibilityEvidenceService(ctx.config);
    const artifacts = await service.listArtifacts(query);

    return c.json({
      query: {
        ...query,
        ...(query.classifications ? { classifications: query.classifications } : {}),
      },
      artifacts: artifacts.map((artifact) => summarizeCompatibilityEvidenceArtifactForListReadModel(artifact)),
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Invalid compatibility evidence query',
    }, 400);
  }
});

compatibilityEvidenceRoutes.get('/diagnostics/providers/evidence/:artifactId', async (c) => {
  try {
    const ctx = c.get('ctx' as never) as AppContext;
    const query = parseArtifactQuery(new URL(c.req.url));
    const service = createCompatibilityEvidenceService(ctx.config);
    const artifact = await service.readArtifactById(c.req.param('artifactId'), query);

    if (!artifact) {
      return c.json({
        error: 'compatibility_evidence_not_found',
      }, 404);
    }

    return c.json({
      relativePath: artifact.relativePath.replace(/\\/g, '/'),
      artifact: artifact.artifact,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Invalid compatibility evidence query',
    }, 400);
  }
});

export { compatibilityEvidenceRoutes };
