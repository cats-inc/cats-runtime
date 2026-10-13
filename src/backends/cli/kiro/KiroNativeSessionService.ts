import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import type { ProviderCommandConfig } from '../config.js';
import { isWslDistroRunning, type WslDistroInspector } from '../discovery/wslDiscovery.js';
import {
  spawnCommandRunner,
  type CommandRunner,
  type CommandRunnerOptions,
} from '../pythonScripts.js';
import { createRuntimeAdapter, quoteForBash, type RuntimeAdapter } from '../runtime/runtime.js';

export interface KiroNativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export interface KiroHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export type KiroCommandRunner = CommandRunner;

export interface KiroSessionListOptions {
  startIfNeeded?: boolean;
}

export interface KiroNativeSessionServiceOptions {
  commandConfig: ProviderCommandConfig;
  /** Kiro V3 session store, a runtime-side path; defaults to `~/.kiro/sessions`. */
  sessionsDir?: string;
  runner?: KiroCommandRunner;
  wslInspector?: WslDistroInspector;
}

/**
 * Kiro V3 keeps one directory per session under `~/.kiro/sessions/<workspace
 * hash>/<session id>/`, with `session.json` (title, workspace, model, effort)
 * and `messages.jsonl` (the transcript). `kiro-cli chat --list-sessions` only
 * enumerates the current directory, and its `--all-cwds` form spans the V1/V2
 * stores alone (Kiro 2.30.0), so sessions are enumerated and read from the
 * store directly. Deletion goes through `kiro-cli chat --delete-session`, which
 * also maintains Kiro's session index.
 */
export const DEFAULT_KIRO_SESSIONS_DIR = '~/.kiro/sessions';

/** The V3 store schema the transcript reader understands (`session.json` `schemaVersion`). */
const SUPPORTED_SESSION_SCHEMA_MAJOR = 1;
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const V2_STORE_DIR = 'cli';
const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';

export interface KiroStoreSessionMeta {
  id: string;
  schemaVersion?: string;
  title?: string;
  workspacePath?: string;
  createdAt?: string;
  lastModifiedAt?: string;
  modelId?: string;
  effortLevel?: string;
}

interface KiroStoreEntry {
  meta: KiroStoreSessionMeta;
  userMessageCount: number;
}

interface KiroStoreSession {
  meta: KiroStoreSessionMeta;
  messagesJsonl: string;
}

interface KiroSessionStore {
  readAll(): Promise<KiroStoreEntry[]>;
  read(sessionId: string): Promise<KiroStoreSession | null>;
}

export class KiroNativeSessionService {
  private readonly commandConfig: ProviderCommandConfig;
  private readonly runtime: RuntimeAdapter;
  private readonly runner: KiroCommandRunner;
  private readonly wslInspector: WslDistroInspector;
  private readonly store: KiroSessionStore;

  constructor(options: KiroNativeSessionServiceOptions) {
    this.commandConfig = options.commandConfig;
    this.runtime = createRuntimeAdapter(options.commandConfig.runtime);
    this.runner = options.runner || spawnCommandRunner;
    this.wslInspector = options.wslInspector || isWslDistroRunning;
    const sessionsDir = options.sessionsDir || DEFAULT_KIRO_SESSIONS_DIR;
    this.store = this.runtime.mode === 'native'
      ? new NativeKiroSessionStore(expandHomeDir(sessionsDir))
      : new ShellKiroSessionStore(this.runtime, this.runner, sessionsDir);
  }

  async listAllSessions(
    options: KiroSessionListOptions = {},
  ): Promise<KiroNativeSessionSummary[]> {
    if (!(await this.shouldStartDiscovery(options))) {
      return [];
    }

    const sessions: KiroNativeSessionSummary[] = [];
    for (const { meta, userMessageCount } of await this.store.readAll()) {
      // A session without a workspace cannot be matched to a Cats session.
      if (!meta.workspacePath) continue;
      sessions.push({
        providerSessionId: meta.id,
        cwd: this.runtime.toHostPath(meta.workspacePath),
        summary: meta.title?.trim() || 'Untitled Session',
        messageCount: userMessageCount,
        lastActivity: meta.lastModifiedAt || meta.createdAt,
        model: meta.modelId,
      });
    }

    sessions.sort((a, b) => activityEpoch(b.lastActivity) - activityEpoch(a.lastActivity));
    return sessions;
  }

  async listSessions(
    cwd: string,
    options: KiroSessionListOptions = {},
  ): Promise<KiroNativeSessionSummary[]> {
    const workspace = this.workspaceKey(cwd);
    return (await this.listAllSessions(options)).filter(
      (session) => this.workspaceKey(session.cwd) === workspace,
    );
  }

  async loadHistory(providerSessionId: string): Promise<KiroHistoryMessage[]> {
    assertSessionId(providerSessionId);
    const session = await this.store.read(providerSessionId);
    if (!session) return [];
    assertSupportedSchema(session.meta);
    return parseKiroMessages(session.messagesJsonl);
  }

  async deleteSession(providerSessionId: string): Promise<boolean> {
    assertSessionId(providerSessionId);
    const result = await this.runKiroResult(['chat', '--delete-session', providerSessionId]);
    return result.code === 0;
  }

  private workspaceKey(cwd: string): string {
    if (!cwd.trim()) {
      throw new Error('cwd is required');
    }
    const normalized = this.runtime.toRuntimePath(cwd).replace(/\/+$/, '');
    // Windows paths compare case-insensitively; Kiro itself records them in either case.
    return this.runtime.mode === 'native' && process.platform === 'win32'
      ? normalized.toLowerCase()
      : normalized;
  }

  private async shouldStartDiscovery(
    options: KiroSessionListOptions,
  ): Promise<boolean> {
    if (options.startIfNeeded !== false || this.runtime.mode !== 'wsl') {
      return true;
    }

    return this.wslInspector(this.runtime.distro || 'Ubuntu');
  }

  private async runKiroResult(args: string[]) {
    if (this.runtime.mode === 'native') {
      const command = this.commandConfig.path;
      const options: CommandRunnerOptions = /\.(cmd|bat)$/i.test(extname(command.trim()))
        ? { shell: true }
        : {};
      return this.runner(command, args, options);
    }

    const script = [this.commandConfig.path, ...args].map(quoteForBash).join(' ');
    const { command, args: shellArgs } = this.runtime.buildShellInvocation(script);
    return this.runner(command, shellArgs, {});
  }
}

/** Reads the store from the host filesystem. */
class NativeKiroSessionStore implements KiroSessionStore {
  constructor(private readonly root: string) {}

  async readAll(): Promise<KiroStoreEntry[]> {
    const entries: KiroStoreEntry[] = [];
    for (const dir of await this.sessionDirs()) {
      const meta = parseSessionMeta(await readTextFile(join(dir, 'session.json')));
      if (!meta) continue;
      const transcript = await readTextFile(join(dir, 'messages.jsonl'));
      entries.push({ meta, userMessageCount: countUserMessages(transcript ?? '') });
    }
    return entries;
  }

  async read(sessionId: string): Promise<KiroStoreSession | null> {
    for (const group of await this.groupDirs()) {
      const dir = join(group, sessionId);
      const meta = parseSessionMeta(await readTextFile(join(dir, 'session.json')));
      if (!meta) continue;
      return { meta, messagesJsonl: (await readTextFile(join(dir, 'messages.jsonl'))) ?? '' };
    }
    return null;
  }

  private async groupDirs(): Promise<string[]> {
    let names: Dirent[];
    try {
      names = await readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    return names
      .filter((entry) => entry.isDirectory() && entry.name !== V2_STORE_DIR)
      .map((entry) => join(this.root, entry.name));
  }

  private async sessionDirs(): Promise<string[]> {
    const dirs: string[] = [];
    for (const group of await this.groupDirs()) {
      let names: Dirent[];
      try {
        names = await readdir(group, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of names) {
        if (entry.isDirectory() && SESSION_ID_RE.test(entry.name)) {
          dirs.push(join(group, entry.name));
        }
      }
    }
    return dirs;
  }
}

/** Reads the store inside a WSL distro or Docker container through its shell. */
class ShellKiroSessionStore implements KiroSessionStore {
  constructor(
    private readonly runtime: RuntimeAdapter,
    private readonly runner: KiroCommandRunner,
    private readonly root: string,
  ) {}

  async readAll(): Promise<KiroStoreEntry[]> {
    const output = await this.runScript([
      `root=${bashPath(this.root)}`,
      `for f in "$root"/*/*/session.json; do`,
      `  case "$f" in "$root"/${V2_STORE_DIR}/*) continue;; esac`,
      '  [ -f "$f" ] || continue',
      `  cat "$f"; printf '${FIELD_SEPARATOR}'`,
      `  grep -c '"payload":{"type":"user"' "\${f%/session.json}/messages.jsonl" 2>/dev/null; printf '${RECORD_SEPARATOR}'`,
      'done',
    ]);
    const entries: KiroStoreEntry[] = [];
    for (const record of output.split(RECORD_SEPARATOR)) {
      const [metaText, countText] = record.split(FIELD_SEPARATOR);
      const meta = parseSessionMeta(metaText);
      if (!meta) continue;
      const count = Number.parseInt((countText ?? '').trim(), 10);
      entries.push({ meta, userMessageCount: Number.isFinite(count) ? count : 0 });
    }
    return entries;
  }

  async read(sessionId: string): Promise<KiroStoreSession | null> {
    const output = await this.runScript([
      `root=${bashPath(this.root)}`,
      `for d in "$root"/*/${quoteForBash(sessionId)}; do`,
      `  case "$d" in "$root"/${V2_STORE_DIR}/*) continue;; esac`,
      '  [ -f "$d/session.json" ] || continue',
      `  cat "$d/session.json"; printf '${FIELD_SEPARATOR}'; cat "$d/messages.jsonl" 2>/dev/null`,
      '  exit 0',
      'done',
    ]);
    const [metaText, messagesJsonl] = output.split(FIELD_SEPARATOR);
    const meta = parseSessionMeta(metaText);
    return meta ? { meta, messagesJsonl: messagesJsonl ?? '' } : null;
  }

  private async runScript(lines: string[]): Promise<string> {
    const { command, args } = this.runtime.buildShellInvocation(lines.join('\n'));
    const result = await this.runner(command, args, {});
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Kiro session store read failed with code ${result.code}`);
    }
    return result.stdout;
  }
}

function bashPath(path: string): string {
  if (path === '~') return '"$HOME"';
  if (path.startsWith('~/')) return `"$HOME"/${quoteForBash(path.slice(2))}`;
  return quoteForBash(path);
}

function expandHomeDir(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function assertSessionId(providerSessionId: string): void {
  if (!SESSION_ID_RE.test(providerSessionId)) {
    throw new Error('Invalid Kiro session id.');
  }
}

function assertSupportedSchema(meta: KiroStoreSessionMeta): void {
  const major = Number.parseInt((meta.schemaVersion ?? '').split('.')[0] ?? '', 10);
  if (major !== SUPPORTED_SESSION_SCHEMA_MAJOR) {
    throw new Error(
      `Unsupported Kiro session schema ${meta.schemaVersion ?? '(none)'}; `
      + `expected ${SUPPORTED_SESSION_SCHEMA_MAJOR}.x.`,
    );
  }
}

function activityEpoch(iso: string | undefined): number {
  const epoch = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(epoch) ? epoch : 0;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parseSessionMeta(text: string | null | undefined): KiroStoreSessionMeta | null {
  if (!text?.trim()) return null;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (!document || typeof document !== 'object') return null;
  const record = document as Record<string, unknown>;
  const id = readString(record.id);
  if (!id || !SESSION_ID_RE.test(id)) return null;
  const workspacePaths = Array.isArray(record.workspacePaths) ? record.workspacePaths : [];
  return {
    id,
    schemaVersion: readString(record.schemaVersion),
    title: readString(record.title),
    workspacePath: readString(workspacePaths[0]),
    createdAt: readString(record.createdAt),
    lastModifiedAt: readString(record.lastModifiedAt),
    modelId: readString(record.modelId),
    effortLevel: readString(record.effortLevel),
  };
}

interface KiroMessageEntry {
  timestamp?: string;
  payload?: {
    type?: string;
    content?: unknown;
    operationType?: string;
  };
}

function parseMessageEntries(jsonl: string): KiroMessageEntry[] {
  const entries: KiroMessageEntry[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as unknown;
      if (entry && typeof entry === 'object') {
        entries.push(entry as KiroMessageEntry);
      }
    } catch {
      // A partially written trailing line is not a transcript entry.
    }
  }
  return entries;
}

export function countUserMessages(jsonl: string): number {
  return parseMessageEntries(jsonl).filter((entry) => entry.payload?.type === 'user').length;
}

/**
 * User prompts and the assistant's spoken replies. Kiro files tool calls,
 * results, usage summaries and its own system prompt in the same transcript;
 * those are not chat messages.
 */
export function parseKiroMessages(jsonl: string): KiroHistoryMessage[] {
  const messages: KiroHistoryMessage[] = [];
  for (const entry of parseMessageEntries(jsonl)) {
    const payload = entry.payload;
    if (!payload || typeof payload.content !== 'string' || !payload.content.trim()) continue;
    const timestamp = readString(entry.timestamp);
    if (payload.type === 'user') {
      messages.push({ role: 'user', text: payload.content, ...(timestamp ? { timestamp } : {}) });
    } else if (
      payload.type === 'assistant'
      && (payload.operationType === undefined || payload.operationType === 'Say')
    ) {
      messages.push({ role: 'assistant', text: payload.content, ...(timestamp ? { timestamp } : {}) });
    }
  }
  return messages;
}
