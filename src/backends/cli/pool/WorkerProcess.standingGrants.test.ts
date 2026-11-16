import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock, execFile: vi.fn() }));
vi.mock('../runtime/windowsCodexHost.js', () => ({ windowsCodexHostPath: () => undefined, startWindowsCodexHost: async () => null }));
import { WorkerProcess } from './WorkerProcess.js';
import { HostedAcpProvider } from '../providers/hostedAcp.js';
import { StandingGrants } from '../../../core/interactions/standingGrants.js';

// ADR-055 at the process boundary, with Kimi Code 2.6.0's captured `kimi acp` frames.
const captures = new URL('../../../../tests/fixtures/provider-captures/kimi-2.6.0/', import.meta.url);
const capture = (name: string) => readFileSync(fileURLToPath(new URL(name, captures)), 'utf8').trim();
const NL = String.fromCharCode(10);
const children: Array<EventEmitter> = [];
afterEach(() => { children.splice(0).forEach(child => child.emit('close', 0)); vi.restoreAllMocks(); });

async function fixture(standingGrants: boolean, grants = new StandingGrants()) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, killed: false, kill: vi.fn(() => true) });
  children.push(child); spawnMock.mockReturnValue(child);
  const provider = new HostedAcpProvider('kimi', { platform: 'win32', env: {}, exists: () => true, nodeVersion: async () => 'v24.15.0' });
  const worker = new WorkerProcess(provider, { cwd: '/workspace', interactionHost: {
    version: 1, kinds: ['command_approval', 'file_approval', 'tool_approval'], timeoutMs: 60_000 },
  executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } } },
  { path: 'kimi', runner: 'direct', runtime: { mode: 'native' }, protocol: 'hosted' }, undefined, false, {}, 'session-1', grants);
  worker.on('error', () => {}); worker.start();
  const written: Array<Record<string, unknown>> = [];
  const read = async () => {
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    const frames = child.stdin.read().toString().trim().split('\n').map((line: string) => JSON.parse(line));
    written.push(...frames); return frames;
  };
  const turn = (async () => { const events = []; for await (const event of worker.streamMessage({ message: 'fixture', standingGrants })) events.push(event); return events; })()
    .catch(error => error);
  const reply = (id: unknown, result: unknown) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  reply((await read())[0].id, JSON.parse(capture('acp-initialize.success.redacted.json')));
  reply((await read())[0].id, JSON.parse(capture('acp-session-new.success.redacted.json')));
  const prompt = (await read())[0];
  expect(prompt.method).toBe('session/prompt');
  return { worker, child, read, reply, prompt, turn, written };
}

const permissionFrames = () => capture('acp-plugin-tool-permission.success.redacted.ndjson').split('\n')
  .slice(0, 5);

describe('standing grants at the worker boundary (ADR-055)', () => {
  it('answers a granted computer-use permission with Approve once and shows no card', async () => {
    const grants = new StandingGrants(); grants.add('computer_use', { until: 'session' });
    const f = await fixture(true, grants);
    f.child.stdout.write(permissionFrames().join('\n') + '\n');
    const answer = (await f.read()).find(frame => frame.id === 0);
    expect(answer).toMatchObject({ id: 0, result: { outcome: { outcome: 'selected', optionId: 'approve_once' } } });
    const views = f.worker.interactions!.snapshot().interactions;
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ reason: 'standing_grant', decision: 'accept' });
    expect(views[0]!.status).not.toBe('pending');
    f.reply(f.prompt.id, { stopReason: 'end_turn' });
    await f.turn;
  });

  it('keeps the card for a send that may not use grants, and adds a grant from the card', async () => {
    const grants = new StandingGrants(); grants.add('computer_use', { until: 'session' });
    const f = await fixture(false, grants);
    f.child.stdout.write(permissionFrames().join('\n') + '\n');
    await vi.waitFor(() => expect(f.worker.interactions!.snapshot().interactions[0]?.status).toBe('pending'));
    expect(f.written.some(frame => frame.id === 0)).toBe(false);
    const card = f.worker.interactions!.snapshot().interactions[0]!;
    expect(card.prompt).toMatchObject({ grantCategory: 'computer_use', choices: [{ id: 'approve_once' }] });
    grants.revoke();
    await f.worker.interactions!.respond(card.interactionId, { expectedRevision: card.revision, idempotencyKey: 'card',
      answer: { action: 'accept', choice: 'approve_once', standingGrant: { until: 'time', durationMs: 30 * 60_000 } } });
    expect((await f.read()).find(frame => frame.id === 0)).toMatchObject({ result: { outcome: { outcome: 'selected', optionId: 'approve_once' } } });
    expect(grants.list()).toMatchObject([{ category: 'computer_use', until: 'time' }]);
    f.reply(f.prompt.id, { stopReason: 'end_turn' });
    await f.turn;
  });
});

describe('standing grants without a card event (ADR-055 review)', () => {
  it('emits no pending interaction while answering from a grant', async () => {
    const grants = new StandingGrants(); grants.add('computer_use', { until: 'session' });
    const f = await fixture(true, grants);
    const kinds: string[] = [];
    f.worker.on('event', (event: { metadata?: { kind?: string } }) => { if (event.metadata?.kind) kinds.push(event.metadata.kind); });
    f.child.stdout.write(permissionFrames().join(NL) + NL);
    expect((await f.read()).find(frame => frame.id === 0)).toMatchObject({ result: { outcome: { optionId: 'approve_once' } } });
    expect(kinds).toContain('interaction_updated');
    expect(kinds).not.toContain('interaction_requested');
    f.reply(f.prompt.id, { stopReason: 'end_turn' });
    await f.turn;
  });
});
