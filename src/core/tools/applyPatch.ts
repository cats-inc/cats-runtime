import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const BEGIN_PATCH_MARKER = '*** Begin Patch';
const END_PATCH_MARKER = '*** End Patch';
const ADD_FILE_MARKER = '*** Add File: ';
const DELETE_FILE_MARKER = '*** Delete File: ';
const UPDATE_FILE_MARKER = '*** Update File: ';
const MOVE_TO_MARKER = '*** Move to: ';
const EOF_MARKER = '*** End of File';
const CHANGE_CONTEXT_MARKER = '@@ ';
const EMPTY_CHANGE_CONTEXT_MARKER = '@@';

interface AddFileHunk {
  kind: 'add';
  path: string;
  content: string;
}

interface DeleteFileHunk {
  kind: 'delete';
  path: string;
}

interface UpdateFileChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

interface UpdateFileHunk {
  kind: 'update';
  path: string;
  movePath?: string;
  chunks: UpdateFileChunk[];
}

type PatchHunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;

export interface ApplyPatchSummary {
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface ApplyPatchResult {
  summary: ApplyPatchSummary;
  text: string;
}

export async function applyPatch(input: string, cwd: string): Promise<ApplyPatchResult> {
  const hunks = parsePatchText(input);
  if (hunks.length === 0) {
    throw new Error('No files were modified.');
  }

  const summary: ApplyPatchSummary = {
    added: [],
    modified: [],
    deleted: [],
  };
  const seen = {
    added: new Set<string>(),
    modified: new Set<string>(),
    deleted: new Set<string>(),
  };

  for (const hunk of hunks) {
    if (hunk.kind === 'add') {
      const target = resolvePatchPath(cwd, hunk.path);
      await assertDoesNotExist(target.fullPath, target.displayPath);
      await mkdir(dirname(target.fullPath), { recursive: true });
      await writeFile(target.fullPath, hunk.content, 'utf-8');
      recordSummary(summary, seen, 'added', target.displayPath);
      continue;
    }

    if (hunk.kind === 'delete') {
      const target = resolvePatchPath(cwd, hunk.path);
      await assertFileExists(target.fullPath, target.displayPath);
      await unlink(target.fullPath);
      recordSummary(summary, seen, 'deleted', target.displayPath);
      continue;
    }

    const source = resolvePatchPath(cwd, hunk.path);
    await assertFileExists(source.fullPath, source.displayPath);
    const updated = await applyUpdateHunks(source.fullPath, hunk.chunks);

    if (hunk.movePath) {
      const destination = resolvePatchPath(cwd, hunk.movePath);
      if (destination.fullPath === source.fullPath) {
        await writeFile(source.fullPath, updated, 'utf-8');
        recordSummary(summary, seen, 'modified', source.displayPath);
        continue;
      }

      await assertDoesNotExist(destination.fullPath, destination.displayPath);
      await mkdir(dirname(destination.fullPath), { recursive: true });
      await writeFile(destination.fullPath, updated, 'utf-8');
      await unlink(source.fullPath);
      recordSummary(summary, seen, 'modified', destination.displayPath);
      continue;
    }

    await writeFile(source.fullPath, updated, 'utf-8');
    recordSummary(summary, seen, 'modified', source.displayPath);
  }

  return {
    summary,
    text: formatSummary(summary),
  };
}

function recordSummary(
  summary: ApplyPatchSummary,
  seen: Record<keyof ApplyPatchSummary, Set<string>>,
  bucket: keyof ApplyPatchSummary,
  value: string,
): void {
  if (seen[bucket].has(value)) {
    return;
  }
  seen[bucket].add(value);
  summary[bucket].push(value);
}

function formatSummary(summary: ApplyPatchSummary): string {
  const lines = ['Success. Updated the following files:'];
  for (const filePath of summary.added) {
    lines.push(`A ${filePath}`);
  }
  for (const filePath of summary.modified) {
    lines.push(`M ${filePath}`);
  }
  for (const filePath of summary.deleted) {
    lines.push(`D ${filePath}`);
  }
  return lines.join('\n');
}

function parsePatchText(input: string): PatchHunk[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Invalid patch: input is empty.');
  }

  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines[0]?.trim();
  const lastLine = lines[lines.length - 1]?.trim();
  if (firstLine !== BEGIN_PATCH_MARKER) {
    throw new Error(`The first line of the patch must be '${BEGIN_PATCH_MARKER}'`);
  }
  if (lastLine !== END_PATCH_MARKER) {
    throw new Error(`The last line of the patch must be '${END_PATCH_MARKER}'`);
  }

  const hunks: PatchHunk[] = [];
  let remaining = lines.slice(1, lines.length - 1);
  let lineNumber = 2;

  while (remaining.length > 0) {
    if (remaining[0].trim() === '') {
      remaining = remaining.slice(1);
      lineNumber += 1;
      continue;
    }
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    remaining = remaining.slice(consumed);
    lineNumber += consumed;
  }

  return hunks;
}

function parseOneHunk(
  lines: string[],
  lineNumber: number,
): { hunk: PatchHunk; consumed: number } {
  const firstLine = lines[0];
  if (!firstLine) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: empty hunk`);
  }

  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const targetPath = firstLine.slice(ADD_FILE_MARKER.length).trim();
    if (!targetPath) {
      throw new Error(`Invalid patch hunk at line ${lineNumber}: Add File path must not be empty`);
    }

    const contents: string[] = [];
    let consumed = 1;
    for (const line of lines.slice(1)) {
      if (!line.startsWith('+')) {
        break;
      }
      contents.push(line.slice(1));
      consumed += 1;
    }

    if (contents.length === 0) {
      throw new Error(`Invalid patch hunk at line ${lineNumber}: Add File hunk is empty`);
    }

    return {
      hunk: {
        kind: 'add',
        path: targetPath,
        content: `${contents.join('\n')}\n`,
      },
      consumed,
    };
  }

  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    const targetPath = firstLine.slice(DELETE_FILE_MARKER.length).trim();
    if (!targetPath) {
      throw new Error(`Invalid patch hunk at line ${lineNumber}: Delete File path must not be empty`);
    }
    return {
      hunk: { kind: 'delete', path: targetPath },
      consumed: 1,
    };
  }

  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const targetPath = firstLine.slice(UPDATE_FILE_MARKER.length).trim();
    if (!targetPath) {
      throw new Error(`Invalid patch hunk at line ${lineNumber}: Update File path must not be empty`);
    }

    let remaining = lines.slice(1);
    let consumed = 1;
    let movePath: string | undefined;

    if (remaining[0]?.startsWith(MOVE_TO_MARKER)) {
      movePath = remaining[0].slice(MOVE_TO_MARKER.length).trim();
      if (!movePath) {
        throw new Error(`Invalid patch hunk at line ${lineNumber + 1}: Move to path must not be empty`);
      }
      remaining = remaining.slice(1);
      consumed += 1;
    }

    const chunks: UpdateFileChunk[] = [];
    while (remaining.length > 0) {
      if (remaining[0].trim() === '') {
        remaining = remaining.slice(1);
        consumed += 1;
        continue;
      }
      if (remaining[0].startsWith('***')) {
        break;
      }

      const parsed = parseUpdateChunk(remaining, lineNumber + consumed, chunks.length === 0);
      chunks.push(parsed.chunk);
      remaining = remaining.slice(parsed.consumed);
      consumed += parsed.consumed;
    }

    if (chunks.length === 0) {
      throw new Error(`Invalid patch hunk at line ${lineNumber}: Update File hunk is empty`);
    }

    return {
      hunk: {
        kind: 'update',
        path: targetPath,
        movePath,
        chunks,
      },
      consumed,
    };
  }

  throw new Error(
    `Invalid patch hunk at line ${lineNumber}: '${firstLine}' is not a valid hunk header`,
  );
}

function parseUpdateChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk is empty`);
  }

  let changeContext: string | undefined;
  let startIndex = 0;
  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: expected update hunk to start with '@@'`,
    );
  }

  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  };

  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk is empty`);
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }

    const marker = line[0];
    if (marker === ' ') {
      const content = line.slice(1);
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }
    if (marker === '+') {
      chunk.newLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }
    if (marker === '-') {
      chunk.oldLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }

    if (parsedLines === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber}: unexpected line '${line}' in update hunk`,
      );
    }
    break;
  }

  if (parsedLines === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk is empty`);
  }

  return {
    chunk,
    consumed: startIndex + parsedLines,
  };
}

async function applyUpdateHunks(filePath: string, chunks: UpdateFileChunk[]): Promise<string> {
  const originalContent = await readFile(filePath, 'utf-8');
  const originalLines = originalContent.split('\n');
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === '') {
    originalLines.pop();
  }

  const replacements = computeReplacements(originalLines, filePath, chunks);
  let newLines = applyReplacements(originalLines, replacements);
  if (newLines.length === 0 || newLines[newLines.length - 1] !== '') {
    newLines = [...newLines, ''];
  }
  return newLines.join('\n');
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (contextIndex === null) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${filePath}`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex =
        originalLines.length > 0 && originalLines[originalLines.length - 1] === ''
          ? originalLines.length - 1
          : originalLines.length;
      replacements.push([insertionIndex, 0, chunk.newLines]);
      continue;
    }

    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

    if (found === null && pattern[pattern.length - 1] === '') {
      pattern = pattern.slice(0, -1);
      if (newSlice[newSlice.length - 1] === '') {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (found === null) {
      throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join('\n')}`,
      );
    }

    replacements.push([found, pattern.length, newSlice]);
    lineIndex = found + pattern.length;
  }

  replacements.sort((left, right) => left[0] - right[0]);
  return replacements;
}

function applyReplacements(
  lines: string[],
  replacements: Array<[number, number, string[]]>,
): string[] {
  const result = [...lines];
  for (const [startIndex, oldLength, newLines] of [...replacements].reverse()) {
    result.splice(startIndex, oldLength, ...newLines);
  }
  return result;
}

function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  endOfFile: boolean,
): number | null {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return null;
  }

  const maxStart = lines.length - pattern.length;
  const searchStart = endOfFile && lines.length >= pattern.length ? maxStart : start;
  if (searchStart > maxStart) {
    return null;
  }

  for (const normalizer of [
    (value: string) => value,
    (value: string) => value.trimEnd(),
    (value: string) => value.trim(),
    (value: string) => normalizePunctuation(value.trim()),
  ]) {
    for (let index = searchStart; index <= maxStart; index += 1) {
      if (linesMatch(lines, pattern, index, normalizer)) {
        return index;
      }
    }
  }

  return null;
}

function linesMatch(
  lines: string[],
  pattern: string[],
  start: number,
  normalize: (value: string) => string,
): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (normalize(lines[start + index]) !== normalize(pattern[index])) {
      return false;
    }
  }
  return true;
}

function normalizePunctuation(value: string): string {
  return Array.from(value)
    .map((char) => {
      switch (char) {
        case '\u2010':
        case '\u2011':
        case '\u2012':
        case '\u2013':
        case '\u2014':
        case '\u2015':
        case '\u2212':
          return '-';
        case '\u2018':
        case '\u2019':
        case '\u201A':
        case '\u201B':
          return '\'';
        case '\u201C':
        case '\u201D':
        case '\u201E':
        case '\u201F':
          return '"';
        case '\u00A0':
        case '\u2002':
        case '\u2003':
        case '\u2004':
        case '\u2005':
        case '\u2006':
        case '\u2007':
        case '\u2008':
        case '\u2009':
        case '\u200A':
        case '\u202F':
        case '\u205F':
        case '\u3000':
          return ' ';
        default:
          return char;
      }
    })
    .join('');
}

function resolvePatchPath(
  root: string,
  inputPath: string,
): { fullPath: string; displayPath: string } {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error('Patch path must not be empty');
  }

  const fullPath = resolve(root, trimmed);
  const rel = relative(root, fullPath);
  if (rel.startsWith('..') || rel.includes(`..${rel.includes('/') ? '/' : '\\'}`)) {
    throw new Error(`Path '${inputPath}' is outside the workspace`);
  }

  return {
    fullPath,
    displayPath: rel === '' ? '.' : rel.split('\\').join('/'),
  };
}

async function assertDoesNotExist(fullPath: string, displayPath: string): Promise<void> {
  try {
    await stat(fullPath);
    throw new Error(`File already exists: ${displayPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function assertFileExists(fullPath: string, displayPath: string): Promise<void> {
  const info = await stat(fullPath);
  if (!info.isFile()) {
    throw new Error(`Patch target must be a file: ${displayPath}`);
  }
}
