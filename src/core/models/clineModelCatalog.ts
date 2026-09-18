// Cline 3.0.62: operator-selected ClinePass combinations, not provider defaults.
export const CLINE_MODELS = [
  { id: 'cline-pass/glm-5.3', label: 'GLM-5.3 — Medium' },
  { id: 'cline-pass/kimi-k3', label: 'Kimi K3 — Medium' },
  { id: 'cline-pass/qwen3.8-max', label: 'Qwen3.8 Max — Medium' },
  { id: 'cline-pass/deepseek-v4-pro', label: 'DeepSeek V4 Pro — Medium' },
  { id: 'cline-pass/minimax-m3', label: 'MiniMax-M3 — Medium' },
  { id: 'cline-pass/mimo-v2.5-pro', label: 'MiMo-V2.5-Pro — Medium' },
];

export const CLINE_EFFORT_CONTROL = 'cline.reasoning_effort';

export function getClineFixedEffort(model: string | undefined): 'medium' | undefined {
  return CLINE_MODELS.some((entry) => entry.id === model) ? 'medium' : undefined;
}
