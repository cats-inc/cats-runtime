import { EventEmitter } from 'node:events';
import type { ExecutionHandle, StreamEvent, TurnInput } from '../types.js';

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
      const errorEvent = {
        type: 'error',
        text: error instanceof Error ? error.message : String(error),
      } satisfies StreamEvent;
      this.emitter.emit('event', errorEvent);
      this.emitter.emit('error', error);
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
        this.emitter.emit('error', error);
      }
    }

    this.emitter.emit('exit');
    if (lifecycleError) {
      throw lifecycleError;
    }
  }

  kill(): void {
    void this.close('close').catch((error) => {
      this.emitter.emit('error', error);
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
}
