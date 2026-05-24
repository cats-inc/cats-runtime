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

function normalizeCursorAnthropicEffortSuffix(
  suffix: string | undefined,
): string | null {
  switch (suffix) {
    case undefined:
      return '';
    case 'low':
      return '-low';
    case 'medium':
      return '-medium';
    case 'high':
      return '-high';
    case 'extra high':
      return '-xhigh';
    case 'max':
      return '-max';
    default:
      return null;
  }
}

const KNOWN_CURSOR_ANTHROPIC_CANONICAL_IDS = new Set([
  'claude-4.5-opus',
  'claude-4.5-opus-thinking',
  'claude-4.5-sonnet',
  'claude-4.5-sonnet-thinking',
  'claude-4.6-opus-high-thinking',
  'claude-4.6-sonnet',
  'claude-4.6-sonnet-thinking',
  'claude-4.7-opus',
  'claude-4.7-opus-low',
  'claude-4.7-opus-medium',
  'claude-4.7-opus-xhigh',
  'claude-4.7-opus-max',
  'claude-4.7-opus-thinking',
  'claude-4.7-opus-low-thinking',
  'claude-4.7-opus-medium-thinking',
  'claude-4.7-opus-xhigh-thinking',
  'claude-4.7-opus-max-thinking',
]);

const LEGACY_CURSOR_ANTHROPIC_LABEL_IDS = new Map([
  ['opus 4.5', 'claude-4.5-opus'],
  ['opus 4.5 thinking', 'claude-4.5-opus-thinking'],
  ['sonnet 4.5 1m', 'claude-4.5-sonnet'],
  ['sonnet 4.5 1m thinking', 'claude-4.5-sonnet-thinking'],
  // Cursor's observed legacy Opus 4.6 dynamic id is `claude-4.6-opus-high-thinking`
  // even though the picker label only says "Opus 4.6 1M Thinking".
  ['opus 4.6 1m thinking', 'claude-4.6-opus-high-thinking'],
  ['sonnet 4.6 1m', 'claude-4.6-sonnet'],
  ['sonnet 4.6 1m thinking', 'claude-4.6-sonnet-thinking'],
]);

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
    || KNOWN_CURSOR_ANTHROPIC_CANONICAL_IDS.has(value)
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
  const legacyMatch = LEGACY_CURSOR_ANTHROPIC_LABEL_IDS.get(value);
  if (legacyMatch) {
    return legacyMatch;
  }

  const match = value.match(/^(opus) (4\.7)(?: (low|medium|extra high|max))?( thinking)?$/);
  if (!match) {
    return null;
  }

  const [, family, version, effortLabel, thinkingLabel] = match;
  const effort = normalizeCursorAnthropicEffortSuffix(effortLabel);
  if (effort === null) {
    return null;
  }

  return `claude-${version}-${family}${effort}${thinkingLabel ? '-thinking' : ''}`;
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

export function normalizeCopilotModelName(
  value: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const knownIds = new Set([
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5.4-mini',
    'gpt-5-mini',
    'gpt-4.1',
    'claude-sonnet-4.6',
    'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-4.6',
    'claude-opus-4.5',
    'claude-sonnet-4',
  ]);
  if (knownIds.has(normalized)) {
    return normalized;
  }

  switch (normalized) {
    case 'gpt-5.4 mini':
      return 'gpt-5.4-mini';
    case 'gpt-5 mini':
      return 'gpt-5-mini';
    case 'claude-sonnet-4-6':
    case 'claude sonnet 4.6':
      return 'claude-sonnet-4.6';
    case 'claude-sonnet-4-5':
    case 'claude sonnet 4.5':
      return 'claude-sonnet-4.5';
    case 'claude-haiku-4-5':
    case 'claude haiku 4.5':
      return 'claude-haiku-4.5';
    case 'claude-opus-4-6':
    case 'claude opus 4.6':
      return 'claude-opus-4.6';
    case 'claude-opus-4-5':
    case 'claude opus 4.5':
      return 'claude-opus-4.5';
    case 'claude sonnet 4':
      return 'claude-sonnet-4';
    default:
      return null;
  }
}

export function normalizeKiloModelName(
  value: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const knownIds = new Set([
    'kilo/kilo-auto/frontier',
    'kilo/kilo-auto/balanced',
    'kilo/kilo-auto/free',
    'kilo/bytedance-seed/dola-seed-2.0-pro:free',
    'kilo/x-ai/grok-code-fast-1',
    'kilo/x-ai/grok-code-fast-1:optimized:free',
    'kilo/openrouter/elephant-alpha',
    'kilo/anthropic/claude-opus-4.6',
    'kilo/anthropic/claude-opus-4.7',
    'kilo/anthropic/claude-sonnet-4.6',
    'kilo/openai/gpt-5.4',
    'kilo/google/gemini-3.1-pro-preview',
    'kilo/minimax/minimax-m2.7',
    'kilo/moonshotai/kimi-k2.5',
    'kilo/stepfun/step-3.5-flash',
    'kilo/z-ai/glm-5.1',
  ]);
  if (knownIds.has(normalized)) {
    return normalized;
  }

  switch (normalized) {
    case 'kilo auto frontier':
      return 'kilo/kilo-auto/frontier';
    case 'kilo auto balanced':
      return 'kilo/kilo-auto/balanced';
    case 'kilo auto free':
      return 'kilo/kilo-auto/free';
    case 'bytedance seed: dola seed 2.0 pro (free)':
      return 'kilo/bytedance-seed/dola-seed-2.0-pro:free';
    case 'xai: grok code fast 1':
      return 'kilo/x-ai/grok-code-fast-1';
    // Current `kilo models` output exposes the optimized variant only as
    // `kilo/x-ai/grok-code-fast-1:optimized:free`; the picker label omits the
    // trailing "(free)" marker.
    case 'xai: grok code fast 1 optimized':
    case 'xai: grok code fast 1 optimized (free)':
      return 'kilo/x-ai/grok-code-fast-1:optimized:free';
    case 'stepfun: step 3.5 flash':
      return 'kilo/stepfun/step-3.5-flash';
    case 'elephant':
    case 'elephant (new)':
      return 'kilo/openrouter/elephant-alpha';
    case 'anthropic: claude opus 4.6':
      return 'kilo/anthropic/claude-opus-4.6';
    case 'anthropic: claude opus 4.7':
      return 'kilo/anthropic/claude-opus-4.7';
    case 'anthropic: claude sonnet 4.6':
      return 'kilo/anthropic/claude-sonnet-4.6';
    case 'openai: gpt-5.4':
    case 'gpt-5.4':
      return 'kilo/openai/gpt-5.4';
    case 'google: gemini 3.1 pro preview':
      return 'kilo/google/gemini-3.1-pro-preview';
    case 'minimax: minimax m2.7':
      return 'kilo/minimax/minimax-m2.7';
    case 'moonshotai: kimi k2.5':
      return 'kilo/moonshotai/kimi-k2.5';
    case 'z.ai: glm 5.1':
    case 'z.ai: glm 5.1 (new)':
      return 'kilo/z-ai/glm-5.1';
    default:
      return null;
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
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2',
    'gpt-5.1-codex-mini',
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

export function normalizeVerbatimCuratedModelId(
  model: CuratedModelCatalogModel,
): string | null {
  const name = model.name.trim();
  if (name.length > 0) {
    return name;
  }

  const label = model.label?.trim();
  return label && label.length > 0 ? label : null;
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

export function normalizeCopilotCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const normalized = normalizeCopilotModelName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function normalizeKiloCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const normalized = normalizeKiloModelName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function normalizeKiroCuratedModelId(model: CuratedModelCatalogModel): string | null {
  const candidates = [model.name, model.label].filter((value): value is string => Boolean(value));
  const knownIds = new Set([
    'auto',
    'claude-opus-4.6',
    'claude-sonnet-4.6',
    'claude-opus-4.5',
    'claude-sonnet-4.5',
    'claude-sonnet-4',
    'claude-haiku-4.5',
    'deepseek-3.2',
    'minimax-m2.5',
    'minimax-m2.1',
    'glm-5',
    'qwen3-coder-next',
  ]);

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (knownIds.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

export function normalizeJunieCuratedModelId(model: CuratedModelCatalogModel): string | null {
  return normalizeVerbatimCuratedModelId(model);
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
    case 'antigravity':
      return normalizeVerbatimCuratedModelId(model);
    case 'kilo':
      return normalizeKiloCuratedModelId(model);
    case 'kiro':
      return normalizeKiroCuratedModelId(model);
    case 'junie':
      return normalizeJunieCuratedModelId(model);
    case 'copilot':
      return normalizeCopilotCuratedModelId(model);
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
