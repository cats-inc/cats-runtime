/** Pending cards are ephemeral, but still must not display credential-shaped fields. */
export function boundedInteractionText(value: string, max = 4096): string {
  return value.length <= max ? value : `${value.slice(0, max - 14)}\n[truncated]`;
}

export function interactionInputSummary(input: unknown): string {
  if (input === undefined || input === null) return '';
  let value = input;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* Non-JSON input remains reviewable text. */ }
  }
  const redact = (entry: unknown, depth: number): unknown => {
    if (depth > 8) return '[truncated]';
    if (Array.isArray(entry)) return entry.slice(0, 32).map(item => redact(item, depth + 1))
      .concat(entry.length > 32 ? ['[truncated]'] : []);
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry);
      return Object.fromEntries(entries.slice(0, 64).map(([key, value]) => [key,
        /authorization|cookie|password|secret|(?:api[_-]?)?token|api[_-]?key/iu.test(key) ? '[REDACTED]' : redact(value, depth + 1)]
      ).concat(entries.length > 64 ? [['[truncated]', true]] : []));
    }
    return typeof entry === 'string' ? boundedInteractionText(entry).replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [REDACTED]') : entry;
  };
  const safe = redact(value, 0);
  return boundedInteractionText(typeof safe === 'string' ? safe : JSON.stringify(safe));
}
