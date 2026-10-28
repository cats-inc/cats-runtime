import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractionStore } from './InteractionStore.js';
import { parseInteractionHost, parseInteractionResponse } from './validation.js';
import { INTERACTION_KINDS, type InteractionPrompt } from './types.js';

afterEach(() => vi.useRealTimers());

function fixture(prompt: InteractionPrompt = { kind: 'command_approval', title: 'Run command',
  choices: [{ id: 'accept', label: 'Allow once' }] }) {
  const changed = vi.fn();
  const store = new InteractionStore('session-a', { version: 1, kinds: [...INTERACTION_KINDS], timeoutMs: 60_000 }, changed);
  const controller = new AbortController();
  const send = vi.fn(async () => undefined);
  const fallback = vi.fn(async () => undefined);
  const abortDelivery = vi.fn();
  const id = store.register({ executionId: 'turn-a', prompt, signal: controller.signal, respond: send, fallback, abortDelivery });
  const revision = store.snapshot().interactions[0]!.revision;
  const response = { expectedRevision: revision, idempotencyKey: 'response-1', answer: { action: 'accept', choice: 'accept' } };
  return { store, controller, send, fallback, id, response, changed, abortDelivery };
}

describe('provider interaction lifecycle', () => {
  it('returns one response receipt for duplicate concurrent requests without another provider write', async () => {
    const { store, id, response, send } = fixture();
    const results = await Promise.all([store.respond(id, response), store.respond(id, response)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: 'resolved', providerConfirmed: false, decision: 'accept' });
    expect(results[0]?.prompt).toBeUndefined();
    store.resolve(id);
    expect(store.snapshot().interactions[0]).toMatchObject({ providerConfirmed: true });
  });

  it('rejects stale revisions, foreign identifiers and conflicting answers', async () => {
    const { store, id, response, send } = fixture();
    await expect(store.respond(id, { ...response, expectedRevision: 9 })).rejects.toMatchObject({ code: 'interaction_conflict' });
    await expect(store.respond('foreign', response)).rejects.toMatchObject({ code: 'interaction_not_found' });
    await store.respond(id, response);
    await expect(store.respond(id, { ...response, answer: { action: 'decline' } })).rejects.toMatchObject({ code: 'interaction_conflict' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('expires without a grant and cannot accept a late response', async () => {
    vi.useFakeTimers();
    const { store, id, response, send, fallback } = fixture();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.snapshot().interactions[0]).toMatchObject({ status: 'expired' });
    expect(fallback).toHaveBeenCalledOnce();
    await expect(store.respond(id, response)).rejects.toMatchObject({ code: 'interaction_conflict' });
    expect(send).not.toHaveBeenCalled();
  });

  it('honors a shorter provider deadline', async () => {
    vi.useFakeTimers();
    const { store, controller } = fixture();
    const fallback = vi.fn(async () => undefined);
    const id = store.register({ executionId: 'turn-a', signal: controller.signal,
      prompt: { kind: 'mcp_url', title: 'Connect', url: 'https://example.test' },
      deadlineMs: Date.now() + 1000, respond: async () => undefined, fallback });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.snapshot().interactions.find(item => item.interactionId === id)?.status).toBe('expired');
    expect(fallback).toHaveBeenCalledOnce();
    store.interrupt();
  });

  it('cancels the queued write if the execution ends before delivery', async () => {
    const { store, controller, id, response, send } = fixture();
    const result = store.respond(id, response);
    controller.abort();
    expect(await result).toMatchObject({ status: 'interrupted' });
    expect(send).not.toHaveBeenCalled();
  });

  it('settles a response on worker loss even if provider delivery is stuck', async () => {
    const { store, id, response, send } = fixture();
    send.mockImplementation(() => new Promise(() => undefined));
    const result = store.respond(id, response);
    await Promise.resolve();
    store.interrupt();
    expect(await result).toMatchObject({ status: 'interrupted' });
  });

  it('bounds a stuck delivery even while the worker remains alive', async () => {
    vi.useFakeTimers();
    const { store, controller } = fixture();
    const abortDelivery = vi.fn();
    const fallback = vi.fn(async () => undefined);
    const id = store.register({ executionId: 'turn-a', signal: controller.signal,
      prompt: { kind: 'mcp_url', title: 'Connect' }, deadlineMs: Date.now() + 1000,
      respond: () => new Promise(() => undefined), fallback, abortDelivery });
    const view = store.snapshot().interactions.find(item => item.interactionId === id)!;
    const pending = store.respond(id, { expectedRevision: view.revision, idempotencyKey: 'stuck', answer: { action: 'accept' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ status: 'interrupted', reason: 'response_delivery_timeout' });
    expect(abortDelivery).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    store.interrupt();
  });

  it('reconciles provider resolution before an owner answer', async () => {
    const { store, id, response, send, fallback } = fixture();
    store.resolve(id);
    await expect(store.respond(id, response)).rejects.toMatchObject({ code: 'interaction_conflict' });
    expect(store.waiting).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('reports delivery failure without retaining sensitive prompt or answer values', async () => {
    const { store, id, send, response } = fixture({ kind: 'user_input', title: 'Credential',
      fields: [{ id: 'password', label: 'Password', type: 'string', required: true, secret: true }] });
    send.mockRejectedValue(new Error('secret must not be reflected'));
    const result = await store.respond(id, { ...response, answer: { action: 'accept', values: { password: 'private-answer' } } });
    expect(result).toMatchObject({ status: 'interrupted', reason: 'response_delivery_failed' });
    expect(JSON.stringify(store.snapshot())).not.toContain('private-answer');
    expect(JSON.stringify(store.snapshot())).not.toContain('Credential');
    expect(JSON.stringify(store.snapshot())).not.toContain('secret must');
  });

  it('does not allow a snapshot caller to mutate a pending request', () => {
    const { store } = fixture();
    store.snapshot().interactions[0]!.prompt!.choices![0]!.id = 'broader-grant';
    expect(store.snapshot().interactions[0]!.prompt!.choices![0]!.id).toBe('accept');
    store.interrupt();
  });
  it('interrupts the worker when delivery fails instead of leaving the native request waiting', async () => {
    const { store, id, response, send, abortDelivery } = fixture();
    send.mockRejectedValue(new Error('fixture admission changed'));
    expect(await store.respond(id, response)).toMatchObject({ status: 'interrupted', reason: 'response_delivery_failed' });
    expect(abortDelivery).toHaveBeenCalledOnce();
  });
  it('bounds fallback delivery after expiry and interrupts only once on a late rejection', async () => {
    vi.useFakeTimers();
    const { store, fallback, abortDelivery } = fixture();
    let reject!: (error: Error) => void;
    fallback.mockImplementation(() => new Promise<void>((_resolve, no) => { reject = no; }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.snapshot().interactions[0]!.status).toBe('expired');
    expect(fallback).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(abortDelivery).toHaveBeenCalledOnce();
    reject(new Error('late failure'));
    await Promise.resolve();
    expect(abortDelivery).toHaveBeenCalledOnce();
  });

  it('bounds pending requests and terminal receipts', () => {
    const { store, controller } = fixture();
    const register = () => store.register({ executionId: 'turn-a', signal: controller.signal,
      prompt: { kind: 'mcp_url', title: 'Connect' }, respond: async () => undefined, fallback: async () => undefined });
    for (let index = 0; index < 15; index++) register();
    expect(register).toThrow(/Too many/);
    store.interrupt();
    for (let index = 0; index < 70; index++) store.resolve(register());
    expect(store.snapshot().interactions).toHaveLength(64);
  });
});

describe('interaction validation', () => {
  it('validates host negotiation and deadline bounds without changing absent input', () => {
    expect(parseInteractionHost(undefined)).toBeUndefined();
    expect(parseInteractionHost({ version: 1, kinds: ['mcp_form'] })?.timeoutMs).toBe(1_800_000);
    for (const input of [null, {}, { version: 2, kinds: ['mcp_form'] },
      { version: 1, kinds: ['mcp_form', 'mcp_form'] }, { version: 1, kinds: ['unknown'] },
      { version: 1, kinds: ['mcp_form'], timeoutMs: 59_999 },
      { version: 1, kinds: ['mcp_form'], timeoutMs: 86_400_001 }]) {
      expect(() => parseInteractionHost(input)).toThrow();
    }
  });

  it('validates requested choices rather than accepting arbitrary grant names', async () => {
    const { store, id, response, send } = fixture();
    await expect(store.respond(id, { ...response, answer: { action: 'accept', choice: 'acceptForSession' } })).rejects.toMatchObject({ code: 'interaction_invalid' });
    expect(send).not.toHaveBeenCalled();
    store.interrupt();
  });

  it('validates required fields, choices and numeric constraints', async () => {
    const { store, id, response } = fixture({ kind: 'mcp_form', title: 'Form', fields: [
      { id: 'count', label: 'Count', type: 'integer', required: true, min: 1, max: 3 },
      { id: 'mode', label: 'Mode', type: 'string', required: true, options: [{ id: 'a', label: 'A' }] },
    ] });
    for (const values of [{}, { count: 4, mode: 'a' }, { count: 1.5, mode: 'a' },
      { count: 2, mode: 'b' }, { count: 2, mode: 'a', extra: true }]) {
      await expect(store.respond(id, { ...response, answer: { action: 'accept', values } })).rejects.toMatchObject({ code: 'interaction_invalid' });
    }
    await expect(store.respond(id, { ...response, answer: { action: 'accept', values: { count: 2, mode: 'a' } } })).resolves.toMatchObject({ status: 'resolved' });
  });

  it('allows only requested permission units and scopes', async () => {
    const { store, id, response } = fixture({ kind: 'permission_grant', title: 'Permission',
      permissions: [{ id: 'read-a', label: 'Read A' }], scopes: ['turn'] });
    for (const answer of [{ action: 'accept', grants: ['write-a'], scope: 'turn' },
      { action: 'accept', grants: ['read-a'], scope: 'session' }]) {
      await expect(store.respond(id, { ...response, answer })).rejects.toMatchObject({ code: 'interaction_invalid' });
    }
    await expect(store.respond(id, { ...response, answer: { action: 'accept', grants: ['read-a'], scope: 'turn' } })).resolves.toMatchObject({ status: 'resolved' });
  });

  it('rejects unknown fields, unsafe keys, nonfinite and oversized answers', () => {
    const base = { expectedRevision: 1, idempotencyKey: 'reply', answer: { action: 'accept' } };
    for (const answer of [{ action: 'accept', unknown: true }, { action: ['accept'] },
      { action: ['decline'] }, { action: ['cancel'] },
      { action: 'accept', values: { count: NaN } }, { action: 'accept', values: { constructor: 'bad' } },
      { action: 'accept', values: { text: 'x'.repeat(33_000) } }]) {
      expect(() => parseInteractionResponse({ ...base, answer })).toThrow();
    }
    expect(() => parseInteractionResponse({ ...base, answer: { action: 'accept', values: { text: '貓'.repeat(11_000) } } })).toThrow();
  });
});
