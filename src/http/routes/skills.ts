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

const RUNTIME_SKILL_SORT_FIELD_VALUES = [
  'id',
  'title',
  'family',
  'slug',
  'role',
] as const;
type RuntimeSkillCatalogSortField = typeof RUNTIME_SKILL_SORT_FIELD_VALUES[number];
const RUNTIME_SKILL_SORT_FIELDS = new Set<RuntimeSkillCatalogSortField>(
  RUNTIME_SKILL_SORT_FIELD_VALUES,
);

const RUNTIME_SKILL_SORT_DIRECTION_VALUES = [
  'asc',
  'desc',
] as const;
type RuntimeSkillCatalogSortDirection = typeof RUNTIME_SKILL_SORT_DIRECTION_VALUES[number];
const RUNTIME_SKILL_SORT_DIRECTIONS = new Set<RuntimeSkillCatalogSortDirection>(
  RUNTIME_SKILL_SORT_DIRECTION_VALUES,
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
  sorting: {
    sortBy: RUNTIME_SKILL_SORT_FIELD_VALUES,
    sortDirection: RUNTIME_SKILL_SORT_DIRECTION_VALUES,
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

interface RuntimeSkillCatalogSort {
  by: RuntimeSkillCatalogSortField;
  direction: RuntimeSkillCatalogSortDirection;
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
  const values = readQueryValues(searchParams, key);
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

function readOptionalSingleQueryValue(
  searchParams: URLSearchParams,
  key: string,
): string | undefined {
  const values = readQueryValues(searchParams, key);
  if (values.length === 0) {
    return undefined;
  }
  if (values.length !== 1) {
    throw new SkillCatalogQueryError(`Invalid ${key}: expected a single value.`);
  }
  return values[0];
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

function readRuntimeSkillCatalogSort(
  searchParams: URLSearchParams,
): RuntimeSkillCatalogSort | undefined {
  const sortBy = readOptionalSingleQueryValue(searchParams, 'sortBy');
  const sortDirection = readOptionalSingleQueryValue(searchParams, 'sortDirection');

  if (!sortBy && !sortDirection) {
    return undefined;
  }
  if (!sortBy) {
    throw new SkillCatalogQueryError('Invalid sortBy: sortDirection requires sortBy.');
  }
  if (!RUNTIME_SKILL_SORT_FIELDS.has(sortBy as RuntimeSkillCatalogSortField)) {
    throw new SkillCatalogQueryError(`Invalid sortBy: ${sortBy}`);
  }
  if (
    sortDirection
    && !RUNTIME_SKILL_SORT_DIRECTIONS.has(sortDirection as RuntimeSkillCatalogSortDirection)
  ) {
    throw new SkillCatalogQueryError(`Invalid sortDirection: ${sortDirection}`);
  }

  return {
    by: sortBy as RuntimeSkillCatalogSortField,
    direction: (sortDirection ?? 'asc') as RuntimeSkillCatalogSortDirection,
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

function readRuntimeSkillCatalogSortValue(
  skill: RuntimeSkillCatalogEntry,
  field: RuntimeSkillCatalogSortField,
): string {
  switch (field) {
    case 'id':
      return skill.id;
    case 'title':
      return skill.title;
    case 'family':
      return skill.library.family;
    case 'slug':
      return skill.library.slug;
    case 'role':
      return skill.library.role;
    default:
      return skill.id;
  }
}

function compareRuntimeSkillCatalogEntries(
  left: RuntimeSkillCatalogEntry,
  right: RuntimeSkillCatalogEntry,
  sort: RuntimeSkillCatalogSort,
): number {
  const primaryComparison = readRuntimeSkillCatalogSortValue(left, sort.by).localeCompare(
    readRuntimeSkillCatalogSortValue(right, sort.by),
  );
  if (primaryComparison !== 0) {
    return sort.direction === 'desc' ? -primaryComparison : primaryComparison;
  }

  for (const field of RUNTIME_SKILL_SORT_FIELD_VALUES) {
    const tieBreaker = readRuntimeSkillCatalogSortValue(left, field).localeCompare(
      readRuntimeSkillCatalogSortValue(right, field),
    );
    if (tieBreaker !== 0) {
      return tieBreaker;
    }
  }
  return 0;
}

function sortRuntimeSkillCatalog(
  skills: RuntimeSkillCatalogEntry[],
  sort: RuntimeSkillCatalogSort | undefined,
): RuntimeSkillCatalogEntry[] {
  if (!sort) {
    return skills;
  }
  return [...skills].sort((left, right) => compareRuntimeSkillCatalogEntries(left, right, sort));
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
    const sort = readRuntimeSkillCatalogSort(searchParams);
    const offset = readOptionalSingleIntegerQueryValue(searchParams, 'offset', 0) ?? 0;
    const limit = readOptionalSingleIntegerQueryValue(searchParams, 'limit', 1);
    const appliedFilters = buildAppliedRuntimeSkillCatalogFilters(filters);
    const filteredSkills = filterRuntimeSkillCatalog(listRuntimeSkillCatalog(), filters);
    const sortedSkills = sortRuntimeSkillCatalog(filteredSkills, sort);
    const { skills, pagination } = paginateRuntimeSkillCatalog(sortedSkills, offset, limit);
    return c.json({
      contract: RUNTIME_SKILL_CATALOG_CONTRACT,
      query: {
        hasFilters: Object.keys(appliedFilters).length > 0,
        filters: appliedFilters,
        ...(sort ? { sort } : {}),
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
