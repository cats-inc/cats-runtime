import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent, TurnInput } from '../types.js';
import { ManagedExecutionHandle } from './ManagedExecutionHandle.js';

async function* noopStream(
  _input: TurnInput,
  _signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  return;
}

describe('ManagedExecutionHandle', () => {
  it('still closes and emits exit when cancel cleanup fails', async () => {
    const onClose = vi.fn();
    const onExit = vi.fn();
    const handle = new ManagedExecutionHandle({
      streamMessage: noopStream,
      onCancel: async () => {
        throw new Error('cancel failed');
      },
      onClose,
    });

    handle.on('exit', onExit);

    await expect(handle.close('close')).rejects.toThrow('cancel failed');

    expect(handle.active).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledTimes(1);

    await expect(handle.close('close')).resolves.toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('kill emits an error event when close cleanup fails', async () => {
    const onError = vi.fn();
    const onExit = vi.fn();
    const handle = new ManagedExecutionHandle({
      streamMessage: noopStream,
      onCancel: async () => {
        throw new Error('cancel failed');
      },
    });

    handle.on('error', onError);
    handle.on('exit', onExit);

    handle.kill();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });

    expect(handle.active).toBe(false);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('preserves provider refusal metadata when streamMessage throws', async () => {
    const refusalError: Error & {
      refusal: {
        category: 'capacity_exhausted';
        message: string;
        statusCode: number;
        retryable: boolean;
        source: 'stderr';
        evidenceSummary: string;
      };
    } = new Error('Gemini has no capacity available for the selected model right now.');
    refusalError.refusal = {
      category: 'capacity_exhausted',
      message: refusalError.message,
      statusCode: 429,
      retryable: true,
      source: 'stderr',
      evidenceSummary: 'MODEL_CAPACITY_EXHAUSTED',
    };

    const handle = new ManagedExecutionHandle({
      streamMessage: async function* () {
        throw refusalError;
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of handle.streamMessage({ message: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'error',
        text: 'Gemini has no capacity available for the selected model right now.',
        metadata: {
          providerRefusal: refusalError.refusal,
          incidentHint: {
            classification: 'rate_limited',
            statusCode: 429,
            evidenceSummary: 'MODEL_CAPACITY_EXHAUSTED',
            metadata: {
              refusalCategory: 'capacity_exhausted',
            },
          },
        },
      },
    ]);
  });
});
