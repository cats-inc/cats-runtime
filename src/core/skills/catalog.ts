import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import type {
  ProviderBackend,
  RequestedSessionSkillRef,
  ResolvedRuntimeSkill,
  RuntimeRequestedSkillRef,
  RuntimeSkillDeliveryMode,
  RuntimeSkillManifest,
  SessionSkillState,
  WorkspaceMode,
} from '../types.js';

const SKILLS_ROOT = path.resolve(fileURLToPath(new URL('../../../skills/', import.meta.url)));
const CODER_SKILLS_ROOT = path.join('.agents', 'skills');
const RUNTIME_SKILL_STATE_ROOT = '.runtime-skills';
const MAX_RUNTIME_SKILL_PACKAGE_CACHE_ENTRIES = 128;
const runtimeSkillPackageCache = new Map<string, RuntimeSkillPackage>();

interface RuntimeSkillPackage {
  id: string;
  slug: string;
  family?: string;
  version?: string;
  aliases: string[];
  title: string;
  description: string;
  sourcePath: string;
  entryFile: string;
  body: string;
  fingerprint: string;
}

interface RuntimeSkillFrontmatter {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  family?: unknown;
  version?: unknown;
  aliases?: unknown;
}

interface DiscoverableRuntimeSkillEntry {
  packagePath: string;
  entryFile: string;
  pathSegments: string[];
}

interface NormalizedRequestedSkillRef {
  id: string;
  slug: string;
  family?: string;
  version?: string;
  fingerprint?: string;
  requestedAs: string;
}

interface ResolveRuntimeSkillManifestOptions {
  sessionId: string;
  providerName: string;
  providerBackend?: ProviderBackend;
  cwd: string;
  sessionBaseDir: string;
  workspaceMode?: WorkspaceMode;
  now?: Date;
  baseInstructionsFile?: string;
  skillsRoot?: string;
}

interface RuntimeSkillDeliveryPlan {
  preferredMode: RuntimeSkillDeliveryMode;
  mode: RuntimeSkillDeliveryMode;
  status: 'applied' | 'degraded' | 'unsupported';
  warnings: string[];
  filesystem?: {
    rootPath: string;
    entryPaths: string[];
  };
  instructions?: {
    filePath?: string;
    byteLength: number;
  };
}

interface ResolvedRequestedSkillPackage {
  request: NormalizedRequestedSkillRef;
  skillPackage: RuntimeSkillPackage;
}

export class RuntimeSkillError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_skill'
      | 'invalid_skill_package'
      | 'invalid_skill_manifest'
      | 'strict_skill_delivery_unavailable',
  ) {
    super(message);
    this.name = 'RuntimeSkillError';
  }
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function splitRequestedSkillId(
  value: string,
): { family?: string; slug: string } {
  const normalized = normalizeOptionalToken(value);
  if (!normalized) {
    throw new RuntimeSkillError(
      'Runtime skill refs must include a non-empty id or slug.',
      'invalid_skill_manifest',
    );
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new RuntimeSkillError(
      'Runtime skill refs must include a non-empty id or slug.',
      'invalid_skill_manifest',
    );
  }

  const slug = segments.at(-1)!;
  const family = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
  return { family, slug };
}

function normalizeRequestedSkillRef(
  value: string | RuntimeRequestedSkillRef,
): NormalizedRequestedSkillRef {
  if (typeof value === 'string') {
    const normalized = normalizeOptionalToken(value);
    const parsed = splitRequestedSkillId(value);
    return {
      id: normalized!,
      slug: parsed.slug,
      family: parsed.family,
      requestedAs: normalized!,
    };
  }

  const literalId = normalizeOptionalToken(value.id);
  const literalFamily = normalizeOptionalToken(value.family);
  const literalSlug = normalizeOptionalToken(value.slug);
  const version = normalizeOptionalToken(value.version);
  const fingerprint = normalizeOptionalToken(value.fingerprint);

  const parsedId = literalId ? splitRequestedSkillId(literalId) : undefined;
  const family = literalFamily ?? parsedId?.family;
  const slug = literalSlug ?? parsedId?.slug;
  if (!slug) {
    throw new RuntimeSkillError(
      'Runtime skill refs must include a non-empty id or slug.',
      'invalid_skill_manifest',
    );
  }

  if (literalFamily && parsedId?.family && literalFamily !== parsedId.family) {
    throw new RuntimeSkillError(
      `Runtime skill ref '${literalId}' conflicts with family '${literalFamily}'.`,
      'invalid_skill_manifest',
    );
  }

  const id = family ? `${family}/${slug}` : literalId ?? slug;
  return {
    id,
    slug,
    ...(family ? { family } : {}),
    ...(version ? { version } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    requestedAs: literalId ?? (family ? `${family}/${slug}` : slug),
  };
}

function normalizeRequestedSkillRefs(
  skillRefs: Array<string | RuntimeRequestedSkillRef> | undefined,
): NormalizedRequestedSkillRef[] {
  const deduped = new Map<string, NormalizedRequestedSkillRef>();
  for (const skillRef of skillRefs ?? []) {
    const normalized = normalizeRequestedSkillRef(skillRef);
    const dedupeKey = [
      normalized.id,
      normalized.version ?? '',
      normalized.fingerprint ?? '',
    ].join('|');
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, normalized);
    }
  }

  return Array.from(deduped.values());
}

function toSkillTitle(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function computeFingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildRuntimeSkillPackageCacheKey(value: {
  entryFile: string;
  fingerprint: string;
}): string {
  return `${value.entryFile}:${value.fingerprint}`;
}

function cacheRuntimeSkillPackage(skillPackage: RuntimeSkillPackage): RuntimeSkillPackage {
  const cacheKey = buildRuntimeSkillPackageCacheKey(skillPackage);
  if (runtimeSkillPackageCache.has(cacheKey)) {
    runtimeSkillPackageCache.delete(cacheKey);
  } else if (runtimeSkillPackageCache.size >= MAX_RUNTIME_SKILL_PACKAGE_CACHE_ENTRIES) {
    const oldestKey = runtimeSkillPackageCache.keys().next().value;
    if (oldestKey) {
      runtimeSkillPackageCache.delete(oldestKey);
    }
  }

  runtimeSkillPackageCache.set(cacheKey, skillPackage);
  return skillPackage;
}

function getCachedRuntimeSkillPackage(value: {
  entryFile: string;
  fingerprint: string;
}): RuntimeSkillPackage | undefined {
  return runtimeSkillPackageCache.get(buildRuntimeSkillPackageCacheKey(value));
}

function discoverRuntimeSkillEntries(
  skillsRoot: string,
): DiscoverableRuntimeSkillEntry[] {
  if (!existsSync(skillsRoot)) {
    return [];
  }

  const discovered: DiscoverableRuntimeSkillEntry[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packagePath = path.join(skillsRoot, entry.name);
    const directEntryFile = path.join(packagePath, 'SKILL.md');
    if (existsSync(directEntryFile)) {
      discovered.push({
        packagePath,
        entryFile: directEntryFile,
        pathSegments: [entry.name],
      });
      continue;
    }

    for (const child of readdirSync(packagePath, { withFileTypes: true })) {
      if (!child.isDirectory()) {
        continue;
      }
      const childPackagePath = path.join(packagePath, child.name);
      const childEntryFile = path.join(childPackagePath, 'SKILL.md');
      if (!existsSync(childEntryFile)) {
        continue;
      }
      discovered.push({
        packagePath: childPackagePath,
        entryFile: childEntryFile,
        pathSegments: [entry.name, child.name],
      });
    }
  }

  return discovered.sort((left, right) => left.pathSegments.join('/').localeCompare(right.pathSegments.join('/')));
}

function parseAliases(
  skillId: string,
  value: unknown,
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' must declare aliases as a string array when present.`,
      'invalid_skill_package',
    );
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
}

function parseSkillMarkdown(
  entry: DiscoverableRuntimeSkillEntry,
): RuntimeSkillPackage {
  const raw = readFileSync(entry.entryFile, 'utf-8');
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/);
  const pathSkillId = entry.pathSegments.join('/');
  if (!match) {
    throw new RuntimeSkillError(
      `Runtime skill '${pathSkillId}' is missing valid YAML frontmatter in SKILL.md.`,
      'invalid_skill_package',
    );
  }

  let frontmatter: RuntimeSkillFrontmatter;
  try {
    const parsed = parseYaml(match[1] || '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Frontmatter must be a mapping.');
    }
    frontmatter = parsed as RuntimeSkillFrontmatter;
  } catch (error) {
    throw new RuntimeSkillError(
      `Runtime skill '${pathSkillId}' has invalid YAML frontmatter: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'invalid_skill_package',
    );
  }

  const slug = entry.pathSegments.at(-1)!;
  const frontmatterName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  if (!frontmatterName || frontmatterName !== slug) {
    throw new RuntimeSkillError(
      `Runtime skill '${pathSkillId}' must declare frontmatter name '${slug}'.`,
      'invalid_skill_package',
    );
  }

  const description = typeof frontmatter.description === 'string'
    ? frontmatter.description.trim()
    : '';
  if (!description) {
    throw new RuntimeSkillError(
      `Runtime skill '${pathSkillId}' must declare a non-empty frontmatter description.`,
      'invalid_skill_package',
    );
  }

  const pathFamily = entry.pathSegments.length > 1
    ? entry.pathSegments.slice(0, -1).join('/')
    : undefined;
  const frontmatterFamily = typeof frontmatter.family === 'string'
    ? normalizeOptionalToken(frontmatter.family)
    : undefined;
  if (frontmatterFamily && pathFamily && frontmatterFamily !== pathFamily) {
    throw new RuntimeSkillError(
      `Runtime skill '${pathSkillId}' declares family '${frontmatterFamily}' but lives under '${pathFamily}'.`,
      'invalid_skill_package',
    );
  }

  const family = frontmatterFamily ?? pathFamily;
  const version = typeof frontmatter.version === 'string' || typeof frontmatter.version === 'number'
    ? normalizeOptionalToken(String(frontmatter.version))
    : undefined;
  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
    ? frontmatter.title.trim()
    : toSkillTitle(slug);
  const body = (match[2] || '').trim();
  if (!body) {
    throw new RuntimeSkillError(
      `Runtime skill '${pathSkillId}' must contain non-empty markdown instructions.`,
      'invalid_skill_package',
    );
  }

  return {
    id: family ? `${family}/${slug}` : slug,
    slug,
    ...(family ? { family } : {}),
    ...(version ? { version } : {}),
    aliases: parseAliases(pathSkillId, frontmatter.aliases),
    title,
    description,
    sourcePath: entry.packagePath,
    entryFile: entry.entryFile,
    body,
    fingerprint: computeFingerprint(raw),
  };
}

function loadRuntimeSkillPackage(
  entry: DiscoverableRuntimeSkillEntry,
): RuntimeSkillPackage {
  const raw = readFileSync(entry.entryFile, 'utf-8');
  const fingerprint = computeFingerprint(raw);
  const cached = getCachedRuntimeSkillPackage({
    entryFile: entry.entryFile,
    fingerprint,
  });
  if (cached) {
    return cached;
  }

  return cacheRuntimeSkillPackage(parseSkillMarkdown(entry));
}

function listRuntimeSkillPackages(
  skillsRoot: string = SKILLS_ROOT,
): RuntimeSkillPackage[] {
  return discoverRuntimeSkillEntries(skillsRoot).map((entry) => loadRuntimeSkillPackage(entry));
}

export function listRuntimeSkillIds(skillsRoot: string = SKILLS_ROOT): string[] {
  return listRuntimeSkillPackages(skillsRoot).map((skillPackage) => skillPackage.id);
}

function buildRequestedSessionSkillRef(
  request: NormalizedRequestedSkillRef,
): RequestedSessionSkillRef {
  return {
    id: request.id,
    slug: request.slug,
    ...(request.family ? { family: request.family } : {}),
    ...(request.version ? { version: request.version } : {}),
    ...(request.fingerprint ? { fingerprint: request.fingerprint } : {}),
    requestedAs: request.requestedAs,
  };
}

function toResolvedSkill(skillPackage: RuntimeSkillPackage): ResolvedRuntimeSkill {
  return {
    id: skillPackage.id,
    slug: skillPackage.slug,
    ...(skillPackage.family ? { family: skillPackage.family } : {}),
    ...(skillPackage.version ? { version: skillPackage.version } : {}),
    title: skillPackage.title,
    description: skillPackage.description,
    status: 'resolved',
    source: 'runtime_catalog',
    sourcePath: skillPackage.sourcePath,
    entryFile: skillPackage.entryFile,
    fingerprint: skillPackage.fingerprint,
  };
}

function resolveRequestedSkillPackage(
  request: NormalizedRequestedSkillRef,
  skillPackages: RuntimeSkillPackage[],
): RuntimeSkillPackage {
  let candidates = skillPackages.filter((skillPackage) => skillPackage.id === request.id);
  if (candidates.length === 0) {
    if (request.family) {
      candidates = skillPackages.filter((skillPackage) =>
        skillPackage.slug === request.slug && skillPackage.family === request.family);
    } else {
      const slugMatches = skillPackages.filter((skillPackage) => skillPackage.slug === request.slug);
      if (slugMatches.length === 1) {
        candidates = slugMatches;
      } else if (slugMatches.length === 0) {
        const aliasMatches = skillPackages.filter((skillPackage) => skillPackage.aliases.includes(request.slug));
        if (aliasMatches.length === 1) {
          candidates = aliasMatches;
        } else if (aliasMatches.length > 1) {
          throw new RuntimeSkillError(
            `Runtime skill '${request.requestedAs}' is ambiguous. Request it as family/slug instead.`,
            'invalid_skill_manifest',
          );
        }
      } else {
        throw new RuntimeSkillError(
          `Runtime skill '${request.requestedAs}' is ambiguous. Request it as family/slug instead.`,
          'invalid_skill_manifest',
        );
      }
    }
  }

  if (candidates.length === 0) {
    throw new RuntimeSkillError(
      `Unknown runtime skill '${request.requestedAs}'.`,
      'unknown_skill',
    );
  }

  if (candidates.length > 1) {
    throw new RuntimeSkillError(
      `Runtime skill '${request.requestedAs}' is ambiguous. Request it as family/slug instead.`,
      'invalid_skill_manifest',
    );
  }

  const resolved = candidates[0];
  if (request.version && resolved.version !== request.version) {
    throw new RuntimeSkillError(
      `Runtime skill '${request.requestedAs}' resolved version '${resolved.version ?? 'unversioned'}' instead of '${request.version}'.`,
      'invalid_skill_manifest',
    );
  }

  if (request.fingerprint && resolved.fingerprint !== request.fingerprint) {
    throw new RuntimeSkillError(
      `Runtime skill '${request.requestedAs}' resolved fingerprint '${resolved.fingerprint}' instead of '${request.fingerprint}'.`,
      'invalid_skill_manifest',
    );
  }

  return resolved;
}

function resolveRequestedSkillPackages(
  requestedSkills: Array<string | RuntimeRequestedSkillRef>,
  skillsRoot: string = SKILLS_ROOT,
): ResolvedRequestedSkillPackage[] {
  const normalizedRequests = normalizeRequestedSkillRefs(requestedSkills);
  const skillPackages = listRuntimeSkillPackages(skillsRoot);
  return normalizedRequests.map((request) => ({
    request,
    skillPackage: resolveRequestedSkillPackage(request, skillPackages),
  }));
}

function buildSkillInstructionOverlayFromPackages(
  skillPackages: RuntimeSkillPackage[],
): string | undefined {
  if (skillPackages.length === 0) {
    return undefined;
  }

  return [
    'The following runtime-managed skills are attached to this session.',
    'Apply them as durable behavior guidance when relevant.',
    skillPackages
      .map((skillPackage) => [
        `Runtime Skill: ${skillPackage.title} (${skillPackage.id})`,
        ...(skillPackage.version ? [`Version: ${skillPackage.version}`] : []),
        skillPackage.body,
      ].join('\n\n'))
      .join('\n\n---\n\n'),
  ].join('\n\n');
}

function readOptionalFile(filePath: string | undefined): string | undefined {
  if (!filePath || !existsSync(filePath)) {
    return undefined;
  }

  const content = readFileSync(filePath, 'utf8').trim();
  return content || undefined;
}

function buildPiSkillInstructionFile(
  skillPackages: RuntimeSkillPackage[],
  options: ResolveRuntimeSkillManifestOptions,
): {
  filePath: string;
  byteLength: number;
} | undefined {
  const skillOverlay = buildSkillInstructionOverlayFromPackages(skillPackages);
  const baseInstructions = readOptionalFile(options.baseInstructionsFile);
  const content = [baseInstructions, skillOverlay]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
    .trim();

  if (!content) {
    return undefined;
  }

  const outputDir = path.join(
    options.sessionBaseDir,
    RUNTIME_SKILL_STATE_ROOT,
    options.sessionId,
  );
  mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `pi-system-prompt-${computeFingerprint(content).slice(0, 12)}.md`,
  );
  writeFileSync(filePath, content + '\n', 'utf8');
  return {
    filePath,
    byteLength: Buffer.byteLength(content, 'utf8'),
  };
}

function findMaterializationSlugConflicts(
  skillPackages: RuntimeSkillPackage[],
): string[] {
  const slugOwners = new Map<string, string[]>();
  for (const skillPackage of skillPackages) {
    const current = slugOwners.get(skillPackage.slug) ?? [];
    current.push(skillPackage.id);
    slugOwners.set(skillPackage.slug, current);
  }

  return Array.from(slugOwners.entries())
    .filter(([, owners]) => owners.length > 1)
    .map(([slug, owners]) =>
      `Codex filesystem delivery skipped because slug '${slug}' is requested by multiple skills (${owners.join(', ')}).`);
}

function canMaterializeCodexFilesystem(
  skillPackages: RuntimeSkillPackage[],
  cwd: string,
): {
  ok: boolean;
  warnings: string[];
} {
  const slugConflicts = findMaterializationSlugConflicts(skillPackages);
  if (slugConflicts.length > 0) {
    return {
      ok: false,
      warnings: slugConflicts,
    };
  }

  const targetRoot = path.join(cwd, CODER_SKILLS_ROOT);
  for (const skillPackage of skillPackages) {
    const targetDir = path.join(targetRoot, skillPackage.slug);
    if (!existsSync(targetDir)) {
      continue;
    }

    const targetSkillFile = path.join(targetDir, 'SKILL.md');
    if (!existsSync(targetSkillFile)) {
      return {
        ok: false,
        warnings: [
          `Codex filesystem delivery skipped because '${path.relative(cwd, targetDir) || targetDir}' already exists without SKILL.md.`,
        ],
      };
    }

    const currentFingerprint = computeFingerprint(readFileSync(targetSkillFile, 'utf8'));
    if (currentFingerprint !== skillPackage.fingerprint) {
      return {
        ok: false,
        warnings: [
          `Codex filesystem delivery skipped because '${path.relative(cwd, targetDir) || targetDir}' already exists with different content.`,
        ],
      };
    }
  }

  return { ok: true, warnings: [] };
}

function materializeCodexFilesystem(
  skillPackages: RuntimeSkillPackage[],
  cwd: string,
): {
  rootPath: string;
  entryPaths: string[];
} {
  const targetRoot = path.join(cwd, CODER_SKILLS_ROOT);
  mkdirSync(targetRoot, { recursive: true });

  const entryPaths: string[] = [];
  for (const skillPackage of skillPackages) {
    const targetDir = path.join(targetRoot, skillPackage.slug);
    if (!existsSync(targetDir)) {
      cpSync(skillPackage.sourcePath, targetDir, { recursive: true });
    }
    entryPaths.push(path.join(targetDir, 'SKILL.md'));
  }

  return {
    rootPath: targetRoot,
    entryPaths,
  };
}

function buildRuntimeSkillDeliveryPlan(
  skillPackages: RuntimeSkillPackage[],
  options: ResolveRuntimeSkillManifestOptions,
): RuntimeSkillDeliveryPlan {
  if (options.providerBackend === 'cli' && options.providerName === 'codex') {
    const warnings: string[] = [];
    if (options.workspaceMode !== 'isolated') {
      warnings.push(
        'Codex runtime skills prefer filesystem delivery; shared/read_only workspaces downgrade to instruction delivery.',
      );
    }

    const compatibility = options.workspaceMode === 'isolated'
      ? canMaterializeCodexFilesystem(skillPackages, options.cwd)
      : { ok: false, warnings };
    if (compatibility.ok && options.workspaceMode === 'isolated') {
      return {
        preferredMode: 'filesystem',
        mode: 'filesystem',
        status: 'applied',
        warnings: [],
        filesystem: materializeCodexFilesystem(skillPackages, options.cwd),
      };
    }

    const overlay = buildSkillInstructionOverlayFromPackages(skillPackages);
    return {
      preferredMode: 'filesystem',
      mode: 'instructions',
      status: 'degraded',
      warnings: compatibility.warnings.length > 0 ? compatibility.warnings : warnings,
      instructions: overlay
        ? {
            byteLength: Buffer.byteLength(overlay, 'utf8'),
          }
        : undefined,
    };
  }

  if (options.providerBackend === 'cli' && options.providerName === 'pi') {
    return {
      preferredMode: 'instructions',
      mode: 'instructions',
      status: 'applied',
      warnings: [],
      instructions: buildPiSkillInstructionFile(skillPackages, options),
    };
  }

  if (options.providerBackend === 'api' || options.providerBackend === 'local' || options.providerBackend === 'agent') {
    const overlay = buildSkillInstructionOverlayFromPackages(skillPackages);
    return {
      preferredMode: 'instructions',
      mode: 'instructions',
      status: 'applied',
      warnings: [],
      instructions: overlay
        ? {
            byteLength: Buffer.byteLength(overlay, 'utf8'),
          }
        : undefined,
    };
  }

  return {
    preferredMode: 'none',
    mode: 'none',
    status: 'unsupported',
    warnings: [
      `Provider '${options.providerName}' does not support runtime-managed skill delivery yet.`,
    ],
  };
}

export function resolveRuntimeSkillManifest(
  manifest: RuntimeSkillManifest | undefined,
  options: ResolveRuntimeSkillManifestOptions,
): SessionSkillState | undefined {
  if (!manifest) {
    return undefined;
  }

  const resolvedRequests = resolveRequestedSkillPackages(manifest.requestedSkills, options.skillsRoot);
  if (resolvedRequests.length === 0) {
    return undefined;
  }

  const skillPackages = resolvedRequests.map((entry) => entry.skillPackage);
  const delivery = buildRuntimeSkillDeliveryPlan(skillPackages, options);

  if (manifest.strict === true && delivery.status !== 'applied') {
    throw new RuntimeSkillError(
      `Strict runtime skill delivery could not be satisfied for provider '${options.providerName}'.`,
      'strict_skill_delivery_unavailable',
    );
  }

  return {
    profileId: manifest.profileId,
    requestedSkills: resolvedRequests.map((entry) => entry.skillPackage.id),
    requestedSkillRefs: resolvedRequests.map((entry) => buildRequestedSessionSkillRef(entry.request)),
    context: manifest.context ? structuredClone(manifest.context) : undefined,
    resolvedSkills: resolvedRequests.map((entry) => toResolvedSkill(entry.skillPackage)),
    strict: manifest.strict === true,
    delivery: {
      provider: options.providerName,
      backend: options.providerBackend ?? 'cli',
      preferredMode: delivery.preferredMode,
      mode: delivery.mode,
      status: delivery.status,
      warnings: [...delivery.warnings],
      ...(delivery.filesystem ? { filesystem: delivery.filesystem } : {}),
      ...(delivery.instructions ? { instructions: delivery.instructions } : {}),
    },
    warnings: [...delivery.warnings],
    appliedSkillIds: delivery.mode === 'none'
      ? []
      : skillPackages.map((skillPackage) => skillPackage.id),
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
}

function rebuildRuntimeSkillPackages(
  skillState: SessionSkillState | undefined,
): RuntimeSkillPackage[] {
  if (!skillState) {
    return [];
  }

  return skillState.resolvedSkills.map((skill) => {
    const cached = getCachedRuntimeSkillPackage(skill);
    if (cached) {
      return cached;
    }

    if (!existsSync(skill.entryFile)) {
      throw new RuntimeSkillError(
        `Runtime skill '${skill.id}' is missing SKILL.md.`,
        'invalid_skill_package',
      );
    }

    return cacheRuntimeSkillPackage(parseSkillMarkdown({
      packagePath: path.dirname(skill.entryFile),
      entryFile: skill.entryFile,
      pathSegments: skill.family
        ? [...skill.family.split('/').filter(Boolean), skill.slug]
        : [skill.slug],
    }));
  });
}

export function buildRuntimeSkillInstructionOverlay(
  skillState: SessionSkillState | undefined,
): string | undefined {
  if (!skillState || skillState.delivery.mode !== 'instructions' || skillState.appliedSkillIds.length === 0) {
    return undefined;
  }

  return buildSkillInstructionOverlayFromPackages(rebuildRuntimeSkillPackages(skillState));
}

export function mergeRuntimeSkillInstructions(
  instructions: string | undefined,
  skillState: SessionSkillState | undefined,
): string | undefined {
  return mergeRuntimeInstructionLayers(
    skillState,
    instructions,
  );
}

export function mergeRuntimeInstructionLayers(
  skillState: SessionSkillState | undefined,
  ...instructions: Array<string | undefined>
): string | undefined {
  const instructionParts = [
    buildRuntimeSkillInstructionOverlay(skillState),
    ...instructions.map((instruction) => instruction?.trim() || undefined),
  ].filter((part): part is string => Boolean(part));

  if (instructionParts.length === 0) {
    return undefined;
  }

  const mergedParts: string[] = [];
  for (const part of instructionParts) {
    if (mergedParts.at(-1) === part) {
      continue;
    }
    mergedParts.push(part);
  }

  return mergedParts.join('\n\n');
}

export function clearRuntimeSkillState(
  sessionBaseDir: string,
  sessionId: string,
): void {
  const rootPath = path.join(sessionBaseDir, RUNTIME_SKILL_STATE_ROOT, sessionId);
  if (!existsSync(rootPath)) {
    return;
  }

  rmSync(rootPath, { recursive: true, force: true });
}
