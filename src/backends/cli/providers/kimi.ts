import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ProviderCommandConfig } from '../config.js';
import {
  createKimiParseState,
  parseKimiFailure,
  parseKimiStreamLine,
  readKimiTurnTelemetry,
  type KimiTurnTelemetry,
} from '../kimi/parser.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import type { ErrorStreamEvent, InitStreamEvent, ResultStreamEvent } from '../../../core/types.js';
import { compileRuntimeTurnPrompt } from './prompt.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';
import { killWindowsProcessTree } from '../../../core/process/processTree.js';
import { appendStderrLines } from '../stderrLines.js';
import { providerSessionUnavailableEvent } from '../../../core/runtime/providerSessionUnavailable.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';

/** Print mode, machine-readable. The prompt follows as `-p <prompt>`. */
export const KIMI_STREAM_JSON_BASE_ARGS = ['--output-format', 'stream-json'] as const;
export const KIMI_STREAM_JSON_PROFILE_ID = 'kimi-cli-stream-json-v1';

const DEFAULT_KIMI_TURN_TIMEOUT_MS = 30 * 60 * 1000;
const KIMI_TURN_TIMEOUT_ENV = 'CATS_KIMI_TURN_TIMEOUT_MS';
/** Wire journals beyond this size are skipped rather than read for usage. */
const MAX_WIRE_JOURNAL_BYTES = 64 * 1024 * 1024;

interface KimiProviderOptions {
  /** Kimi's data root; defaults to KIMI_CODE_HOME, then ~/.kimi-code. */
  kimiHome?: string;
  evolutionObserver?: ProviderEvolutionEvidenceObserver;
}

/**
 * Kimi Code CLI in print mode (`kimi -p ... --output-format stream-json`).
 *
 * Print mode always runs in Kimi's `auto` permission mode: every tool call is
 * decided without asking, and `--yolo`, `--auto` and `--plan` are rejected
 * alongside `--prompt`. There is no per-invocation effort flag; Kimi applies
 * the effort configured in its own config.toml or the model's default.
 *
 * The adapter owns the turn instead of the worker's line pump because Kimi
 * writes an assistant step only after that step's tools finish: a long shell
 * command leaves stdout silent for longer than the worker's idle timeout, and
 * failures arrive on stderr after a stdout line was already seen.
 */
export class KimiProvider implements Provider {
  name = 'kimi';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private readonly parseState = createKimiParseState();
  private pendingPrompt: string | null = null;

  constructor(
    private readonly commandConfig?: ProviderCommandConfig,
    private readonly options: KimiProviderOptions = {},
  ) {}

  resolveFirstEventTimeoutMs(_defaultTimeoutMs: number): number {
    return 0;
  }

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const prompt = this.pendingPrompt;
    this.pendingPrompt = null;
    return buildKimiArgs(opts, prompt);
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    return parseKimiStreamLine(line, this.options.evolutionObserver, this.parseState);
  }

  async *streamTurn(turn: TurnInput, opts: ProviderTurnOptions): AsyncGenerator<StreamEvent> {
    if (!this.commandConfig) {
      throw new Error('Kimi command config is required before sending a message');
    }

    const args = buildKimiArgs(opts, compileRuntimeTurnPrompt(turn.message, turn));
    const spawnConfig = buildProcessSpawnConfig(this.commandConfig, this.name, args, opts.cwd);
    const env: NodeJS.ProcessEnv = { ...process.env, ...spawnConfig.env };
    delete env.CLAUDECODE;

    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd ?? opts.cwd,
      // Print mode takes the prompt from argv and never reads stdin.
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: spawnConfig.shell,
      windowsVerbatimArguments: spawnConfig.windowsVerbatimArguments,
      env,
      ...hiddenWindowsSpawnOptions(),
    });

    const parseState = createKimiParseState();
    const queue: StreamEvent[] = [];
    const stderrLines: string[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let completion: ResultStreamEvent | null = null;
    let stdoutError: ErrorStreamEvent | null = null;
    let launchError: Error | null = null;

    const wake = () => {
      const resolve = notify;
      notify = null;
      resolve?.();
    };
    const enqueue = (event: StreamEvent) => {
      if (finished) return;
      queue.push(event);
      if (event.type === 'result' || event.type === 'error') finished = true;
      wake();
    };

    if (opts.resumeSessionId) {
      enqueue({ type: 'init', sessionId: opts.resumeSessionId } satisfies InitStreamEvent);
    }

    const turnTimeoutMs = resolveKimiTurnTimeoutMs();
    const turnTimer = turnTimeoutMs > 0
      ? setTimeout(() => {
        enqueue({
          type: 'error',
          sessionId: opts.resumeSessionId,
          text: `Kimi Code did not finish within ${turnTimeoutMs}ms. Set ${KIMI_TURN_TIMEOUT_ENV}=0 `
            + 'to disable the limit or raise it for longer tasks.',
        } satisfies ErrorStreamEvent);
        terminateKimi(child);
      }, turnTimeoutMs)
      : undefined;

    const abortHandler = () => {
      finished = true;
      terminateKimi(child);
      wake();
    };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    if (child.stdout) {
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        const parsed = parseKimiStreamLine(line, this.options.evolutionObserver, parseState);
        for (const event of parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]) {
          // The resume hint is written just before a successful exit; hold it
          // until the exit code confirms the turn and usage can be attached.
          if (event.type === 'result') completion = event;
          else if (event.type === 'error') stdoutError = event;
          else enqueue(event);
        }
      });
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      appendStderrLines(stderrLines, chunk.toString('utf-8'));
    });
    child.on('error', (error) => { launchError = error; });

    const closed = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });
    void closed.then(async (code) => {
      if (finished) return;
      const result: ResultStreamEvent | null = completion;
      if (code === 0 && result) {
        const telemetry = await this.readTelemetry(result.sessionId, opts.model);
        enqueue({
          ...result,
          ...(telemetry.usage ? { usage: telemetry.usage } : {}),
          ...(telemetry.reportedModels ? { reportedModels: telemetry.reportedModels } : {}),
        });
        return;
      }
      enqueue(buildKimiExitError(code, stderrLines, {
        launchError,
        stdoutError,
        resumeSessionId: opts.resumeSessionId,
      }));
    }).finally(wake);

    try {
      while (true) {
        if (queue.length === 0) {
          if (finished) break;
          await new Promise<void>((resolve) => { notify = resolve; });
          continue;
        }
        const event = queue.shift();
        if (event) yield event;
      }
    } finally {
      finished = true;
      if (turnTimer) clearTimeout(turnTimer);
      opts.signal?.removeEventListener('abort', abortHandler);
      terminateKimi(child);
    }
  }

  /** Native runs only: WSL and Docker keep the journal inside their own filesystem. */
  private async readTelemetry(
    sessionId: string | undefined,
    requestedModel: string | undefined,
  ): Promise<KimiTurnTelemetry> {
    if (!sessionId || this.commandConfig?.runtime.mode !== 'native') return {};
    try {
      const wirePath = await findKimiWireJournal(resolveKimiHome(this.options.kimiHome), sessionId);
      if (!wirePath) return {};
      if ((await stat(wirePath)).size > MAX_WIRE_JOURNAL_BYTES) return {};
      return readKimiTurnTelemetry(await readFile(wirePath, 'utf8'), requestedModel?.trim() || undefined);
    } catch {
      return {};
    }
  }
}

export function buildKimiArgs(opts: ProviderSpawnOptions, prompt: string | null): string[] {
  const args: string[] = [...KIMI_STREAM_JSON_BASE_ARGS];
  const model = opts.model?.trim();
  if (model) args.push('--model', model);
  if (opts.resumeSessionId) args.push('--session', opts.resumeSessionId);
  // Commander gives a required option-argument the next argv entry even when
  // it starts with a dash, so a prompt like "-x" stays the prompt.
  if (prompt !== null) args.push('--prompt', prompt);
  return args;
}

export function resolveKimiHome(configured?: string, env: NodeJS.ProcessEnv = process.env): string {
  return configured?.trim() || env.KIMI_CODE_HOME?.trim() || join(os.homedir(), '.kimi-code');
}

/** `<home>/sessions/<workdir key>/<session id>/agents/main/wire.jsonl`. */
export async function findKimiWireJournal(kimiHome: string, sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/u.test(sessionId)) return null;
  const sessionsDir = join(kimiHome, 'sessions');
  let workdirs: string[];
  try {
    workdirs = await readdir(sessionsDir);
  } catch {
    return null;
  }
  for (const workdir of workdirs) {
    if (workdir.startsWith('.')) continue;
    const candidate = join(sessionsDir, workdir, sessionId, 'agents', 'main', 'wire.jsonl');
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not this workdir.
    }
  }
  return null;
}

export function buildKimiExitError(
  code: number | null,
  stderrLines: readonly string[],
  context: {
    launchError?: Error | null;
    stdoutError?: ErrorStreamEvent | null;
    resumeSessionId?: string;
  } = {},
): ErrorStreamEvent {
  if (context.launchError) {
    return { type: 'error', text: `Kimi Code could not start: ${context.launchError.message}` };
  }
  if (context.stdoutError) return context.stdoutError;
  const failure = parseKimiFailure(stderrLines);
  if (failure?.sessionUnavailable && context.resumeSessionId) {
    return providerSessionUnavailableEvent(`Kimi Code cannot resume this session: ${failure.message}`);
  }
  if (failure) return { type: 'error', text: `Kimi Code failed: ${failure.message}` };
  const details = stderrLines.filter((line) => !/^See log: /u.test(line.trim()));
  return {
    type: 'error',
    text: code === 0
      ? 'Kimi Code exited without completing the turn.'
      : `Kimi Code exited with code ${code} before completing the turn`
        + (details.length ? `. stderr: ${details.join(' | ')}` : '.'),
  };
}

function terminateKimi(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    // Kimi runs shell tools as its own children; end the whole tree.
    void killWindowsProcessTree(child);
    return;
  }
  child.kill('SIGTERM');
}

function resolveKimiTurnTimeoutMs(): number {
  const raw = process.env[KIMI_TURN_TIMEOUT_ENV]?.trim();
  if (!raw) return DEFAULT_KIMI_TURN_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_KIMI_TURN_TIMEOUT_MS;
}
