import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ProviderCommandConfig } from '../config.js';
import { isWslDistroRunning, type WslDistroInspector } from '../discovery/wslDiscovery.js';
import { spawnCommandRunner, type CommandRunner } from '../pythonScripts.js';
import {
  buildProcessSpawnConfig,
  createRuntimeAdapter,
  quoteForBash,
  type RuntimeAdapter,
} from '../runtime/runtime.js';
import { resolveKimiHome } from '../providers/kimi.js';
import {
  AcpJsonRpcClientError,
  AcpStdioClient,
} from '../../agent/adapters/acp/AcpStdioClient.js';
import type { AgentProcessSpawner } from '../../agent/types.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

export interface KimiNativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export interface KimiHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export interface KimiSessionListOptions {
  startIfNeeded?: boolean;
}

export interface KimiNativeSessionServiceOptions {
  commandConfig: ProviderCommandConfig;
  /** Native runs only; defaults to KIMI_CODE_HOME, then ~/.kimi-code (as turns resolve it). */
  kimiHome?: string;
  runner?: CommandRunner;
  wslInspector?: WslDistroInspector;
  /** Starts `kimi acp` for deletion; tests replace it. */
  acpSpawner?: AgentProcessSpawner;
  acpTimeoutMs?: number;
}

/**
 * Kimi Code keeps one directory per session under
 * `<KIMI_CODE_HOME>/sessions/wd_<dir>_<hash>/<session id>/`: `state.json`
 * (version 2: id, cwd, timestamps, archived, title) and
 * `agents/main/wire.jsonl` (the main agent's journal, protocol 1.x). Natively
 * the store is read from disk; inside WSL or Docker `kimi session list --all
 * --json` enumerates it. Deletion always goes through Kimi's own ACP
 * `session/delete`, which removes the directory, its index entry and file
 * history and journals the deletion in `session_index.jsonl` (Kimi Code
 * 2.5.3); removing the directory alone would leave those behind.
 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const SUPPORTED_STATE_VERSION = 2;
const SUPPORTED_WIRE_PROTOCOL_MAJOR = 1;
const DEFAULT_ACP_TIMEOUT_MS = 60_000;
/** Journals beyond this size are listed without a message count or model. */
const MAX_SCANNED_WIRE_BYTES = 64 * 1024 * 1024;
const COMPILED_PROMPT_MARKER = '\n\nUser message:\n';

interface KimiStoreSession {
  id: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
  sessionDir: string;
}

interface WireDigest {
  userTurns: number;
  firstPrompt?: string;
  model?: string;
}

export class KimiNativeSessionService {
  private readonly commandConfig: ProviderCommandConfig;
  private readonly runtime: RuntimeAdapter;
  private readonly runner: CommandRunner;
  private readonly wslInspector: WslDistroInspector;
  private readonly kimiHome: string;
  private readonly acpSpawner?: AgentProcessSpawner;
  private readonly acpTimeoutMs: number;
  /** Wire digests keyed by journal path, reused while its size and mtime hold. */
  private readonly digests = new Map<string, { stamp: string; digest: WireDigest }>();

  constructor(options: KimiNativeSessionServiceOptions) {
    this.commandConfig = options.commandConfig;
    this.runtime = createRuntimeAdapter(options.commandConfig.runtime);
    this.runner = options.runner || spawnCommandRunner;
    this.wslInspector = options.wslInspector || isWslDistroRunning;
    this.kimiHome = resolveKimiHome(options.kimiHome);
    this.acpSpawner = options.acpSpawner;
    this.acpTimeoutMs = options.acpTimeoutMs ?? DEFAULT_ACP_TIMEOUT_MS;
  }

  async listAllSessions(options: KimiSessionListOptions = {}): Promise<KimiNativeSessionSummary[]> {
    if (!(await this.shouldStartDiscovery(options))) return [];
    const sessions = this.runtime.mode === 'native'
      ? await this.readNativeSessions()
      : await this.readShellSessions();
    sessions.sort((a, b) => epoch(b.lastActivity) - epoch(a.lastActivity));
    return sessions;
  }

  async listSessions(
    cwd: string,
    options: KimiSessionListOptions = {},
  ): Promise<KimiNativeSessionSummary[]> {
    const workspace = this.workspaceKey(cwd);
    return (await this.listAllSessions(options)).filter(
      (session) => this.workspaceKey(session.cwd) === workspace,
    );
  }

  async loadHistory(providerSessionId: string): Promise<KimiHistoryMessage[]> {
    assertSessionId(providerSessionId);
    const wire = this.runtime.mode === 'native'
      ? await this.readNativeWire(providerSessionId)
      : await this.readShellWire(providerSessionId);
    return wire === null ? [] : parseKimiWireHistory(wire);
  }

  /**
   * Deletes through Kimi so its index, file history and deletion journal stay
   * consistent. An id Kimi no longer knows counts as deleted.
   */
  async deleteSession(providerSessionId: string): Promise<boolean> {
    assertSessionId(providerSessionId);
    const client = new AcpStdioClient({
      command: this.commandConfig.path,
      providerFamily: 'kimi',
      args: ['acp'],
      // Any existing directory works: delete does not depend on the session's
      // workspace, and starting `kimi acp` does not register its cwd as a project.
      cwd: tmpdir(),
      ...(this.runtime.mode === 'native' && this.kimiHome
        ? { env: { KIMI_CODE_HOME: this.kimiHome } }
        : {}),
      spawnProcess: this.acpSpawner ?? ((command, args, options) => this.spawnAcp(args, options.cwd, options.env)),
    });
    try {
      const initialized = record(await client.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }, { timeoutMs: this.acpTimeoutMs }));
      const sessionCapabilities = record(record(initialized?.agentCapabilities)?.sessionCapabilities);
      if (!sessionCapabilities || !('delete' in sessionCapabilities)) {
        throw new Error('This Kimi Code version does not offer ACP session deletion.');
      }
      try {
        await client.request('session/delete', { sessionId: providerSessionId }, { timeoutMs: this.acpTimeoutMs });
      } catch (error) {
        // -32602: "Unknown sessionId" — already gone, which is the goal.
        if (!(error instanceof AcpJsonRpcClientError && error.code === -32602)) throw error;
      }
      return true;
    } finally {
      await client.close();
    }
  }

  private spawnAcp(args: string[], cwd: string | undefined, env: Record<string, string> | undefined) {
    const spawnConfig = buildProcessSpawnConfig(this.commandConfig, 'kimi', args, cwd ?? tmpdir());
    return spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd ?? cwd,
      env: { ...process.env, ...env, ...spawnConfig.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spawnConfig.shell,
      windowsVerbatimArguments: spawnConfig.windowsVerbatimArguments,
      ...hiddenWindowsSpawnOptions(),
    });
  }

  private workspaceKey(cwd: string): string {
    if (!cwd.trim()) throw new Error('cwd is required');
    const normalized = this.runtime.toRuntimePath(cwd).replace(/[\\/]+$/u, '');
    // Windows paths compare case-insensitively and Kimi records backslashes.
    return this.runtime.mode === 'native' && process.platform === 'win32'
      ? normalized.replace(/\//gu, '\\').toLowerCase()
      : normalized;
  }

  private async shouldStartDiscovery(options: KimiSessionListOptions): Promise<boolean> {
    if (options.startIfNeeded !== false || this.runtime.mode !== 'wsl') return true;
    return this.wslInspector(this.runtime.distro || 'Ubuntu');
  }

  private async readNativeSessions(): Promise<KimiNativeSessionSummary[]> {
    const sessions: KimiNativeSessionSummary[] = [];
    for (const session of await this.nativeStoreSessions()) {
      const digest = await this.digestWire(join(session.sessionDir, 'agents', 'main', 'wire.jsonl'));
      sessions.push(toSummary(session, digest, this.runtime));
    }
    return sessions;
  }

  private async nativeStoreSessions(): Promise<KimiStoreSession[]> {
    const sessionsDir = join(this.kimiHome, 'sessions');
    const sessions: KimiStoreSession[] = [];
    for (const group of await directoryNames(sessionsDir)) {
      if (group.startsWith('.')) continue;
      for (const id of await directoryNames(join(sessionsDir, group))) {
        if (!SESSION_ID_RE.test(id)) continue;
        const sessionDir = join(sessionsDir, group, id);
        const state = parseKimiSessionState(await readText(join(sessionDir, 'state.json')), sessionDir);
        if (state && state.id === id) sessions.push(state);
      }
    }
    return sessions;
  }

  private async digestWire(path: string): Promise<WireDigest> {
    let stamp: string;
    try {
      const info = await stat(path);
      if (info.size > MAX_SCANNED_WIRE_BYTES) return { userTurns: 0 };
      stamp = `${info.size}:${info.mtimeMs}`;
    } catch {
      return { userTurns: 0 };
    }
    const cached = this.digests.get(path);
    if (cached?.stamp === stamp) return cached.digest;
    const digest = digestKimiWire((await readText(path)) ?? '');
    this.digests.set(path, { stamp, digest });
    return digest;
  }

  private async readNativeWire(sessionId: string): Promise<string | null> {
    const session = (await this.nativeStoreSessions()).find((candidate) => candidate.id === sessionId);
    return session ? readText(join(session.sessionDir, 'agents', 'main', 'wire.jsonl')) : null;
  }

  /** `kimi session list --all --json` inside the distro or container, plus each journal's counts. */
  private async readShellSessions(): Promise<KimiNativeSessionSummary[]> {
    const sessions = parseKimiSessionListJson(await this.runShell([
      `KIMI_CODE_NO_AUTO_UPDATE=1 ${quoteForBash(this.commandConfig.path)} session list --all --json`,
    ]));
    const summaries: KimiNativeSessionSummary[] = [];
    for (const session of sessions) {
      const wire = await this.runShell([
        `cat ${quoteForBash(`${session.sessionDir}/agents/main/wire.jsonl`)} 2>/dev/null || true`,
      ]);
      summaries.push(toSummary(session, digestKimiWire(wire), this.runtime));
    }
    return summaries;
  }

  private async readShellWire(sessionId: string): Promise<string | null> {
    const sessions = parseKimiSessionListJson(await this.runShell([
      `KIMI_CODE_NO_AUTO_UPDATE=1 ${quoteForBash(this.commandConfig.path)} session list --all --json`,
    ]));
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return null;
    return this.runShell([`cat ${quoteForBash(`${session.sessionDir}/agents/main/wire.jsonl`)} 2>/dev/null || true`]);
  }

  private async runShell(lines: string[]): Promise<string> {
    const { command, args } = this.runtime.buildShellInvocation(lines.join('\n'));
    const result = await this.runner(command, args, {});
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Kimi session store read failed with code ${result.code}`);
    }
    return result.stdout;
  }
}

/** One `state.json`; null when it is not a Kimi session state this reader understands. */
export function parseKimiSessionState(
  text: string | null | undefined,
  sessionDir: string,
): KimiStoreSession | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const state = record(parsed);
  const id = readString(state?.id);
  const cwd = readString(state?.cwd);
  if (!state || !id || !cwd) return null;
  if (state.version !== undefined && state.version !== SUPPORTED_STATE_VERSION) return null;
  return {
    id,
    cwd,
    sessionDir,
    ...(readString(state.title) ? { title: readString(state.title) } : {}),
    ...(isoFromEpoch(state.updatedAt) ? { updatedAt: isoFromEpoch(state.updatedAt) } : {}),
    ...(isoFromEpoch(state.createdAt) ? { createdAt: isoFromEpoch(state.createdAt) } : {}),
  };
}

/** `kimi session list --all --json` (Kimi Code 2.5.3): `[{ id, workDir, sessionDir, createdAt, updatedAt, ... }]`. */
export function parseKimiSessionListJson(text: string): KimiStoreSession[] {
  const start = text.indexOf('[');
  if (start < 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch {
    throw new Error('kimi session list --json returned unreadable JSON.');
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const item = record(entry);
    const id = readString(item?.id);
    const cwd = readString(item?.workDir);
    const sessionDir = readString(item?.sessionDir);
    if (!item || !id || !cwd || !sessionDir || !SESSION_ID_RE.test(id)) return [];
    const title = readString(record(item.metadata)?.title) ?? readString(item.title);
    return [{
      id,
      cwd,
      sessionDir,
      ...(title ? { title } : {}),
      ...(isoFromEpoch(item.updatedAt) ? { updatedAt: isoFromEpoch(item.updatedAt) } : {}),
      ...(isoFromEpoch(item.createdAt) ? { createdAt: isoFromEpoch(item.createdAt) } : {}),
    }];
  });
}

/** User turns, the first prompt and the newest model of a main-agent wire journal. */
export function digestKimiWire(wire: string): WireDigest {
  let userTurns = 0;
  let firstPrompt: string | undefined;
  let model: string | undefined;
  for (const line of wire.split(/\r?\n/u)) {
    if (!line.includes('"turn.prompt"') && !line.includes('"llm.request"')) continue;
    const entry = parseLine(line);
    if (entry?.type === 'turn.prompt' && record(entry.origin)?.kind === 'user') {
      userTurns += 1;
      firstPrompt ??= textParts(entry.input);
    } else if (entry?.type === 'llm.request' && readString(entry.model)) {
      model = readString(entry.model);
    }
  }
  return { userTurns, ...(firstPrompt ? { firstPrompt } : {}), ...(model ? { model } : {}) };
}

/**
 * The visible transcript: user input and assistant text from
 * `agent.message.appended` records. Reminders Kimi injects are context
 * records, and tool traffic has role `tool`, so neither appears.
 */
export function parseKimiWireHistory(wire: string): KimiHistoryMessage[] {
  const lines = wire.split(/\r?\n/u);
  const header = parseLine(lines.find((line) => line.trim()) ?? '');
  if (header?.type === 'metadata') {
    const major = Number.parseInt(String(header.protocol_version ?? '').split('.')[0] ?? '', 10);
    if (major !== SUPPORTED_WIRE_PROTOCOL_MAJOR) {
      throw new Error(`Unsupported Kimi wire protocol ${String(header.protocol_version ?? '(none)')}; `
        + `expected ${SUPPORTED_WIRE_PROTOCOL_MAJOR}.x.`);
    }
  }
  const messages: KimiHistoryMessage[] = [];
  for (const line of lines) {
    if (!line.includes('"agent.message.appended"')) continue;
    const entry = parseLine(line);
    if (entry?.type !== 'agent.message.appended') continue;
    const outer = record(entry.message);
    const message = record(outer?.message);
    const meta = record(outer?.meta);
    const role = message?.role;
    const text = textParts(message?.content);
    if (!text) continue;
    const timestamp = typeof entry.time === 'number' ? new Date(entry.time).toISOString() : undefined;
    if (role === 'user' && meta?.source === 'input') {
      messages.push({ role: 'user', text: userText(text), ...(timestamp ? { timestamp } : {}) });
    } else if (role === 'assistant') {
      messages.push({ role: 'assistant', text, ...(timestamp ? { timestamp } : {}) });
    }
  }
  return messages;
}

function toSummary(
  session: KimiStoreSession,
  digest: WireDigest,
  runtime: RuntimeAdapter,
): KimiNativeSessionSummary {
  return {
    providerSessionId: session.id,
    cwd: runtime.toHostPath(session.cwd),
    summary: session.title || summarizePrompt(digest.firstPrompt) || 'Untitled Session',
    messageCount: digest.userTurns,
    ...(session.updatedAt || session.createdAt ? { lastActivity: session.updatedAt || session.createdAt } : {}),
    ...(digest.model ? { model: digest.model } : {}),
  };
}

/** A Cats-run turn sends `Instructions: ... User message: <text>`; show the user's text. */
function userText(prompt: string): string {
  const marker = prompt.indexOf(COMPILED_PROMPT_MARKER);
  return prompt.startsWith('Instructions:') && marker >= 0
    ? prompt.slice(marker + COMPILED_PROMPT_MARKER.length)
    : prompt;
}

function summarizePrompt(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  const text = userText(prompt).trim().split(/\r?\n/u)[0]?.trim();
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function textParts(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap((part) => {
    const item = record(part);
    return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : [];
  }).join('');
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return record(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isoFromEpoch(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
}

function epoch(iso: string | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

async function directoryNames(path: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function assertSessionId(providerSessionId: string): void {
  if (!SESSION_ID_RE.test(providerSessionId)) throw new Error('Invalid Kimi session id.');
}
