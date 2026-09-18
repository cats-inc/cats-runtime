import type { ProviderTargetDescriptor } from '../providerCatalog.js';

// Devin 3000.10.31: operator-selected fixed combinations. Effort is part of
// each executable model_uid, not an independent ACP configuration option.
export const DEVIN_MODELS = [
  { id: 'adaptive', label: 'Adaptive' },
  { id: 'claude-fable-5-1-medium', label: 'Claude Fable 5.1 — Medium' },
  { id: 'gemini-3-8-flash-medium', label: 'Gemini 3.8 Flash — Medium' },
  { id: 'gpt-6-astra-medium', label: 'GPT-6 Astra — Medium' },
  { id: 'grok-4-6-medium', label: 'Grok 4.6 — Medium' },
  { id: 'nemotron-3-ultra-high', label: 'Nemotron 3 Ultra — High' },
];

export function isDevinAcpModelTarget(
  target: Pick<ProviderTargetDescriptor, 'providerName'>
    & Partial<Pick<ProviderTargetDescriptor, 'backend' | 'remoteInstance'>>,
): boolean {
  return target.providerName === 'devin'
    && target.backend === 'agent'
    && target.remoteInstance?.transport === 'acp_stdio';
}
