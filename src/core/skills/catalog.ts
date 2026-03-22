import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import type {
  ProviderBackend,
  ResolvedRuntimeSkill,
  RuntimeSkillDeliveryMode,
  RuntimeSkillManifest,
  SessionSkillState,
  WorkspaceMode,
} from '../types.js';

const SKILLS_ROOT = path.resolve(fileURLToPath(new URL('../../../skills/', import.meta.url)));
const CODER_SKILLS_ROOT = path.join('.agents', 'skills');
const RUNTIME_SKILL_STATE_ROOT = '.runtime-skills';
const runtimeSkillPackageCache = new Map<string, RuntimeSkillPackage>();

interface RuntimeSkillPackage {
  id: string;
  title: string;
  description: string;
  sourcePath: string;
  entryFile: string;
  body: string;
  fingerprint: string;
}

interface RuntimeSkillFrontmatter {
  name?: unknown;
  description?: unknown;
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

function normalizeSkillIds(skillIds: string[] | undefined): string[] {
  return (skillIds ?? [])
    .map((skillId) => skillId.trim())
    .filter((skillId, index, list) => skillId.length > 0 && list.indexOf(skillId) === index);
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
  runtimeSkillPackageCache.set(
    buildRuntimeSkillPackageCacheKey(skillPackage),
    skillPackage,
  );
  return skillPackage;
}

function getCachedRuntimeSkillPackage(value: {
  entryFile: string;
  fingerprint: string;
}): RuntimeSkillPackage | undefined {
  return runtimeSkillPackageCache.get(buildRuntimeSkillPackageCacheKey(value));
}

function parseSkillMarkdown(skillId: string, entryFile: string): RuntimeSkillPackage {
  const raw = readFileSync(entryFile, 'utf-8');
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
  };
}

function resolveRuntimeSkillPackage(
  skillId: string,
  skillsRoot: string = SKILLS_ROOT,
): RuntimeSkillPackage {
  const skillPath = path.join(skillsRoot, skillId);
  if (!existsSync(skillPath) || !statSync(skillPath).isDirectory()) {
    throw new RuntimeSkillError(
      `Unknown runtime skill '${skillId}'.`,
      'unknown_skill',
    );
  }

  const entryFile = path.join(skillPath, 'SKILL.md');
  if (!existsSync(entryFile)) {
    throw new RuntimeSkillError(
      `Runtime skill '${skillId}' is missing SKILL.md.`,
      'invalid_skill_package',
    );
  }

  return cacheRuntimeSkillPackage(parseSkillMarkdown(skillId, entryFile));
}

export function listRuntimeSkillIds(skillsRoot: string = SKILLS_ROOT): string[] {
  if (!existsSync(skillsRoot)) {
    return [];
  }

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function toResolvedSkill(skillPackage: RuntimeSkillPackage): ResolvedRuntimeSkill {
  return {
    id: skillPackage.id,
    title: skillPackage.title,
    description: skillPackage.description,
    status: 'resolved',
    source: 'runtime_catalog',
    sourcePath: skillPackage.sourcePath,
    entryFile: skillPackage.entryFile,
    fingerprint: skillPackage.fingerprint,
  };
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

  const requestedSkills = normalizeSkillIds(manifest.requestedSkills);
  if (requestedSkills.length === 0) {
    return undefined;
  }

  const skillPackages = requestedSkills.map((skillId) =>
    resolveRuntimeSkillPackage(skillId, options.skillsRoot),
  );
  const delivery = buildRuntimeSkillDeliveryPlan(skillPackages, options);

  if (manifest.strict === true && delivery.status !== 'applied') {
    throw new RuntimeSkillError(
      `Strict runtime skill delivery could not be satisfied for provider '${options.providerName}'.`,
      'strict_skill_delivery_unavailable',
    );
  }

  return {
    profileId: manifest.profileId,
    requestedSkills,
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
    return cacheRuntimeSkillPackage(parseSkillMarkdown(skill.id, skill.entryFile));
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
  const instructionParts = [
    buildRuntimeSkillInstructionOverlay(skillState),
    instructions?.trim() || undefined,
  ].filter((part): part is string => Boolean(part));

  if (instructionParts.length === 0) {
    return undefined;
  }

  return instructionParts.join('\n\n');
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
