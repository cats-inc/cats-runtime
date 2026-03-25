function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(
  template: Record<string, unknown>,
  runtime: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...template };

  for (const [key, runtimeValue] of Object.entries(runtime)) {
    const templateValue = merged[key];
    if (isPlainObject(templateValue) && isPlainObject(runtimeValue)) {
      merged[key] = mergeObjects(templateValue, runtimeValue);
      continue;
    }

    merged[key] = runtimeValue;
  }

  return merged;
}

export function applyPayloadTemplate<T extends Record<string, unknown>>(
  runtimeBody: T,
  template?: Record<string, unknown>,
): T {
  if (!template || !isPlainObject(template)) {
    return runtimeBody;
  }

  return mergeObjects(template, runtimeBody) as T;
}

export function mergeRuntimePayloadPatch<T extends Record<string, unknown>>(
  requestBody: T,
  runtimePatch?: Record<string, unknown>,
): T {
  if (!runtimePatch || !isPlainObject(runtimePatch)) {
    return requestBody;
  }

  return mergeObjects(requestBody, runtimePatch) as T;
}

export function readPayloadTemplateString(
  template: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!template) {
    return undefined;
  }

  for (const key of keys) {
    const value = template[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}
