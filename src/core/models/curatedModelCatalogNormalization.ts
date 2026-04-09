import type { CuratedModelCatalogModel } from './curatedModelCatalog.js';

function normalizeWhitespace(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCursorCodexSuffix(
  suffix: string | undefined,
): string | null {
  switch (suffix) {
    case undefined:
      return '';
    case 'low':
      return '-low';
    case 'low fast':
      return '-low-fast';
    case 'medium fast':
      return '-medium-fast';
    case 'fast':
      return '-fast';
    case 'high':
      return '-high';
    case 'high fast':
      return '-high-fast';
    case 'extra high':
      return '-xhigh';
    case 'extra high fast':
      return '-xhigh-fast';
    default:
      return null;
  }
}

function isKnownCursorCanonicalModelId(value: string): boolean {
  return /^auto$/.test(value)
    || /^composer-2(?:-fast)?$/.test(value)
    || /^composer-1\.5$/.test(value)
    || /^gpt-5\.3-codex(?:-spark)?(?:-(low|low-fast|fast|high|high-fast|xhigh|xhigh-fast))?$/.test(
      value,
    )
    || /^gpt-5\.2(?:-codex)?(?:-(low|low-fast|fast|high|high-fast|xhigh|xhigh-fast))?$/.test(
      value,
    )
    || /^gpt-5\.1-codex-(max|mini)(?:-(low|low-fast|medium-fast|high|high-fast|xhigh|xhigh-fast))?$/.test(
      value,
    )
    || /^gpt-5\.4(?:-(medium|low|high|xhigh|fast|high-fast|xhigh-fast))$/.test(value)
    || /^gpt-5\.4-mini(?:-(none|low|high|xhigh))?$/.test(value)
    || /^gpt-5\.4-nano(?:-(none|low|high|xhigh))?$/.test(value)
    || /^gpt-5-mini$/.test(value)
    || /^claude-4\.(5|6)-(opus|sonnet)(?:-high-thinking|-thinking)?$/.test(value)
    || /^gemini-3(?:\.1)?-(pro|flash)$/.test(value)
    || /^grok-4\.20(?:-thinking)?$/.test(value)
    || /^kimi-k2\.5$/.test(value);
}

function normalizeCursorCodexLabel(value: string): string | null {
  const match = value.match(
    /^codex (5\.[123])(?: (spark|max|mini))?(?: (low fast|medium fast|fast|high fast|extra high fast|low|high|extra high))?$/,
  );
  if (!match) {
    return null;
  }

  const [, version, tier, suffixLabel] = match;
  const suffix = normalizeCursorCodexSuffix(suffixLabel);
  if (suffix === null) {
    return null;
  }

  if (version === '5.3' && tier === undefined) {
    return `gpt-5.3-codex${suffix}`;
  }
  if (version === '5.3' && tier === 'spark') {
    return `gpt-5.3-codex-spark${suffix}`;
  }
  if (version === '5.2' && tier === undefined) {
    return `gpt-5.2-codex${suffix}`;
  }
  if (version === '5.1' && tier === 'max') {
    return `gpt-5.1-codex-max${suffix}`;
  }
  if (version === '5.1' && tier === 'mini') {
    return `gpt-5.1-codex-mini${suffix}`;
  }

  return null;
}

function normalizeCursorGpt54Label(value: string): string | null {
  switch (value) {
    case 'gpt-5.4 1m':
      return 'gpt-5.4-medium';
    case 'gpt-5.4 1m low':
      return 'gpt-5.4-low';
    case 'gpt-5.4 1m high':
      return 'gpt-5.4-high';
    case 'gpt-5.4 1m extra high':
      return 'gpt-5.4-xhigh';
    case 'gpt-5.4 fast':
      return 'gpt-5.4-fast';
    case 'gpt-5.4 high fast':
      return 'gpt-5.4-high-fast';
    case 'gpt-5.4 extra high fast':
      return 'gpt-5.4-xhigh-fast';
    default:
      return null;
  }
}

function normalizeCursorGpt54TierLabel(value: string): string | null {
  const match = value.match(/^gpt-5\.4 (mini|nano)(?: (none|low|high|extra high))?$/);
  if (!match) {
    return null;
  }

  const [, tier, suffixLabel] = match;
  if (!suffixLabel) {
    return `gpt-5.4-${tier}`;
  }

  switch (suffixLabel) {
    case 'none':
      return `gpt-5.4-${tier}-none`;
    case 'low':
      return `gpt-5.4-${tier}-low`;
    case 'high':
      return `gpt-5.4-${tier}-high`;
    case 'extra high':
      return `gpt-5.4-${tier}-xhigh`;
    default:
      return null;
  }
}

function normalizeCursorGpt52Label(value: string): string | null {
  const match = value.match(
    /^gpt-5\.2(?: (low fast|fast|high fast|extra high fast|low|high|extra high))?$/,
  );
  if (!match) {
    return null;
  }

  const suffix = normalizeCursorCodexSuffix(match[1]);
  if (suffix === null || suffix === '-medium-fast') {
    return null;
  }

  return `gpt-5.2${suffix}`;
}

function normalizeCursorAnthropicLabel(value: string): string | null {
  if (value === 'opus 4.6 1m thinking') {
    return 'claude-4.6-opus-high-thinking';
  }
  if (value === 'opus 4.5') {
    return 'claude-4.5-opus';
  }
  if (value === 'opus 4.5 thinking') {
    return 'claude-4.5-opus-thinking';
  }
  if (value === 'sonnet 4.5 1m') {
    return 'claude-4.5-sonnet';
  }
  if (value === 'sonnet 4.5 1m thinking') {
    return 'claude-4.5-sonnet-thinking';
  }
  return null;
}

export function normalizeCursorModelName(
  value: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (isKnownCursorCanonicalModelId(normalized)) {
    return normalized;
  }

  switch (normalized) {
    case 'auto':
      return 'auto';
    case 'composer 2 fast':
      return 'composer-2-fast';
    case 'composer 2':
      return 'composer-2';
    case 'composer 1.5':
      return 'composer-1.5';
    case 'gpt-5 mini':
      return 'gpt-5-mini';
    case 'gemini 3.1 pro':
      return 'gemini-3.1-pro';
    case 'gemini 3 flash':
      return 'gemini-3-flash';
    case 'grok 4.20':
      return 'grok-4.20';
    case 'grok 4.20 thinking':
      return 'grok-4.20-thinking';
    case 'kimi k2.5':
      return 'kimi-k2.5';
    default:
      return normalizeCursorCodexLabel(normalized)
        || normalizeCursorGpt54Label(normalized)
        || normalizeCursorGpt54TierLabel(normalized)
        || normalizeCursorGpt52Label(normalized)
        || normalizeCursorAnthropicLabel(normalized);
  }
}

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

export function normalizeCursorCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const normalized = normalizeCursorModelName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
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
    case 'cursor':
      return normalizeCursorCuratedModelId(model);
    default:
      return null;
  }
}

export function describeCuratedModelLabel(model: CuratedModelCatalogModel): string {
  const name = model.name.trim();
  const label = model.label?.trim();
  if (label && label.length > 0 && label !== name) {
    return `${name} (${label})`;
  }
  return name || label || '<unnamed>';
}
