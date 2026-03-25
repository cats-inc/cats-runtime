import type { ProviderAdvancedControlValue } from './providerAdvancedCatalog.js';

export function cloneProviderControls(
  controls: Record<string, ProviderAdvancedControlValue> | undefined,
): Record<string, ProviderAdvancedControlValue> | undefined {
  if (!controls) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(controls)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  );
}
