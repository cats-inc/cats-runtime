import { EventEmitter } from 'node:events';
import type { ExecutionHandle, StreamEvent } from '../../../core/types.js';

type ExecutionEventName = 'event' | 'exit' | 'error';
type ExecutionListener = (...args: unknown[]) => void;

export interface ApiExecutionCallbacks {
  streamMessage(message: string, signal: AbortSignal): AsyncGenerator<StreamEvent>;
  onClose(): void;
}

export class ApiExecutionHandle implements ExecutionHandle {
  private readonly emitter = new EventEmitter();
  private activeState = true;
  private busyState = false;
  private abortController?: AbortController;

  constructor(private readonly callbacks: ApiExecutionCallbacks) {}

  get active(): boolean {
    return this.activeState;
  }

  get busy(): boolean {
    return this.busyState;
  }

  async *streamMessage(message: string): AsyncGenerator<StreamEvent> {
    if (!this.activeState) {
      throw new Error('Session is closed. Resume it first.');
    }
    if (this.busyState) {
      throw new Error('Session is busy processing another message');
    }

    this.busyState = true;
    this.abortController = new AbortController();

    try {
      for await (const event of this.callbacks.streamMessage(message, this.abortController.signal)) {
        this.emitter.emit('event', event);
        yield event;
      }
    } catch (error) {
      const errorEvent: StreamEvent = {
        type: 'error',
        text: error instanceof Error ? error.message : String(error),
      };
      this.emitter.emit('event', errorEvent);
      this.emitter.emit('error', error);
      yield errorEvent;
    } finally {
      this.busyState = false;
      this.abortController = undefined;
    }
  }

  kill(): void {
    if (!this.activeState) {
      return;
    }

    this.activeState = false;
    this.abortController?.abort();
    this.callbacks.onClose();
    this.emitter.emit('exit');
  }

  on(event: ExecutionEventName, listener: ExecutionListener): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: ExecutionEventName, listener: ExecutionListener): this {
    this.emitter.off(event, listener);
    return this;
  }
}
