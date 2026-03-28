import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const JSON_ARTIFACT_SUFFIX = '.json';
const TIMESTAMPED_ARTIFACT_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-.*\.json$/u;

export interface ProviderArtifactPathList {
  relativePaths: string[];
  orderedByRecency: boolean;
}

export function sanitizeArtifactProviderSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'default';
}

export async function listProviderArtifactDirectories(rootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function listProviderArtifactRelativePaths(
  rootDir: string,
  provider?: string,
  options: {
    newestFirst?: boolean;
  } = {},
): Promise<ProviderArtifactPathList> {
  if (!provider) {
    const providerSegments = await listProviderArtifactDirectories(rootDir);
    const relativePaths: string[] = [];

    for (const providerSegment of providerSegments) {
      const providerPaths = await listOneProviderArtifactRelativePaths(rootDir, providerSegment, {
        newestFirst: false,
      });
      relativePaths.push(...providerPaths.relativePaths);
    }

    return {
      relativePaths,
      orderedByRecency: false,
    };
  }

  return listOneProviderArtifactRelativePaths(
    rootDir,
    sanitizeArtifactProviderSegment(provider),
    options,
  );
}

export async function pruneProviderArtifacts(
  rootDir: string,
  retentionLimit: number,
  provider?: string,
): Promise<number> {
  const normalizedLimit = Math.max(1, Math.trunc(retentionLimit));
  const providerSegments = provider
    ? [sanitizeArtifactProviderSegment(provider)]
    : await listProviderArtifactDirectories(rootDir);
  let removed = 0;

  for (const providerSegment of providerSegments) {
    removed += await pruneOneProviderArtifacts(rootDir, providerSegment, normalizedLimit);
  }

  return removed;
}

async function listOneProviderArtifactRelativePaths(
  rootDir: string,
  providerSegment: string,
  options: {
    newestFirst?: boolean;
  },
): Promise<ProviderArtifactPathList> {
  const providerDir = join(rootDir, providerSegment);
  let names: string[];

  try {
    names = await readdir(providerDir);
  } catch {
    return {
      relativePaths: [],
      orderedByRecency: false,
    };
  }

  const jsonNames = names.filter((name) => name.endsWith(JSON_ARTIFACT_SUFFIX));
  const orderedByRecency = options.newestFirst === true
    && jsonNames.length > 0
    && jsonNames.every((name) => TIMESTAMPED_ARTIFACT_FILE_PATTERN.test(name));
  const orderedNames = orderedByRecency
    ? [...jsonNames].sort((left, right) => right.localeCompare(left))
    : jsonNames;

  return {
    relativePaths: orderedNames.map((name) => join(providerSegment, name)),
    orderedByRecency,
  };
}

async function pruneOneProviderArtifacts(
  rootDir: string,
  providerSegment: string,
  retentionLimit: number,
): Promise<number> {
  const providerDir = join(rootDir, providerSegment);
  let names: string[];

  try {
    names = await readdir(providerDir);
  } catch {
    return 0;
  }

  const jsonNames = names.filter((name) => name.endsWith(JSON_ARTIFACT_SUFFIX));
  if (jsonNames.length <= retentionLimit) {
    return 0;
  }

  const orderedNames = await orderArtifactNamesNewestFirst(providerDir, jsonNames);
  const staleNames = orderedNames.slice(retentionLimit);
  await Promise.all(staleNames.map((name) => rm(join(providerDir, name), { force: true })));
  return staleNames.length;
}

async function orderArtifactNamesNewestFirst(
  providerDir: string,
  names: string[],
): Promise<string[]> {
  if (names.every((name) => TIMESTAMPED_ARTIFACT_FILE_PATTERN.test(name))) {
    return [...names].sort((left, right) => right.localeCompare(left));
  }

  const stats = await Promise.all(names.map(async (name) => ({
    name,
    mtimeMs: (await stat(join(providerDir, name))).mtimeMs,
  })));

  return stats
    .sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) {
        return right.mtimeMs - left.mtimeMs;
      }
      return right.name.localeCompare(left.name);
    })
    .map((entry) => entry.name);
}
