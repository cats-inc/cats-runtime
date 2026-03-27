import { OpencodeNativeSessionService } from '../opencode/OpencodeNativeSessionService.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  TurnInput,
} from './types.js';
import type {
  ResultStreamEvent,
  StreamEvent,
  TextStreamEvent,
  ToolUseStreamEvent,
} from '../../../core/types.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

const REQUEST_POLL_INTERVAL_MS = 250;

export class OpencodeProvider implements Provider {
  name = 'opencode';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true };

  constructor(private readonly native: OpencodeNativeSessionService) {}

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    return [];
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(_line: string): StreamEvent | null {
    return null;
  }

  async *streamTurn(turn: TurnInput, opts: ProviderTurnOptions): AsyncGenerator<StreamEvent> {
    const sessionId = opts.resumeSessionId;
    if (!sessionId) {
      throw new Error('OpenCode session ID is required before sending a message');
    }

    let automationRunning = true;
    const automationController = new AbortController();
    const automation = this.autoHandlePendingRequests({
      cwd: opts.cwd,
      sessionId,
      permissionMode: opts.permissionMode ?? 'skip',
      allowedTools: opts.allowedTools || [],
      signal: automationController.signal,
      isRunning: () => automationRunning,
    });

    const abortHandler = () => {
      void this.native.abortSession(opts.cwd, sessionId).catch(() => {});
    };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      const result = await this.native.prompt({
        cwd: opts.cwd,
        sessionId,
        content: compileRuntimeTurnPrompt(turn.message, turn),
        model: opts.model,
        signal: opts.signal,
      });

      for (const toolUse of result.toolUses) {
        yield {
          type: 'tool_use',
          toolId: toolUse.toolId,
          toolName: toolUse.toolName,
        } satisfies ToolUseStreamEvent;
      }

      if (result.text) {
        yield {
          type: 'text',
          text: result.text,
        } satisfies TextStreamEvent;
      }

      yield {
        type: 'result',
        sessionId: result.sessionId,
        usage: result.usage,
      } satisfies ResultStreamEvent;
    } finally {
      automationRunning = false;
      automationController.abort();
      opts.signal?.removeEventListener('abort', abortHandler);
      await automation.catch(() => {});
    }
  }

  private async autoHandlePendingRequests(input: {
    cwd: string;
    sessionId: string;
    permissionMode: 'skip' | 'whitelist' | 'default';
    allowedTools: string[];
    signal?: AbortSignal;
    isRunning: () => boolean;
  }): Promise<void> {
    const handledPermissions = new Set<string>();
    const handledQuestions = new Set<string>();

    while (input.isRunning() && !input.signal?.aborted) {
      const [permissions, questions] = await Promise.all([
        this.native.listPendingPermissions(input.cwd).catch(() => []),
        this.native.listPendingQuestions(input.cwd).catch(() => []),
      ]);

      for (const permission of permissions) {
        if (permission.sessionID !== input.sessionId) continue;
        if (handledPermissions.has(permission.id)) continue;
        handledPermissions.add(permission.id);

        const reply = decidePermissionReply(
          input.permissionMode,
          permission.permission,
          permission.patterns,
          input.allowedTools,
        );

        await this.native.replyPermission(
          input.cwd,
          permission.id,
          reply,
          reply === 'reject' ? 'Rejected by cats-runtime permission policy' : undefined,
        ).catch(() => {});
      }

      for (const question of questions) {
        if (question.sessionID !== input.sessionId) continue;
        if (handledQuestions.has(question.id)) continue;
        handledQuestions.add(question.id);
        await this.native.rejectQuestion(
          input.cwd,
          question.id,
        ).catch(() => {});
      }

      await sleep(REQUEST_POLL_INTERVAL_MS, input.signal).catch(() => {});
    }
  }
}

function decidePermissionReply(
  mode: 'skip' | 'whitelist' | 'default',
  permission: string,
  patterns: string[],
  allowedTools: string[],
): 'once' | 'reject' {
  if (mode === 'skip') {
    return 'once';
  }

  if (mode === 'default') {
    return 'reject';
  }

  return matchesAllowedTool(permission, patterns, allowedTools) ? 'once' : 'reject';
}

function matchesAllowedTool(permission: string, patterns: string[], allowedTools: string[]): boolean {
  const allowed = new Set(
    allowedTools
      .map(normalizeToken)
      .filter(Boolean),
  );

  if (allowed.has('*')) {
    return true;
  }

  const candidates = [
    permission,
    ...patterns,
  ].map(normalizeToken).filter(Boolean);

  return candidates.some((candidate) => allowed.has(candidate));
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
