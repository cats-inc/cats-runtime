import { spawn } from 'node:child_process';
import { copyFile, readdir, readFile, rmdir, stat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import path from 'node:path';
import type { PermissionMode, WorkspaceMode } from '../types.js';
import { applyPatch as applyStructuredPatch } from './applyPatch.js';
import {
  assertDistinctWorkspaceFiles,
  assertSafeExistingFileMutation,
  resolveSafeWorkspacePath,
  toRelativeDisplay,
} from './pathSafety.js';
import { WorkspaceSubstrateService } from '../runtime/WorkspaceSubstrateService.js';
import { RuntimeDeliveryService } from '../runtime/RuntimeDeliveryService.js';
import { RuntimeManagementService } from '../management/RuntimeManagementService.js';
import type { RuntimeManagementDomain, RuntimeManagementAction } from '../management/types.js';

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
    description: 'Audit workspace collaboration substrate and return a read-only JSON report.',
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
    description: 'Plan or apply workspace collaboration substrate initialization and return JSON contract/plan/approval payloads.',
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
    description: 'Plan or apply conservative workspace substrate updates and return JSON contract/plan/approval payloads.',
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
    name: 'audit-delivery-target',
    description: 'Inspect artifact/repo/preview delivery capability and return a machine-readable JSON audit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        session_id: { type: 'string' },
        artifact_ids: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array', items: { type: 'object' } },
        services: { type: 'array', items: { type: 'object' } },
        include_session_artifacts: { type: 'boolean' },
        include_session_services: { type: 'boolean' },
      },
    },
  },
  {
    name: 'publish-artifacts',
    description: 'Preview or apply artifact export/publication into a target directory and return JSON metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        session_id: { type: 'string' },
        artifact_ids: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array', items: { type: 'object' } },
        directory: { type: 'string', description: 'Relative output directory for exported artifacts.' },
        manifest_file_name: { type: 'string' },
        public_base_url: { type: 'string' },
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
    name: 'inspect-repo-status',
    description: 'Inspect Git status for a workspace and return machine-readable delivery metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        session_id: { type: 'string' },
      },
    },
  },
  {
    name: 'create-commit',
    description: 'Preview or apply Git commit creation with approval-aware JSON output.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        session_id: { type: 'string' },
        message: { type: 'string' },
        stage_all: {
          type: 'boolean',
          description: 'Explicitly stage all tracked and untracked changes before commit.',
        },
        allow_empty: { type: 'boolean' },
        apply: { type: 'boolean' },
        actor_role: {
          type: 'string',
          enum: ['boss_cat', 'specialist_cat', 'system', 'owner', 'product_host', 'operator'],
        },
        approved: { type: 'boolean' },
      },
      required: ['message'],
    },
  },
  {
    name: 'push-branch',
    description: 'Preview or apply Git branch push with approval-aware JSON output.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        session_id: { type: 'string' },
        remote: { type: 'string' },
        branch: { type: 'string' },
        set_upstream: { type: 'boolean' },
        force_with_lease: { type: 'boolean' },
        apply: { type: 'boolean' },
        actor_role: {
          type: 'string',
          enum: ['boss_cat', 'specialist_cat', 'system', 'owner', 'product_host', 'operator'],
        },
        approved: { type: 'boolean' },
      },
    },
  },

  // Management adapter tools
  {
    name: 'audit-review-target',
    description: 'Check forge/review readiness (GitHub CLI auth, repo context) and return a machine-readable JSON audit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative workspace path. Defaults to ".".' },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'open-pull-request',
    description: 'Preview or create a pull request via the runtime management adapter.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        base: { type: 'string' },
        apply: { type: 'boolean' },
        actor_class: { type: 'string', enum: ['system', 'owner', 'operator', 'service'] },
        approval_ref: { type: 'string' },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'inspect-pull-request',
    description: 'Inspect a pull request via the runtime management adapter.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        number: { type: ['number', 'string'] },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'wait-review-checks',
    description: 'Poll PR checks with bounded timeout. Returns operation ID for resumption if checks do not complete.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        number: { type: ['number', 'string'] },
        timeout_ms: { type: 'number' },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'audit-deployment-target',
    description: 'Check deployment CLI readiness (auth, project context) and return a machine-readable JSON audit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'create-deployment',
    description: 'Preview or trigger a deployment via the runtime management adapter.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        apply: { type: 'boolean' },
        actor_class: { type: 'string', enum: ['system', 'owner', 'operator', 'service'] },
        approval_ref: { type: 'string' },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'inspect-deployment',
    description: 'Inspect deployment or service status.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        adapter: { type: 'string' },
      },
    },
  },
  {
    name: 'read-deployment-logs',
    description: 'Read deployment logs from the runtime management adapter.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        service_id: { type: 'string' },
        adapter: { type: 'string' },
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set([
  'list_files',
  'read_file',
  'grep',
  'glob',
  'audit-workspace',
  'audit-delivery-target',
  'inspect-repo-status',
  'audit-review-target',
  'inspect-pull-request',
  'wait-review-checks',
  'audit-deployment-target',
  'inspect-deployment',
  'read-deployment-logs',
]);
const TOOL_ORDER = new Map(TOOL_DEFINITIONS.map((tool, index) => [tool.name, index]));

const STANDARD_TOOLS = new Set([
  'list_files', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'grep', 'glob', 'run_shell',
  'audit-workspace', 'init-workspace', 'update-workspace',
  'audit-delivery-target', 'publish-artifacts', 'inspect-repo-status', 'create-commit', 'push-branch',
  'audit-review-target', 'open-pull-request', 'inspect-pull-request', 'wait-review-checks',
  'audit-deployment-target', 'create-deployment', 'inspect-deployment', 'read-deployment-logs',
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
const DELIVERY_ACTOR_ROLES = new Set([
  'boss_cat',
  'specialist_cat',
  'system',
  'owner',
  'product_host',
  'operator',
]);

function normalizeProfile(profile?: string): string {
  return (profile || 'standard').trim().toLowerCase();
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase();
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

function parseToolArtifacts(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
    if (!id) {
      return [];
    }

    return [{
      id,
      kind: typeof record.kind === 'string' ? record.kind.trim() || undefined : undefined,
      label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
      path: typeof record.path === 'string' ? record.path.trim() || undefined : undefined,
      uri: typeof record.uri === 'string' ? record.uri.trim() || undefined : undefined,
      mediaType: typeof record.mediaType === 'string' ? record.mediaType.trim() || undefined : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt.trim() || undefined : undefined,
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    }];
  });
}

function parseToolServices(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
    if (!id) {
      return [];
    }

    return [{
      id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id,
      url: typeof record.url === 'string' ? record.url.trim() || undefined : undefined,
      status: typeof record.status === 'string' ? record.status.trim() || undefined : undefined,
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    }];
  });
}

function truncate(text: string, limit = MAX_TEXT_OUTPUT): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
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

    if (entry.isSymbolicLink()) {
      continue;
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

    if (entry.isSymbolicLink()) {
      continue;
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

    if (entry.isSymbolicLink()) {
      continue;
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
  private readonly delivery = new RuntimeDeliveryService({});
  private management?: RuntimeManagementService;

  setManagementService(service: RuntimeManagementService): void {
    this.management = service;
  }

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
        case 'audit-delivery-target':
        case 'publish-artifacts':
        case 'inspect-repo-status':
        case 'create-commit':
        case 'push-branch':
          return await this.deliveryOperation(context, call.id, call.name, args);
        case 'audit-review-target':
          return await this.managementOperation(context, call.id, 'review', 'audit_review_target', args);
        case 'open-pull-request':
          return await this.managementOperation(context, call.id, 'review', 'open_pull_request', args);
        case 'inspect-pull-request':
          return await this.managementOperation(context, call.id, 'review', 'inspect_pull_request', args);
        case 'wait-review-checks':
          return await this.managementOperation(context, call.id, 'review', 'wait_review_checks', args);
        case 'audit-deployment-target':
          return await this.managementOperation(context, call.id, 'deployment', 'audit_deployment_target', args);
        case 'create-deployment':
          return await this.managementOperation(context, call.id, 'deployment', 'create_deployment', args);
        case 'inspect-deployment':
          return await this.managementOperation(context, call.id, 'deployment', 'inspect_deployment', args);
        case 'read-deployment-logs':
          return await this.managementOperation(context, call.id, 'deployment', 'read_deployment_logs', args);
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

    return (
      (name === 'init-workspace' || name === 'update-workspace')
      && args.apply !== true
    ) || (
      (name === 'publish-artifacts' || name === 'create-commit' || name === 'push-branch')
      && args.apply !== true
    );
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
    const fullPath = (await resolveSafeWorkspacePath(context.cwd, String(args.path || '.'))).fullPath;
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
    const { fullPath } = await resolveSafeWorkspacePath(context.cwd, inputPath);
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
    const { fullPath, displayPath } = await resolveSafeWorkspacePath(context.cwd, inputPath);
    const content = typeof args.content === 'string' ? args.content : '';
    try {
      await assertSafeExistingFileMutation(fullPath, displayPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
    return {
      callId,
      name: 'write_file',
      output: `Wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${displayPath}`,
    };
  }

  private async editFile(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const inputPath = requireString(args, 'path');
    const { fullPath, displayPath } = await resolveSafeWorkspacePath(context.cwd, inputPath);
    const oldString = requireString(args, 'old_string');
    const newString = typeof args.new_string === 'string' ? args.new_string : '';
    const allowMultiple = readOptionalBoolean(args, 'allow_multiple');

    await assertSafeExistingFileMutation(fullPath, displayPath);
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
      throw new Error(`old_string not found in ${displayPath}`);
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
    const rootPath = (await resolveSafeWorkspacePath(context.cwd, String(args.path || '.'))).fullPath;
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
    const startPath = (await resolveSafeWorkspacePath(context.cwd, String(args.path || '.'))).fullPath;
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
    const { fullPath, displayPath } = await resolveSafeWorkspacePath(context.cwd, inputPath);

    const info = await stat(fullPath);
    if (info.isDirectory()) {
      const entries = await readdir(fullPath);
      if (entries.length > 0) {
        throw new Error(`Directory is not empty: ${displayPath}`);
      }
      await rmdir(fullPath);
    } else {
      await assertSafeExistingFileMutation(fullPath, displayPath);
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
    const { fullPath: fullSource, displayPath: sourceDisplayPath } = await resolveSafeWorkspacePath(context.cwd, sourcePath);
    const { fullPath: fullDest, displayPath: destinationDisplayPath } = await resolveSafeWorkspacePath(context.cwd, destPath);
    const overwrite = readOptionalBoolean(args, 'overwrite');

    const sourceInfo = await stat(fullSource);
    if (!sourceInfo.isFile()) {
      throw new Error(`Source must be a file, not a directory: ${sourceDisplayPath}`);
    }
    await assertSafeExistingFileMutation(fullSource, sourceDisplayPath);

    if (!overwrite) {
      try {
        await stat(fullDest);
        throw new Error(
          `Destination already exists: ${destinationDisplayPath}; set overwrite=true to replace`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } else {
      try {
        await assertDistinctWorkspaceFiles(
          fullSource,
          sourceDisplayPath,
          fullDest,
          destinationDisplayPath,
        );
        await assertSafeExistingFileMutation(fullDest, destinationDisplayPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    await mkdir(dirname(fullDest), { recursive: true });
    await rename(fullSource, fullDest);

    return {
      callId,
      name: 'rename_file',
      output: `Renamed ${sourceDisplayPath} → ${destinationDisplayPath}`,
    };
  }

  private async copyFileTool(
    context: ToolExecutionContext,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const sourcePath = requireString(args, 'source');
    const destPath = requireString(args, 'destination');
    const { fullPath: fullSource, displayPath: sourceDisplayPath } = await resolveSafeWorkspacePath(context.cwd, sourcePath);
    const { fullPath: fullDest, displayPath: destinationDisplayPath } = await resolveSafeWorkspacePath(context.cwd, destPath);
    const overwrite = readOptionalBoolean(args, 'overwrite');

    const sourceInfo = await stat(fullSource);
    if (!sourceInfo.isFile()) {
      throw new Error(`Source must be a file, not a directory: ${sourceDisplayPath}`);
    }

    if (!overwrite) {
      try {
        await stat(fullDest);
        throw new Error(
          `Destination already exists: ${destinationDisplayPath}; set overwrite=true to replace`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } else {
      try {
        await assertDistinctWorkspaceFiles(
          fullSource,
          sourceDisplayPath,
          fullDest,
          destinationDisplayPath,
        );
        await assertSafeExistingFileMutation(fullDest, destinationDisplayPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    await mkdir(dirname(fullDest), { recursive: true });
    await copyFile(fullSource, fullDest);

    return {
      callId,
      name: 'copy_file',
      output: `Copied ${sourceDisplayPath} → ${destinationDisplayPath}`,
    };
  }

  private async workspaceSubstrateOperation(
    context: ToolExecutionContext,
    callId: string,
    operation: 'audit-workspace' | 'init-workspace' | 'update-workspace',
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workspacePath = (await resolveSafeWorkspacePath(context.cwd, String(args.path || '.'))).fullPath;
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

  private async deliveryOperation(
    context: ToolExecutionContext,
    callId: string,
    operation: 'audit-delivery-target' | 'publish-artifacts' | 'inspect-repo-status' | 'create-commit' | 'push-branch',
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workspacePath = (await resolveSafeWorkspacePath(
      context.cwd,
      String(args.path || '.'),
    )).fullPath;
    const actorRole = typeof args.actor_role === 'string' && DELIVERY_ACTOR_ROLES.has(args.actor_role)
      ? args.actor_role as 'boss_cat' | 'specialist_cat' | 'system' | 'owner' | 'product_host' | 'operator'
      : undefined;

    const result = await this.delivery.execute({
      action: operation,
      workspacePath,
      sessionId: typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : undefined,
      artifactIds: readOptionalStringArray(args, 'artifact_ids'),
      artifacts: parseToolArtifacts(args.artifacts),
      services: parseToolServices(args.services),
      apply: args.apply === true,
      authorization: actorRole || args.approved === true
        ? {
            actorRole,
            approved: args.approved === true,
          }
        : undefined,
      publication: operation === 'publish-artifacts'
        ? {
            directory: typeof args.directory === 'string' && args.directory.trim()
              ? (await resolveSafeWorkspacePath(workspacePath, args.directory)).fullPath
              : undefined,
            manifestFileName: typeof args.manifest_file_name === 'string' && args.manifest_file_name.trim()
              ? args.manifest_file_name.trim()
              : undefined,
            publicBaseUrl: typeof args.public_base_url === 'string' && args.public_base_url.trim()
              ? args.public_base_url.trim()
              : undefined,
          }
        : undefined,
      repo: operation === 'create-commit' || operation === 'push-branch'
        || operation === 'inspect-repo-status'
        ? {
            message: typeof args.message === 'string' && args.message.trim() ? args.message.trim() : undefined,
            stageAll: typeof args.stage_all === 'boolean' ? args.stage_all : undefined,
            allowEmpty: typeof args.allow_empty === 'boolean' ? args.allow_empty : undefined,
            remote: typeof args.remote === 'string' && args.remote.trim() ? args.remote.trim() : undefined,
            branch: typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : undefined,
            setUpstream: typeof args.set_upstream === 'boolean' ? args.set_upstream : undefined,
            forceWithLease: typeof args.force_with_lease === 'boolean' ? args.force_with_lease : undefined,
          }
        : undefined,
      preview: {
        includeSessionArtifacts: typeof args.include_session_artifacts === 'boolean'
          ? args.include_session_artifacts
          : undefined,
        includeSessionServices: typeof args.include_session_services === 'boolean'
          ? args.include_session_services
          : undefined,
      },
    });

    return {
      callId,
      name: operation,
      output: JSON.stringify(result, null, 2),
    };
  }

  private async managementOperation(
    context: ToolExecutionContext,
    callId: string,
    domain: RuntimeManagementDomain,
    action: RuntimeManagementAction,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!this.management) {
      return {
        callId,
        name: `${domain}-${action}`,
        output: 'Management service not available.',
        isError: true,
      };
    }

    const workspacePath = (await resolveSafeWorkspacePath(
      context.cwd,
      String(args.path || '.'),
    )).fullPath;

    const actorClass = typeof args.actor_class === 'string'
      && ['system', 'owner', 'operator', 'service'].includes(args.actor_class)
      ? args.actor_class as 'system' | 'owner' | 'operator' | 'service'
      : undefined;
    const approvalRef = typeof args.approval_ref === 'string' && args.approval_ref.trim()
      ? args.approval_ref.trim()
      : undefined;

    const target: Record<string, unknown> = {};
    if (typeof args.title === 'string') target.title = args.title;
    if (typeof args.body === 'string') target.body = args.body;
    if (typeof args.base === 'string') target.base = args.base;
    if (args.number !== undefined) target.number = args.number;
    if (typeof args.timeout_ms === 'number') target.timeoutMs = args.timeout_ms;
    if (typeof args.service_id === 'string') target.serviceId = args.service_id;
    if (typeof args.format === 'string') target.format = args.format;

    const result = await this.management.execute({
      domain,
      action,
      adapter: typeof args.adapter === 'string' ? args.adapter : undefined,
      workspacePath,
      sessionId: typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : undefined,
      apply: args.apply === true,
      authorization: actorClass || approvalRef
        ? { actorClass, approvalRef }
        : undefined,
      target: Object.keys(target).length > 0 ? target : undefined,
    });

    return {
      callId,
      name: `${domain}-${action}`,
      output: JSON.stringify(result, null, 2),
    };
  }
}
