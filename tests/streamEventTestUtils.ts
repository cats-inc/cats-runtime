export function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function stripAdditiveContentBlocks<T extends { type?: unknown }>(events: readonly T[]): T[] {
  return events.filter((event) => event?.type !== 'content_block');
}

export function parseCoreNdjson(text: string): Array<Record<string, unknown>> {
  return stripAdditiveContentBlocks(parseNdjson(text));
}
