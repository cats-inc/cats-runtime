import { spawn } from 'node:child_process';
import { copyFile, readdir, readFile, rmdir, stat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import path from 'node:path';
import type { PermissionMode, WorkspaceMode } from '../types.js';
import { applyPatch as applyStructuredPatch } from './applyPatch.js';
import { WorkspaceSubstrateService } from '../runtime/WorkspaceSubstrateService.js';

// path.matchesGlob — Node 22+ built-in; @types/node@20 lacks the typedef
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const matchesGlob: (filePath: string, pattern: string) => boolean = (path as any).matchesGlob;

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
const DEFAULT_GLOB_RESULTS = 200;
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
    name: 'edit_file',
    description: 'Replace exact text in a file. old_string must match precisely.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file.' },
        old_string: { type: 'string', description: 'Exact text to find and replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        allow_multiple: { type: 'boolean', description: 'Replace all occurrences if true.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'apply_patch',
    description: 'Apply a multi-file patch using the *** Begin Patch / *** End Patch format.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Patch text including *** Begin Patch and *** End Patch.' },
      },
      required: ['input'],
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
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns paths only.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts").' },
        path: { type: 'string', description: 'Starting directory, defaults to workspace root.' },
        max_results: { type: 'integer', minimum: 1, maximum: 1000 },
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
  {
    name: 'delete_file',
    description: 'Delete a file or empty directory from the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file or empty directory.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file within the workspace. Source must be a file, not a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Current relative path (must be a file).' },
        destination: { type: 'string', description: 'New relative path.' },
        overwrite: { type: 'boolean', description: 'Allow overwriting an existing destination. Defaults to false.' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file within the workspace. Source must be a file, not a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source relative path (must be a file).' },
        destination: { type: 'string', description: 'Destination relative path.' },
        overwrite: { type: 'boolean', description: 'Allow overwriting an existing destination. Defaults to false.' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'audit-workspace',
    description: 'Audit workspace collaboration substrate and return a JSON report.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        profile: { type: 'string', enum: ['minimal', 'standard', 'a2a-enabled'] },
        enabled_agents: {
          type: 'array',
          items: { type: 'string', enum: ['claude', 'gemini', 'codex'] },
        },
        include_a2a: { type: 'boolean' },
        project_type: { type: 'string', enum: ['single-project', 'monorepo'] },
        purpose: { type: 'string' },
        background: { type: 'string' },
        technology_labels: { type: 'array', items: { type: 'string' } },
        documentation_style: { type: 'string' },
      },
    },
  },
  {
    name: 'init-workspace',
    description: 'Plan or apply workspace collaboration substrate initialization and return JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        profile: { type: 'string', enum: ['minimal', 'standard', 'a2a-enabled'] },
        enabled_agents: {
          type: 'array',
          items: { type: 'string', enum: ['claude', 'gemini', 'codex'] },
        },
        include_a2a: { type: 'boolean' },
        project_type: { type: 'string', enum: ['single-project', 'monorepo'] },
        purpose: { type: 'string' },
        background: { type: 'string' },
        technology_labels: { type: 'array', items: { type: 'string' } },
        documentation_style: { type: 'string' },
        apply: { type: 'boolean' },
        actor_role: {
          type: 'string',
          enum: ['boss_cat', 'specialist_cat', 'system', 'owner', 'product_host', 'operator'],
        },
        approved: { type: 'boolean' },
      },
    },
  },
  {
    name: 'update-workspace',
    description: 'Plan or apply conservative workspace substrate updates and return JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        profile: { type: 'string', enum: ['minimal', 'standard', 'a2a-enabled'] },
        enabled_agents: {
          type: 'array',
          items: { type: 'string', enum: ['claude', 'gemini', 'codex'] },
        },
        include_a2a: { type: 'boolean' },
        project_type: { type: 'string', enum: ['single-project', 'monorepo'] },
        purpose: { type: 'string' },
        background: { type: 'string' },
        technology_labels: { type: 'array', items: { type: 'string' } },
        documentation_style: { type: 'string' },
        apply: { type: 'boolean' },
        actor_role: {
          type: 'string',
          enum: ['boss_cat', 'specialist_cat', 'system', 'owner', 'product_host', 'operator'],
        },
        approved: { type: 'boolean' },
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set(['list_files', 'read_file', 'grep', 'glob', 'audit-workspace']);
const TOOL_ORDER = new Map(TOOL_DEFINITIONS.map((tool, index) => [tool.name, index]));

const STANDARD_TOOLS = new Set([
  'list_files', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'grep', 'glob', 'run_shell',
  'audit-workspace', 'init-workspace', 'update-workspace',
]);
const EXTENDED_TOOLS = new Set([
  ...STANDARD_TOOLS, 'delete_file', 'rename_file', 'copy_file',
]);
const PROFILE_TOOLS: Record<string, Set<string>> = {
  standard: STANDARD_TOOLS,
  extended: EXTENDED_TOOLS,
  read_only: READ_ONLY_TOOLS,
  none: new Set(),
  chat: new Set(),
};

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

function readOptionalStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return strings.length > 0 ? strings : undefined;
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
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
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

async function walkGlob(
  root: string,
  currentPath: string,
  pattern: string,
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
    if (entry.isDirectory()) {
      await walkGlob(root, fullPath, pattern, limit, results);
    } else {
      const rel = toRelativeDisplay(root, fullPath);
      if (matchesGlob(rel, pattern)) {
        results.push(rel);
      }
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
  private readonly substrate = new WorkspaceSubstrateService();

  listTools(profile?: string): ToolDefinition[] {
    const normalized = normalizeProfile(profile);
    const allowed = PROFILE_TOOLS[normalized] ?? PROFILE_TOOLS.standard;
    return TOOL_DEFINITIONS
      .filter((tool) => allowed.has(tool.name))
      .sort((left, right) => (TOOL_ORDER.get(left.name) ?? 0) - (TOOL_ORDER.get(right.name) ?? 0));
  }

  async execute(context: ToolExecutionContext, call: ToolCall): Promise<ToolResult> {
    try {
      const args = ensureObject(call.arguments);
      this.assertToolAllowed(context, call.name, args);

      switch (call.name) {
        case 'list_files':
          return await this.listFiles(context, call.id, args);
        case 'read_file':
          return await this.readFile(context, call.id, args);
        case 'write_file':
          return await this.writeFile(context, call.id, args);
        case 'edit_file':
          return await this.editFile(context, call.id, args);
        case 'apply_patch':
          return await this.applyPatch(context, call.id, args);
        case 'grep':
          return await this.grep(context, call.id, args);
        case 'glob':
          return await this.globFiles(context, call.id, args);
        case 'run_shell':
          return await this.runShell(context, call.id, args);
        case 'delete_file':
          return await this.deleteFile(context, call.id, args);
        case 'rename_file':
          return await this.renameFile(context, call.id, args);
        case 'copy_file':
          return await this.copyFileTool(context, call.id, args);
        case 'audit-workspace':
        case 'init-workspace':
        case 'update-workspace':
          return await this.workspaceSubstrateOperation(context, call.id, call.name, args);
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

  private isReadOnlyCompatibleTool(name: string, args: Record<string, unknown>): boolean {
    if (READ_ONLY_TOOLS.has(name)) {
      return true;
    }

    return (name === 'init-workspace' || name === 'update-workspace')
      && args.apply !== true;
  }

  private assertToolAllowed(
    context: ToolExecutionContext,
    name: string,
    args: Record<string, unknown>,
  ): void {
    const toolName = normalizeToolName(name);
    const profileTools = new Set(this.listTools(context.toolProfile).map((tool) => tool.name));
    if (!profileTools.has(toolName)) {
      throw new Error(`Tool '${toolName}' is disabled by toolProfile '${context.toolProfile || 'standard'}'`);
    }

    const readOnlyCompatible = this.isReadOnlyCompatibleTool(toolName, args);

    if (context.workspaceMode === 'read_only' && !readOnlyCompatible) {
      throw new Error(`Tool '${toolName}' is not allowed in read_only workspace mode`);
    }

    const permissionMode = context.permissionMode || (context.workspaceMode === 'read_only' ? 'default' : 'skip');
    if (permissionMode === 'default' && !readOnlyCompatible) {
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

  private async editFile(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const inputPath = requireString(args, 'path');
    const fullPath = resolveWorkspacePath(context.cwd, inputPath);
    const oldString = requireString(args, 'old_string');
    const newString = typeof args.new_string === 'string' ? args.new_string : '';
    const allowMultiple = readOptionalBoolean(args, 'allow_multiple');

    const content = await readFile(fullPath, 'utf-8');

    let count = 0;
    let searchIndex = 0;
    while (true) {
      const found = content.indexOf(oldString, searchIndex);
      if (found === -1) break;
      count++;
      searchIndex = found + oldString.length;
    }

    if (count === 0) {
      throw new Error(`old_string not found in ${toRelativeDisplay(context.cwd, fullPath)}`);
    }

    if (count > 1 && !allowMultiple) {
      throw new Error(
        `Found ${count} occurrences; set allow_multiple=true or provide more specific old_string`,
      );
    }

    const updated = count === 1
      ? content.replace(oldString, newString)
      : content.replaceAll(oldString, newString);

    await writeFile(fullPath, updated, 'utf-8');

    const displayPath = toRelativeDisplay(context.cwd, fullPath);
    return {
      callId,
      name: 'edit_file',
      output: count === 1
        ? `Replaced 1 occurrence in ${displayPath}`
        : `Replaced ${count} occurrences in ${displayPath}`,
    };
  }

  private async applyPatch(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const input = typeof args.input === 'string'
      ? args.input
      : typeof args.patch === 'string'
        ? args.patch
        : '';
    if (!input.trim()) {
      throw new Error(`Argument 'input' must be a non-empty string`);
    }

    const result = await applyStructuredPatch(input, context.cwd);
    return {
      callId,
      name: 'apply_patch',
      output: result.text,
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

  private async globFiles(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const pattern = requireString(args, 'pattern');
    const startPath = resolveWorkspacePath(context.cwd, String(args.path || '.'));
    const maxResults = readOptionalInteger(args, 'max_results', DEFAULT_GLOB_RESULTS, 1, 1000);

    const matches: string[] = [];
    await walkGlob(context.cwd, startPath, pattern, maxResults, matches);

    return {
      callId,
      name: 'glob',
      output: matches.length > 0 ? matches.join('\n') : '[no matches]',
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

  private async deleteFile(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const inputPath = requireString(args, 'path');
    const fullPath = resolveWorkspacePath(context.cwd, inputPath);
    const displayPath = toRelativeDisplay(context.cwd, fullPath);

    const info = await stat(fullPath);
    if (info.isDirectory()) {
      const entries = await readdir(fullPath);
      if (entries.length > 0) {
        throw new Error(`Directory is not empty: ${displayPath}`);
      }
      await rmdir(fullPath);
    } else {
      await unlink(fullPath);
    }

    return {
      callId,
      name: 'delete_file',
      output: `Deleted ${displayPath}`,
    };
  }

  private async renameFile(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const sourcePath = requireString(args, 'source');
    const destPath = requireString(args, 'destination');
    const fullSource = resolveWorkspacePath(context.cwd, sourcePath);
    const fullDest = resolveWorkspacePath(context.cwd, destPath);
    const overwrite = readOptionalBoolean(args, 'overwrite');

    const sourceInfo = await stat(fullSource);
    if (!sourceInfo.isFile()) {
      throw new Error(`Source must be a file, not a directory: ${toRelativeDisplay(context.cwd, fullSource)}`);
    }

    if (!overwrite) {
      try {
        await stat(fullDest);
        throw new Error(
          `Destination already exists: ${toRelativeDisplay(context.cwd, fullDest)}; set overwrite=true to replace`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    await mkdir(dirname(fullDest), { recursive: true });
    await rename(fullSource, fullDest);

    return {
      callId,
      name: 'rename_file',
      output: `Renamed ${toRelativeDisplay(context.cwd, fullSource)} → ${toRelativeDisplay(context.cwd, fullDest)}`,
    };
  }

  private async copyFileTool(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const sourcePath = requireString(args, 'source');
    const destPath = requireString(args, 'destination');
    const fullSource = resolveWorkspacePath(context.cwd, sourcePath);
    const fullDest = resolveWorkspacePath(context.cwd, destPath);
    const overwrite = readOptionalBoolean(args, 'overwrite');

    const sourceInfo = await stat(fullSource);
    if (!sourceInfo.isFile()) {
      throw new Error(`Source must be a file, not a directory: ${toRelativeDisplay(context.cwd, fullSource)}`);
    }

    if (!overwrite) {
      try {
        await stat(fullDest);
        throw new Error(
          `Destination already exists: ${toRelativeDisplay(context.cwd, fullDest)}; set overwrite=true to replace`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    await mkdir(dirname(fullDest), { recursive: true });
    await copyFile(fullSource, fullDest);

    return {
      callId,
      name: 'copy_file',
      output: `Copied ${toRelativeDisplay(context.cwd, fullSource)} → ${toRelativeDisplay(context.cwd, fullDest)}`,
    };
  }

  private async workspaceSubstrateOperation(
    context: ToolExecutionContext,
    callId: string,
    operation: 'audit-workspace' | 'init-workspace' | 'update-workspace',
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workspacePath = resolveWorkspacePath(context.cwd, String(args.path || '.'));
    const profile = typeof args.profile === 'string'
      && ['minimal', 'standard', 'a2a-enabled'].includes(args.profile)
      ? args.profile as 'minimal' | 'standard' | 'a2a-enabled'
      : undefined;
    const enabledAgents = readOptionalStringArray(args, 'enabled_agents')
      ?.filter((agent): agent is 'claude' | 'gemini' | 'codex' =>
        agent === 'claude' || agent === 'gemini' || agent === 'codex');
    const technologyLabels = readOptionalStringArray(args, 'technology_labels');
    const actorRole = typeof args.actor_role === 'string'
      && [
        'boss_cat',
        'specialist_cat',
        'system',
        'owner',
        'product_host',
        'operator',
      ].includes(args.actor_role)
      ? args.actor_role as 'boss_cat' | 'specialist_cat' | 'system' | 'owner' | 'product_host' | 'operator'
      : undefined;

    const result = await this.substrate.execute({
      operation,
      workspacePath,
      profile,
      enabledAgents,
      includeA2A: typeof args.include_a2a === 'boolean' ? args.include_a2a : undefined,
      apply: args.apply === true,
      hints: {
        projectType: args.project_type === 'monorepo' || args.project_type === 'single-project'
          ? args.project_type
          : undefined,
        purpose: typeof args.purpose === 'string' ? args.purpose.trim() || undefined : undefined,
        background: typeof args.background === 'string' ? args.background.trim() || undefined : undefined,
        technologyLabels,
        documentationStyle: typeof args.documentation_style === 'string'
          ? args.documentation_style.trim() || undefined
          : undefined,
      },
      authorization: {
        actorRole,
        approved: args.approved === true,
      },
    });

    return {
      callId,
      name: operation,
      output: JSON.stringify(result, null, 2),
    };
  }
}
