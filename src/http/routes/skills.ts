import { Hono } from 'hono';
import { listRuntimeSkillCatalog } from '../../core/skills/catalog.js';
import type {
  RuntimeSkillCatalogEntry,
  RuntimeSkillDeliveryMode,
  RuntimeSkillFamily,
  RuntimeSkillPackageKind,
} from '../../core/types.js';

export const skillRoutes = new Hono();

const RUNTIME_SKILL_FAMILIES = new Set<RuntimeSkillFamily>([
  'base',
  'orchestration',
  'work',
  'chat',
  'code',
]);

const RUNTIME_SKILL_PACKAGE_KINDS = new Set<RuntimeSkillPackageKind>([
  'base',
  'role',
  'bundle',
]);

const RUNTIME_SKILL_DELIVERY_HINTS = new Set<RuntimeSkillDeliveryMode>([
  'filesystem',
  'instructions',
  'none',
]);

class SkillCatalogQueryError extends Error {}

function readQueryValues(searchParams: URLSearchParams, key: string): string[] {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function validateEnumValues<T extends string>(
  values: string[],
  allowed: Set<T>,
  label: string,
): asserts values is T[] {
  for (const value of values) {
    if (!allowed.has(value as T)) {
      throw new SkillCatalogQueryError(`Invalid ${label}: ${value}`);
    }
  }
}

function filterRuntimeSkillCatalog(
  skills: RuntimeSkillCatalogEntry[],
  searchParams: URLSearchParams,
): RuntimeSkillCatalogEntry[] {
  const ids = readQueryValues(searchParams, 'id');
  const families = readQueryValues(searchParams, 'family');
  const slugs = readQueryValues(searchParams, 'slug');
  const roles = readQueryValues(searchParams, 'role');
  const packageKinds = readQueryValues(searchParams, 'packageKind');
  const capabilityTags = readQueryValues(searchParams, 'capabilityTag');
  const productTags = readQueryValues(searchParams, 'productTag');
  const deliveryHints = readQueryValues(searchParams, 'deliveryHint');

  validateEnumValues(families, RUNTIME_SKILL_FAMILIES, 'family');
  validateEnumValues(packageKinds, RUNTIME_SKILL_PACKAGE_KINDS, 'packageKind');
  validateEnumValues(deliveryHints, RUNTIME_SKILL_DELIVERY_HINTS, 'deliveryHint');

  return skills.filter((skill) => {
    if (ids.length > 0 && !ids.includes(skill.id)) {
      return false;
    }
    if (families.length > 0 && !families.includes(skill.library.family)) {
      return false;
    }
    if (slugs.length > 0 && !slugs.includes(skill.library.slug)) {
      return false;
    }
    if (roles.length > 0 && !roles.includes(skill.library.role)) {
      return false;
    }
    if (packageKinds.length > 0 && !packageKinds.includes(skill.library.packageKind)) {
      return false;
    }
    if (
      capabilityTags.length > 0
      && !capabilityTags.some((tag) => skill.library.capabilityTags.includes(tag))
    ) {
      return false;
    }
    if (
      productTags.length > 0
      && !productTags.some((tag) => skill.library.productTags.includes(tag))
    ) {
      return false;
    }
    if (
      deliveryHints.length > 0
      && !deliveryHints.some((hint) => skill.library.deliveryHints.includes(hint))
    ) {
      return false;
    }
    return true;
  });
}

skillRoutes.get('/skills/catalog', (c) => {
  try {
    const searchParams = new URL(c.req.url).searchParams;
    const skills = filterRuntimeSkillCatalog(listRuntimeSkillCatalog(), searchParams);
    return c.json({
      count: skills.length,
      skills,
    });
  } catch (err) {
    if (err instanceof SkillCatalogQueryError) {
      return c.json({ error: err.message }, 400);
    }
    return c.json(
      { error: `Failed to read runtime skill catalog: ${err}` },
      500,
    );
  }
});
