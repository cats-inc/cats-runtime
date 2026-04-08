import type { CuratedModelCatalogModel } from './curatedModelCatalog.js';

export function normalizeClaudeCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (
      normalized === 'opus'
      || normalized.includes('claude-opus')
      || normalized.includes('opus 4.6')
    ) {
      return 'opus';
    }
    if (
      normalized === 'sonnet'
      || normalized.includes('claude-sonnet')
      || normalized.includes('sonnet 4.6')
    ) {
      return 'sonnet';
    }
    if (
      normalized === 'haiku'
      || normalized.includes('claude-haiku')
      || normalized.includes('haiku 4.5')
    ) {
      return 'haiku';
    }
  }

  return null;
}

export function normalizeCodexCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  const knownIds = new Set([
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2',
  ]);

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (knownIds.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

export function normalizeLiteralCuratedModelId(
  model: CuratedModelCatalogModel,
): string | null {
  const normalized = model.name.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeCuratedModelId(
  providerName: string,
  model: CuratedModelCatalogModel,
): string | null {
  switch (providerName) {
    case 'claude':
      return normalizeClaudeCuratedModelId(model);
    case 'codex':
      return normalizeCodexCuratedModelId(model);
    case 'gemini':
      return normalizeLiteralCuratedModelId(model);
    default:
      return null;
  }
}
