const MAX_STDERR_LINES = 12;
const HEAD_STDERR_LINES = 4;
const OMITTED_MARKER = /^… (\d+) more lines …$/u;

/**
 * Appends a provider's stderr text to `lines`, keeping the first lines and the
 * most recent ones. A CLI often states the failure first and then lists
 * details, as Junie prints "Invalid model: X" before every available model, so
 * keeping only the tail can lose the cause.
 */
export function appendStderrLines(lines: string[], text: string): void {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  if (lines.length <= MAX_STDERR_LINES) return;

  let rest = lines.slice(HEAD_STDERR_LINES);
  const marker = OMITTED_MARKER.exec(rest[0] ?? '');
  let omitted = marker ? Number(marker[1]) : 0;
  if (marker) rest = rest.slice(1);
  const keep = MAX_STDERR_LINES - HEAD_STDERR_LINES - 1;
  omitted += Math.max(0, rest.length - keep);
  lines.splice(
    HEAD_STDERR_LINES,
    lines.length - HEAD_STDERR_LINES,
    `… ${omitted} more lines …`,
    ...rest.slice(-keep),
  );
}
