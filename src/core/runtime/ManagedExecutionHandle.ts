import { EventEmitter } from 'node:events';
import type {
  ExecutionHandle,
  RuntimeIncidentClassification,
  RuntimeProviderRefusal,
  StreamEvent,
  TurnInput,
} from '../types.js';

type ExecutionEventName = 'event' | 'exit' | 'error';
type ExecutionListener = (...args: unknown[]) => void;

export type ManagedExecutionLifecycleReason =
  | 'cancel'
  | 'close'
  | 'delete'
  | 'reset'
  | 'shutdown';

export interface ManagedExecutionLifecycleInput {
  reason: ManagedExecutionLifecycleReason;
  busy: boolean;
  signal?: AbortSignal;
}

export interface ManagedExecutionCallbacks {
  streamMessage(input: TurnInput, signal: AbortSignal): AsyncGenerator<StreamEvent>;
  onCancel?(input: ManagedExecutionLifecycleInput): Promise<void> | void;
  onClose?(input: ManagedExecutionLifecycleInput): Promise<void> | void;
}

export class ManagedExecutionHandle implements ExecutionHandle {
  private readonly emitter = new EventEmitter();
  private activeState = true;
  private busyState = false;
  private abortController?: AbortController;
  private cancelPromise?: Promise<void>;

  constructor(private readonly callbacks: ManagedExecutionCallbacks) {}

  get active(): boolean {
    return this.activeState;
  }

  get busy(): boolean {
    return this.busyState;
  }

  async *streamMessage(message: string | TurnInput): AsyncGenerator<StreamEvent> {
    if (!this.activeState) {
      throw new Error('Session is closed. Resume it first.');
    }
    if (this.busyState) {
      throw new Error('Session is busy processing another message');
    }

    this.busyState = true;
    this.abortController = new AbortController();
    const turn = typeof message === 'string' ? { message } : message;

    try {
      for await (const event of this.callbacks.streamMessage(turn, this.abortController.signal)) {
        this.emitter.emit('event', event);
        yield event;
      }
    } catch (error) {
      const errorEvent = buildErrorStreamEvent(error);
      this.emitter.emit('event', errorEvent);
      this.emitManagedError(error);
      yield errorEvent;
    } finally {
      this.busyState = false;
      this.abortController = undefined;
    }
  }

  async cancel(reason: ManagedExecutionLifecycleReason = 'cancel'): Promise<void> {
    if (!this.activeState && !this.busyState) {
      return;
    }

    await this.runCancel(reason);
  }

  async close(reason: ManagedExecutionLifecycleReason = 'close'): Promise<void> {
    if (!this.activeState) {
      return;
    }

    const lifecycleInput = {
      reason,
      busy: this.busyState,
      signal: this.abortController?.signal,
    } satisfies ManagedExecutionLifecycleInput;

    this.activeState = false;
    let lifecycleError: unknown;

    try {
      await this.runCancel(reason);
    } catch (error) {
      lifecycleError = error;
    }

    try {
      await this.callbacks.onClose?.(lifecycleInput);
    } catch (error) {
      if (!lifecycleError) {
        lifecycleError = error;
      } else {
        this.emitManagedError(error);
      }
    }

    this.emitter.emit('exit');
    if (lifecycleError) {
      throw lifecycleError;
    }
  }

  kill(): void {
    void this.close('close').catch((error) => {
      this.emitManagedError(error);
    });
  }

  on(event: ExecutionEventName, listener: ExecutionListener): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: ExecutionEventName, listener: ExecutionListener): this {
    this.emitter.off(event, listener);
    return this;
  }

  private async runCancel(reason: ManagedExecutionLifecycleReason): Promise<void> {
    if (this.cancelPromise) {
      await this.cancelPromise;
      return;
    }

    const lifecycleInput = {
      reason,
      busy: this.busyState,
      signal: this.abortController?.signal,
    } satisfies ManagedExecutionLifecycleInput;

    this.abortController?.abort();
    const promise = Promise.resolve(this.callbacks.onCancel?.(lifecycleInput))
      .finally(() => {
        if (this.cancelPromise === promise) {
          this.cancelPromise = undefined;
        }
      });
    this.cancelPromise = promise;
    await promise;
  }

  private emitManagedError(error: unknown): void {
    if (this.emitter.listenerCount('error') > 0) {
      this.emitter.emit('error', error);
    }
  }
}

function buildErrorStreamEvent(error: unknown): StreamEvent {
  const text = error instanceof Error ? error.message : String(error);
  const refusal = readProviderRefusal(error);
  if (!refusal) {
    return {
      type: 'error',
      text,
    } satisfies StreamEvent;
  }

  const incidentHint = buildIncidentHint(refusal);

  return {
    type: 'error',
    text,
    metadata: {
      providerRefusal: refusal,
      ...(incidentHint ? { incidentHint } : {}),
    },
  } satisfies StreamEvent;
}

function readProviderRefusal(error: unknown): RuntimeProviderRefusal | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const candidate = (error as { refusal?: RuntimeProviderRefusal }).refusal;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  if (typeof candidate.category !== 'string' || typeof candidate.message !== 'string') {
    return undefined;
  }
  return candidate;
}

function buildIncidentHint(
  refusal: RuntimeProviderRefusal,
): {
  classification: RuntimeIncidentClassification;
  statusCode?: number;
  retryAfterMs?: number;
  evidenceSummary: string;
  metadata: Record<string, unknown>;
} | undefined {
  const classification = mapRefusalToIncidentClassification(refusal);
  if (!classification) {
    return undefined;
  }

  return {
    classification,
    ...(typeof refusal.statusCode === 'number' ? { statusCode: refusal.statusCode } : {}),
    ...(typeof refusal.retryAfterMs === 'number' ? { retryAfterMs: refusal.retryAfterMs } : {}),
    evidenceSummary: refusal.evidenceSummary ?? refusal.message,
    metadata: {
      refusalCategory: refusal.category,
      ...(refusal.metadata ?? {}),
    },
  };
}

function mapRefusalToIncidentClassification(
  refusal: RuntimeProviderRefusal,
): RuntimeIncidentClassification | undefined {
  switch (refusal.category) {
    case 'rate_limited':
    case 'capacity_exhausted':
      return 'rate_limited';
    default:
      return undefined;
  }
}
