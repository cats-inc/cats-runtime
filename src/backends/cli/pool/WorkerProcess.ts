import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { ProviderCommandConfig } from '../config.js';
import type {
  ErrorStreamEvent,
  InitStreamEvent,
  ResultStreamEvent,
  StreamEvent,
  TurnInput,
} from '../../../core/types.js';
import type {
  Provider,
  ProviderLaunchFailureInput,
  ProviderSpawnOptions,
  RuntimeProviderRefusal,
} from '../providers/types.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

export interface WorkerProcessEvents {
  event: [StreamEvent];
  error: [Error];
  exit: [number | null, NodeJS.Signals | null];
  ready: [];
}

export interface SpawnResilienceConfig {
  retries: number;
  timeoutMs: number;
}

function isSessionIdentityEvent(
  event: StreamEvent,
): event is InitStreamEvent | ResultStreamEvent {
  return event.type === 'init' || event.type === 'result';
}

function isTerminalStreamEvent(
  event: StreamEvent,
): event is ErrorStreamEvent | ResultStreamEvent {
  return event.type === 'result' || event.type === 'error';
}

export class WorkerProcess extends EventEmitter<WorkerProcessEvents> {
  private process: ChildProcess | null = null;
  private provider: Provider;
  private spawnOpts: ProviderSpawnOptions;
  private commandConfig: ProviderCommandConfig;
  private isBusy = false;
  private _ephemeralKilled = false;
  private _providerSessionId: string | null = null;
  private activeTurnController: AbortController | null = null;
  private stderrLines: string[] = [];
  private launchFailureRefusal: RuntimeProviderRefusal | null = null;
  private launchResponseObserved = false;
  private lastLaunchSummary = '';
  private spawnResilience: SpawnResilienceConfig;

  constructor(
    provider: Provider,
    spawnOpts: ProviderSpawnOptions,
    commandConfig: ProviderCommandConfig,
    spawnResilience: SpawnResilienceConfig = { retries: 1, timeoutMs: 30_000 },
  ) {
    super();
    this.provider = provider;
    this.spawnOpts = spawnOpts;
    this.commandConfig = commandConfig;
    this.spawnResilience = spawnResilience;
  }

  get alive(): boolean {
    if (this.provider.ephemeral) return !this._ephemeralKilled;
    return this.process !== null && this.process.exitCode === null;
  }

  get busy(): boolean {
    return this.isBusy;
  }

  start(): void {
    if (this.provider.ephemeral) return; // defer to sendMessage
    this.spawnProcess();
  }

  private spawnProcess(): void {
    const args = [
      ...(this.commandConfig.args ?? []),
      ...this.provider.buildSpawnArgs(this.spawnOpts),
    ];

    // Strip CLAUDECODE env var so nested sessions don't get blocked
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const spawnConfig = this.resolveSpawnConfig(args);
    if (spawnConfig.env) {
      Object.assign(env, spawnConfig.env);
    }
    this.stderrLines = [];
    this.launchFailureRefusal = null;
    this.launchResponseObserved = false;
    this.lastLaunchSummary = formatLaunchSummary(
      this.commandConfig.runtime.mode,
      this.commandConfig.runner,
      spawnConfig.command,
      this.commandConfig.path,
    );

    this.process = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd ?? this.spawnOpts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spawnConfig.shell,
      windowsVerbatimArguments: spawnConfig.windowsVerbatimArguments,
      env,
      ...hiddenWindowsSpawnOptions(),
    });

    // Read stdout line-by-line (NDJSON)
    const rl = createInterface({ input: this.process.stdout! });
    rl.on('line', (line) => {
      // Handle auto-response (e.g. Codex approval requests)
      if (this.provider.buildAutoResponse) {
        const response = this.provider.buildAutoResponse(line);
        if (response) {
          this.process!.stdin!.write(response);
        }
      }

      const parsed = this.provider.parseStreamLine(line);
      if (parsed) {
        const events = Array.isArray(parsed) ? parsed : [parsed];
        for (const event of events) {
          this.launchResponseObserved = true;
          if (isSessionIdentityEvent(event) && event.sessionId) {
            this._providerSessionId = event.sessionId;
          }
          // If provider has pending messages after init, send them
          if (event.type === 'init' && this.provider.getPendingTurnStart) {
            const pending = this.provider.getPendingTurnStart();
            if (pending) {
              this.process!.stdin!.write(pending);
            }
          }
          this.emit('event', event);
        }
      }
    });

    // Drain stderr to prevent buffer deadlock
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        this.captureStderr(text);
        const refusal = this.recordLaunchFailureRefusal({
          source: 'stderr',
          line: text,
          stderrLines: [...this.stderrLines],
        });
        this.maybeFailFastOnLaunchRefusal(refusal);
        if (shouldLogProviderStderr(this.provider.name)) {
          console.error(`[${this.provider.name}:stderr] ${text}`);
        }
      }
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });

    this.process.on('close', (code, signal) => {
      this.process = null;
      this.isBusy = false;
      this.emit('exit', code, signal);
    });
  }

  /**
   * Send a message to the CLI process via stdin.
   * Returns an async iterable of StreamEvents for this turn.
   */
  async sendMessage(content: string | TurnInput): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of this.streamMessage(content)) {
      events.push(event);
    }
    return events;
  }

  /**
   * Send a message and yield StreamEvents as they arrive (for SSE streaming).
   */
  async *streamMessage(content: string | TurnInput): AsyncGenerator<StreamEvent> {
    const turn = typeof content === 'string' ? { message: content } : content;

    if (!this.alive) {
      throw new Error('Worker process is not running');
    }
    if (this.isBusy) {
      throw new Error('Worker is busy processing another message');
    }

    if (this.provider.streamTurn) {
      this.isBusy = true;
      const controller = new AbortController();
      this.activeTurnController = controller;

      if (this._providerSessionId) {
        this.spawnOpts = { ...this.spawnOpts, resumeSessionId: this._providerSessionId };
      }

      try {
        await this.runProviderBeforeTurn();
        for await (const event of this.provider.streamTurn(turn, {
          ...this.spawnOpts,
          signal: controller.signal,
        })) {
          if (isSessionIdentityEvent(event) && event.sessionId) {
            this._providerSessionId = event.sessionId;
          }
          this.emit('event', event);
          yield event;
        }
      } finally {
        this.isBusy = false;
        this.activeTurnController = null;
      }
      return;
    }

    this.isBusy = true;

    // Create a queue-based async iterator
    const queue: Array<StreamEvent | null> = [];
    let resolve: (() => void) | null = null;
    let error: Error | null = null;
    let sawEvent = false;
    let sawTerminalEvent = false;
    let currentAttemptTimeoutMs = 0;
    let turnInactivityTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const push = (item: StreamEvent | null) => {
      queue.push(item);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const clearTurnInactivityTimeout = () => {
      if (turnInactivityTimeoutId) {
        clearTimeout(turnInactivityTimeoutId);
        turnInactivityTimeoutId = undefined;
      }
    };

    const armTurnInactivityTimeout = () => {
      clearTurnInactivityTimeout();
      if (currentAttemptTimeoutMs <= 0 || sawTerminalEvent) {
        return;
      }

      turnInactivityTimeoutId = setTimeout(() => {
        if (!sawEvent || sawTerminalEvent || !this.process || this.process.exitCode !== null) {
          return;
        }
        error = this.buildProviderRefusalError({
          category: 'true_timeout',
          message: `${formatProviderDisplayName(this.provider.name)} stopped responding after the initial response for ${currentAttemptTimeoutMs}ms.`,
          retryable: true,
          source: 'timeout',
          evidenceSummary: this.stderrLines.length > 0
            ? this.stderrLines.join(' | ')
            : 'Provider emitted a non-terminal event but never finished the turn.',
        });
        this.emit('error', error);
        this.terminateLaunchProcess();
      }, currentAttemptTimeoutMs);
    };

    const onEvent = (event: StreamEvent) => {
      sawEvent = true;
      const terminal = isTerminalStreamEvent(event);
      if (terminal) {
        sawTerminalEvent = true;
        clearTurnInactivityTimeout();
      } else {
        armTurnInactivityTimeout();
      }
      push(event);
      if (terminal) {
        push(null); // signal done
      }
    };

    const onError = (err: Error) => {
      clearTurnInactivityTimeout();
      error = err;
      push(null);
    };

    const onExit = (code: number | null) => {
      void handleExit(code);
    };

    const handleExit = async (code: number | null) => {
      clearTurnInactivityTimeout();
      const refusal = this.recordLaunchFailureRefusal({
        source: 'exit',
        exitCode: code,
        stderrLines: [...this.stderrLines],
      });
      if (!sawEvent && refusal) {
        error = this.buildProviderRefusalError(refusal);
        push(null);
        return;
      }

      if (!sawEvent && (error || code !== 0)) {
        if (!error) {
          error = this.buildProcessExitError(code);
        }
        push(null);
        return;
      }

      try {
        await this.emitProviderAfterTurnEvents();
      } catch (err) {
        error = err as Error;
        push(null);
        return;
      }

      if (!sawEvent && !error) {
        error = this.buildProcessExitError(code);
      }
      push(null);
    };

    this.on('event', onEvent);
    this.on('error', onError);
    this.on('exit', onExit);

    try {
      if (this.provider.ephemeral) {
        const retries = this.spawnResilience.retries;
        const timeoutMs = this.provider.resolveFirstEventTimeoutMs?.(
          this.spawnResilience.timeoutMs,
        ) ?? this.spawnResilience.timeoutMs;

        for (let attempt = 1; attempt <= retries; attempt++) {
          // Reset per-attempt state
          sawEvent = false;
          sawTerminalEvent = false;
          error = null;
          queue.length = 0;
          clearTurnInactivityTimeout();
          currentAttemptTimeoutMs = timeoutMs;

          if (this._providerSessionId) {
            this.spawnOpts = { ...this.spawnOpts, resumeSessionId: this._providerSessionId };
          }
          await this.runProviderBeforeTurn();
          this.provider.prepareEphemeralTurn?.(turn);
          this.spawnProcess();
          const msg = this.provider.buildStdinMessage(turn.message, turn);
          if (msg) this.process!.stdin!.write(msg);
          this.process!.stdin!.end();

          // Most ephemeral providers stream early progress, but some only emit
          // stdout once the task has fully completed.
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          if (timeoutMs > 0) {
            timeoutId = setTimeout(() => {
              if (!sawEvent && this.process && this.process.exitCode === null) {
                const refusal = this.recordLaunchFailureRefusal({
                  source: 'timeout',
                  stderrLines: [...this.stderrLines],
                });
                error = refusal
                  ? this.buildProviderRefusalError(refusal)
                  : new Error(
                    `Provider did not respond within ${timeoutMs}ms`
                    + (this.lastLaunchSummary ? `. launch: ${this.lastLaunchSummary}` : ''),
                  );
                this.emit('error', error);
                this.terminateLaunchProcess();
              }
            }, timeoutMs);
          }

          // Wait for first event or process exit/error
          if (!sawEvent && !queue.includes(null)) {
            await new Promise<void>((r) => { resolve = r; });
          }

          if (timeoutId) clearTimeout(timeoutId);

          if (sawEvent) break; // spawn succeeded

          // Drain the termination sentinel so next attempt starts clean
          const nullIdx = queue.indexOf(null);
          if (nullIdx !== -1) queue.splice(nullIdx, 1);

          if (attempt < retries) {
            console.error(
              `[${this.provider.name}] Spawn attempt ${attempt}/${retries} failed`
              + formatRetryReason(error)
              + '. Retrying...',
            );
            error = null;
            continue;
          }

          // All attempts exhausted
          throw error || this.buildProcessExitError(null);
        }
      } else {
        await this.runProviderBeforeTurn();
      const msg = this.provider.buildStdinMessage(turn.message, turn);
        this.process!.stdin!.write(msg);
      }

      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => { resolve = r; });
        }

        const item = queue.shift();
        if (item === null || item === undefined) {
          if (error) throw error;
          break;
        }
        yield item;
      }
    } finally {
      clearTurnInactivityTimeout();
      this.isBusy = false;
      this.removeListener('event', onEvent);
      this.removeListener('error', onError);
      this.removeListener('exit', onExit);
    }
  }

  cancel(): void {
    this.activeTurnController?.abort();

    if (this.process && this.process.exitCode === null) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');

      setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  kill(): void {
    if (this.provider.ephemeral) this._ephemeralKilled = true;
    this.cancel();

    if (this.provider.ephemeral && !this.process) {
      this.emit('exit', 0, null);
    }
  }

  private captureStderr(text: string): void {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.stderrLines.push(trimmed);
    }
    if (this.stderrLines.length > 12) {
      this.stderrLines.splice(0, this.stderrLines.length - 12);
    }
  }

  private recordLaunchFailureRefusal(
    input: ProviderLaunchFailureInput,
  ): RuntimeProviderRefusal | null {
    const refusal = this.provider.classifyLaunchFailure?.(input)
      ?? inferCommonProviderRefusal(this.provider.name, input);
    if (refusal) {
      this.launchFailureRefusal = refusal;
      return refusal;
    }
    return this.launchFailureRefusal;
  }

  private buildProviderRefusalError(refusal: RuntimeProviderRefusal): Error {
    const error = new Error(refusal.message) as Error & { refusal: RuntimeProviderRefusal };
    error.name = 'ProviderRefusalError';
    error.refusal = {
      ...refusal,
      metadata: {
        ...(refusal.metadata ?? {}),
        ...(this.lastLaunchSummary ? { launch: this.lastLaunchSummary } : {}),
        ...(this.stderrLines.length > 0 ? { stderrLines: [...this.stderrLines] } : {}),
      },
    };
    return error;
  }

  private maybeFailFastOnLaunchRefusal(
    refusal: RuntimeProviderRefusal | null,
  ): void {
    if (!refusal || this.launchResponseObserved || !shouldFailFastOnRefusal(refusal)) {
      return;
    }
    if (!this.process || this.process.exitCode !== null) {
      return;
    }

    this.emit('error', this.buildProviderRefusalError(refusal));
    this.terminateLaunchProcess();
  }

  private terminateLaunchProcess(): void {
    if (!this.process || this.process.exitCode !== null) {
      return;
    }

    const processRef = this.process;
    processRef.kill('SIGTERM');

    setTimeout(() => {
      if (processRef.exitCode === null) {
        processRef.kill('SIGKILL');
      }
    }, 5000);
  }

  private buildProcessExitError(code: number | null): Error {
    const details = [`Process exited with code ${code} before responding`];
    if (this.lastLaunchSummary) {
      details.push(`launch: ${this.lastLaunchSummary}`);
    }
    if (this.stderrLines.length > 0) {
      details.push(`stderr: ${this.stderrLines.join(' | ')}`);
    }
    return new Error(details.join('. '));
  }

  private resolveSpawnConfig(args: string[]): {
    command: string;
    args: string[];
    shell: boolean | string;
    cwd?: string;
    env?: Record<string, string>;
    windowsVerbatimArguments?: boolean;
  } {
    return buildProcessSpawnConfig(
      this.commandConfig,
      this.provider.name,
      args,
      this.spawnOpts.cwd,
    );
  }

  private async runProviderBeforeTurn(): Promise<void> {
    await this.provider.beforeTurn?.(this.spawnOpts);
  }

  private async emitProviderAfterTurnEvents(): Promise<void> {
    const result = await this.provider.afterTurn?.(this.spawnOpts);
    if (!result) return;

    const events = Array.isArray(result) ? result : [result];
    for (const event of events) {
      if (isSessionIdentityEvent(event) && event.sessionId) {
        this._providerSessionId = event.sessionId;
      }
      this.emit('event', event);
    }
  }
}

function shouldLogProviderStderr(providerName: string): boolean {
  if (process.env.CATS_RUNTIME_LOG_STDERR === '1') {
    return true;
  }
  return providerName !== 'kiro';
}

function formatLaunchSummary(
  runtime: ProviderCommandConfig['runtime']['mode'],
  runner: ProviderCommandConfig['runner'],
  outerCommand: string,
  innerCommand: string,
): string {
  if (outerCommand === innerCommand) {
    return `${runtime}/${runner}:${outerCommand}`;
  }
  return `${runtime}/${runner}:${outerCommand} -> ${innerCommand}`;
}

function formatRetryReason(error: unknown): string {
  if (error instanceof Error) {
    return `: ${error.message}`;
  }
  if (typeof error === 'string' && error) {
    return `: ${error}`;
  }
  return '';
}

function inferCommonProviderRefusal(
  providerName: string,
  input: ProviderLaunchFailureInput,
): RuntimeProviderRefusal | null {
  const evidenceLines = collectEvidenceLines(input);
  if (evidenceLines.length === 0) {
    return null;
  }

  const evidenceSummary = evidenceLines.join(' | ');
  const displayName = formatProviderDisplayName(providerName);
  const capacityLine = evidenceLines.find((line) => lineHasCapacitySignal(line));
  if (capacityLine) {
    return {
      category: 'capacity_exhausted',
      message: `${displayName} has no capacity available for the selected model right now.`,
      statusCode: extractStatusCode(capacityLine) ?? 429,
      retryAfterMs: extractRetryAfterMs(capacityLine),
      retryable: true,
      source: input.source,
      evidenceSummary,
    };
  }

  const rateLimitLine = evidenceLines.find((line) => lineHasRateLimitSignal(line));
  if (rateLimitLine) {
    return {
      category: 'rate_limited',
      message: `${displayName} rate-limited the request.`,
      statusCode: extractStatusCode(rateLimitLine) ?? 429,
      retryAfterMs: extractRetryAfterMs(rateLimitLine),
      retryable: true,
      source: input.source,
      evidenceSummary,
    };
  }

  const authLine = evidenceLines.find((line) => lineHasAuthSignal(line));
  if (authLine) {
    return {
      category: 'auth_required',
      message: `${displayName} requires authentication before it can continue.`,
      statusCode: extractStatusCode(authLine) ?? 401,
      retryable: false,
      source: input.source,
      evidenceSummary,
    };
  }

  const unavailableLine = evidenceLines.find((line) => lineHasUnavailableSignal(line));
  if (unavailableLine) {
    return {
      category: 'provider_unavailable',
      message: `${displayName} is unavailable or not reachable right now.`,
      statusCode: extractStatusCode(unavailableLine),
      retryable: true,
      source: input.source,
      evidenceSummary,
    };
  }

  const rejectedLine = evidenceLines.find((line) => lineHasRejectedSignal(line));
  if (rejectedLine) {
    return {
      category: 'provider_rejected',
      message: `${displayName} refused the request.`,
      statusCode: extractStatusCode(rejectedLine) ?? 403,
      retryable: false,
      source: input.source,
      evidenceSummary,
    };
  }

  return null;
}

function shouldFailFastOnRefusal(refusal: RuntimeProviderRefusal): boolean {
  switch (refusal.category) {
    case 'rate_limited':
    case 'capacity_exhausted':
    case 'auth_required':
    case 'provider_unavailable':
    case 'provider_rejected':
      return true;
    default:
      return false;
  }
}

function collectEvidenceLines(input: ProviderLaunchFailureInput): string[] {
  const lines = [input.line, ...input.stderrLines]
    .flatMap((value) => (typeof value === 'string' ? value.split(/\r?\n/) : []))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return Array.from(new Set(lines));
}

function lineHasCapacitySignal(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('model_capacity_exhausted')
    || normalized.includes('no capacity available for model')
    || normalized.includes('capacity exhausted')
    || (normalized.includes('resource_exhausted') && extractStatusCode(line) === 429)
  );
}

function lineHasRateLimitSignal(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('too many requests')
    || normalized.includes('rate limit')
    || normalized.includes('ratelimit')
    || normalized.includes('retry after')
    || (normalized.includes('resource_exhausted') && extractStatusCode(line) === 429)
    || (extractStatusCode(line) === 429 && /^429\b/.test(normalized))
  );
}

function lineHasAuthSignal(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('authentication required')
    || normalized.includes('auth required')
    || normalized.includes('login required')
    || normalized.includes('not authenticated')
    || normalized.includes('unauthorized')
  );
}

function lineHasUnavailableSignal(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('connection refused')
    || normalized.includes('failed to connect')
    || normalized.includes('server is not running')
    || normalized.includes('daemon is not running')
    || normalized.includes('econnrefused')
  );
}

function lineHasRejectedSignal(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('forbidden')
    || normalized.includes('abuse')
    || normalized.includes('banned')
    || normalized.includes('suspended')
  );
}

function extractStatusCode(text: string): number | undefined {
  const patterns = [
    /\bstatus(?:\s*code)?\s*[:=]?\s*(401|403|408|409|423|429|500|502|503|504)\b/i,
    /\bhttp\s*(401|403|408|409|423|429|500|502|503|504)\b/i,
    /^\s*(401|403|408|409|423|429|500|502|503|504)\b/,
    /\b(401|403|408|409|423|429|500|502|503|504)\s+(?:too many requests|unauthorized|forbidden|service unavailable|bad gateway|gateway timeout)\b/i,
  ] as const;

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number.parseInt(match[1]!, 10);
    }
  }

  return undefined;
}

function extractRetryAfterMs(text: string): number | undefined {
  const normalized = text.toLowerCase();
  const millisecondMatch = normalized.match(/retry(?:ing)? after\s+(\d+)\s*ms/);
  if (millisecondMatch) {
    return Number.parseInt(millisecondMatch[1]!, 10);
  }

  const secondMatch = normalized.match(/retry(?:ing)? after\s+(\d+(?:\.\d+)?)\s*s/);
  if (secondMatch) {
    return Math.round(Number.parseFloat(secondMatch[1]!) * 1000);
  }

  return undefined;
}

function formatProviderDisplayName(providerName: string): string {
  if (!providerName) {
    return 'Provider';
  }
  return providerName.charAt(0).toUpperCase() + providerName.slice(1);
}
