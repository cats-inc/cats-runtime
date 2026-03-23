import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import type {
  RuntimeSessionCompactionRecord,
  SessionInfo,
} from '../types.js';

const COMPACTION_RATIO = 0.7;
const MIN_RETAINED_ENTRIES = 4;
const MAX_AGGRESSIVE_PASSES = 4;
const MAX_SUMMARY_LINES = 12;
const MAX_HIGHLIGHT_LENGTH = 220;

interface RuntimeTranscriptEntry {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'compaction_summary';
  raw: Record<string, unknown>;
}

export interface RuntimeTranscriptCompactionOptions {
  sessionId: string;
  session: Pick<SessionInfo, 'messageCount' | 'totalInputTokens' | 'totalOutputTokens' | 'sourcePath'>;
  sessionBaseDir: string;
  now?: Date;
}

export interface RuntimeTranscriptCompactionResult {
  record: RuntimeSessionCompactionRecord;
  summaryText: string;
}

function normalizeRuntimePath(filePath: string): string {
  return resolve(filePath);
}

export function isRuntimeManagedTranscriptPath(
  filePath: string | undefined,
  sessionBaseDir: string,
): boolean {
  if (!filePath) {
    return false;
  }

  const normalizedFilePath = normalizeRuntimePath(filePath);
  const normalizedRuntimeRoot = `${normalizeRuntimePath(sessionBaseDir)}${sep}`;
  return normalizedFilePath.startsWith(normalizedRuntimeRoot);
}

export function canRuntimeCompactSessionTranscript(
  session: Pick<SessionInfo, 'sourcePath'>,
  sessionBaseDir: string,
): boolean {
  return isRuntimeManagedTranscriptPath(session.sourcePath, sessionBaseDir)
    && Boolean(session.sourcePath)
    && existsSync(session.sourcePath!);
}

export function compactRuntimeManagedTranscript(
  options: RuntimeTranscriptCompactionOptions,
): RuntimeTranscriptCompactionResult | undefined {
  const transcriptPath = options.session.sourcePath;
  if (!transcriptPath || !canRuntimeCompactSessionTranscript(options.session, options.sessionBaseDir)) {
    return undefined;
  }

  const compactedAt = (options.now ?? new Date()).toISOString();
  const parsed = parseRuntimeTranscript(transcriptPath);
  if (parsed.liveEntries.length <= 1 && parsed.repairedLineCount === 0) {
    return undefined;
  }

  const archivePath = writeTranscriptArchive(
    options.sessionBaseDir,
    options.sessionId,
    compactedAt,
    parsed.repairedLines,
  );

  let summaryTexts = [...parsed.summaryTexts];
  let liveEntries = [...parsed.liveEntries];
  let compactedEntryCount = 0;
  let aggressivePassCount = 0;

  while (aggressivePassCount < MAX_AGGRESSIVE_PASSES) {
    const retainedEntryCount = resolveRetainedEntryCount(liveEntries.length);
    const compactUntilIndex = liveEntries.length - retainedEntryCount;
    if (compactUntilIndex <= 0) {
      break;
    }

    const compactedEntries = liveEntries.slice(0, compactUntilIndex);
    const nextLiveEntries = liveEntries.slice(compactUntilIndex);
    if (compactedEntries.length === 0 || nextLiveEntries.length >= liveEntries.length) {
      break;
    }

    summaryTexts = mergeSummaryTexts(summaryTexts, [
      buildCompactionPassSummary(compactedEntries, {
        compactedAt,
        passNumber: aggressivePassCount + 1,
      }),
    ]);
    compactedEntryCount += compactedEntries.length;
    aggressivePassCount += 1;
    liveEntries = nextLiveEntries;

    if (liveEntries.length <= resolveRetainedEntryCount(liveEntries.length)) {
      break;
    }
  }

  if (compactedEntryCount === 0 && parsed.repairedLineCount === 0) {
    return undefined;
  }

  const summaryText = mergeSummaryTexts(summaryTexts).join('\n');
  const rewrittenEntries = [
    buildSummaryEntry(summaryText, compactedAt, {
      compactedEntryCount,
      repairedLineCount: parsed.repairedLineCount,
      aggressivePassCount,
      archivePath,
    }),
    ...liveEntries.map((entry) => entry.raw),
  ];
  writeRewrittenTranscript(transcriptPath, rewrittenEntries);

  return {
    record: {
      compactedAt,
      transcriptPath,
      baselineMessageCount: options.session.messageCount,
      baselineTotalTokens: options.session.totalInputTokens + options.session.totalOutputTokens,
      compactedEntryCount,
      retainedEntryCount: liveEntries.length,
      repairedLineCount: parsed.repairedLineCount,
      aggressivePassCount,
      archivePath,
    },
    summaryText,
  };
}

function parseRuntimeTranscript(filePath: string): {
  repairedLineCount: number;
  repairedLines: string[];
  summaryTexts: string[];
  liveEntries: RuntimeTranscriptEntry[];
} {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const repairedLines: string[] = [];
  const summaryTexts: string[] = [];
  const liveEntries: RuntimeTranscriptEntry[] = [];
  let repairedLineCount = 0;
  let previousSerialized: string | undefined;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      repairedLineCount += 1;
      continue;
    }

    const entry = normalizeRuntimeTranscriptEntry(parsed);
    if (!entry) {
      repairedLineCount += 1;
      continue;
    }

    const serialized = JSON.stringify(entry.raw);
    if (serialized === previousSerialized) {
      repairedLineCount += 1;
      continue;
    }
    previousSerialized = serialized;
    repairedLines.push(serialized);

    if (entry.type === 'compaction_summary') {
      const text = readCompactionSummaryText(entry.raw);
      if (text) {
        summaryTexts.push(text);
      }
      continue;
    }

    liveEntries.push(entry);
  }

  return {
    repairedLineCount,
    repairedLines,
    summaryTexts,
    liveEntries,
  };
}

function normalizeRuntimeTranscriptEntry(value: unknown): RuntimeTranscriptEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const raw = structuredClone(value as Record<string, unknown>);
  switch (raw.type) {
    case 'user':
    case 'assistant':
    case 'tool_use':
    case 'tool_result':
    case 'compaction_summary':
      return {
        type: raw.type,
        raw,
      };
    default:
      return undefined;
  }
}

function resolveRetainedEntryCount(entryCount: number): number {
  if (entryCount <= 1) {
    return entryCount;
  }

  return Math.min(
    entryCount,
    Math.max(MIN_RETAINED_ENTRIES, Math.ceil(entryCount * (1 - COMPACTION_RATIO))),
  );
}

function buildCompactionPassSummary(
  entries: RuntimeTranscriptEntry[],
  options: {
    compactedAt: string;
    passNumber: number;
  },
): string {
  const userHighlights = collectHighlights(entries, 'user');
  const assistantHighlights = collectHighlights(entries, 'assistant');
  const toolUsage = collectToolUsage(entries);
  const summaryLines = [
    `Runtime compaction summary (${options.compactedAt})`,
    `Pass ${options.passNumber} compacted ${entries.length} earlier transcript entries.`,
  ];

  if (userHighlights.length > 0) {
    summaryLines.push('Earlier user focus:');
    summaryLines.push(...userHighlights.map((line) => `- ${line}`));
  }

  if (assistantHighlights.length > 0) {
    summaryLines.push('Earlier assistant outcomes:');
    summaryLines.push(...assistantHighlights.map((line) => `- ${line}`));
  }

  if (toolUsage.length > 0) {
    summaryLines.push(`Earlier tool activity: ${toolUsage.join(', ')}.`);
  }

  return summaryLines.join('\n');
}

function collectHighlights(
  entries: RuntimeTranscriptEntry[],
  type: 'user' | 'assistant',
): string[] {
  const highlights: string[] = [];
  for (const entry of entries) {
    if (entry.type !== type) {
      continue;
    }
    const text = extractEntryText(entry);
    if (!text) {
      continue;
    }
    highlights.push(truncateLine(text));
    if (highlights.length >= Math.max(2, Math.floor(MAX_SUMMARY_LINES / 3))) {
      break;
    }
  }

  return highlights;
}

function collectToolUsage(entries: RuntimeTranscriptEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== 'tool_use') {
      continue;
    }
    const toolName = typeof entry.raw.toolName === 'string'
      ? entry.raw.toolName.trim()
      : '';
    if (!toolName) {
      continue;
    }
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([toolName, count]) => `${toolName} x${count}`);
}

function extractEntryText(entry: RuntimeTranscriptEntry): string | undefined {
  if (entry.type === 'user') {
    return typeof entry.raw.message === 'object'
      && entry.raw.message
      && typeof (entry.raw.message as Record<string, unknown>).content === 'string'
      ? ((entry.raw.message as Record<string, unknown>).content as string).trim()
      : undefined;
  }

  if (entry.type === 'assistant') {
    const content = typeof entry.raw.message === 'object' && entry.raw.message
      ? (entry.raw.message as Record<string, unknown>).content
      : undefined;
    if (!Array.isArray(content)) {
      return undefined;
    }

    const text = content
      .filter((part): part is { type?: string; text?: string } =>
        Boolean(part) && typeof part === 'object',
      )
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();
    return text || undefined;
  }

  return undefined;
}

function truncateLine(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_HIGHLIGHT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_HIGHLIGHT_LENGTH - 3)}...`;
}

function mergeSummaryTexts(summaryTexts: string[], nextSummaryTexts: string[] = []): string[] {
  const merged: string[] = [];
  for (const text of [...summaryTexts, ...nextSummaryTexts]) {
    const normalized = text.trim();
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }

  return merged.slice(-MAX_SUMMARY_LINES);
}

function buildSummaryEntry(
  text: string,
  compactedAt: string,
  metadata: {
    compactedEntryCount: number;
    repairedLineCount: number;
    aggressivePassCount: number;
    archivePath: string;
  },
): Record<string, unknown> {
  return {
    type: 'compaction_summary',
    text,
    timestamp: compactedAt,
    metadata: {
      compactedEntryCount: metadata.compactedEntryCount,
      repairedLineCount: metadata.repairedLineCount,
      aggressivePassCount: metadata.aggressivePassCount,
      archivePath: metadata.archivePath,
    },
  };
}

function readCompactionSummaryText(value: Record<string, unknown>): string | undefined {
  if (typeof value.text === 'string' && value.text.trim()) {
    return value.text.trim();
  }

  return undefined;
}

function writeTranscriptArchive(
  sessionBaseDir: string,
  sessionId: string,
  compactedAt: string,
  repairedLines: string[],
): string {
  const archiveDir = join(sessionBaseDir, 'compactions', sessionId);
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(
    archiveDir,
    `${compactedAt.replace(/[:.]/g, '-')}.jsonl`,
  );
  writeFileSync(archivePath, repairedLines.join('\n') + (repairedLines.length ? '\n' : ''), 'utf8');
  return archivePath;
}

function writeRewrittenTranscript(
  transcriptPath: string,
  entries: Array<Record<string, unknown>>,
): void {
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(
    transcriptPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

export function readRuntimeManagedTranscriptSize(
  transcriptPath: string | undefined,
): number | undefined {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return undefined;
  }

  return statSync(transcriptPath).size;
}
