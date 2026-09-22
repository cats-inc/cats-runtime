// Goose 1.51.0: operator-selected ChatGPT Codex combinations, not provider defaults.
export const GOOSE_MODELS = [
  { id: 'chatgpt_codex/gpt-5.6-sol', label: 'gpt-5.6-sol — Off' },
  { id: 'chatgpt_codex/gpt-5.6-terra', label: 'gpt-5.6-terra — Off' },
  { id: 'chatgpt_codex/gpt-5.6-luna', label: 'gpt-5.6-luna — Off' },
  { id: 'chatgpt_codex/gpt-5.6', label: 'gpt-5.6 — Off' },
  { id: 'chatgpt_codex/gpt-5.5', label: 'gpt-5.5 — Off' },
  { id: 'chatgpt_codex/gpt-5.4', label: 'gpt-5.4 — Off' },
];

export const GOOSE_EFFORT_CONTROL = 'goose.thinking_effort';

export function getGooseFixedEffort(model: string | undefined): 'off' | undefined {
  return GOOSE_MODELS.some((entry) => entry.id === model) ? 'off' : undefined;
}
