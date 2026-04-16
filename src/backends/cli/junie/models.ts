function normalizeJunieToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/^openai\//, '')
    .replace(/^anthropic\//, '')
    .replace(/^google\//, '')
    .replace(/^xai\//, '')
    .trim();
}

const KNOWN_JUNIE_MODEL_IDS = new Set([
  'gpt',
  'gpt-codex',
  'sonnet',
  'opus',
  'gemini-pro',
  'gemini-flash',
  'grok',
]);

export function normalizeJunieModelName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeJunieToken(value);
  if (!normalized) {
    return null;
  }

  if (KNOWN_JUNIE_MODEL_IDS.has(normalized)) {
    return normalized;
  }

  if (normalized.includes('codex')) {
    return 'gpt-codex';
  }

  if (normalized.startsWith('gpt')) {
    return 'gpt';
  }

  if (normalized.includes('opus')) {
    return 'opus';
  }

  if (normalized.includes('sonnet')) {
    return 'sonnet';
  }

  if (normalized.includes('gemini') && normalized.includes('flash')) {
    return 'gemini-flash';
  }

  if (normalized.includes('gemini')) {
    return 'gemini-pro';
  }

  if (normalized.includes('grok')) {
    return 'grok';
  }

  return null;
}
