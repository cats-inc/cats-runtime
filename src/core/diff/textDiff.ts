import type { WorkspaceSubstrateDiffStats } from '../types.js';

export interface TextDiffPreview {
  text: string;
  stats: WorkspaceSubstrateDiffStats;
}

function splitLinesForDiff(content: string): string[] {
  return content === '' ? [] : content.split('\n');
}

export function buildTextDiffPreview(
  filePath: string,
  before: string,
  after: string,
): TextDiffPreview {
  if (before === after) {
    return {
      text: `--- ${filePath}\n+++ ${filePath}\n@@ no changes @@`,
      stats: {
        changed: false,
        addedLines: 0,
        removedLines: 0,
      },
    };
  }

  const beforeLines = splitLinesForDiff(before);
  const afterLines = splitLinesForDiff(after);
  let start = 0;
  while (
    start < beforeLines.length
    && start < afterLines.length
    && beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start
    && afterEnd >= start
    && beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removed = beforeLines.slice(start, beforeEnd + 1).map((line) => `-${line}`);
  const added = afterLines.slice(start, afterEnd + 1).map((line) => `+${line}`);
  const beforeCount = Math.max(0, beforeEnd - start + 1);
  const afterCount = Math.max(0, afterEnd - start + 1);

  return {
    text: [
      `--- ${filePath}`,
      `+++ ${filePath}`,
      `@@ -${start + 1},${beforeCount} +${start + 1},${afterCount} @@`,
      ...removed,
      ...added,
    ].join('\n'),
    stats: {
      changed: true,
      addedLines: added.length,
      removedLines: removed.length,
    },
  };
}
