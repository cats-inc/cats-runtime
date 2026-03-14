import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { ProviderCommandConfig } from '../config.js';
import type { Provider, ProviderSpawnOptions, StreamEvent } from '../providers/types.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';

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
    const args = this.provider.buildSpawnArgs(this.spawnOpts);

    // Strip CLAUDECODE env var so nested sessions don't get blocked
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const spawnConfig = this.resolveSpawnConfig(args);
    if (spawnConfig.env) {
      Object.assign(env, spawnConfig.env);
    }
    this.stderrLines = [];
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
      env,
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

      const event = this.provider.parseStreamLine(line);
      if (event) {
        // Track session ID for ephemeral resume
        if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
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
    });

    // Drain stderr to prevent buffer deadlock
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        this.captureStderr(text);
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
  async sendMessage(content: string): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of this.streamMessage(content)) {
      events.push(event);
    }
    return events;
  }

  /**
   * Send a message and yield StreamEvents as they arrive (for SSE streaming).
   */
  async *streamMessage(content: string): AsyncGenerator<StreamEvent> {
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
        for await (const event of this.provider.streamTurn(content, {
          ...this.spawnOpts,
          signal: controller.signal,
        })) {
          if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
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

    const push = (item: StreamEvent | null) => {
      queue.push(item);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const onEvent = (event: StreamEvent) => {
      sawEvent = true;
      push(event);
      if (event.type === 'result' || event.type === 'error') {
        push(null); // signal done
      }
    };

    const onError = (err: Error) => {
      error = err;
      push(null);
    };

    const onExit = (code: number | null) => {
      void handleExit(code);
    };

    const handleExit = async (code: number | null) => {
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
        const { retries, timeoutMs } = this.spawnResilience;

        for (let attempt = 1; attempt <= retries; attempt++) {
          // Reset per-attempt state
          sawEvent = false;
          error = null;
          queue.length = 0;

          if (this._providerSessionId) {
            this.spawnOpts = { ...this.spawnOpts, resumeSessionId: this._providerSessionId };
          }
          await this.runProviderBeforeTurn();
          this.provider.prepareEphemeralTurn?.(content);
          this.spawnProcess();
          const msg = this.provider.buildStdinMessage(content);
          if (msg) this.process!.stdin!.write(msg);
          this.process!.stdin!.end();

          // Per-attempt spawn timeout
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          if (timeoutMs > 0) {
            timeoutId = setTimeout(() => {
              if (!sawEvent && this.process && this.process.exitCode === null) {
                error = new Error(
                  `Provider did not respond within ${timeoutMs}ms`
                  + (this.lastLaunchSummary ? `. launch: ${this.lastLaunchSummary}` : ''),
                );
                this.process.kill('SIGTERM');
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
        const msg = this.provider.buildStdinMessage(content);
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
      this.isBusy = false;
      this.removeListener('event', onEvent);
      this.removeListener('error', onError);
      this.removeListener('exit', onExit);
    }
  }

  kill(): void {
    this.activeTurnController?.abort();
    if (this.provider.ephemeral) this._ephemeralKilled = true;

    if (this.process && this.process.exitCode === null) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }

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
      if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
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
