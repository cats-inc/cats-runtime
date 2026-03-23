import { Hono } from 'hono';
import { listRuntimeSkillCatalog } from '../../core/skills/catalog.js';
import type {
  RuntimeSkillCatalogEntry,
  RuntimeSkillDeliveryMode,
  RuntimeSkillFamily,
  RuntimeSkillPackageKind,
} from '../../core/types.js';

export const skillRoutes = new Hono();

const RUNTIME_SKILL_FAMILY_VALUES = [
  'base',
  'orchestration',
  'work',
  'chat',
  'code',
 ] as const satisfies readonly RuntimeSkillFamily[];
const RUNTIME_SKILL_FAMILIES = new Set<RuntimeSkillFamily>(RUNTIME_SKILL_FAMILY_VALUES);

const RUNTIME_SKILL_PACKAGE_KIND_VALUES = [
  'base',
  'role',
  'bundle',
 ] as const satisfies readonly RuntimeSkillPackageKind[];
const RUNTIME_SKILL_PACKAGE_KINDS = new Set<RuntimeSkillPackageKind>(
  RUNTIME_SKILL_PACKAGE_KIND_VALUES,
);

const RUNTIME_SKILL_DELIVERY_HINT_VALUES = [
  'filesystem',
  'instructions',
  'none',
 ] as const satisfies readonly RuntimeSkillDeliveryMode[];
const RUNTIME_SKILL_DELIVERY_HINTS = new Set<RuntimeSkillDeliveryMode>(
  RUNTIME_SKILL_DELIVERY_HINT_VALUES,
);

const RUNTIME_SKILL_CATALOG_CONTRACT = {
  version: 1,
  acceptedFilterEncodings: ['repeat', 'csv'],
  filterSemantics: {
    withinField: 'or',
    acrossFields: 'and',
  },
  pagination: {
    offset: { minimum: 0 },
    limit: { minimum: 1 },
  },
  supportedFilters: {
    id: { type: 'string' },
    family: { type: 'enum', values: RUNTIME_SKILL_FAMILY_VALUES },
    slug: { type: 'string' },
    role: { type: 'string' },
    packageKind: { type: 'enum', values: RUNTIME_SKILL_PACKAGE_KIND_VALUES },
    capabilityTag: { type: 'string' },
    productTag: { type: 'string' },
    deliveryHint: { type: 'enum', values: RUNTIME_SKILL_DELIVERY_HINT_VALUES },
  },
} as const;

interface RuntimeSkillCatalogFilters {
  id: string[];
  family: RuntimeSkillFamily[];
  slug: string[];
  role: string[];
  packageKind: RuntimeSkillPackageKind[];
  capabilityTag: string[];
  productTag: string[];
  deliveryHint: RuntimeSkillDeliveryMode[];
}

interface RuntimeSkillCatalogPagination {
  offset: number;
  limit: number | null;
  returned: number;
  hasMore: boolean;
}

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

function readOptionalSingleIntegerQueryValue(
  searchParams: URLSearchParams,
  key: string,
  minimum: number,
): number | undefined {
  const values = searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    return undefined;
  }
  if (values.length !== 1 || !/^\d+$/.test(values[0])) {
    throw new SkillCatalogQueryError(`Invalid ${key}: expected a single integer.`);
  }
  const parsed = Number.parseInt(values[0], 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new SkillCatalogQueryError(`Invalid ${key}: expected an integer >= ${minimum}.`);
  }
  return parsed;
}

function readRuntimeSkillCatalogFilters(
  searchParams: URLSearchParams,
): RuntimeSkillCatalogFilters {
  const id = readQueryValues(searchParams, 'id');
  const family = readQueryValues(searchParams, 'family');
  const slug = readQueryValues(searchParams, 'slug');
  const role = readQueryValues(searchParams, 'role');
  const packageKind = readQueryValues(searchParams, 'packageKind');
  const capabilityTag = readQueryValues(searchParams, 'capabilityTag');
  const productTag = readQueryValues(searchParams, 'productTag');
  const deliveryHint = readQueryValues(searchParams, 'deliveryHint');

  validateEnumValues(family, RUNTIME_SKILL_FAMILIES, 'family');
  validateEnumValues(packageKind, RUNTIME_SKILL_PACKAGE_KINDS, 'packageKind');
  validateEnumValues(deliveryHint, RUNTIME_SKILL_DELIVERY_HINTS, 'deliveryHint');

  return {
    id,
    family,
    slug,
    role,
    packageKind,
    capabilityTag,
    productTag,
    deliveryHint,
  };
}

function buildAppliedRuntimeSkillCatalogFilters(
  filters: RuntimeSkillCatalogFilters,
): Partial<RuntimeSkillCatalogFilters> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, values]) => values.length > 0),
  ) as Partial<RuntimeSkillCatalogFilters>;
}

function filterRuntimeSkillCatalog(
  skills: RuntimeSkillCatalogEntry[],
  filters: RuntimeSkillCatalogFilters,
): RuntimeSkillCatalogEntry[] {
  const {
    id,
    family,
    slug,
    role,
    packageKind,
    capabilityTag,
    productTag,
    deliveryHint,
  } = filters;

  return skills.filter((skill) => {
    if (id.length > 0 && !id.includes(skill.id)) {
      return false;
    }
    if (family.length > 0 && !family.includes(skill.library.family)) {
      return false;
    }
    if (slug.length > 0 && !slug.includes(skill.library.slug)) {
      return false;
    }
    if (role.length > 0 && !role.includes(skill.library.role)) {
      return false;
    }
    if (packageKind.length > 0 && !packageKind.includes(skill.library.packageKind)) {
      return false;
    }
    if (
      capabilityTag.length > 0
      && !capabilityTag.some((tag) => skill.library.capabilityTags.includes(tag))
    ) {
      return false;
    }
    if (
      productTag.length > 0
      && !productTag.some((tag) => skill.library.productTags.includes(tag))
    ) {
      return false;
    }
    if (
      deliveryHint.length > 0
      && !deliveryHint.some((hint) => skill.library.deliveryHints.includes(hint))
    ) {
      return false;
    }
    return true;
  });
}

function paginateRuntimeSkillCatalog(
  skills: RuntimeSkillCatalogEntry[],
  offset: number,
  limit: number | undefined,
): {
  skills: RuntimeSkillCatalogEntry[];
  pagination: RuntimeSkillCatalogPagination;
} {
  const pagedSkills = limit === undefined
    ? skills.slice(offset)
    : skills.slice(offset, offset + limit);
  return {
    skills: pagedSkills,
    pagination: {
      offset,
      limit: limit ?? null,
      returned: pagedSkills.length,
      hasMore: offset + pagedSkills.length < skills.length,
    },
  };
}

skillRoutes.get('/skills/catalog', (c) => {
  try {
    const searchParams = new URL(c.req.url).searchParams;
    const filters = readRuntimeSkillCatalogFilters(searchParams);
    const offset = readOptionalSingleIntegerQueryValue(searchParams, 'offset', 0) ?? 0;
    const limit = readOptionalSingleIntegerQueryValue(searchParams, 'limit', 1);
    const appliedFilters = buildAppliedRuntimeSkillCatalogFilters(filters);
    const filteredSkills = filterRuntimeSkillCatalog(listRuntimeSkillCatalog(), filters);
    const { skills, pagination } = paginateRuntimeSkillCatalog(filteredSkills, offset, limit);
    return c.json({
      contract: RUNTIME_SKILL_CATALOG_CONTRACT,
      query: {
        hasFilters: Object.keys(appliedFilters).length > 0,
        filters: appliedFilters,
      },
      count: filteredSkills.length,
      pagination,
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
