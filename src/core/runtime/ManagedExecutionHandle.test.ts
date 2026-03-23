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
});
