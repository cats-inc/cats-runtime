import {
  INTERACTION_KINDS, InteractionError,
  type InteractionAnswer, type InteractionHost, type InteractionPrompt, type InteractionResponse,
} from './types.js';

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function invalid(): never {
  throw new InteractionError('interaction_invalid', 'Invalid provider interaction request or response.');
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}

export function parseInteractionHost(value: unknown): InteractionHost | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  if (!input) return invalid();
  keys(input, ['version', 'kinds', 'timeoutMs']);
  if (input.version !== 1 || !Array.isArray(input.kinds) || input.kinds.length === 0
    || input.kinds.length > INTERACTION_KINDS.length
    || input.kinds.some(kind => !INTERACTION_KINDS.includes(kind))
    || new Set(input.kinds).size !== input.kinds.length) invalid();
  const timeoutMs = input.timeoutMs ?? 1_800_000;
  if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 60_000 || Number(timeoutMs) > 86_400_000) invalid();
  return { version: 1, kinds: [...input.kinds] as InteractionHost['kinds'], timeoutMs: Number(timeoutMs) };
}

export function parseInteractionResponse(value: unknown): InteractionResponse {
  const input = record(value);
  if (!input) return invalid();
  keys(input, ['expectedRevision', 'idempotencyKey', 'answer']);
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1
    || typeof input.idempotencyKey !== 'string' || !/^[\w-]{1,128}$/.test(input.idempotencyKey)) invalid();
  const answer = record(input.answer);
  if (!answer) return invalid();
  keys(answer, ['action', 'choice', 'values', 'grants', 'scope']);
  if (typeof answer.action !== 'string' || !['accept', 'decline', 'cancel'].includes(answer.action)) invalid();
  if (answer.choice !== undefined && (typeof answer.choice !== 'string' || answer.choice.length > 128)) invalid();
  if (answer.scope !== undefined && answer.scope !== 'turn' && answer.scope !== 'session') invalid();
  if (answer.grants !== undefined && (!Array.isArray(answer.grants) || answer.grants.length > 64
    || answer.grants.some(id => typeof id !== 'string' || id.length > 128)
    || new Set(answer.grants).size !== answer.grants.length)) invalid();
  if (answer.values !== undefined) {
    const values = record(answer.values);
    if (!values || Object.keys(values).length > 32) invalid();
    for (const [id, item] of Object.entries(values)) {
      if (!id || id.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(id)) invalid();
      if (!(typeof item === 'string' || typeof item === 'boolean'
        || typeof item === 'number' && Number.isFinite(item)
        || Array.isArray(item) && item.length <= 64 && item.every(entry => typeof entry === 'string'))) invalid();
    }
  }
  if (Buffer.byteLength(JSON.stringify(answer), 'utf8') > 32_768) invalid();
  return { expectedRevision: Number(input.expectedRevision), idempotencyKey: input.idempotencyKey,
    answer: structuredClone(answer) as unknown as InteractionAnswer };
}

export function validateAnswer(prompt: InteractionPrompt, answer: InteractionAnswer): void {
  if (answer.action !== 'accept') {
    if (answer.values !== undefined || answer.grants !== undefined || answer.scope !== undefined
      || answer.choice !== undefined) invalid();
    return;
  }
  const choices = prompt.choices ?? [];
  if (choices.length && !choices.some(choice => choice.id === answer.choice)) invalid();
  if (!choices.length && answer.choice !== undefined) invalid();
  if (prompt.kind === 'permission_grant') {
    if (!answer.grants || answer.grants.some(id => !prompt.permissions?.some(option => option.id === id))) invalid();
    if (!prompt.scopes?.includes(answer.scope ?? 'turn')) invalid();
  } else if (answer.grants !== undefined || answer.scope !== undefined) invalid();
  const fields = prompt.fields ?? [];
  const values = answer.values ?? {};
  if (Object.keys(values).some(id => !fields.some(field => field.id === id))) invalid();
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined) { if (field.required) invalid(); else continue; }
    if (field.type === 'boolean' && typeof value !== 'boolean') invalid();
    if ((field.type === 'number' || field.type === 'integer')
      && (typeof value !== 'number' || !Number.isFinite(value)
        || field.type === 'integer' && !Number.isInteger(value))) invalid();
    if (typeof value === 'number' && (field.min !== undefined && value < field.min
      || field.max !== undefined && value > field.max)) invalid();
    if (field.type === 'string' && typeof value !== 'string') invalid();
    if (field.type === 'strings' && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))) invalid();
    const strings = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    for (const text of strings) {
      if (text.length < (field.minLength ?? 0) || text.length > (field.maxLength ?? 16_384)) invalid();
      if (field.options && !field.allowOther && !field.options.some(option => option.id === text)) invalid();
    }
  }
}
