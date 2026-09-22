// Junie 26.9.21: operator-selected fixed combinations, not the full upstream menu.
const JUNIE_COMBINATIONS = [
  { id: 'Gemini 3.7 Flash', effort: 'medium', label: 'Medium', default: true },
  { id: 'Claude Fable 5.1', effort: 'low', label: 'Low' },
  { id: 'Gemini 3.8 Flash', effort: 'medium', label: 'Medium' },
  { id: 'GPT-5.6-SOL', effort: 'low', label: 'Low' },
  { id: 'Grok 4.6', effort: 'low', label: 'Low' },
] as const;

export const JUNIE_MODELS = JUNIE_COMBINATIONS.map((entry) => ({
  id: entry.id,
  label: `${entry.id} — ${entry.label}`,
  ...('default' in entry ? { default: entry.default } : {}),
}));

export const JUNIE_EFFORT_CONTROL = 'junie.reasoning_effort';

export function getJunieFixedEffort(model: string | undefined): 'low' | 'medium' | undefined {
  return JUNIE_COMBINATIONS.find((entry) => entry.id === model)?.effort;
}
