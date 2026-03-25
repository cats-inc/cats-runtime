import type { ApiConversationMessage, ApiToolCallPart } from '../types.js';

export function extractTextParts(
  message: ApiConversationMessage,
): string[] {
  return message.parts
    .filter((part): part is Extract<ApiConversationMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter((text) => text.length > 0);
}

export function extractToolCalls(
  message: ApiConversationMessage,
): ApiToolCallPart[] {
  return message.parts.filter((part): part is ApiToolCallPart => part.type === 'tool_call');
}
