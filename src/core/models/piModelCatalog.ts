// Pi 0.87.1: operator-selected subscription models with fixed thinking.
export const PI_MODELS = [
  { id: 'openai-codex/gpt-5.6-luna', label: 'gpt-5.6-luna [openai-codex] — medium' },
  { id: 'openai-codex/gpt-5.6-sol', label: 'gpt-5.6-sol [openai-codex] — medium' },
  { id: 'openai-codex/gpt-5.6-terra', label: 'gpt-5.6-terra [openai-codex] — medium' },
  { id: 'openai-codex/gpt-6-astra', label: 'gpt-6-astra [openai-codex] — medium' },
  { id: 'openai-codex/gpt-6-luna', label: 'gpt-6-luna [openai-codex] — medium' },
  { id: 'openai-codex/gpt-6-sol', label: 'gpt-6-sol [openai-codex] — medium' },
];

export const PI_THINKING_CONTROL = 'pi.thinking';

export function getPiFixedThinking(model: string | undefined): 'medium' | undefined {
  return PI_MODELS.some((entry) => entry.id === model) ? 'medium' : undefined;
}
