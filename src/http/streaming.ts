import type { StreamEvent } from '../core/types.js';

/** Format a StreamEvent as an SSE data line */
export function formatSSE(event: StreamEvent): string {
  const data = JSON.stringify(event);
  return `data: ${data}\n\n`;
}

/** Format a StreamEvent as an NDJSON line */
export function formatNDJSON(event: StreamEvent): string {
  return JSON.stringify(event) + '\n';
}
