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
  'kilo.variant': { provider: 'kilo', backend: 'cli', type: 'string' },
  'cline.reasoning_effort': { provider: 'cline', backend: 'cli', type: 'string' },
  'junie.reasoning_effort': { provider: 'junie', backend: 'cli', type: 'string' },
  'kiro.reasoning_effort': { provider: 'kiro', backend: 'cli', type: 'string' },
  'goose.thinking_effort': { provider: 'goose', backend: 'cli', type: 'string' },
  'pi.thinking': { provider: 'pi', backend: 'cli', type: 'string' },
  'openai.reasoning_effort': { backend: 'api', transport: 'openai', type: 'string' },
  'ollama.temperature': { backend: 'local', transport: 'ollama', type: 'number' },
  'ollama.keep_alive': { backend: 'local', transport: 'ollama', type: 'string' },
});

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
  // Goose currently has one verified effort serializer: the native '-none' suffix.
  if (key === 'goose.thinking_effort' && value !== undefined && value !== 'off') {
    throw new Error(`Binding '${key}' currently supports only 'off'`);
  }
}
