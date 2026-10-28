import { record } from '../../../core/interactions/validation.js';
import type { InteractionField, InteractionOption } from '../../../core/interactions/types.js';

/** MCP elicitation shapes shared by every provider that relays them to a host. */
function unsupported(): never { throw new Error('Unsupported MCP elicitation shape.'); }
export function boundedText(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > 16_384) return unsupported();
  return value;
}
export function fieldId(id: string): string {
  if (!id || id.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(id)) unsupported();
  return id;
}
function options(value: unknown): InteractionOption[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 64) return unsupported();
  return value.map(entry => {
    if (typeof entry === 'string') return { id: boundedText(entry), label: boundedText(entry) };
    const item = record(entry);
    if (!item || typeof item.const !== 'string'
      || Object.keys(item).some(key => !['const', 'title', 'description'].includes(key))) return unsupported();
    return { id: boundedText(item.const), label: boundedText(item.title, item.const) };
  });
}

/** Flat MCP primitive/enum forms; unknown constraints must not be silently dropped. */
export function mcpFormFields(value: unknown): InteractionField[] {
  const schema = record(value);
  const properties = record(schema?.properties);
  if (!schema || schema.type !== 'object' || !properties || Object.keys(properties).length > 32
    || Object.keys(schema).some(key => !['$schema', 'type', 'properties', 'required', 'title', 'description', 'additionalProperties'].includes(key))
    || schema.additionalProperties !== undefined && schema.additionalProperties !== false) return unsupported();
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some(id => typeof id !== 'string' || !Object.hasOwn(properties, id))) return unsupported();
  return Object.entries(properties).map(([id, value]) => {
    fieldId(id);
    const property = record(value);
    if (!property || Object.keys(property).some(key => !['type', 'title', 'description', 'default', 'enum', 'enumNames',
      'oneOf', 'anyOf', 'items', 'minimum', 'maximum', 'minLength', 'maxLength'].includes(key))) return unsupported();
    const type = property.type;
    if (typeof type !== 'string' || !['string', 'integer', 'number', 'boolean', 'array'].includes(type)) return unsupported();
    if (property.enum !== undefined && property.oneOf !== undefined) return unsupported();
    let choices = options(property.enum ?? property.oneOf);
    if (choices && type !== 'string') return unsupported();
    if (choices && new Set(choices.map(choice => choice.id)).size !== choices.length) return unsupported();
    if (property.enumNames !== undefined) {
      if (!Array.isArray(property.enumNames) || !choices || property.enumNames.length !== choices.length) return unsupported();
      choices = choices.map((choice, index) => ({ ...choice, label: boundedText((property.enumNames as unknown[])[index]) }));
    }
    if (type === 'array') {
      if (property.enum !== undefined || property.oneOf !== undefined || property.enumNames !== undefined || property.anyOf !== undefined) return unsupported();
      const items = record(property.items);
      if (!items || items.type !== 'string' || Object.keys(items).some(key => !['type', 'enum', 'anyOf'].includes(key))) return unsupported();
      if (items.enum !== undefined && items.anyOf !== undefined) return unsupported();
      choices = options(items.enum ?? items.anyOf);
      if (!choices) return unsupported();
    } else if (property.items !== undefined || property.anyOf !== undefined) return unsupported();
    const field: InteractionField = { id, label: boundedText(property.title, id), description: boundedText(property.description),
      type: type === 'array' ? 'strings' : type as InteractionField['type'], required: required.includes(id),
      ...(choices ? { options: choices } : {}) };
    for (const [native, normalized] of [['minimum', 'min'], ['maximum', 'max'], ['minLength', 'minLength'], ['maxLength', 'maxLength']] as const) {
      const limit = property[native];
      if (limit !== undefined) {
        if (typeof limit !== 'number' || !Number.isFinite(limit)
          || native.includes('Length') && (!Number.isSafeInteger(limit) || limit < 0)) return unsupported();
        field[normalized] = limit;
      }
    }
    return field;
  });
}

/** Only plain http(s) destinations without embedded credentials reach a host. */
export function mcpElicitationUrl(value: unknown): string {
  const url = new URL(boundedText(value));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return unsupported();
  return url.href;
}
