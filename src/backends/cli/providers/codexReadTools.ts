import { lstatSync, realpathSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';
import { LocalToolRuntime, type ToolDefinition } from '../../../core/tools/LocalToolRuntime.js';
import { resolveSafeWorkspacePath } from '../../../core/tools/pathSafety.js';
import type { ProviderSpawnOptions } from './types.js';

const READ_TOOLS = ['read_file', 'list_files'] as const;
type ReadToolName = typeof READ_TOOLS[number];
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_PATH_CHARS = 2048;

export interface CodexReadToolResult {
  success: boolean;
  contentItems: Array<{ type: 'inputText'; text: string }>;
}

export function grantedCodexReadTools(allowedTools: readonly string[] = []): ReadToolName[] {
  return READ_TOOLS.filter((name) => allowedTools.includes(name));
}

export function codexReadToolError(message: string): CodexReadToolResult {
  return { success: false, contentItems: [{ type: 'inputText', text: message.slice(0, 512) }] };
}

class ReadToolError extends Error {}

/** Native tools delegate here; no shell or provider-supplied cwd enters this boundary. */
export class CodexReadTools {
  private readonly runtime = new LocalToolRuntime();
  private readonly granted: ReadToolName[];
  private readonly cwd: string;
  private readonly canonicalCwd: string;
  private readonly options: ProviderSpawnOptions;

  constructor(options: ProviderSpawnOptions, localWorkspaceCwd: string | undefined) {
    if (!localWorkspaceCwd || !isAbsolute(localWorkspaceCwd)
      || resolve(localWorkspaceCwd) !== resolve(options.cwd)) {
      throw new Error('Codex read tools require a verified native local workspace mapping.');
    }
    if (options.resumeSessionId || options.forkSession) {
      throw new Error('Codex read tool registration on resume/fork is not verified; create a new session.');
    }
    this.cwd = resolve(localWorkspaceCwd);
    const info = lstatSync(this.cwd);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Codex read tools require an ordinary local workspace directory.');
    }
    this.canonicalCwd = realpathSync(this.cwd);
    this.granted = grantedCodexReadTools(options.allowedTools);
    this.options = { ...options, allowedTools: [...this.granted] };
  }

  definitions(): Array<ToolDefinition & { type: 'function' }> {
    return this.runtime.listTools('read_only')
      .filter((tool) => this.granted.some((name) => name === tool.name))
      .map((tool) => ({ ...tool, type: 'function',
        description: `${tool.description} Use a workspace-relative path. Read files up to 1 MiB; output is bounded.`,
        inputSchema: { ...tool.inputSchema, additionalProperties: false } }));
  }

  async execute(input: {
    threadId: string;
    callId: string;
    name: string;
    arguments: unknown;
    signal: AbortSignal;
  }): Promise<CodexReadToolResult> {
    try {
      this.assertActive(input.signal);
      if (!this.granted.some((name) => name === input.name)) {
        throw new ReadToolError('Tool is not in the admitted read-tool grant.');
      }
      const args = validateArguments(input.name as ReadToolName, input.arguments);
      if (await realpath(this.cwd) !== this.canonicalCwd || (await lstat(this.cwd)).isSymbolicLink()) {
        throw new ReadToolError('The admitted workspace has changed.');
      }
      const { fullPath } = await resolveSafeWorkspacePath(this.cwd, args.path);
      const info = await lstat(fullPath);
      if (input.name === 'read_file') {
        if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
          throw new ReadToolError('Read target must be an ordinary, unaliased file.');
        }
        if (info.size > MAX_FILE_BYTES) throw new ReadToolError('Read target exceeds the 1 MiB limit.');
      } else if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new ReadToolError('List target must be an ordinary directory.');
      }
      this.assertActive(input.signal);
      const result = await this.runtime.execute({
        sessionId: input.threadId,
        cwd: this.cwd,
        workspaceMode: this.options.workspaceAccess === 'read_only'
          ? 'read_only' : this.options.workspaceMode,
        permissionMode: this.options.permissionMode,
        allowedTools: [...this.granted],
        toolProfile: 'read_only',
      }, { id: input.callId, name: input.name, arguments: args });
      this.assertActive(input.signal);
      if (result.isError) return codexReadToolError('Workspace read was denied or could not be completed.');
      const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
      const text = output.length > MAX_OUTPUT_CHARS
        ? `${output.slice(0, MAX_OUTPUT_CHARS - 16)}\n...[truncated]` : output;
      return { success: true, contentItems: [{ type: 'inputText', text }] };
    } catch (error) {
      return codexReadToolError(error instanceof ReadToolError
        ? error.message : 'Workspace path is not available or is outside the admitted read boundary.');
    }
  }

  private assertActive(signal: AbortSignal): void {
    if (signal.aborted) throw new ReadToolError('Read request is no longer active.');
  }
}

function validateArguments(name: ReadToolName, value: unknown): Record<string, unknown> & { path: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReadToolError('Read-tool arguments must be an object.');
  }
  const args = value as Record<string, unknown>;
  const allowed = name === 'read_file'
    ? ['path', 'offset_line', 'limit_lines'] : ['path', 'recursive', 'max_entries'];
  if (Object.keys(args).some((key) => !allowed.includes(key))) {
    throw new ReadToolError('Unknown read-tool argument.');
  }
  const path = args.path === undefined && name === 'list_files' ? '.' : args.path;
  if (typeof path !== 'string' || !path.trim() || path.length > MAX_PATH_CHARS
    || isAbsolute(path) || win32.isAbsolute(path) || /[:\x00-\x1f]/.test(path)
    || path.split(/[\\/]/).some((segment) => /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment))) {
    throw new ReadToolError('Path must be a bounded, ordinary workspace-relative path.');
  }
  const limits = name === 'read_file'
    ? [['offset_line', 0, Number.MAX_SAFE_INTEGER], ['limit_lines', 1, 2000]] as const
    : [['max_entries', 1, 1000]] as const;
  for (const [key, min, max] of limits) {
    if (args[key] !== undefined && (typeof args[key] !== 'number'
      || !Number.isSafeInteger(args[key]) || args[key] < min || args[key] > max)) {
      throw new ReadToolError(`Argument '${key}' is outside its integer bounds.`);
    }
  }
  if (args.recursive !== undefined && typeof args.recursive !== 'boolean') {
    throw new ReadToolError("Argument 'recursive' must be a boolean.");
  }
  return { ...args, path: path.replace(/\\/g, '/') };
}
