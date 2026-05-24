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
  RuntimeSkillCatalogEntry,
  RuntimeSkillDeliveryMode,
  RuntimeSkillFamily,
  RuntimeSkillLibraryMetadata,
  RuntimeSkillPackageKind,
  RuntimeSkillManifest,
  SessionSkillState,
  WorkspaceMode,
} from '../types.js';

const BUILT_RUNTIME_SEGMENT = `${path.sep}build${path.sep}runtime${path.sep}`;
const SOURCE_SKILLS_ROOT_CANDIDATES = [
  ['..', '..', '..', 'skills'],
  ['..', '..', '..', '..', 'skills'],
] as const;
const BUILT_SKILLS_ROOT_CANDIDATES = [
  ['..', '..', 'skills'],
  ['..', '..', '..', '..', 'skills'],
  ['..', '..', '..', 'skills'],
] as const;
const CODER_SKILLS_ROOT = path.join('.agents', 'skills');
const RUNTIME_SKILL_STATE_ROOT = '.runtime-skills';
const MAX_RUNTIME_SKILL_DISCOVERY_DEPTH = 6;
const REQUIRED_RUNTIME_LIBRARY_FRONTMATTER_FIELDS = [
  'family',
  'slug',
  'role',
  'packageKind',
  'version',
  'capabilityTags',
  'productTags',
  'deliveryHints',
] as const;
const OPTIONAL_RUNTIME_LIBRARY_FRONTMATTER_FIELDS = [
  'recommendedCompanions',
] as const;
const INSTRUCTION_DELIVERY_CLI_PROVIDERS = new Set([
  'claude',
  'copilot',
  'cursor',
  'kiro',
  'auggie',
  'goose',
  'junie',
  'opencode',
  'kilo',
]);
// Keep the process-local skill-package cache bounded so long-lived runtimes do not
// accumulate unbounded entries across many distinct session skill combinations.
const MAX_RUNTIME_SKILL_PACKAGE_CACHE_ENTRIES = 128;
const runtimeSkillPackageCache = new Map<string, RuntimeSkillPackage>();
const runtimeSkillCatalogCache = new Map<string, {
  watchKey: string;
  packages: RuntimeSkillPackage[];
}>();

interface RuntimeSkillPackage {
  id: string;
  title: string;
  description: string;
  sourcePath: string;
  entryFile: string;
  body: string;
  fingerprint: string;
  frontmatter: RuntimeSkillFrontmatter;
  library: RuntimeSkillLibraryMetadata;
}

interface RuntimeSkillEntrySource {
  entryFile: string;
  raw: string;
  fingerprint: string;
}

interface RuntimeSkillFrontmatter {
  name?: unknown;
  description?: unknown;
  family?: unknown;
  slug?: unknown;
  role?: unknown;
  packageKind?: unknown;
  version?: unknown;
  capabilityTags?: unknown;
  productTags?: unknown;
  deliveryHints?: unknown;
  recommendedCompanions?: unknown;
}

interface NormalizedRequestedSkillRef {
  id: string;
  slug: string;
  family?: string;
  version?: string;
  fingerprint?: string;
  requestedAs: string;
  canonicalId: string;
}

interface ResolvedRequestedSkillPackage {
  request: NormalizedRequestedSkillRef;
  skillPackage: RuntimeSkillPackage;
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

const RUNTIME_SKILL_FAMILY_SET = new Set<RuntimeSkillFamily>([
  'base',
  'orchestration',
  'work',
  'chat',
  'code',
]);
const RUNTIME_SKILL_FAMILY_VALUES = [
  'base',
  'orchestration',
  'work',
  'chat',
  'code',
] as const satisfies readonly RuntimeSkillFamily[];

const RUNTIME_SKILL_PACKAGE_KIND_SET = new Set<RuntimeSkillPackageKind>([
  'base',
  'role',
  'bundle',
]);
const RUNTIME_SKILL_PACKAGE_KIND_VALUES = [
  'base',
  'role',
  'bundle',
] as const satisfies readonly RuntimeSkillPackageKind[];

const RUNTIME_SKILL_DELIVERY_HINT_SET = new Set<RuntimeSkillDeliveryMode>([
  'filesystem',
  'instructions',
  'none',
]);
const RUNTIME_SKILL_DELIVERY_HINT_VALUES = [
  'filesystem',
  'instructions',
  'none',
] as const satisfies readonly RuntimeSkillDeliveryMode[];

export interface RuntimeSkillCatalogInspection {
  rootPath: string;
  state: 'loaded' | 'empty' | 'missing';
  totalSkills: number;
  catalogFingerprint: string | null;
  families: Record<RuntimeSkillFamily, number>;
  packageKinds: Record<RuntimeSkillPackageKind, number>;
  deliveryHints: Record<RuntimeSkillDeliveryMode, number>;
  cache: {
    catalogRoots: number;
    packages: number;
  };
  discovery: {
    maxDepth: number;
    symbolicLinksAllowed: false;
  };
  summary: string;
}

export interface RuntimeSkillCatalogVerification {
  rootPath: string;
  totalSkills: number;
  requiredFields: string[];
  optionalFields: string[];
}

export function resolveRuntimeSkillsRoot(moduleUrl: string = import.meta.url): string {
  const packageRootOverride = process.env.CATS_RUNTIME_PACKAGE_ROOT?.trim();
  if (packageRootOverride) {
    const resolvedOverride = path.isAbsolute(packageRootOverride)
      ? packageRootOverride
      : path.resolve(process.cwd(), packageRootOverride);
    const overrideSkillsRoot = path.join(resolvedOverride, 'skills');
    if (existsSync(overrideSkillsRoot)) {
      return overrideSkillsRoot;
    }
  }

  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = moduleDirIncludesBuiltRuntime(moduleDir)
    ? BUILT_SKILLS_ROOT_CANDIDATES
    : SOURCE_SKILLS_ROOT_CANDIDATES;

  for (const segments of candidates) {
    const candidatePath = path.resolve(moduleDir, ...segments);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return path.resolve(moduleDir, ...candidates[0]);
}

function moduleDirIncludesBuiltRuntime(moduleDir: string): boolean {
  if (moduleDir.includes(BUILT_RUNTIME_SEGMENT)) {
    return true;
  }
  const segments = path.resolve(moduleDir).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'build' && segments[index + 1] === 'runtime') {
      return true;
    }
  }
  return false;
}

const SKILLS_ROOT = resolveRuntimeSkillsRoot();

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
      id: parsed.slug,
      slug: parsed.slug,
      ...(parsed.family ? { family: parsed.family } : {}),
      requestedAs: normalized!,
      canonicalId: parsed.family ? `${parsed.family}/${parsed.slug}` : parsed.slug,
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

  const id = parsedId?.slug ?? literalId ?? slug;
  const canonicalId = family ? `${family}/${slug}` : slug;
  return {
    id,
    slug,
    ...(family ? { family } : {}),
    ...(version ? { version } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    requestedAs: literalId ?? canonicalId,
    canonicalId,
  };
}

function normalizeRequestedSkillRefs(
  skillRefs: Array<string | RuntimeRequestedSkillRef> | undefined,
): NormalizedRequestedSkillRef[] {
  const deduped = new Map<string, NormalizedRequestedSkillRef>();
  for (const skillRef of skillRefs ?? []) {
    const normalized = normalizeRequestedSkillRef(skillRef);
    const dedupeKey = [
      normalized.canonicalId,
      normalized.version ?? '',
      normalized.fingerprint ?? '',
    ].join('|');
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, normalized);
    }
  }

  return Array.from(deduped.values());
}

function toSkillTitle(skillId: string): string {
  return skillId
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

function normalizeStringArray(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);
}

function parseOptionalStringArrayField(
  skillId: string,
  frontmatter: RuntimeSkillFrontmatter,
  fieldName:
    | 'capabilityTags'
    | 'productTags'
    | 'recommendedCompanions',
): string[] {
  const value = frontmatter[fieldName];
  if (typeof value === 'undefined') {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' must declare '${fieldName}' as a string array when present.`,
      'invalid_skill_package',
    );
  }

  return normalizeStringArray(value);
}

function parseOptionalDeliveryHints(
  skillId: string,
  frontmatter: RuntimeSkillFrontmatter,
): RuntimeSkillDeliveryMode[] {
  const rawHints = frontmatter.deliveryHints;
  if (typeof rawHints === 'undefined') {
    return [];
  }

  if (!Array.isArray(rawHints) || rawHints.some((item) => typeof item !== 'string')) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' must declare 'deliveryHints' as a string array when present.`,
      'invalid_skill_package',
    );
  }

  const hints = normalizeStringArray(rawHints);
  for (const hint of hints) {
    if (!RUNTIME_SKILL_DELIVERY_HINT_SET.has(hint as RuntimeSkillDeliveryMode)) {
      throw new RuntimeSkillError(
        `Runtime skill '${skillId}' declares unsupported delivery hint '${hint}'.`,
        'invalid_skill_package',
      );
    }
  }

  return hints as RuntimeSkillDeliveryMode[];
}

function parseOptionalFamily(
  skillId: string,
  frontmatter: RuntimeSkillFrontmatter,
  entryFile: string,
  skillsRoot: string,
): RuntimeSkillFamily {
  const value = typeof frontmatter.family === 'string' ? frontmatter.family.trim() : '';
  if (value) {
    if (!RUNTIME_SKILL_FAMILY_SET.has(value as RuntimeSkillFamily)) {
      throw new RuntimeSkillError(
        `Runtime skill '${skillId}' declares unsupported family '${value}'.`,
        'invalid_skill_package',
      );
    }
    return value as RuntimeSkillFamily;
  }

  const relativeDir = path.relative(skillsRoot, path.dirname(entryFile));
  const segments = relativeDir.split(path.sep).filter(Boolean);
  const firstSegment = segments[0];
  if (firstSegment && RUNTIME_SKILL_FAMILY_SET.has(firstSegment as RuntimeSkillFamily)) {
    return firstSegment as RuntimeSkillFamily;
  }

  return 'base';
}

function deriveRoleFromSlug(slug: string): string {
  return slug.replace(/-/g, '_');
}

function buildRuntimeSkillLibraryMetadata(
  skillId: string,
  frontmatter: RuntimeSkillFrontmatter,
  entryFile: string,
  skillsRoot: string,
): RuntimeSkillLibraryMetadata {
  const family = parseOptionalFamily(skillId, frontmatter, entryFile, skillsRoot);
  const slug = typeof frontmatter.slug === 'string' && frontmatter.slug.trim()
    ? frontmatter.slug.trim()
    : skillId;
  const role = typeof frontmatter.role === 'string' && frontmatter.role.trim()
    ? frontmatter.role.trim()
    : deriveRoleFromSlug(slug);
  const packageKindValue = typeof frontmatter.packageKind === 'string'
    ? frontmatter.packageKind.trim()
    : '';
  const packageKind = packageKindValue
    ? packageKindValue
    : family === 'base' ? 'base' : 'role';
  if (!RUNTIME_SKILL_PACKAGE_KIND_SET.has(packageKind as RuntimeSkillPackageKind)) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' declares unsupported packageKind '${packageKind}'.`,
      'invalid_skill_package',
    );
  }

  const version = typeof frontmatter.version === 'string' && frontmatter.version.trim()
    ? frontmatter.version.trim()
    : '1.0.0';

  return {
    family,
    slug,
    role,
    packageKind: packageKind as RuntimeSkillPackageKind,
    version,
    capabilityTags: parseOptionalStringArrayField(skillId, frontmatter, 'capabilityTags'),
    productTags: parseOptionalStringArrayField(skillId, frontmatter, 'productTags'),
    deliveryHints: parseOptionalDeliveryHints(skillId, frontmatter),
    recommendedCompanions: parseOptionalStringArrayField(
      skillId,
      frontmatter,
      'recommendedCompanions',
    ),
  };
}

function parseSkillMarkdown(
  skillId: string,
  entryFile: string,
  skillsRoot: string,
  rawContent?: string,
): RuntimeSkillPackage {
  const raw = rawContent ?? readFileSync(entryFile, 'utf-8');
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' is missing valid YAML frontmatter in SKILL.md.`,
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
      `Runtime skill '${skillId}' has invalid YAML frontmatter: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'invalid_skill_package',
    );
  }

  const frontmatterName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  if (!frontmatterName || frontmatterName !== skillId) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' must declare frontmatter name '${skillId}'.`,
      'invalid_skill_package',
    );
  }

  const description = typeof frontmatter.description === 'string'
    ? frontmatter.description.trim()
    : '';
  if (!description) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' must declare a non-empty frontmatter description.`,
      'invalid_skill_package',
    );
  }

  const body = (match[2] || '').trim();
  if (!body) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' must contain non-empty markdown instructions.`,
      'invalid_skill_package',
    );
  }

  return {
    id: skillId,
    title: toSkillTitle(skillId),
    description,
    sourcePath: path.dirname(entryFile),
    entryFile,
    body,
    fingerprint: computeFingerprint(raw),
    frontmatter,
    library: buildRuntimeSkillLibraryMetadata(skillId, frontmatter, entryFile, skillsRoot),
  };
}

function hasOwnFrontmatterField(
  frontmatter: RuntimeSkillFrontmatter,
  fieldName: keyof RuntimeSkillFrontmatter,
): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, fieldName);
}

function verifyRuntimeOwnedSkillPackageFrontmatter(skillPackage: RuntimeSkillPackage): void {
  const missingFields = REQUIRED_RUNTIME_LIBRARY_FRONTMATTER_FIELDS.filter(
    (fieldName) => !hasOwnFrontmatterField(skillPackage.frontmatter, fieldName),
  );
  if (missingFields.length > 0) {
    throw new RuntimeSkillError(
      `Runtime-owned skill '${skillPackage.id}' must explicitly declare frontmatter fields: ${
        missingFields.map((fieldName) => `'${fieldName}'`).join(', ')
      }.`,
      'invalid_skill_package',
    );
  }
}

function readRuntimeSkillEntrySource(entryFile: string): RuntimeSkillEntrySource {
  const raw = readFileSync(entryFile, 'utf-8');
  return {
    entryFile,
    raw,
    fingerprint: computeFingerprint(raw),
  };
}

function loadRuntimeSkillPackageFromSource(
  skillId: string,
  source: RuntimeSkillEntrySource,
  skillsRoot: string,
): RuntimeSkillPackage {
  const cached = getCachedRuntimeSkillPackage({
    entryFile: source.entryFile,
    fingerprint: source.fingerprint,
  });
  if (cached) {
    return cached;
  }

  return cacheRuntimeSkillPackage(
    parseSkillMarkdown(skillId, source.entryFile, skillsRoot, source.raw),
  );
}

function loadRuntimeSkillPackage(
  skillId: string,
  entryFile: string,
  skillsRoot: string,
): RuntimeSkillPackage {
  return loadRuntimeSkillPackageFromSource(
    skillId,
    readRuntimeSkillEntrySource(entryFile),
    skillsRoot,
  );
}

function toSkillDiscoveryRelativePath(skillsRoot: string, targetPath: string): string {
  const relativePath = path.relative(skillsRoot, targetPath).replace(/\\/g, '/');
  return relativePath || '.';
}

function discoverRuntimeSkillEntryFiles(
  rootPath: string,
  options: {
    skillsRoot: string;
    depth: number;
  } = {
    skillsRoot: rootPath,
    depth: 0,
  },
): string[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  if (options.depth > MAX_RUNTIME_SKILL_DISCOVERY_DEPTH) {
    throw new RuntimeSkillError(
      `Runtime skill discovery exceeded max depth ${MAX_RUNTIME_SKILL_DISCOVERY_DEPTH} at '${
        toSkillDiscoveryRelativePath(options.skillsRoot, rootPath)
      }'.`,
      'invalid_skill_package',
    );
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  const skillEntry = entries.find((entry) => entry.isFile() && entry.name === 'SKILL.md');
  if (skillEntry) {
    return [path.join(rootPath, skillEntry.name)];
  }

  const discovered: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new RuntimeSkillError(
        `Runtime skill discovery does not allow symbolic-link or junction entries: '${
          toSkillDiscoveryRelativePath(options.skillsRoot, path.join(rootPath, entry.name))
        }'.`,
        'invalid_skill_package',
      );
    }
    if (!entry.isDirectory()) {
      continue;
    }
    discovered.push(...discoverRuntimeSkillEntryFiles(path.join(rootPath, entry.name), {
      skillsRoot: options.skillsRoot,
      depth: options.depth + 1,
    }));
  }
  return discovered;
}

function discoverRuntimeSkillEntrySources(
  skillsRoot: string,
): RuntimeSkillEntrySource[] {
  return discoverRuntimeSkillEntryFiles(skillsRoot)
    .sort()
    .map((entryFile) => readRuntimeSkillEntrySource(entryFile));
}

function inferSkillsRootFromEntryFile(entryFile: string): string | undefined {
  let currentDir = path.dirname(entryFile);
  while (true) {
    if (path.basename(currentDir) === 'skills') {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

function buildSkillsRootWatchKey(
  skillsRoot: string,
  entrySources: RuntimeSkillEntrySource[],
): string {
  if (entrySources.length === 0) {
    return existsSync(skillsRoot) ? 'empty' : 'missing';
  }

  return entrySources
    .map((entrySource) => {
      return [
        path.relative(skillsRoot, entrySource.entryFile).replace(/\\/g, '/'),
        entrySource.fingerprint,
      ].join(':');
    })
    .join('|');
}

function buildRuntimeSkillCatalogPackages(
  skillsRoot: string = SKILLS_ROOT,
): RuntimeSkillPackage[] {
  const entrySources = discoverRuntimeSkillEntrySources(skillsRoot);
  const watchKey = buildSkillsRootWatchKey(skillsRoot, entrySources);
  const cachedCatalog = runtimeSkillCatalogCache.get(skillsRoot);
  if (cachedCatalog?.watchKey === watchKey) {
    return cachedCatalog.packages;
  }

  if (!existsSync(skillsRoot)) {
    runtimeSkillCatalogCache.set(skillsRoot, {
      watchKey,
      packages: [],
    });
    return [];
  }

  const packages: RuntimeSkillPackage[] = [];
  const seenSkillIds = new Map<string, string>();

  for (const entrySource of entrySources) {
    const skillId = path.basename(path.dirname(entrySource.entryFile));
    const skillPackage = loadRuntimeSkillPackageFromSource(
      skillId,
      entrySource,
      skillsRoot,
    );
    const duplicateEntry = seenSkillIds.get(skillId);
    if (duplicateEntry) {
      throw new RuntimeSkillError(
        `Runtime skill '${skillId}' is declared more than once: '${duplicateEntry}' and '${entrySource.entryFile}'.`,
        'invalid_skill_manifest',
      );
    }
    seenSkillIds.set(skillId, entrySource.entryFile);
    packages.push(skillPackage);
  }

  const sortedPackages = packages.sort((left, right) => {
    if (left.library.family !== right.library.family) {
      return left.library.family.localeCompare(right.library.family);
    }
    return left.id.localeCompare(right.id);
  });

  runtimeSkillCatalogCache.set(skillsRoot, {
    watchKey,
    packages: sortedPackages,
  });
  return sortedPackages;
}

export function listRuntimeSkillIds(skillsRoot: string = SKILLS_ROOT): string[] {
  return buildRuntimeSkillCatalogPackages(skillsRoot).map((skillPackage) => skillPackage.id);
}

export function listRuntimeSkillCatalog(
  skillsRoot: string = SKILLS_ROOT,
): RuntimeSkillCatalogEntry[] {
  return buildRuntimeSkillCatalogPackages(skillsRoot).map((skillPackage) => toResolvedSkill(skillPackage));
}

export function inspectRuntimeSkillCatalog(
  skillsRoot: string = SKILLS_ROOT,
): RuntimeSkillCatalogInspection {
  const skills = listRuntimeSkillCatalog(skillsRoot);
  const watchKey = runtimeSkillCatalogCache.get(skillsRoot)?.watchKey;
  const families = Object.fromEntries(
    RUNTIME_SKILL_FAMILY_VALUES.map((family) => [family, 0]),
  ) as Record<RuntimeSkillFamily, number>;
  const packageKinds = Object.fromEntries(
    RUNTIME_SKILL_PACKAGE_KIND_VALUES.map((kind) => [kind, 0]),
  ) as Record<RuntimeSkillPackageKind, number>;
  const deliveryHints = Object.fromEntries(
    RUNTIME_SKILL_DELIVERY_HINT_VALUES.map((hint) => [hint, 0]),
  ) as Record<RuntimeSkillDeliveryMode, number>;

  for (const skill of skills) {
    families[skill.library.family] += 1;
    packageKinds[skill.library.packageKind] += 1;
    for (const hint of skill.library.deliveryHints) {
      deliveryHints[hint] += 1;
    }
  }

  if (!existsSync(skillsRoot)) {
    return {
      rootPath: skillsRoot,
      state: 'missing',
      totalSkills: 0,
      catalogFingerprint: null,
      families,
      packageKinds,
      deliveryHints,
      cache: {
        catalogRoots: runtimeSkillCatalogCache.size,
        packages: runtimeSkillPackageCache.size,
      },
      discovery: {
        maxDepth: MAX_RUNTIME_SKILL_DISCOVERY_DEPTH,
        symbolicLinksAllowed: false,
      },
      summary: 'Runtime skills root is missing.',
    };
  }

  if (skills.length === 0) {
    return {
      rootPath: skillsRoot,
      state: 'empty',
      totalSkills: 0,
      catalogFingerprint: summarizeRuntimeSkillCatalogFingerprint(watchKey),
      families,
      packageKinds,
      deliveryHints,
      cache: {
        catalogRoots: runtimeSkillCatalogCache.size,
        packages: runtimeSkillPackageCache.size,
      },
      discovery: {
        maxDepth: MAX_RUNTIME_SKILL_DISCOVERY_DEPTH,
        symbolicLinksAllowed: false,
      },
      summary: 'Runtime skills root is present but no runtime skill packages were discovered.',
    };
  }

  const familyCount = Object.values(families).filter((count) => count > 0).length;
  return {
    rootPath: skillsRoot,
    state: 'loaded',
    totalSkills: skills.length,
    catalogFingerprint: summarizeRuntimeSkillCatalogFingerprint(watchKey),
    families,
    packageKinds,
    deliveryHints,
    cache: {
      catalogRoots: runtimeSkillCatalogCache.size,
      packages: runtimeSkillPackageCache.size,
    },
    discovery: {
      maxDepth: MAX_RUNTIME_SKILL_DISCOVERY_DEPTH,
      symbolicLinksAllowed: false,
    },
    summary: `${skills.length} runtime skill(s) across ${familyCount} famil${familyCount === 1 ? 'y' : 'ies'} are available.`,
  };
}

export function verifyRuntimeSkillCatalog(
  skillsRoot: string = SKILLS_ROOT,
): RuntimeSkillCatalogVerification {
  if (!existsSync(skillsRoot)) {
    throw new RuntimeSkillError(
      'Runtime skills root is missing.',
      'invalid_skill_package',
    );
  }

  const skillPackages = buildRuntimeSkillCatalogPackages(skillsRoot);
  if (skillPackages.length === 0) {
    throw new RuntimeSkillError(
      'Runtime skills root is present but no runtime skill packages were discovered.',
      'invalid_skill_package',
    );
  }

  for (const skillPackage of skillPackages) {
    verifyRuntimeOwnedSkillPackageFrontmatter(skillPackage);
  }

  return {
    rootPath: skillsRoot,
    totalSkills: skillPackages.length,
    requiredFields: [...REQUIRED_RUNTIME_LIBRARY_FRONTMATTER_FIELDS],
    optionalFields: [...OPTIONAL_RUNTIME_LIBRARY_FRONTMATTER_FIELDS],
  };
}

function summarizeRuntimeSkillCatalogFingerprint(watchKey: string | undefined): string | null {
  if (!watchKey || watchKey === 'missing') {
    return null;
  }

  return computeFingerprint(watchKey).slice(0, 16);
}

function toResolvedSkill(skillPackage: RuntimeSkillPackage): ResolvedRuntimeSkill {
  return {
    id: skillPackage.id,
    slug: skillPackage.library.slug,
    ...(skillPackage.library.family ? { family: skillPackage.library.family } : {}),
    ...(skillPackage.library.version ? { version: skillPackage.library.version } : {}),
    title: skillPackage.title,
    description: skillPackage.description,
    status: 'resolved',
    source: 'runtime_catalog',
    sourcePath: skillPackage.sourcePath,
    entryFile: skillPackage.entryFile,
    fingerprint: skillPackage.fingerprint,
    library: {
      ...skillPackage.library,
      capabilityTags: [...skillPackage.library.capabilityTags],
      productTags: [...skillPackage.library.productTags],
      deliveryHints: [...skillPackage.library.deliveryHints],
      recommendedCompanions: [...skillPackage.library.recommendedCompanions],
    },
  };
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

function resolvePersistedSkillPathParts(
  skill: ResolvedRuntimeSkill,
): { family?: string; slug: string } {
  const parsed = splitRequestedSkillId(skill.id);
  return {
    family: normalizeOptionalToken(skill.family) ?? parsed.family,
    slug: normalizeOptionalToken(skill.slug) ?? parsed.slug,
  };
}

function resolveRequestedSkillPackage(
  request: NormalizedRequestedSkillRef,
  skillPackages: RuntimeSkillPackage[],
): RuntimeSkillPackage {
  let candidates = request.family
    ? skillPackages.filter((skillPackage) =>
        skillPackage.library.family === request.family
        && skillPackage.library.slug === request.slug)
    : skillPackages.filter((skillPackage) => skillPackage.id === request.id);

  if (candidates.length === 0 && !request.family) {
    const slugMatches = skillPackages.filter((skillPackage) => skillPackage.library.slug === request.slug);
    if (slugMatches.length === 1) {
      candidates = slugMatches;
    } else if (slugMatches.length > 1) {
      throw new RuntimeSkillError(
        `Runtime skill '${request.requestedAs}' is ambiguous. Request it as family/slug instead.`,
        'invalid_skill_manifest',
      );
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
  if (request.version && resolved.library.version !== request.version) {
    throw new RuntimeSkillError(
      `Runtime skill '${request.requestedAs}' resolved version '${resolved.library.version}' instead of '${request.version}'.`,
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
  const skillPackages = buildRuntimeSkillCatalogPackages(skillsRoot);
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

function canMaterializeCodexFilesystem(
  skillPackages: RuntimeSkillPackage[],
  cwd: string,
): {
  ok: boolean;
  warnings: string[];
} {
  const targetRoot = path.join(cwd, CODER_SKILLS_ROOT);

  for (const skillPackage of skillPackages) {
    const targetDir = path.join(targetRoot, skillPackage.id);
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
    const targetDir = path.join(targetRoot, skillPackage.id);
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

  if (
    options.providerBackend === 'cli'
    && INSTRUCTION_DELIVERY_CLI_PROVIDERS.has(options.providerName)
  ) {
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
    resolvedSkills: skillPackages.map((skillPackage) => toResolvedSkill(skillPackage)),
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

    // Fall back to the current on-disk package so persisted sessions remain recoverable
    // after a runtime restart, but prefer the cached package when this process already
    // resolved the session skill state.
    const inferredSkillsRoot = inferSkillsRootFromEntryFile(skill.entryFile);
    if (!inferredSkillsRoot) {
      throw new RuntimeSkillError(
        `Runtime skill '${skill.id}' is stored outside a recognizable skills root.`,
        'invalid_skill_manifest',
      );
    }

    const pathParts = resolvePersistedSkillPathParts(skill);
    const reloadedSkillId = pathParts.slug;
    return loadRuntimeSkillPackage(reloadedSkillId, skill.entryFile, inferredSkillsRoot);
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
