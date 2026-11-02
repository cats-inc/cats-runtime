import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../runtime/windowsCodexHost.js', () => ({ windowsCodexHostPath: () => undefined, startWindowsCodexHost: async () => null }));
import { WorkerProcess } from './WorkerProcess.js';
import { MuseMspProvider } from '../providers/museMsp.js';
const children: Array<EventEmitter> = [];
afterEach(() => { children.splice(0).forEach(child => child.emit('close', 0)); vi.restoreAllMocks(); });

async function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, killed: false, kill: vi.fn(() => true) });
  children.push(child); spawnMock.mockReturnValue(child);
  const worker = new WorkerProcess(new MuseMspProvider(), { cwd: '/workspace', interactionHost: {
    version: 1, kinds: ['command_approval', 'file_approval', 'tool_approval', 'user_input'], timeoutMs: 60_000 },
  executionPolicy: { version: 1, mode: 'provider', constraints: { maxAccess: 'full-access', network: true } },
  mcpServers: [{ name: 'cats', transport: 'http', url: 'http://127.0.0.1/mcp', bearerTokenEnvVar: 'CATS_FIXTURE_GRANT' }] },
  { path: 'fixture', runner: 'direct', runtime: { mode: 'native' }, protocol: 'hosted' }, undefined, false,
  { CATS_FIXTURE_GRANT: 'private-fixture-secret' });
  worker.on('error', () => {}); worker.start();
  const turn = worker.sendMessage('fixture').catch(error => error);
  const read = async () => { await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    return child.stdin.read().toString().trim().split('\n').map((line: string) => JSON.parse(line)); };
  const reply = (id: string, result: unknown) => child.stdout.write(JSON.stringify({ id, result }) + '\n');
  reply((await read())[0].id, { experimentalApi: true, grantedCapabilities: ['sessionMcp'], sandboxAvailability: 'available' });
  reply((await read())[1].id, { profiles: [] });
  reply((await read())[0].id, { servers: [] });
  const start = (await read())[0];
  expect(start.params.config.mcpServers.cats.headers.Authorization).toBe('Bearer private-fixture-secret');
  reply(start.id, { session: { sessionId: 'native', workspaceRoot: '/workspace', activeTurnId: null,
    approvalMode: { mode: 'onRequest' }, permissionState: { profileId: ':auto-review', reviewerAuthority: 'autoReview',
      reviewerAttached: true, axes: { filesystem: 'sandboxed', network: 'off' } } }, pendingRequests: [] });
  return { worker, child, turn, read, reply };
}

describe('hosted protocol process boundary', () => {
  it('handles provider resolution before an adjacent terminal frame in the same stdout chunk', async () => {
    const { worker, child, turn, read, reply } = await fixture();
    const request = (await read())[0];
    reply(request.id, { commandId: request.params.commandId, disposition: 'started', status: 'accepted', turnId: 'turn' });
    child.stdout.write(JSON.stringify({ id: 8, method: 'approval/request', params: {
      sessionId: 'native', turnId: 'turn', approvalId: 'approval',
      currentRequirementId: { approvalId: 'approval', sourceIndex: 0 }, subject: { kind: 'shell', command: 'printf fixture' },
      availableChoices: [{ choiceId: 'yes', label: 'Allow once', decision: 'approved', scope: 'once' },
        { choiceId: 'no', label: 'Deny', decision: 'denied', scope: 'once' }],
    } }) + '\n');
    const card = worker.interactions!.snapshot().interactions[0]!;
    expect(card.status).toBe('pending');
    child.stdout.write([
      { method: 'approval/resolved', params: { sessionId: 'native', approvalId: 'approval' } },
      { method: 'turn/completed', params: { sessionId: 'native', turnId: 'turn', terminal: 'completed' } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    await turn;
    expect(worker.interactions!.snapshot().interactions[0]).toMatchObject({ status: 'resolved', providerConfirmed: true });
    await expect(worker.interactions!.respond(card.interactionId, { expectedRevision: card.revision,
      idempotencyKey: 'late', answer: { action: 'accept' } })).rejects.toMatchObject({ code: 'interaction_conflict' });
  });
  it('terminates a child that queued a prompt instead of admitting it', async () => {
    const { worker, child, turn, read, reply } = await fixture();
    const request = (await read())[0];
    reply(request.id, { commandId: request.params.commandId, disposition: 'queued', status: 'accepted', turnId: 'foreign' });
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(child.stdin.writableEnded).toBe(true);
    await turn;
    expect(worker.busy).toBe(false);
  });
  it('keeps literal grants out of child env and redacts native error echoes before logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { worker, child, turn } = await fixture();
    expect(spawnMock.mock.calls.at(-1)![2].env.CATS_FIXTURE_GRANT).toBeUndefined();
    child.stderr.write('native error: Bearer private-fixture-');
    child.stderr.write('secret rejected\n');
    const output = log.mock.calls.flat().join('');
    expect(output).not.toContain('private-fixture-secret');
    expect(output).toContain('[REDACTED]');
    worker.cancel(); child.emit('close', 0); await turn;
  });
});
