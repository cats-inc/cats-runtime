import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuggieSessionService, type AuggieSavedSession } from '../auggie/AuggieSessionService.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  TurnInput,
} from './types.js';
import type {
  ErrorStreamEvent,
  ResultStreamEvent,
  StreamEvent,
  TextStreamEvent,
} from '../../../core/types.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

interface AuggieResultLine {
  type?: string;
  result?: string;
  is_error?: boolean;
  session_id?: string;
}

const AUGGIE_TOOL_NAMES = [
  'codebase-retrieval',
  'remove-files',
  'save-file',
  'apply_patch',
  'str-replace-editor',
  'view',
  'launch-process',
  'kill-process',
  'read-process',
  'write-process',
  'list-processes',
  'web-search',
  'web-fetch',
  'sub-agent-explore',
  'sub-agent-plan',
  'view_tasklist',
  'reorganize_tasklist',
  'update_tasks',
  'add_tasks',
] as const;

export class AuggieProvider implements Provider {
  name = 'auggie';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true };

  private pendingPrompt: string | null = null;
  private previousWorkspaceSession: AuggieSavedSession | null = null;
  private previousTurnSession: AuggieSavedSession | null = null;
  private lastResult: { remoteSessionId?: string; isError: boolean } | null = null;
  private sawStructuredResult = false;
  private sawText = false;
  private pendingPromptFilePath: string | null = null;
  private readonly sessions: AuggieSessionService;

  constructor(
    sessions: AuggieSessionService,
    private readonly maxTurns: number = 10,
  ) {
    this.sessions = sessions;
  }

  prepareEphemeralTurn(turn: TurnInput): void {
    this.cleanupPendingPromptFile();
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.lastResult = null;
    this.sawStructuredResult = false;
    this.sawText = false;
  }

  resolveFirstEventTimeoutMs(_defaultTimeoutMs: number): number {
    // Auggie print mode emits a single JSON line only after the turn completes.
    return 0;
  }

  async beforeTurn(opts: ProviderSpawnOptions): Promise<void> {
    this.previousWorkspaceSession = await this.sessions.getLatestSession(opts.cwd);
    this.previousTurnSession = opts.resumeSessionId
      ? await this.sessions.getSession(opts.resumeSessionId)
      : this.previousWorkspaceSession;
  }

  async afterTurn(opts: ProviderSpawnOptions): Promise<StreamEvent | null> {
    try {
      if (this.lastResult?.isError) {
        return null;
      }

      const updatedSession = await this.resolveUpdatedSession(opts);
      if (this.sawText) {
        return this.buildResultEvent(opts, updatedSession);
      }

      throw new Error(this.buildEmptyResponseError(updatedSession));
    } finally {
      this.cleanupPendingPromptFile();
    }
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      '--print',
      '--quiet',
      '--output-format', 'json',
      '--max-turns', String(this.maxTurns),
      '--workspace-root', opts.cwd,
    ];

    const model = normalizeAuggieModelId(opts.model);
    if (model) {
      args.push('--model', model);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    appendPermissionArgs(args, opts);

    if (this.pendingPrompt) {
      const instructionFile = this.writePendingPromptFile();
      args.push('--instruction-file', instructionFile);
      this.pendingPrompt = null;
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('Applying --max-turns override:')) {
      return null;
    }

    let parsed: AuggieResultLine;
    try {
      parsed = JSON.parse(trimmed) as AuggieResultLine;
    } catch {
      return null;
    }

    if (parsed.type !== 'result') {
      return null;
    }

    this.sawStructuredResult = true;
    this.lastResult = {
      remoteSessionId: parsed.session_id,
      isError: Boolean(parsed.is_error),
    };

    const text = typeof parsed.result === 'string' ? parsed.result : '';
    if (parsed.is_error) {
      return {
        type: 'error',
        text: text.trim() || 'Auggie request failed',
      } satisfies ErrorStreamEvent;
    }

    if (!text.trim()) return null;
    this.sawText = true;
    return {
      type: 'text',
      text,
    } satisfies TextStreamEvent;
  }

  private async resolveUpdatedSession(opts: ProviderSpawnOptions): Promise<AuggieSavedSession | null> {
    if (opts.resumeSessionId) {
      const resumed = await this.sessions.getSession(opts.resumeSessionId);
      if (!resumed) return null;
      return this.sessionWasUpdated(resumed, this.previousTurnSession) ? resumed : null;
    }

    const latest = await this.sessions.getLatestSession(opts.cwd);
    if (!latest) return null;
    return this.sessionWasUpdated(latest, this.previousWorkspaceSession) ? latest : null;
  }

  private buildResultEvent(
    opts: ProviderSpawnOptions,
    updatedSession: AuggieSavedSession | null,
  ): StreamEvent {
    const usage = updatedSession?.usage;

    if (opts.resumeSessionId) {
      return {
        type: 'result',
        sessionId: opts.resumeSessionId,
        usage,
      } satisfies ResultStreamEvent;
    }

    if (updatedSession) {
      return {
        type: 'result',
        sessionId: updatedSession.providerSessionId,
        usage,
      } satisfies ResultStreamEvent;
    }

    if (this.lastResult?.remoteSessionId) {
      return {
        type: 'result',
        sessionId: this.lastResult.remoteSessionId,
        usage,
      } satisfies ResultStreamEvent;
    }

    return {
      type: 'result',
      usage,
    } satisfies ResultStreamEvent;
  }

  private buildEmptyResponseError(updatedSession: AuggieSavedSession | null): string {
    if (updatedSession) {
      return `Auggie completed without streaming assistant text for session `
        + `${updatedSession.providerSessionId}.`;
    }

    if (this.sawStructuredResult) {
      return 'Auggie returned a structured result without any assistant text.';
    }

    return 'Auggie exited without emitting a usable JSON result.';
  }

  private sessionWasUpdated(
    latest: AuggieSavedSession,
    previous: AuggieSavedSession | null,
  ): boolean {
    if (!previous) return true;
    if (latest.providerSessionId !== previous.providerSessionId) return true;
    return latest.lastActivity !== previous.lastActivity
      || latest.messageCount !== previous.messageCount
      || latest.exchangeCount !== previous.exchangeCount;
  }

  private writePendingPromptFile(): string {
    if (this.pendingPromptFilePath) {
      return this.pendingPromptFilePath;
    }
    const prompt = this.pendingPrompt ?? '';
    const filePath = join(tmpdir(), `cats-runtime-auggie-${randomUUID()}.txt`);
    writeFileSync(filePath, prompt, 'utf8');
    this.pendingPromptFilePath = filePath;
    return filePath;
  }

  private cleanupPendingPromptFile(): void {
    if (!this.pendingPromptFilePath) {
      return;
    }
    try {
      unlinkSync(this.pendingPromptFilePath);
    } catch {
      // Best-effort cleanup only.
    }
    this.pendingPromptFilePath = null;
  }
}

function appendPermissionArgs(args: string[], opts: ProviderSpawnOptions): void {
  if (opts.permissionMode === 'skip') {
    for (const tool of AUGGIE_TOOL_NAMES) {
      args.push('--permission', `${tool}:allow`);
    }
    return;
  }

  if (opts.permissionMode !== 'whitelist') {
    return;
  }

  const allowed = new Set(
    (opts.allowedTools || [])
      .map(normalizeAuggieToolName)
      .filter((tool): tool is string => tool.length > 0),
  );

  for (const tool of AUGGIE_TOOL_NAMES) {
    args.push('--permission', `${tool}:${allowed.has(tool) ? 'allow' : 'deny'}`);
  }
}

function normalizeAuggieToolName(tool: string): string {
  return tool.trim().toLowerCase();
}

function normalizeAuggieModelId(model?: string): string | undefined {
  if (!model) return undefined;

  const trimmed = model.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const aliases: Record<string, string> = {
    'gpt 5': 'gpt5',
    'gpt 5.1': 'gpt5.1',
    'gpt 5.2': 'gpt5.2',
    'gpt 5.4': 'gpt5.4',
    'claude opus 4.5': 'opus4.5',
    'claude opus 4.6': 'opus4.6',
    'opus 4.5': 'opus4.5',
    'opus 4.6': 'opus4.6',
    'haiku 4.5': 'haiku4.5',
    'claude haiku 4.5': 'haiku4.5',
    'claude sonnet 4': 'sonnet4',
    'sonnet 4': 'sonnet4',
    'claude sonnet 4.5': 'sonnet4.5',
    'sonnet 4.5': 'sonnet4.5',
    'claude sonnet 4.6': 'sonnet4.6',
    'sonnet 4.6': 'sonnet4.6',
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  if (/^(gpt|opus|sonnet|haiku)\d(?:\.\d)?$/.test(trimmed.toLowerCase())) {
    return trimmed.toLowerCase();
  }

  return trimmed;
}
