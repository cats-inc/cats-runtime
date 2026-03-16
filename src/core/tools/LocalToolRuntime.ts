import { spawn } from 'node:child_process';
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import type { PermissionMode, WorkspaceMode } from '../types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface ToolExecutionContext {
  sessionId: string;
  cwd: string;
  workspaceMode?: WorkspaceMode;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  toolProfile?: string;
}

interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_TEXT_OUTPUT = 12_000;
const DEFAULT_READ_LINE_LIMIT = 400;
const DEFAULT_LIST_ENTRIES = 200;
const DEFAULT_GREP_MATCHES = 200;
const DEFAULT_SHELL_TIMEOUT_MS = 15_000;
const MAX_SHELL_TIMEOUT_MS = 60_000;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'target',
]);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.jar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
]);

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List files and directories under the current workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path under the workspace. Defaults to ".".' },
        recursive: { type: 'boolean', description: 'Whether to traverse nested directories.' },
        max_entries: { type: 'integer', minimum: 1, maximum: 1000 },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file.' },
        offset_line: { type: 'integer', minimum: 0 },
        limit_lines: { type: 'integer', minimum: 1, maximum: 2000 },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a UTF-8 text file inside the workspace, creating parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file.' },
        content: { type: 'string', description: 'Full file contents to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'grep',
    description: 'Search workspace text files with a regular expression.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression source.' },
        path: { type: 'string', description: 'Relative directory or file path to search.' },
        max_matches: { type: 'integer', minimum: 1, maximum: 1000 },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'run_shell',
    description: 'Run a shell command in the session workspace and capture stdout/stderr.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        timeout_ms: { type: 'integer', minimum: 1, maximum: 60000 },
      },
      required: ['command'],
    },
  },
];

const READ_ONLY_TOOLS = new Set(['list_files', 'read_file', 'grep']);
const TOOL_ORDER = new Map(TOOL_DEFINITIONS.map((tool, index) => [tool.name, index]));

function normalizeProfile(profile?: string): string {
  return (profile || 'standard').trim().toLowerCase();
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase();
}

function toRelativeDisplay(root: string, fullPath: string): string {
  const rel = relative(root, fullPath);
  return rel === '' ? '.' : rel.split('\\').join('/');
}

function shouldIgnoreDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

function looksBinaryFile(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Argument '${key}' must be a non-empty string`);
  }
  return value;
}

function readOptionalBoolean(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readOptionalInteger(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function truncate(text: string, limit = MAX_TEXT_OUTPUT): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
}

function resolveWorkspacePath(root: string, inputPath: string): string {
  const fullPath = resolve(root, inputPath);
  const rel = relative(root, fullPath);
  if (rel.startsWith('..') || rel.includes(`..${rel.includes('/') ? '/' : '\\'}`)) {
    throw new Error(`Path '${inputPath}' is outside the workspace`);
  }
  return fullPath;
}

async function walkFiles(
  root: string,
  currentPath: string,
  recursive: boolean,
  limit: number,
  results: string[],
): Promise<void> {
  if (results.length >= limit) {
    return;
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (results.length >= limit) {
      return;
    }

    if (entry.isDirectory() && shouldIgnoreDirectory(entry.name)) {
      continue;
    }

    const fullPath = resolve(currentPath, entry.name);
    results.push(`${toRelativeDisplay(root, fullPath)}${entry.isDirectory() ? '/' : ''}`);
    if (recursive && entry.isDirectory()) {
      await walkFiles(root, fullPath, recursive, limit, results);
    }
  }
}

async function readTextFile(
  fullPath: string,
  offsetLine: number,
  limitLines: number,
): Promise<string> {
  const content = await readFile(fullPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  return lines.slice(offsetLine, offsetLine + limitLines).join('\n');
}

async function collectTextFiles(
  root: string,
  targetPath: string,
  results: string[],
  limit: number,
): Promise<void> {
  if (results.length >= limit) {
    return;
  }

  const info = await stat(targetPath);
  if (info.isFile()) {
    results.push(targetPath);
    return;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (results.length >= limit) {
      return;
    }

    if (entry.isDirectory() && shouldIgnoreDirectory(entry.name)) {
      continue;
    }

    const fullPath = resolve(targetPath, entry.name);
    if (entry.isDirectory()) {
      await collectTextFiles(root, fullPath, results, limit);
      continue;
    }
    if (entry.isFile()) {
      if (looksBinaryFile(fullPath)) {
        continue;
      }
      results.push(fullPath);
    }
  }
}

async function executeShell(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ShellResult> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

export class LocalToolRuntime {
  listTools(profile?: string): ToolDefinition[] {
    const normalized = normalizeProfile(profile);
    if (normalized === 'none' || normalized === 'chat') {
      return [];
    }

    const allowed = normalized === 'read_only'
      ? TOOL_DEFINITIONS.filter((tool) => READ_ONLY_TOOLS.has(tool.name))
      : TOOL_DEFINITIONS;

    return allowed
      .slice()
      .sort((left, right) => (TOOL_ORDER.get(left.name) ?? 0) - (TOOL_ORDER.get(right.name) ?? 0));
  }

  async execute(context: ToolExecutionContext, call: ToolCall): Promise<ToolResult> {
    try {
      this.assertToolAllowed(context, call.name);
      const args = ensureObject(call.arguments);

      switch (call.name) {
        case 'list_files':
          return await this.listFiles(context, call.id, args);
        case 'read_file':
          return await this.readFile(context, call.id, args);
        case 'write_file':
          return await this.writeFile(context, call.id, args);
        case 'grep':
          return await this.grep(context, call.id, args);
        case 'run_shell':
          return await this.runShell(context, call.id, args);
        default:
          throw new Error(`Unknown tool '${call.name}'`);
      }
    } catch (error) {
      return {
        callId: call.id,
        name: call.name,
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private assertToolAllowed(context: ToolExecutionContext, name: string): void {
    const toolName = normalizeToolName(name);
    const profileTools = new Set(this.listTools(context.toolProfile).map((tool) => tool.name));
    if (!profileTools.has(toolName)) {
      throw new Error(`Tool '${toolName}' is disabled by toolProfile '${context.toolProfile || 'standard'}'`);
    }

    if (context.workspaceMode === 'read_only' && !READ_ONLY_TOOLS.has(toolName)) {
      throw new Error(`Tool '${toolName}' is not allowed in read_only workspace mode`);
    }

    const permissionMode = context.permissionMode || (context.workspaceMode === 'read_only' ? 'default' : 'skip');
    if (permissionMode === 'default' && !READ_ONLY_TOOLS.has(toolName)) {
      throw new Error(`Tool '${toolName}' requires permissionMode=skip or whitelist`);
    }

    if (permissionMode === 'whitelist') {
      const allowedTools = new Set((context.allowedTools || []).map(normalizeToolName));
      if (!allowedTools.has(toolName)) {
        throw new Error(`Tool '${toolName}' is not in the allowedTools whitelist`);
      }
    }
  }

  private async listFiles(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const fullPath = resolveWorkspacePath(context.cwd, String(args.path || '.'));
    const recursive = readOptionalBoolean(args, 'recursive');
    const maxEntries = readOptionalInteger(args, 'max_entries', DEFAULT_LIST_ENTRIES, 1, 1000);
    const results: string[] = [];
    await walkFiles(context.cwd, fullPath, recursive, maxEntries, results);
    return {
      callId,
      name: 'list_files',
      output: results.length > 0 ? results.join('\n') : '[empty]',
    };
  }

  private async readFile(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const inputPath = requireString(args, 'path');
    const fullPath = resolveWorkspacePath(context.cwd, inputPath);
    const offsetLine = readOptionalInteger(args, 'offset_line', 0, 0, Number.MAX_SAFE_INTEGER);
    const limitLines = readOptionalInteger(args, 'limit_lines', DEFAULT_READ_LINE_LIMIT, 1, 2000);
    const content = await readTextFile(fullPath, offsetLine, limitLines);
    return {
      callId,
      name: 'read_file',
      output: truncate(content),
    };
  }

  private async writeFile(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const inputPath = requireString(args, 'path');
    const fullPath = resolveWorkspacePath(context.cwd, inputPath);
    const content = typeof args.content === 'string' ? args.content : '';
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
    return {
      callId,
      name: 'write_file',
      output: `Wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${toRelativeDisplay(context.cwd, fullPath)}`,
    };
  }

  private async grep(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const patternSource = requireString(args, 'pattern');
    const rootPath = resolveWorkspacePath(context.cwd, String(args.path || '.'));
    const maxMatches = readOptionalInteger(args, 'max_matches', DEFAULT_GREP_MATCHES, 1, 1000);
    const regexp = new RegExp(patternSource, 'gm');
    const files: string[] = [];
    await collectTextFiles(context.cwd, rootPath, files, 1000);

    const matches: string[] = [];
    for (const filePath of files) {
      if (matches.length >= maxMatches) {
        break;
      }

      let content = '';
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        regexp.lastIndex = 0;
        if (!regexp.test(lines[index])) {
          continue;
        }
        matches.push(`${toRelativeDisplay(context.cwd, filePath)}:${index + 1}:${lines[index]}`);
        if (matches.length >= maxMatches) {
          break;
        }
      }
    }

    return {
      callId,
      name: 'grep',
      output: matches.length > 0 ? truncate(matches.join('\n')) : '[no matches]',
    };
  }

  private async runShell(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const command = requireString(args, 'command');
    const timeoutMs = readOptionalInteger(
      args,
      'timeout_ms',
      DEFAULT_SHELL_TIMEOUT_MS,
      1,
      MAX_SHELL_TIMEOUT_MS,
    );
    const result = await executeShell(command, context.cwd, timeoutMs);
    const sections = [
      `$ ${command}`,
      `exit_code=${result.code === null ? 'terminated' : result.code}`,
    ];
    if (result.timedOut) {
      sections.push(`timed_out_after_ms=${timeoutMs}`);
    }
    if (result.stdout.trim()) {
      sections.push(`stdout:\n${result.stdout.trimEnd()}`);
    }
    if (result.stderr.trim()) {
      sections.push(`stderr:\n${result.stderr.trimEnd()}`);
    }

    return {
      callId,
      name: 'run_shell',
      output: truncate(sections.join('\n\n')),
      isError: result.code !== 0 || result.timedOut,
    };
  }
}
