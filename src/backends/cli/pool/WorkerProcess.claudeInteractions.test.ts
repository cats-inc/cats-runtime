import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { WorkerProcess } from './WorkerProcess.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CLAUDE_INTERACTION_KINDS } from '../providers/claudeInteractions.js';

function child() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(), exitCode: null, killed: false, kill: vi.fn() });
}
const children: ReturnType<typeof child>[] = [];
afterEach(() => { children.splice(0).forEach(process => process.emit('close', 0)); vi.clearAllMocks(); });

const write = (process: ReturnType<typeof child>, frame: unknown) => process.stdout.write(JSON.stringify(frame) + '\n');
const control = (id: string, request: Record<string, unknown>) => ({ type: 'control_request', request_id: id, request });
const result = { type: 'result', subtype: 'success', session_id: 'native', usage: { input_tokens: 1, output_tokens: 1 } };

async function fixture(withHost = true) {
  const process = child(); children.push(process); spawnMock.mockReturnValue(process);
  const worker = new WorkerProcess(new ClaudeProvider(), { cwd: 'fixture',
    ...(withHost ? { interactionHost: { version: 1, kinds: [...CLAUDE_INTERACTION_KINDS], timeoutMs: 60_000 } } : {}) },
  { path: 'fixture', runner: 'direct', runtime: { mode: 'native' } });
  worker.on('error', () => {});
  worker.start();
  const turn = worker.sendMessage('fixture');
  await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
  process.stdin.read();
  write(process, { type: 'system', subtype: 'init', session_id: 'native', tools: ['AskUserQuestion'], mcp_servers: [] });
  return { process, worker, turn };
}

describe('worker host control for Claude Code', () => {
  it('relays a question during the occupied turn and answers by question text', async () => {
    const { process, worker, turn } = await fixture();
    write(process, control('cli-1', { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', requires_user_interaction: true,
      input: { questions: [{ question: 'private-question', header: 'Pick', options: [{ label: 'Red' }, { label: 'Blue' }] }] } }));
    await vi.waitFor(() => expect(worker.interactions?.snapshot().interactions).toHaveLength(1));
    expect(worker.busy).toBe(true);
    const interaction = worker.interactions!.snapshot().interactions[0]!;
    expect(interaction.kind).toBe('user_input');
    await worker.interactions!.respond(interaction.interactionId, {
      expectedRevision: interaction.revision, idempotencyKey: 'reply', answer: { action: 'accept', values: { q0: 'private-answer' } },
    });
    expect(JSON.parse(process.stdin.read().toString())).toEqual({ type: 'control_response', response: {
      subtype: 'success', request_id: 'cli-1', response: { behavior: 'allow', updatedInput: {
        questions: [{ question: 'private-question', header: 'Pick', options: [{ label: 'Red' }, { label: 'Blue' }] }],
        answers: { 'private-question': 'private-answer' } } } } });
    write(process, result);
    const events = await turn;
    expect(JSON.stringify(events)).not.toMatch(/private-question|private-answer/);
  });

  it('declines MCP elicitation without a host instead of leaving the turn waiting', async () => {
    const { process, turn } = await fixture(false);
    write(process, control('cli-2', { subtype: 'elicitation', mcp_server_name: 'fixture', message: 'private-form', mode: 'form',
      requested_schema: { type: 'object', properties: { a: { type: 'string' } } } }));
    await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
    expect(JSON.parse(process.stdin.read().toString()))
      .toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'cli-2', response: { action: 'decline' } } });
    write(process, result);
    expect(JSON.stringify(await turn)).not.toContain('private-form');
  });

  it('closes a pending request when the CLI cancels it', async () => {
    const { process, worker, turn } = await fixture();
    write(process, control('cli-3', { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'fixture/a', content: 'x' } }));
    await vi.waitFor(() => expect(worker.interactions?.snapshot().interactions).toHaveLength(1));
    write(process, { type: 'control_cancel_request', request_id: 'cli-3' });
    await vi.waitFor(() => expect(worker.interactions!.snapshot().interactions[0]!.status).toBe('resolved'));
    write(process, result);
    await turn;
    expect(process.stdin.readableLength).toBe(0);
  });
});
