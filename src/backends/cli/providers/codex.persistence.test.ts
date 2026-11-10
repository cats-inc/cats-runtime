import { describe, expect, it } from 'vitest';
import { CodexProvider } from './codex.js';

const opts = { cwd: '/fixture', workspaceMode: 'read_only' as const };
const permission = { sandbox: { type: 'readOnly' }, approvalPolicy: 'never' };
const frames = (text: string) => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const response = (id: number, thread: Record<string, unknown>) =>
  JSON.stringify({ jsonrpc: '2.0', id, result: { thread, ...permission } });

describe('Codex native history lifetime and names', () => {
  it('admits ephemeral before the first turn and keeps a second turn on the same thread', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ ...opts, providerSessionPersistence: 'ephemeral' });
    const bootstrap = frames(provider.buildStdinMessage('first'));
    expect(bootstrap.at(-1)).toMatchObject({ method: 'thread/start', params: { ephemeral: true } });
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(provider.parseStreamLine(response(bootstrap.at(-1).id, { id: 'job', ephemeral: true })))
      .toMatchObject({ type: 'init', sessionId: 'job' });
    expect(frames(provider.getPendingTurnStart()!)).toMatchObject([
      { method: 'turn/start', params: { threadId: 'job', input: [{ text: 'first' }] } },
    ]);
    expect(frames(provider.buildStdinMessage('second'))).toMatchObject([
      { method: 'turn/start', params: { threadId: 'job', input: [{ text: 'second' }] } },
    ]);
  });

  it.each([undefined, false])('fails closed when ephemeral confirmation is %s', ephemeral => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ ...opts, providerSessionPersistence: 'ephemeral' });
    const bootstrap = frames(provider.buildStdinMessage('never send'));
    expect(provider.parseStreamLine(response(bootstrap.at(-1).id, { id: 'job', ephemeral })))
      .toMatchObject({ type: 'error', text: expect.stringContaining('did not confirm ephemeral') });
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(() => provider.buildStdinMessage('retry')).toThrow('bootstrap failed');
  });

  it('also gates inventory-first bootstrap and refuses ephemeral resume/fork', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ ...opts, providerSessionPersistence: 'ephemeral' });
    const bootstrap = frames(provider.buildInitialization()!);
    provider.parseStreamLine(response(bootstrap.at(-1).id, { id: 'job', ephemeral: true }));
    expect(provider.getPendingTurnStart()).toBeNull();
    expect(frames(provider.buildStdinMessage('later'))[0].params.threadId).toBe('job');
    expect(() => provider.buildSpawnArgs({ ...opts, providerSessionPersistence: 'ephemeral',
      resumeSessionId: 'old' })).toThrow('cannot resume');
  });

  it('seeds a persistent name without treating a failed name reply as a failed turn', () => {
    const provider = new CodexProvider();
    provider.buildSpawnArgs({ ...opts, sessionLabel: 'Cats Bot · Fixture' });
    const bootstrap = frames(provider.buildStdinMessage('hello'));
    expect(bootstrap.at(-1).params).not.toHaveProperty('ephemeral');
    provider.parseStreamLine(response(bootstrap.at(-1).id, { id: 'chat', name: null }));
    const name = frames(provider.getPendingControlMessages()!)[0];
    expect(name).toMatchObject({ method: 'thread/name/set',
      params: { threadId: 'chat', name: 'Cats Bot · Fixture' } });
    const turn = frames(provider.getPendingTurnStart()!)[0];
    expect(name.id).not.toBe(turn.id);
    expect(provider.parseStreamLine(JSON.stringify({ id: name.id, error: { message: 'not supported' } }))).toBeNull();
    expect(frames(provider.buildStdinMessage('still usable'))[0].method).toBe('turn/start');
  });

  it('preserves an existing native name on resume and never names internal jobs', () => {
    for (const ephemeral of [false, true]) {
      const provider = new CodexProvider();
      provider.buildSpawnArgs({ ...opts, sessionLabel: 'Product name',
        ...(ephemeral ? { providerSessionPersistence: 'ephemeral' as const } : { resumeSessionId: 'chat' }) });
      const bootstrap = frames(provider.buildStdinMessage('hello'));
      provider.parseStreamLine(response(bootstrap.at(-1).id, { id: 'chat', ephemeral, name: 'My native name' }));
      expect(provider.getPendingControlMessages()).toBeNull();
      expect(provider.getPendingTurnStart()).not.toBeNull();
    }
  });
});
