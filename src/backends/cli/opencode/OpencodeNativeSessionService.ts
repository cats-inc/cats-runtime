import { spawn } from 'node:child_process';
import type { ProviderCommandConfig } from '../config.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';

export interface OpencodeNativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export interface OpencodeHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export interface OpencodePromptToolUse {
  toolId: string;
  toolName: string;
}

export interface OpencodePromptResult {
  sessionId: string;
  messageId: string;
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  toolUses: OpencodePromptToolUse[];
}

export interface OpencodePendingPermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
}

export interface OpencodePendingQuestionRequest {
  id: string;
  sessionID: string;
}

export interface OpencodeServerHandle {
  url: string;
  close(): void;
}

export type OpencodeServerLauncher = (input: {
  command: string;
  hostname: string;
  port: number;
  timeoutMs: number;
}) => Promise<OpencodeServerHandle>;

export interface OpencodeNativeSessionServiceOptions {
  command: string;
  commandConfig?: ProviderCommandConfig;
  hostname?: string;
  port?: number;
  startupTimeoutMs?: number;
  fetchFn?: typeof fetch;
  launcher?: OpencodeServerLauncher;
}

interface OpencodeApiSession {
  id: string;
  directory: string;
  title: string;
  time?: {
    created?: number;
    updated?: number;
  };
}

interface OpencodeApiAssistantMessage {
  id: string;
  sessionID: string;
  role: 'assistant';
  providerID: string;
  modelID: string;
  time: {
    created: number;
    completed?: number;
  };
  tokens?: {
    input?: number;
    output?: number;
  };
  error?: {
    name?: string;
    data?: {
      message?: string;
    };
  };
}

interface OpencodeApiUserMessage {
  id: string;
  role: 'user';
  time: {
    created: number;
  };
}

interface OpencodeTextPart {
  id: string;
  type: 'text';
  text: string;
  ignored?: boolean;
}

interface OpencodeToolPart {
  id: string;
  type: 'tool';
  callID?: string;
  tool?: string;
}

type OpencodeApiPart = OpencodeTextPart | OpencodeToolPart | {
  id: string;
  type: string;
  [key: string]: unknown;
};

interface OpencodeApiMessageEnvelope {
  info: OpencodeApiAssistantMessage | OpencodeApiUserMessage;
  parts: OpencodeApiPart[];
}

interface ResolvedServer extends OpencodeServerHandle {
  managed: boolean;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4097;
const DEFAULT_STARTUP_TIMEOUT_MS = 10000;
const PROMPT_HISTORY_POLL_ATTEMPTS = 4;
const PROMPT_HISTORY_POLL_INTERVAL_MS = 250;

export class OpencodeNativeSessionService {
  private readonly command: string;
  private readonly commandConfig: ProviderCommandConfig;
  private readonly hostname: string;
  private readonly port: number;
  private readonly startupTimeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly launcher: OpencodeServerLauncher;
  private server: ResolvedServer | null = null;
  private serverPromise: Promise<ResolvedServer | null> | null = null;

  constructor(options: OpencodeNativeSessionServiceOptions) {
    this.commandConfig = options.commandConfig || defaultOpencodeCommandConfig(options.command);
    this.command = this.commandConfig.path;
    this.hostname = options.hostname || DEFAULT_HOST;
    this.port = options.port || DEFAULT_PORT;
    this.startupTimeoutMs = options.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS;
    this.fetchFn = options.fetchFn || fetch;
    this.launcher = options.launcher || ((input) => defaultOpencodeServerLauncher({
      ...input,
      commandConfig: this.commandConfig,
    }));
  }

  async listSessions(
    cwd: string,
    options: { startIfNeeded?: boolean } = {},
  ): Promise<OpencodeNativeSessionSummary[]> {
    return this.listAllSessions({
      ...options,
      cwd,
    });
  }

  async listAllSessions(options: {
    cwd?: string;
    startIfNeeded?: boolean;
  } = {}): Promise<OpencodeNativeSessionSummary[]> {
    let sessions: OpencodeApiSession[];
    try {
      sessions = await this.request<OpencodeApiSession[]>(
        '/session',
        {
          method: 'GET',
        },
        {
          cwd: options.cwd,
          startIfNeeded: options.startIfNeeded,
        },
      );
    } catch (error) {
      if (options.startIfNeeded === false && isServerNotRunningError(error)) {
        return [];
      }
      throw error;
    }

    return sessions.map((session) => ({
      providerSessionId: session.id,
      cwd: session.directory,
      summary: session.title,
      messageCount: 0,
      lastActivity: toIso(session.time?.updated ?? session.time?.created),
    }));
  }

  async createSession(
    cwd: string,
    input: { title?: string } = {},
  ): Promise<OpencodeNativeSessionSummary> {
    const session = await this.request<OpencodeApiSession>(
      '/session',
      {
        method: 'POST',
        body: JSON.stringify(stripUndefined({
          title: input.title,
        })),
      },
      {
        cwd,
      },
    );

    return {
      providerSessionId: session.id,
      cwd: session.directory,
      summary: session.title,
      messageCount: 0,
      lastActivity: toIso(session.time?.updated ?? session.time?.created),
    };
  }

  async getSession(cwd: string, providerSessionId: string): Promise<OpencodeNativeSessionSummary | null> {
    try {
      const session = await this.request<OpencodeApiSession>(
        `/session/${encodeURIComponent(providerSessionId)}`,
        {
          method: 'GET',
        },
        { cwd },
      );

      return {
        providerSessionId: session.id,
        cwd: session.directory,
        summary: session.title,
        messageCount: 0,
        lastActivity: toIso(session.time?.updated ?? session.time?.created),
      };
    } catch (error) {
      if ((error as Error).message.includes('(404)')) {
        return null;
      }
      throw error;
    }
  }

  async loadHistory(cwd: string, providerSessionId: string): Promise<OpencodeHistoryMessage[]> {
    const rawMessages = await this.request<unknown>(
      `/session/${encodeURIComponent(providerSessionId)}/message`,
      {
        method: 'GET',
      },
      {
        cwd,
      },
    );

    const messages = normalizeMessageList(rawMessages);
    return messages.flatMap((message) => {
      const text = extractTextFromParts(message.parts);
      if (!text) return [];

      return [{
        role: message.info.role,
        text,
        timestamp: toIso(message.info.time.created),
      }];
    });
  }

  async prompt(input: {
    cwd: string;
    sessionId: string;
    content: string;
    model?: string;
    signal?: AbortSignal;
  }): Promise<OpencodePromptResult> {
    const model = parseOpencodeModel(input.model);
    const response = await this.request<unknown>(
      `/session/${encodeURIComponent(input.sessionId)}/message`,
      {
        method: 'POST',
        body: JSON.stringify(stripUndefined({
          model,
          parts: [
            {
              type: 'text',
              text: input.content,
            },
          ],
        })),
        signal: input.signal,
      },
      {
        cwd: input.cwd,
      },
    );

    const directResponse = normalizeMessageEnvelope(response);
    if (directResponse?.info.role === 'assistant') {
      return toPromptResult(directResponse);
    }

    const historyResponse = await this.findPromptResultInHistory(
      input.cwd,
      input.sessionId,
      input.content,
    );
    if (historyResponse) {
      return historyResponse;
    }

    if (directResponse) {
      throw new Error('OpenCode returned a non-assistant response for prompt');
    }

    throw new Error(buildEmptyPromptResponseError(input.model));
  }

  async abortSession(cwd: string, providerSessionId: string): Promise<boolean> {
    return this.request<boolean>(
      `/session/${encodeURIComponent(providerSessionId)}/abort`,
      {
        method: 'POST',
      },
      { cwd },
    );
  }

  async deleteSession(cwd: string, providerSessionId: string): Promise<boolean> {
    return this.request<boolean>(
      `/session/${encodeURIComponent(providerSessionId)}`,
      {
        method: 'DELETE',
      },
      { cwd },
    );
  }

  async listPendingPermissions(cwd: string): Promise<OpencodePendingPermissionRequest[]> {
    return this.request<OpencodePendingPermissionRequest[]>(
      '/permission',
      {
        method: 'GET',
      },
      { cwd },
    );
  }

  async replyPermission(
    cwd: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message?: string,
  ): Promise<boolean> {
    return this.request<boolean>(
      `/permission/${encodeURIComponent(requestId)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify(stripUndefined({
          reply,
          message,
        })),
      },
      { cwd },
    );
  }

  async listPendingQuestions(cwd: string): Promise<OpencodePendingQuestionRequest[]> {
    return this.request<OpencodePendingQuestionRequest[]>(
      '/question',
      {
        method: 'GET',
      },
      { cwd },
    );
  }

  async rejectQuestion(cwd: string, requestId: string): Promise<boolean> {
    return this.request<boolean>(
      `/question/${encodeURIComponent(requestId)}/reject`,
      {
        method: 'POST',
      },
      { cwd },
    );
  }

  async close(): Promise<void> {
    const current = this.server;
    this.server = null;
    this.serverPromise = null;
    if (current?.managed) {
      current.close();
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options: {
      cwd?: string;
      startIfNeeded?: boolean;
    } = {},
  ): Promise<T> {
    const server = await this.resolveServer(options.startIfNeeded ?? true);
    if (!server) {
      throw new Error('OpenCode server is not running');
    }

    const url = new URL(path, withTrailingSlash(server.url));
    if (options.cwd) {
      url.searchParams.set('directory', options.cwd);
    }

    const headers = new Headers(init.headers);
    if (options.cwd) {
      headers.set('x-opencode-directory', encodeDirectoryHeader(options.cwd));
    }
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await this.fetchFn(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new Error(
        `OpenCode ${init.method || 'GET'} ${path} failed (${response.status})`
        + `${body ? `: ${body}` : ''}`,
      );
    }

    const body = await safeReadBody(response);
    if (!body) {
      return true as T;
    }

    try {
      return JSON.parse(body) as T;
    } catch (error) {
      throw new Error(`Failed to parse OpenCode response for ${path}: ${String(error)}`);
    }
  }

  private async resolveServer(startIfNeeded: boolean): Promise<ResolvedServer | null> {
    if (this.server) {
      return this.server;
    }

    if (this.serverPromise) {
      return this.serverPromise;
    }

    this.serverPromise = (async () => {
      const url = `http://${this.hostname}:${this.port}`;
      if (await this.isHealthy(url)) {
        return {
          url,
          managed: false,
          close() {},
        };
      }

      if (!startIfNeeded) {
        return null;
      }

      const launched = await this.launcher({
        command: this.command,
        hostname: this.hostname,
        port: this.port,
        timeoutMs: this.startupTimeoutMs,
      });

      return {
        ...launched,
        managed: true,
      };
    })();

    try {
      const server = await this.serverPromise;
      if (server) {
        this.server = server;
      }
      return server;
    } finally {
      if (!this.server) {
        this.serverPromise = null;
      }
    }
  }

  private async isHealthy(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);

    try {
      const response = await this.fetchFn(new URL('/global/health', withTrailingSlash(url)), {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async findPromptResultInHistory(
    cwd: string,
    sessionId: string,
    prompt: string,
  ): Promise<OpencodePromptResult | null> {
    for (let attempt = 0; attempt < PROMPT_HISTORY_POLL_ATTEMPTS; attempt += 1) {
      const rawMessages = await this.request<unknown>(
        `/session/${encodeURIComponent(sessionId)}/message`,
        {
          method: 'GET',
        },
        { cwd },
      ).catch(() => null);

      const messages = normalizeMessageList(rawMessages);
      const matchedAssistant = findAssistantAfterPrompt(messages, prompt);
      if (matchedAssistant) {
        return toPromptResult(matchedAssistant);
      }

      if (findLastPromptMessageIndex(messages, prompt) >= 0 && attempt < PROMPT_HISTORY_POLL_ATTEMPTS - 1) {
        await sleep(PROMPT_HISTORY_POLL_INTERVAL_MS);
        continue;
      }

      return null;
    }

    return null;
  }
}

export function parseOpencodeModel(
  value?: string,
): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const alias = OPENCODE_MODEL_ALIASES[trimmed.toLowerCase()];
  if (alias) {
    return alias;
  }

  const separatorIndex = trimmed.includes('/') ? trimmed.indexOf('/') : trimmed.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return undefined;
  }

  return {
    providerID: trimmed.slice(0, separatorIndex),
    modelID: trimmed.slice(separatorIndex + 1),
  };
}

const OPENCODE_MODEL_ALIASES: Record<string, { providerID: string; modelID: string }> = {
  'minimax m2.5': {
    providerID: 'opencode-go',
    modelID: 'minimax-m2.5',
  },
  'minimax m2.5 free': {
    providerID: 'opencode',
    modelID: 'minimax-m2.5-free',
  },
  'kimi k2.5': {
    providerID: 'opencode-go',
    modelID: 'kimi-k2.5',
  },
  'glm-5': {
    providerID: 'opencode-go',
    modelID: 'glm-5',
  },
  'mimo v2 flash free': {
    providerID: 'openrouter',
    modelID: 'xiaomi/mimo-v2-flash:free',
  },
  'big pickle': {
    providerID: 'opencode',
    modelID: 'big-pickle',
  },
};

function extractTextFromParts(parts: OpencodeApiPart[]): string {
  return parts
    .filter((part): part is OpencodeTextPart => part.type === 'text')
    .filter((part) => !part.ignored)
    .map((part) => part.text)
    .join('');
}

function normalizeMessageList(value: unknown): OpencodeApiMessageEnvelope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeMessageEnvelope)
    .filter((message): message is OpencodeApiMessageEnvelope => Boolean(message));
}

function normalizeMessageEnvelope(value: unknown): OpencodeApiMessageEnvelope | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const info = (value as { info?: unknown }).info;
  const parts = (value as { parts?: unknown }).parts;
  if (!info || typeof info !== 'object' || !Array.isArray(parts)) {
    return null;
  }

  const role = (info as { role?: unknown }).role;
  if (role !== 'user' && role !== 'assistant') {
    return null;
  }

  return {
    info: info as OpencodeApiAssistantMessage | OpencodeApiUserMessage,
    parts: parts as OpencodeApiPart[],
  };
}

function findAssistantAfterPrompt(
  messages: OpencodeApiMessageEnvelope[],
  prompt: string,
): OpencodeApiMessageEnvelope | null {
  const userIndex = findLastPromptMessageIndex(messages, prompt);
  if (userIndex < 0) {
    return null;
  }

  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.info.role === 'assistant') {
      return message;
    }
  }

  return null;
}

function findLastPromptMessageIndex(
  messages: OpencodeApiMessageEnvelope[],
  prompt: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info.role !== 'user') continue;
    if (extractTextFromParts(message.parts) === prompt) {
      return index;
    }
  }

  return -1;
}

function extractToolUses(parts: OpencodeApiPart[]): OpencodePromptToolUse[] {
  const seen = new Set<string>();
  const tools: OpencodePromptToolUse[] = [];

  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const toolId = typeof part.callID === 'string' && part.callID
      ? part.callID
      : part.id;
    const toolName = typeof part.tool === 'string' && part.tool
      ? part.tool
      : 'tool';
    const key = `${toolId}:${toolName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tools.push({ toolId, toolName });
  }

  return tools;
}

function extractApiError(error: { name?: string; data?: { message?: string } }): string {
  return error.data?.message || error.name || 'OpenCode request failed';
}

function toPromptResult(message: OpencodeApiMessageEnvelope): OpencodePromptResult {
  if (message.info.role !== 'assistant') {
    throw new Error('OpenCode returned a non-assistant response for prompt');
  }

  if (message.info.error) {
    throw new Error(extractApiError(message.info.error));
  }

  return {
    sessionId: message.info.sessionID,
    messageId: message.info.id,
    text: extractTextFromParts(message.parts),
    usage: message.info.tokens ? {
      inputTokens: message.info.tokens.input ?? 0,
      outputTokens: message.info.tokens.output ?? 0,
    } : undefined,
    toolUses: extractToolUses(message.parts),
  };
}

function buildEmptyPromptResponseError(model?: string): string {
  const modelText = model ? ` for model '${model}'` : '';
  return `OpenCode returned no assistant response${modelText}. `
    + 'The requested model/provider may be unavailable or OpenCode may have rejected the turn.';
}

function toIso(value?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function encodeDirectoryHeader(cwd: string): string {
  return /[^\x00-\x7F]/.test(cwd) ? encodeURIComponent(cwd) : cwd;
}

function isServerNotRunningError(error: unknown): boolean {
  return error instanceof Error && error.message === 'OpenCode server is not running';
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

export function buildOpencodeServerSpawnConfig(
  commandConfig: ProviderCommandConfig,
  hostname: string,
  port: number,
  cwd: string = process.cwd(),
): ReturnType<typeof buildProcessSpawnConfig> {
  return buildProcessSpawnConfig(
    commandConfig,
    'opencode',
    [
      'serve',
      `--hostname=${hostname}`,
      `--port=${port}`,
    ],
    cwd,
  );
}

async function defaultOpencodeServerLauncher(input: {
  command: string;
  commandConfig?: ProviderCommandConfig;
  hostname: string;
  port: number;
  timeoutMs: number;
}): Promise<OpencodeServerHandle> {
  const spawnConfig = buildOpencodeServerSpawnConfig(
    input.commandConfig || defaultOpencodeCommandConfig(input.command),
    input.hostname,
    input.port,
  );
  const env = {
    ...process.env,
    ...spawnConfig.env,
  };
  const proc = spawn(spawnConfig.command, spawnConfig.args, {
    cwd: spawnConfig.cwd,
    env,
    shell: spawnConfig.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for OpenCode server after ${input.timeoutMs}ms`));
    }, input.timeoutMs);
    let output = '';

    const handleChunk = (chunk: Buffer | string) => {
      output += chunk.toString();
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('opencode server listening')) continue;
        const match = line.match(/on\s+(https?:\/\/\S+)/);
        if (!match) continue;
        clearTimeout(timeout);
        resolve(match[1]);
        return;
      }
    };

    proc.stdout?.on('data', handleChunk);
    proc.stderr?.on('data', handleChunk);
    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(
        `OpenCode server exited with code ${code}${output.trim() ? `\n${output.trim()}` : ''}`,
      ));
    });
  });

  return {
    url,
    close() {
      proc.kill();
    },
  };
}

function defaultOpencodeCommandConfig(command: string): ProviderCommandConfig {
  return {
    path: command,
    runner: 'auto',
    runtime: {
      mode: 'native',
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
