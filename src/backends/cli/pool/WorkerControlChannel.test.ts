import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerControlChannel } from './WorkerControlChannel.js';

afterEach(() => vi.useRealTimers());
describe('worker discovery control channel', () => {
  const frame = (id = 'cats-runtime-control-1') => JSON.stringify({ id, method: 'mcpServerStatus/list' }) + '\n';
  it('correlates discovery without consuming model events or unrelated responses', async () => {
    const write = vi.fn((_line, done) => done());
    const channel = new WorkerControlChannel(write);
    const result = channel.request(frame());
    expect(channel.consume('{"method":"turn/completed","params":{}}')).toBe(false);
    expect(channel.consume('{"id":123,"result":{}}')).toBe(false);
    expect(channel.consume('{"id":"cats-runtime-control-1","result":{"data":[]}}')).toBe(true);
    await expect(result).resolves.toEqual({ data: [] });
    expect(write).toHaveBeenCalledOnce();
  });
  it('bounds waiting and consumes late discovery errors after timeout', async () => {
    vi.useFakeTimers();
    const channel = new WorkerControlChannel((_line, done) => done());
    const result = channel.request(frame(), 100).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).message).toContain('timed out');
    expect(channel.consume('{"id":"cats-runtime-control-1","error":{"message":"private-token"}}')).toBe(true);
  });
  it('rejects pending reads on worker shutdown and sanitizes provider errors', async () => {
    const channel = new WorkerControlChannel((_line, done) => done());
    const one = channel.request(frame()).catch(error => error);
    channel.consume('{"id":"cats-runtime-control-1","error":{"message":"private-token"}}');
    expect((await one).message).not.toContain('private-token');
    const two = channel.request(frame('cats-runtime-control-2')).catch(error => error);
    channel.close();
    expect((await two).message).toContain('stopped');
    await expect(channel.request(frame('cats-runtime-control-3'))).rejects.toThrow('unavailable');
  });
});
