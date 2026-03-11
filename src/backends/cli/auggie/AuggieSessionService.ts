import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface AuggieSavedSession {
  providerSessionId: string;
  cwd: string;
  sourcePath: string;
  summary?: string;
  messageCount: number;
  exchangeCount: number;
  lastActivity?: string;
  model?: string;
  createdAt?: string;
}

export interface AuggieHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

interface RawAuggieSession {
  sessionId?: string;
  created?: string;
  modified?: string;
  name?: string;
  agentState?: {
    modelId?: string;
  };
  chatHistory?: Array<{
    exchange?: {
      request_message?: string;
      response_text?: string;
      request_nodes?: Array<{
        ide_state_node?: {
          workspace_folders?: Array<{
            folder_root?: string;
            repository_root?: string;
          }>;
          current_terminal?: {
            current_working_directory?: string;
          };
        };
      }>;
      response_nodes?: Array<{
        type?: number;
        content?: string;
        timestamp_ms?: number;
      }>;
    };
    finishedAt?: string;
  }>;
}

export class AuggieSessionService {
  constructor(private readonly sessionsDir: string) {}

  async listAllSessions(): Promise<AuggieSavedSession[]> {
    const sessions: AuggieSavedSession[] = [];
    const files = await safeReaddir(this.sessionsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const sourcePath = join(this.sessionsDir, file);
      try {
        const fileStat = await stat(sourcePath);
        if (!fileStat.isFile() || fileStat.size === 0) continue;
      } catch {
        continue;
      }

      const parsed = await this.parseSessionFile(sourcePath);
      if (parsed) {
        sessions.push(parsed);
      }
    }

    return sessions.sort(compareByActivityDesc);
  }

  async listSessions(cwd: string): Promise<AuggieSavedSession[]> {
    const normalizedTarget = normalizePath(cwd);
    const sessions = await this.listAllSessions();
    return sessions.filter((session) => pathsOverlap(session.cwd, normalizedTarget));
  }

  async getSession(providerSessionId: string): Promise<AuggieSavedSession | null> {
    const sessions = await this.listAllSessions();
    return sessions.find((session) => session.providerSessionId === providerSessionId) ?? null;
  }

  async getLatestSession(cwd: string): Promise<AuggieSavedSession | null> {
    const matching = await this.listSessions(cwd);
    return matching[0] ?? null;
  }

  async loadHistory(input: {
    providerSessionId?: string;
    sourcePath?: string;
  }): Promise<AuggieHistoryMessage[]> {
    const sourcePath = input.sourcePath
      || (input.providerSessionId
        ? (await this.getSession(input.providerSessionId))?.sourcePath
        : undefined);

    if (!sourcePath) {
      return [];
    }

    const raw = await this.readRawSession(sourcePath);
    if (!raw) {
      return [];
    }

    return extractHistoryMessages(raw);
  }

  private async parseSessionFile(sourcePath: string): Promise<AuggieSavedSession | null> {
    const raw = await this.readRawSession(sourcePath);
    if (!raw) return null;

    return parseSavedSession(raw, sourcePath);
  }

  private async readRawSession(sourcePath: string): Promise<RawAuggieSession | null> {
    try {
      return JSON.parse(await readFile(sourcePath, 'utf-8')) as RawAuggieSession;
    } catch {
      return null;
    }
  }
}

function parseSavedSession(
  raw: RawAuggieSession,
  sourcePath: string,
): AuggieSavedSession | null {
  const providerSessionId = raw.sessionId?.trim();
  if (!providerSessionId) return null;

  const chatHistory = Array.isArray(raw.chatHistory) ? raw.chatHistory : [];
  const userMessages = chatHistory
    .map((item) => item.exchange?.request_message?.trim())
    .filter((value): value is string => Boolean(value));
  if (userMessages.length === 0) return null;

  const cwd = extractWorkspaceRoot(chatHistory);
  if (!cwd) return null;

  return {
    providerSessionId,
    cwd,
    sourcePath,
    summary: raw.name?.trim() || userMessages[userMessages.length - 1].slice(0, 100),
    messageCount: userMessages.length,
    exchangeCount: chatHistory.length,
    lastActivity: raw.modified,
    model: normalizeStoredModelId(raw.agentState?.modelId),
    createdAt: raw.created,
  };
}

function extractHistoryMessages(raw: RawAuggieSession): AuggieHistoryMessage[] {
  const chatHistory = Array.isArray(raw.chatHistory) ? raw.chatHistory : [];
  const messages: AuggieHistoryMessage[] = [];

  for (const item of chatHistory) {
    const exchange = item.exchange;
    if (!exchange) continue;

    const timestamp = extractExchangeTimestamp(item);
    const userText = exchange.request_message?.trim();
    if (userText) {
      messages.push({
        role: 'user',
        text: userText,
        timestamp,
      });
    }

    const assistantText = extractAssistantText(exchange);
    if (assistantText) {
      messages.push({
        role: 'assistant',
        text: assistantText,
        timestamp,
      });
    }
  }

  return messages;
}

function extractWorkspaceRoot(
  chatHistory: RawAuggieSession['chatHistory'],
): string {
  if (!Array.isArray(chatHistory)) return '';

  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const requestNodes = chatHistory[index]?.exchange?.request_nodes;
    if (!Array.isArray(requestNodes)) continue;

    for (const node of requestNodes) {
      const ideState = node.ide_state_node;
      const workspaceFolders = Array.isArray(ideState?.workspace_folders)
        ? ideState.workspace_folders
        : [];
      const folder = workspaceFolders.find(
        (item) => typeof item.folder_root === 'string' || typeof item.repository_root === 'string',
      );
      if (folder?.folder_root) return folder.folder_root;
      if (folder?.repository_root) return folder.repository_root;

      const terminalCwd = ideState?.current_terminal?.current_working_directory;
      if (typeof terminalCwd === 'string' && terminalCwd.trim()) {
        return terminalCwd;
      }
    }
  }

  return '';
}

function extractAssistantText(
  exchange: NonNullable<RawAuggieSession['chatHistory']>[number]['exchange'],
): string {
  const responseText = exchange?.response_text?.trim();
  if (responseText) {
    return responseText;
  }

  const responseNodes = Array.isArray(exchange?.response_nodes) ? exchange.response_nodes : [];
  return responseNodes
    .filter((node): node is { type?: number; content: string; timestamp_ms?: number } =>
      node.type === 0 && typeof node.content === 'string')
    .map((node) => node.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function extractExchangeTimestamp(
  item: NonNullable<RawAuggieSession['chatHistory']>[number],
): string | undefined {
  if (item.finishedAt && !Number.isNaN(Date.parse(item.finishedAt))) {
    return item.finishedAt;
  }

  const responseNodes = Array.isArray(item.exchange?.response_nodes)
    ? item.exchange.response_nodes
    : [];
  const latestTimestampMs = responseNodes
    .map((node) => node.timestamp_ms)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => right - left)[0];

  return typeof latestTimestampMs === 'number'
    ? new Date(latestTimestampMs).toISOString()
    : undefined;
}

function normalizeStoredModelId(modelId?: string): string | undefined {
  if (!modelId) return undefined;

  const normalized = modelId.trim().toLowerCase();
  const aliases: Record<string, string> = {
    'gpt-5': 'gpt5',
    'gpt-5-1': 'gpt5.1',
    'gpt-5-2': 'gpt5.2',
    'gpt-5-4': 'gpt5.4',
    'haiku-4-5': 'haiku4.5',
    'opus-4-5': 'opus4.5',
    'opus-4-6': 'opus4.6',
    'sonnet-4': 'sonnet4',
    'sonnet-4-5': 'sonnet4.5',
    'sonnet-4-6': 'sonnet4.6',
  };

  return aliases[normalized] || normalized;
}

function compareByActivityDesc(a: AuggieSavedSession, b: AuggieSavedSession): number {
  const aTs = Date.parse(a.lastActivity || a.createdAt || '');
  const bTs = Date.parse(b.lastActivity || b.createdAt || '');

  if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
    return bTs - aTs;
  }

  if (Number.isFinite(aTs)) return -1;
  if (Number.isFinite(bTs)) return 1;
  return b.providerSessionId.localeCompare(a.providerSessionId);
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function isSameOrParent(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  if (!a || !b) return false;
  return isSameOrParent(a, b) || isSameOrParent(b, a);
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
