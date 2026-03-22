import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ResolvedRuntimeSkill,
  RuntimeSkillManifest,
  SessionSkillState,
} from '../types.js';

const SKILLS_ROOT = path.resolve(fileURLToPath(new URL('../../../skills/', import.meta.url)));

interface RuntimeSkillCatalogEntry {
  id: string;
  title: string;
  deliveryMode: ResolvedRuntimeSkill['deliveryMode'];
  skillPath: string;
}

const RUNTIME_SKILL_CATALOG: Record<string, RuntimeSkillCatalogEntry> = {
  companion: {
    id: 'companion',
    title: 'Companion',
    deliveryMode: 'instructions',
    skillPath: path.join(SKILLS_ROOT, 'companion', 'SKILL.md'),
  },
};

function normalizeSkillIds(skillIds: string[] | undefined): string[] {
  return (skillIds ?? [])
    .map((skillId) => skillId.trim())
    .filter((skillId, index, list) => skillId.length > 0 && list.indexOf(skillId) === index);
}

export function resolveRuntimeSkillManifest(
  manifest: RuntimeSkillManifest | undefined,
  now: Date = new Date(),
): SessionSkillState | undefined {
  if (!manifest) {
    return undefined;
  }

  const requestedSkills = normalizeSkillIds(manifest.requestedSkills);
  if (requestedSkills.length === 0) {
    return undefined;
  }

  const resolvedSkills: ResolvedRuntimeSkill[] = [];
  const warnings: string[] = [];

  for (const skillId of requestedSkills) {
    const entry = RUNTIME_SKILL_CATALOG[skillId];
    if (!entry || !existsSync(entry.skillPath)) {
      warnings.push(`Runtime skill '${skillId}' is not available in cats-runtime.`);
      resolvedSkills.push({
        id: skillId,
        title: entry?.title ?? skillId,
        status: 'missing',
        deliveryMode: entry?.deliveryMode ?? 'none',
        source: 'runtime_catalog',
        warning: `Runtime skill '${skillId}' is not available.`,
      });
      continue;
    }

    resolvedSkills.push({
      id: entry.id,
      title: entry.title,
      status: 'resolved',
      deliveryMode: entry.deliveryMode,
      source: 'runtime_catalog',
      skillPath: entry.skillPath,
    });
  }

  const strict = manifest.strict === true;
  if (strict && resolvedSkills.some((skill) => skill.status !== 'resolved')) {
    warnings.push('Strict runtime skill mode requested unresolved skills.');
  }

  return {
    profileId: manifest.profileId,
    requestedSkills,
    resolvedSkills,
    strict,
    warnings,
    appliedSkillIds: resolvedSkills
      .filter((skill) => skill.status === 'resolved' && skill.deliveryMode === 'instructions')
      .map((skill) => skill.id),
    updatedAt: now.toISOString(),
  };
}

export function buildRuntimeSkillInstructionOverlay(
  skillState: SessionSkillState | undefined,
): string | undefined {
  if (!skillState || skillState.appliedSkillIds.length === 0) {
    return undefined;
  }

  const skillBlocks = skillState.appliedSkillIds
    .map((skillId) => {
      const entry = RUNTIME_SKILL_CATALOG[skillId];
      if (!entry || !existsSync(entry.skillPath)) {
        return null;
      }

      const body = readFileSync(entry.skillPath, 'utf-8').trim();
      if (!body) {
        return null;
      }

      return [
        `Runtime Skill: ${entry.title} (${entry.id})`,
        body,
      ].join('\n\n');
    })
    .filter((block): block is string => block !== null);

  if (skillBlocks.length === 0) {
    return undefined;
  }

  return [
    'The following runtime-managed SKILL.md packages are attached to this session.',
    'Follow them as durable skill instructions when relevant.',
    skillBlocks.join('\n\n---\n\n'),
  ].join('\n\n');
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
