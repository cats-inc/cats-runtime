import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionHydrationState, SessionSkillState } from '../types.js';
import { RuntimeSkillError } from './errors.js';

export type RuntimeSkillContentProfile = 'release' | 'preview';
export const SKILL_CONTENT_MANIFEST = 'content-profile.json';
export const PREVIEW_SKILL_DIRECTORY = 'preview';
export const PREVIEW_WORKSPACE_MARKER = '.cats-preview-content.json';

export interface RuntimeSkillContentPolicy {
  profile: RuntimeSkillContentProfile;
  fingerprint: string;
}

/** Locate assets relative to executing code, independent of catalog overrides. */
export function resolveArtifactSkillsRoot(moduleUrl = import.meta.url): string {
  let current = path.dirname(fileURLToPath(moduleUrl));
  while (path.dirname(current) !== current) {
    const packagePath = path.join(current, 'package.json');
    if (existsSync(packagePath)) {
      const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown };
      if (manifest.name !== '@cats-inc/cats-runtime') {
        throw new RuntimeSkillError('Cannot resolve Runtime artifact content authority.', 'invalid_skill_package');
      }
      // Stop at this package even when assets are missing; never adopt an ancestor's library.
      return path.join(current, 'runtime-skills');
    }
    current = path.dirname(current);
  }
  // A missing artifact has no preview eligibility, even beside a source checkout.
  return path.join(path.dirname(fileURLToPath(moduleUrl)), 'runtime-skills');
}

export function getRuntimeSkillContentPolicy(skillsRoot?: string): RuntimeSkillContentPolicy {
  const artifactRoot = resolveArtifactSkillsRoot();
  const artifactPolicy = loadRuntimeSkillContentPolicy(artifactRoot);
  if (artifactPolicy.profile === 'release' || !skillsRoot) return artifactPolicy;
  return loadRuntimeSkillContentPolicy(skillsRoot);
}

/** The selected package owns this manifest. Requests/env do not select a profile. */
export function loadRuntimeSkillContentPolicy(skillsRoot: string): RuntimeSkillContentPolicy {
  if (existsSync(skillsRoot) && lstatSync(skillsRoot).isSymbolicLink()) {
    throw new RuntimeSkillError('Runtime skill roots cannot be symbolic links or junctions.', 'invalid_skill_package');
  }
  const manifestPath = path.join(skillsRoot, SKILL_CONTENT_MANIFEST);
  let profile: RuntimeSkillContentProfile = 'release';
  if (existsSync(manifestPath)) {
    try {
      const info = lstatSync(manifestPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw new Error();
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error();
      const value = manifest as Record<string, unknown>;
      if (value.schemaVersion !== 1 || (value.profile !== 'release' && value.profile !== 'preview')
        || Object.keys(value).some((key) => key !== 'schemaVersion' && key !== 'profile')) {
        throw new Error();
      }
      profile = value.profile;
    } catch {
      throw new RuntimeSkillError('Invalid package skill content profile.', 'invalid_skill_package');
    }
  }
  return Object.freeze({
    profile,
    fingerprint: createHash('sha256').update(`cats.skill-content.v1:${profile}`).digest('hex'),
  });
}

export function isPreviewSkillPath(skillsRoot: string, entryFile: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(path.relative(skillsRoot, entryFile).split(path.sep)[0]) === PREVIEW_SKILL_DIRECTORY) return true;
  const canonical = existsSync(entryFile) ? realpathSync(entryFile) : path.resolve(entryFile);
  const parts = normalize(canonical).split(path.sep);
  return parts.some((part, index) => part === 'runtime-skills'
    && parts[index + 1] === PREVIEW_SKILL_DIRECTORY);
}

/** Preview resources are a bounded closed tree; fingerprint every delivered byte. */
export function fingerprintPreviewSkillPackage(directory: string): string {
  const digest = createHash('sha256');
  let bytes = 0;
  let files = 0;
  let nodes = 0;
  function visit(current: string, depth: number): void {
    const info = lstatSync(current);
    if (info.isSymbolicLink() || depth > 8 || ++nodes > 128) {
      throw new RuntimeSkillError('Preview skill resources must be a bounded local tree.', 'invalid_skill_package');
    }
    if (info.isDirectory()) {
      for (const name of readdirSync(current).sort()) visit(path.join(current, name), depth + 1);
      return;
    }
    if (!info.isFile() || info.nlink > 1 || ++files > 64 || (bytes += info.size) > 256 * 1024) {
      throw new RuntimeSkillError('Invalid or oversized preview skill resource.', 'invalid_skill_package');
    }
    const content = readFileSync(current);
    if (content.length !== info.size) throw new RuntimeSkillError('Preview resource changed during reading.', 'invalid_skill_package');
    digest.update(path.relative(directory, current).replace(/\\/gu, '/'));
    digest.update(`\0${content.length}\0`);
    digest.update(content);
  }
  visit(directory, 0);
  return digest.digest('hex');
}

export function assertReleaseWorkspace(cwd: string, policy: RuntimeSkillContentPolicy): void {
  if (policy.profile === 'release' && hasPreviewWorkspaceContent(cwd)) {
    throw contentConflict('This workspace retains preview skill content. Use a fresh workspace.');
  }
}

export function hasPreviewWorkspaceContent(cwd: string): boolean {
  // This marker is written only with Runtime-owned preview materialization.
  // Do not delete user directories or claim to police unrelated repo instructions.
  const lexical = path.resolve(cwd);
  let existing = lexical;
  while (!existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const canonical = existsSync(existing)
    ? path.resolve(realpathSync(existing), path.relative(existing, lexical)) : lexical;
  for (const root of new Set([lexical, canonical])) {
    for (let current = root;; current = path.dirname(current)) {
      if (existsSync(path.join(current, '.agents', 'skills', PREVIEW_WORKSPACE_MARKER))) return true;
      if (path.dirname(current) === current) break;
    }
  }
  return false;
}

export function contentConflict(message: string): RuntimeSkillError {
  return new RuntimeSkillError(message, 'skill_content_profile_conflict');
}

function exposurePath(sessionBaseDir: string, sessionId: string): string {
  const id = createHash('sha256').update(sessionId).digest('hex');
  return path.join(sessionBaseDir, '.runtime-skill-content', `${id}.preview`);
}

export function hasRecordedPreviewExposure(sessionBaseDir: string, sessionId: string): boolean {
  return existsSync(exposurePath(sessionBaseDir, sessionId));
}

/** Monotonic intent, durable before any preview bytes are handed to a provider. */
export function recordPreviewExposure(sessionBaseDir: string, sessionId: string): void {
  const target = exposurePath(sessionBaseDir, sessionId);
  mkdirSync(path.dirname(target), { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(target, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  try {
    writeSync(descriptor, 'cats.preview-exposure.v1\n');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export interface RuntimeSkillContentProvenance {
  schemaVersion: 1;
  sessionId: string;
  profile: RuntimeSkillContentProfile;
  policyFingerprint: string;
  releaseCompatible: boolean;
}

export function readSkillContentProvenance(
  hydration: SessionHydrationState | undefined,
): RuntimeSkillContentProvenance | undefined {
  const raw = hydration?.metadata?.runtimeSkillContent;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1 || (value.profile !== 'release' && value.profile !== 'preview')
    || typeof value.sessionId !== 'string' || !value.sessionId
    || typeof value.releaseCompatible !== 'boolean'
    || typeof value.policyFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.policyFingerprint)) return undefined;
  return value as unknown as RuntimeSkillContentProvenance;
}

export function invalidateSkillContentProvenance(
  hydration: SessionHydrationState | undefined,
): SessionHydrationState | undefined {
  if (!hydration) return undefined;
  const copy = structuredClone(hydration);
  const provenance = readSkillContentProvenance(copy);
  if (provenance) copy.metadata!.runtimeSkillContent = { ...provenance, releaseCompatible: false };
  return copy;
}

export function hasPreviewSkillContent(skills: SessionSkillState | undefined): boolean {
  return Boolean(skills?.resolvedSkills.some((skill) => skill.contentProfile === 'preview'));
}

export function assertRetainedSkillContent(input: {
  policy: RuntimeSkillContentPolicy;
  hydration?: SessionHydrationState;
  skills?: SessionSkillState;
  cwd: string;
  sessionBaseDir?: string;
  sessionId?: string;
}): void {
  assertReleaseWorkspace(input.cwd, input.policy);
  if (input.policy.profile === 'release'
    && (readSkillContentProvenance(input.hydration)?.releaseCompatible !== true
      || (input.sessionId && readSkillContentProvenance(input.hydration)?.sessionId !== input.sessionId)
      || hasPreviewSkillContent(input.skills)
      || (input.sessionBaseDir && input.sessionId
        && hasRecordedPreviewExposure(input.sessionBaseDir, input.sessionId)))) {
    throw contentConflict(
      'Retained context is not verified for release skills. Start a new session; existing data is preserved.',
    );
  }
}
