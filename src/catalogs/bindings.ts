import type { CatalogScope, CatalogValue } from './types.js';

interface Binding {
  provider?: string;
  backend: CatalogScope['backend'];
  transport?: string;
  type: 'string' | 'number' | 'boolean';
  modelVariant?: boolean;
}

// Increment when serializer semantics change without a key/type change.
export const CATALOG_BINDING_VERSION = 1;

// Protocol serializers are code. Per-model availability, values and defaults are data.
export const CATALOG_BINDINGS: Readonly<Record<string, Binding>> = Object.freeze({
  'claude.reasoning_effort': { provider: 'claude', backend: 'cli', type: 'string' },
  'codex.reasoning_effort': { provider: 'codex', backend: 'cli', type: 'string' },
  'antigravity.effort': { provider: 'antigravity', backend: 'cli', type: 'string', modelVariant: true },
  'grok.reasoning_effort': { provider: 'grok', backend: 'cli', type: 'string' },
  'muse.reasoning_effort': { provider: 'muse', backend: 'cli', type: 'string' },
  'copilot.reasoning_effort': { provider: 'copilot', backend: 'cli', type: 'string' },
  'copilot.context': { provider: 'copilot', backend: 'cli', type: 'string' },
  'copilot.auto_tier': { provider: 'copilot', backend: 'cli', type: 'string' },
  'kilo.variant': { provider: 'kilo', backend: 'cli', type: 'string' },
  'opencode.variant': { provider: 'opencode', backend: 'cli', type: 'string' },
  // Devin and Cursor encode these choices in the executable model id, chosen through variants.
  'devin.effort': { provider: 'devin', backend: 'agent', transport: 'acp_stdio', type: 'string', modelVariant: true },
  'devin.speed': { provider: 'devin', backend: 'agent', transport: 'acp_stdio', type: 'string', modelVariant: true },
  'cursor.context': { provider: 'cursor', backend: 'cli', type: 'string', modelVariant: true },
  'cursor.effort': { provider: 'cursor', backend: 'cli', type: 'string', modelVariant: true },
  'cursor.reasoning': { provider: 'cursor', backend: 'cli', type: 'string', modelVariant: true },
  'cursor.reasoning_effort': { provider: 'cursor', backend: 'cli', type: 'string', modelVariant: true },
  'cursor.thinking': { provider: 'cursor', backend: 'cli', type: 'string', modelVariant: true },
  'cursor.fast': { provider: 'cursor', backend: 'cli', type: 'string', modelVariant: true },
  'cline.reasoning_effort': { provider: 'cline', backend: 'cli', type: 'string' },
  'junie.reasoning_effort': { provider: 'junie', backend: 'cli', type: 'string' },
  'kiro.reasoning_effort': { provider: 'kiro', backend: 'cli', type: 'string' },
  'goose.thinking_effort': { provider: 'goose', backend: 'cli', type: 'string' },
  'pi.thinking': { provider: 'pi', backend: 'cli', type: 'string' },
  'openai.reasoning_effort': { backend: 'api', transport: 'openai', type: 'string' },
  'ollama.temperature': { backend: 'local', transport: 'ollama', type: 'number' },
  'ollama.keep_alive': { backend: 'local', transport: 'ollama', type: 'string' },
});

// Goose 1.54.0 parses these model suffixes into ThinkingEffort (Off, Low, Medium, High, Max);
// it has no -max or -off suffix, so Max travels as -xhigh.
export const GOOSE_THINKING_SUFFIXES: Readonly<Record<string, string>> = Object.freeze({
  off: '-none',
  low: '-low',
  medium: '-medium',
  high: '-high',
  max: '-xhigh',
});

// OpenCode's and Kilo's variant pickers offer Default, which leaves the prompt variant unset.
export const NATIVE_DEFAULT_VARIANT = 'default';

/** The native prompt's variant for a selected value: none for Default or no selection. */
export function nativePromptVariant(value: unknown): string | undefined {
  return typeof value === 'string' && value !== NATIVE_DEFAULT_VARIANT ? value : undefined;
}

export function assertCatalogBinding(scope: CatalogScope, key: string, value?: CatalogValue): void {
  const binding = CATALOG_BINDINGS[key];
  if (!binding || binding.backend !== scope.backend
    || (binding.provider && binding.provider !== scope.provider)
    || (binding.transport && binding.transport !== scope.transport)) {
    throw new Error(`Unsupported binding '${key}' in ${scope.provider}/${scope.backend}`);
  }
  if (value !== undefined && (typeof value !== binding.type
    || (typeof value === 'number' && !Number.isFinite(value))
    || (typeof value === 'string' && (!value.trim() || /[\u0000-\u001f]/.test(value))))) {
    throw new Error(`Binding '${key}' requires a ${binding.type} value`);
  }
  // Goose's verified serializer is its native model suffix, one per thinking effort.
  if (key === 'goose.thinking_effort' && value !== undefined
    && (typeof value !== 'string' || !Object.hasOwn(GOOSE_THINKING_SUFFIXES, value))) {
    throw new Error(`Binding '${key}' supports only ${Object.keys(GOOSE_THINKING_SUFFIXES).join(', ')}`);
  }
}
