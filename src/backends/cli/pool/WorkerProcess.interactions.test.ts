import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERACTION_KINDS } from '../../../core/interactions/types.js';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../runtime/windowsCodexHost.js', () => ({
  windowsCodexHostPath: () => 'fixture-host', startWindowsCodexHost: async () => null,
}));
import { WorkerProcess } from './WorkerProcess.js';
import { CodexProvider } from '../providers/codex.js';

function child() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(), exitCode: null, killed: false, kill: vi.fn() });
}
const children: ReturnType<typeof child>[] = [];
afterEach(() => { children.splice(0).forEach(process => process.emit('close', 0)); vi.clearAllMocks(); });

async function fixture() {
  const process = child(); children.push(process); spawnMock.mockReturnValue(process);
  const worker = new WorkerProcess(new CodexProvider(), { cwd: 'fixture',
    interactionHost: { version: 1, kinds: [...INTERACTION_KINDS], timeoutMs: 60_000 } },
  { path: 'fixture', runner: 'direct', runtime: { mode: 'native' } });
  worker.on('error', () => {});
  worker.start();
  const turn = worker.sendMessage('fixture');
  await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
  const frames = process.stdin.read().toString().trim().split('\n').map((line: string) => JSON.parse(line));
  process.stdout.write(JSON.stringify({ id: frames[2].id, result: { thread: { id: 'thread' },
    approvalPolicy: 'never', sandbox: { type: 'workspaceWrite' } } }) + '\n');
  await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
  const start = JSON.parse(process.stdin.read().toString());
  process.stdout.write(JSON.stringify({ id: start.id, result: { turn: { id: 'turn' } } }) + '\n');
  process.stdout.write(JSON.stringify({ id: 10, method: 'item/tool/requestUserInput', params: {
    threadId: 'thread', turnId: 'turn', questions: [{ id: 'q', header: 'Question', question: 'private-prompt' }],
  } }) + '\n');
  await vi.waitFor(() => expect(worker.interactions?.snapshot().interactions).toHaveLength(1));
  return { process, worker, turn };
}

describe('worker interaction control channel', () => {
  it('delivers a reply during an occupied turn and only emits redacted progress', async () => {
    const { process, worker, turn } = await fixture();
    expect(worker.busy).toBe(true);
    const interaction = worker.interactions!.snapshot().interactions[0]!;
    const receipt = await worker.interactions!.respond(interaction.interactionId, {
      expectedRevision: interaction.revision, idempotencyKey: 'reply', answer: { action: 'accept', values: { q: 'private-answer' } },
    });
    expect(receipt.status).toBe('resolved');
    expect(JSON.parse(process.stdin.read().toString())).toEqual({ jsonrpc: '2.0', id: 10,
      result: { answers: { q: { answers: ['private-answer'] } } } });
    process.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } }) + '\n');
    const events = await turn;
    expect(JSON.stringify(events)).not.toMatch(/private-prompt|private-answer/);
    expect(events.some(event => event.type === 'progress' && event.metadata?.kind === 'interaction_requested')).toBe(true);
  });
  it('interrupts pending callbacks on cancellation and rejects stale responses', async () => {
    const { process, worker, turn } = await fixture();
    const observed = turn.catch(error => error);
    const store = worker.interactions!;
    const interaction = store.snapshot().interactions[0]!;
    worker.cancel();
    expect(store.snapshot().interactions[0]!.status).toBe('interrupted');
    await expect(store.respond(interaction.interactionId, {
      expectedRevision: interaction.revision, idempotencyKey: 'late', answer: { action: 'cancel' },
    })).rejects.toThrow('no longer pending');
    process.emit('close', 0);
    await observed;
    expect(process.stdin.readableLength).toBe(0);
  });
  it('reconciles provider resolution before a completion in the same stdout chunk', async () => {
    const { process, worker, turn } = await fixture();
    process.stdout.write(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 10 } }) + '\n'
      + JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } }) + '\n');
    await turn;
    expect(worker.interactions!.snapshot().interactions[0]).toMatchObject({ status: 'resolved', providerConfirmed: true });
  });
});
