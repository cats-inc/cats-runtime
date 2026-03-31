import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ProviderCommandConfig } from '../config.js';
import {
  parseJunieSessionEventLine,
  parseJunieStreamLine,
  type JunieUsageTotals,
} from '../junie/parser.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import type {
  ErrorStreamEvent,
  InitStreamEvent,
  ResultStreamEvent,
} from '../../../core/types.js';
import { compileRuntimeTurnPrompt } from './prompt.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

const DEFAULT_JUNIE_SESSIONS_DIR = join(os.homedir(), '.junie', 'sessions');
const SESSION_POLL_INTERVAL_MS = 250;
const DEFAULT_JUNIE_TURN_TIMEOUT_MS = 10 * 60 * 1000;
const JUNIE_TURN_TIMEOUT_ENV = 'CATS_JUNIE_TURN_TIMEOUT_MS';

function isSessionIdentityEvent(
  event: StreamEvent,
): event is InitStreamEvent | ResultStreamEvent {
  return event.type === 'init' || event.type === 'result';
}

export class JunieProvider implements Provider {
  name = 'junie';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private pendingPrompt: string | null = null;
  private readonly commandConfig?: ProviderCommandConfig;
  private readonly sessionsDir: string;

  constructor(
    commandConfig?: ProviderCommandConfig,
    sessionsDir: string = DEFAULT_JUNIE_SESSIONS_DIR,
  ) {
    this.commandConfig = commandConfig;
    this.sessionsDir = sessionsDir;
  }

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
  }

  resolveFirstEventTimeoutMs(_defaultTimeoutMs: number): number {
    // Junie only writes its JSON result after the task finishes.
    return 0;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args = this.buildArgs(
      opts,
      this.pendingPrompt,
      resolveJunieTurnTimeoutMs(),
    );
    this.pendingPrompt = null;
    return args;
  }

  private buildArgs(
    opts: ProviderSpawnOptions,
    prompt?: string | null,
    turnTimeoutMs: number = resolveJunieTurnTimeoutMs(),
  ): string[] {
    const args: string[] = [
      '--output-format', 'json',
      '--skip-update-check',
    ];

    if (turnTimeoutMs > 0) {
      args.push('--timeout', String(turnTimeoutMs));
    }

    const model = normalizeJunieModelId(opts.model);
    if (model) {
      args.push('--model', model);
    }

    if (opts.cwd) {
      args.push('--project', opts.cwd);
    }

    if (opts.resumeSessionId) {
      args.push('--session-id', opts.resumeSessionId);
    }

    if (prompt) {
      args.push(prompt);
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    return parseJunieStreamLine(line);
  }

  async *streamTurn(turn: TurnInput, opts: ProviderTurnOptions): AsyncGenerator<StreamEvent> {
    if (!this.commandConfig) {
      throw new Error('Junie command config is required before sending a message');
    }

    const turnTimeoutMs = resolveJunieTurnTimeoutMs();
    const args = this.buildArgs(
      opts,
      compileRuntimeTurnPrompt(turn.message, turn),
      turnTimeoutMs,
    );
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const spawnConfig = buildProcessSpawnConfig(
      this.commandConfig,
      this.name,
      args,
      opts.cwd,
    );
    if (spawnConfig.env) {
      Object.assign(env, spawnConfig.env);
    }

    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd ?? opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spawnConfig.shell,
      env,
      ...hiddenWindowsSpawnOptions(),
    });
    child.stdin?.end();

    const queue: StreamEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let processClosed = false;
    let exitCode: number | null = null;
    const stderrLines: string[] = [];
    const knownSessionIds = opts.resumeSessionId
      ? new Set<string>()
      : await this.readKnownSessionIds();

    const state: LiveJunieTurnState = {
      sessionId: opts.resumeSessionId,
      initEmitted: false,
      processedLineCount: opts.resumeSessionId
        ? await this.readEventLineCount(opts.resumeSessionId)
        : 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      lastProgressKey: '',
      lastProgressText: '',
      lastMeaningfulProgressText: '',
    };

    const wake = () => {
      if (notify) {
        notify();
        notify = null;
      }
    };

    const terminateChild = () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    };

    const enqueue = (event: StreamEvent) => {
      if (finished) return;

      if (isSessionIdentityEvent(event) && event.sessionId) {
        state.sessionId = event.sessionId;
      }

      if (event.type === 'progress' && isJunieProgressEvent(event)) {
        const progressText = typeof event.text === 'string' ? event.text.trim() : '';
        if (progressText) {
          state.lastProgressText = progressText;
          if (
            event.metadata?.kind !== 'status'
            || !isLowSignalJunieStatus(progressText)
          ) {
            state.lastMeaningfulProgressText = progressText;
          }
        }

        const key = buildProgressKey(event);
        if (!key || key === state.lastProgressKey) {
          return;
        }
        state.lastProgressKey = key;
      }

      queue.push(event);
      if (event.type === 'result' || event.type === 'error') {
        finished = true;
        terminateChild();
      }
      wake();
    };

    const emitInitIfNeeded = () => {
      if (!state.sessionId || state.initEmitted) {
        return;
      }
      state.initEmitted = true;
      enqueue({ type: 'init', sessionId: state.sessionId } satisfies InitStreamEvent);
    };

    const applyEvents = (events: StreamEvent | StreamEvent[] | null) => {
      if (!events || finished) return;
      const list = Array.isArray(events) ? events : [events];
      for (const event of list) {
        if (finished) break;
        if (event.type === 'result' && !event.sessionId && state.sessionId) {
          enqueue({ ...event, sessionId: state.sessionId });
          continue;
        }
        enqueue(event);
      }
    };

    const handleParsedSessionLine = (line: string) => {
      const parsed = parseJunieSessionEventLine(line, {
        sessionId: state.sessionId,
        usage: state.usage,
      });
      if (!parsed) return;

      if (parsed.usageDelta) {
        state.usage = mergeUsage(state.usage, parsed.usageDelta);
      }

      for (const event of parsed.events) {
        if (finished) break;
        if (event.type === 'result') {
          const usage = event.usage ?? normalizeUsage(state.usage);
          enqueue({
            ...event,
            sessionId: event.sessionId ?? state.sessionId,
            usage,
          });
          continue;
        }
        enqueue(event);
      }
    };

    emitInitIfNeeded();

    let turnTimeoutId: ReturnType<typeof setTimeout> | undefined;
    if (turnTimeoutMs > 0) {
      turnTimeoutId = setTimeout(() => {
        if (finished) {
          return;
        }
        enqueue({
          type: 'error',
          sessionId: state.sessionId,
          text: buildJunieTurnTimeoutError(turnTimeoutMs, state),
        } satisfies ErrorStreamEvent);
      }, turnTimeoutMs);
    }

    const abortHandler = () => {
      finished = true;
      terminateChild();
      wake();
    };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    const stdout = child.stdout;
    if (stdout) {
      const rl = createInterface({ input: stdout });
      rl.on('line', (line) => {
        if (finished) return;
        applyEvents(parseJunieStreamLine(line));
      });
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        stderrLines.push(trimmed);
      }
      if (stderrLines.length > 12) {
        stderrLines.splice(0, stderrLines.length - 12);
      }
    });

    child.on('error', (error) => {
      enqueue({ type: 'error', text: error.message } satisfies ErrorStreamEvent);
    });

    child.on('close', (code) => {
      processClosed = true;
      exitCode = code;
      wake();
    });

    const monitor = (async () => {
      while (!finished && !opts.signal?.aborted) {
        if (!state.sessionId) {
          const discoveredSessionId = await this.findNewSessionId(knownSessionIds, opts.cwd);
          if (discoveredSessionId) {
            state.sessionId = discoveredSessionId;
            state.processedLineCount = 0;
            emitInitIfNeeded();
          }
        }

        if (state.sessionId) {
          state.processedLineCount = await this.pollSessionEvents(state, handleParsedSessionLine);
        }

        if (finished || processClosed) {
          break;
        }

        await sleep(SESSION_POLL_INTERVAL_MS, opts.signal).catch(() => {});
      }

      if (!finished && state.sessionId) {
        state.processedLineCount = await this.pollSessionEvents(state, handleParsedSessionLine);
      }

      if (finished || opts.signal?.aborted) {
        return;
      }

      enqueue({
        type: 'error',
        text: buildJunieExitError(exitCode, stderrLines),
      } satisfies ErrorStreamEvent);
    })();

    try {
      while (true) {
        if (queue.length === 0) {
          if (finished && processClosed) {
            break;
          }
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          if (queue.length === 0 && finished) {
            break;
          }
        }

        const event = queue.shift();
        if (!event) {
          if (finished) break;
          continue;
        }
        yield event;
      }
    } finally {
      finished = true;
      if (turnTimeoutId) {
        clearTimeout(turnTimeoutId);
      }
      opts.signal?.removeEventListener('abort', abortHandler);
      terminateChild();
      await monitor.catch(() => {});
    }
  }

  private async pollSessionEvents(
    state: LiveJunieTurnState,
    onLine: (line: string) => void,
  ): Promise<number> {
    if (!state.sessionId) {
      return 0;
    }

    const eventsPath = join(this.sessionsDir, state.sessionId, 'events.jsonl');
    const lines = await readJsonlLines(eventsPath);
    if (state.processedLineCount > lines.length) {
      return lines.length;
    }

    for (const line of lines.slice(state.processedLineCount)) {
      onLine(line);
    }
    return lines.length;
  }

  private async readEventLineCount(sessionId: string): Promise<number> {
    const eventsPath = join(this.sessionsDir, sessionId, 'events.jsonl');
    const lines = await readJsonlLines(eventsPath);
    return lines.length;
  }

  private async readKnownSessionIds(): Promise<Set<string>> {
    const entries = await readJunieIndexEntries(join(this.sessionsDir, 'index.jsonl'));
    return new Set(entries.map((entry) => entry.sessionId));
  }

  private async findNewSessionId(
    knownSessionIds: Set<string>,
    cwd: string,
  ): Promise<string | null> {
    const entries = await readJunieIndexEntries(join(this.sessionsDir, 'index.jsonl'));
    const normalizedCwd = normalizeComparablePath(cwd);
    const candidates = entries.filter((entry) => !knownSessionIds.has(entry.sessionId));
    const exactMatch = candidates.filter(
      (entry) => normalizeComparablePath(entry.projectDir) === normalizedCwd,
    );

    const selected = exactMatch.at(-1) ?? (candidates.length === 1 ? candidates[0] : null);
    if (!selected) {
      return null;
    }

    knownSessionIds.add(selected.sessionId);
    return selected.sessionId;
  }
}

function normalizeJunieModelId(model?: string): string | undefined {
  if (!model) return undefined;

  const trimmed = model.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/^openai\//, '')
    .replace(/^anthropic\//, '')
    .replace(/^google\//, '')
    .replace(/^xai\//, '')
    .trim();

  if (normalized.includes('codex')) {
    return 'gpt-codex';
  }

  if (normalized.startsWith('gpt')) {
    return 'gpt';
  }

  if (normalized.includes('opus')) {
    return 'opus';
  }

  if (normalized.includes('sonnet')) {
    return 'sonnet';
  }

  if (normalized.includes('gemini') && normalized.includes('flash')) {
    return 'gemini-flash';
  }

  if (normalized.includes('gemini')) {
    return 'gemini-pro';
  }

  if (normalized.includes('grok')) {
    return 'grok';
  }

  return trimmed;
}

interface LiveJunieTurnState {
  sessionId?: string;
  initEmitted: boolean;
  processedLineCount: number;
  usage: JunieUsageTotals;
  lastProgressKey: string;
  lastProgressText: string;
  lastMeaningfulProgressText: string;
}

interface JunieIndexEntry {
  sessionId: string;
  projectDir: string;
}

function isJunieProgressEvent(event: StreamEvent): boolean {
  return event.type === 'progress'
    && typeof event.metadata?.native === 'object'
    && event.metadata?.native !== null
    && (event.metadata.native as Record<string, unknown>).source === 'junie-progress';
}

function buildProgressKey(event: StreamEvent): string {
  return `${event.metadata?.kind ?? ''}:${event.text ?? ''}`;
}

function isLowSignalJunieStatus(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === 'sending llm request';
}

function mergeUsage(base: JunieUsageTotals, delta: JunieUsageTotals): JunieUsageTotals {
  return {
    inputTokens: base.inputTokens + delta.inputTokens,
    outputTokens: base.outputTokens + delta.outputTokens,
    estimatedCost: (base.estimatedCost ?? 0) + (delta.estimatedCost ?? 0),
    currency: base.currency ?? delta.currency,
  };
}

function normalizeUsage(usage: JunieUsageTotals): JunieUsageTotals | undefined {
  if (
    usage.inputTokens <= 0
    && usage.outputTokens <= 0
    && (usage.estimatedCost ?? 0) <= 0
  ) {
    return undefined;
  }
  return usage;
}

async function readJunieIndexEntries(indexPath: string): Promise<JunieIndexEntry[]> {
  const lines = await readJsonlLines(indexPath);
  const entries: JunieIndexEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.sessionId !== 'string' || typeof parsed.projectDir !== 'string') {
        continue;
      }
      entries.push({
        sessionId: parsed.sessionId,
        projectDir: parsed.projectDir,
      });
    } catch {
      continue;
    }
  }

  return entries;
}

async function readJsonlLines(path: string): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function buildJunieExitError(code: number | null, stderrLines: string[]): string {
  const details = [`Junie exited with code ${code} before producing a usable result`];
  if (stderrLines.length > 0) {
    details.push(`stderr: ${stderrLines.join(' | ')}`);
  }
  return details.join('. ');
}

function buildJunieTurnTimeoutError(
  timeoutMs: number,
  state: LiveJunieTurnState,
): string {
  const details = [`Junie did not finish within ${timeoutMs}ms`];
  if (state.sessionId) {
    details.push(`session: ${state.sessionId}`);
  }
  const progress = state.lastMeaningfulProgressText || state.lastProgressText;
  if (progress) {
    details.push(`last progress: ${progress}`);
  }
  details.push(
    `Set ${JUNIE_TURN_TIMEOUT_ENV}=0 to disable the limit or raise it for longer tasks`,
  );
  return details.join('. ');
}

function resolveJunieTurnTimeoutMs(): number {
  const raw = process.env[JUNIE_TURN_TIMEOUT_ENV]?.trim();
  if (!raw) {
    return DEFAULT_JUNIE_TURN_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_JUNIE_TURN_TIMEOUT_MS;
  }

  return parsed;
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
