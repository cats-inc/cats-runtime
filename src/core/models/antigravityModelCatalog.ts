// Picker labels/options: Antigravity 1.2.3, 2026-09-16. Execution ids retain
// the independently captured `agy models` evidence from 1.1.24.
// A family's first raw id is also its selectable entry id; no synthetic id
// is sent to the CLI and no first choice is advertised as an account default.
export const ANTIGRAVITY_EFFORT_CONTROL = 'antigravity.effort';

const EFFORT_MODELS: Record<string, Record<string, string>> = {
  'gemini-3.8-flash-low': {
    low: 'gemini-3.8-flash-low', medium: 'gemini-3.8-flash-medium', high: 'gemini-3.8-flash-high',
  },
  'gemini-3.7-flash-low': {
    low: 'gemini-3.7-flash-low', medium: 'gemini-3.7-flash-medium', high: 'gemini-3.7-flash-high',
  },
  'gemini-3.6-flash-low': {
    low: 'gemini-3.6-flash-low', medium: 'gemini-3.6-flash-medium', high: 'gemini-3.6-flash-high',
  },
  'gemini-3.1-pro-low': { low: 'gemini-3.1-pro-low', high: 'gemini-3.1-pro-high' },
};

export const ANTIGRAVITY_MODELS = [
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

export function listAntigravityModelEfforts(entryId: string): string[] {
  return Object.keys(EFFORT_MODELS[entryId] ?? {});
}

export function resolveAntigravityExecutionModel(entryId: string, effort: string): string {
  const model = EFFORT_MODELS[entryId]?.[effort];
  if (!model) throw new Error(`Unsupported Antigravity effort '${effort}' for '${entryId}'`);
  return model;
}
