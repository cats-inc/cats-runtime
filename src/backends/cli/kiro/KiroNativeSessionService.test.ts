import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import {
  KiroNativeSessionService,
  countUserMessages,
  parseKiroMessages,
  parseSessionMeta,
} from './KiroNativeSessionService.js';

const SESSION_A = 'sess_0624b1e8-e58c-4c91-8c66-235ed36e6536';
const SESSION_B = 'sess_3196fc6c-21ed-42fe-a933-3bc13a639ff2';
const SESSION_V2 = 'b0474226-7f18-47bd-8e04-3f4f9f183dbb';

// Kiro 2.30.0 V3 store, two turns in one session; the system prompt is elided.
const SESSION_JSON = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: '1.0.0',
  dataModelVersion: 1,
  id: SESSION_A,
  title: 'Read And Summarize Notes File',
  agentMode: 'vibe',
  workspacePaths: ['C:\\repo\\alpha'],
  rootPaths: ['C:\\repo\\alpha'],
  createdAt: '2026-10-13T13:22:15.000Z',
  lastModifiedAt: '2026-10-13T13:22:35.099Z',
  modelId: 'claude-haiku-4.5',
  autopilot: true,
  status: 'idle',
  ...overrides,
});
const MESSAGES_JSONL = [
  { id: 'context_snapshot_1', timestamp: '2026-10-13T13:22:16.000Z', payload: { type: 'agent_note', content: '<session_context>The current model is Claude Haiku 4.5.</session_context>' } },
  { id: 'u1', timestamp: '2026-10-13T13:22:16.100Z', payload: { type: 'user', content: 'Read notes.txt with your file read tool, then reply with the two words it contains separated by a comma.', documents: [], images: [] } },
  { id: 'e1-turn-start', timestamp: '2026-10-13T13:22:16.200Z', payload: { type: 'turn_start', executionId: 'e1' } },
  { id: 'a1-say', timestamp: '2026-10-13T13:22:19.122Z', payload: { type: 'assistant', content: "I'll read the notes.txt file for you.", operationType: 'Say', executionId: 'e1' } },
  { id: 'tooluse_1-call', timestamp: '2026-10-13T13:22:19.289Z', payload: { type: 'tool_call', toolCallId: 'tooluse_1', toolName: 'read_file', args: { path: 'notes.txt' }, status: 'approved', kind: 'read', executionId: 'e1', title: 'Read File' } },
  { id: 'tooluse_1-result', timestamp: '2026-10-13T13:22:19.289Z', payload: { type: 'tool_result', toolCallId: 'tooluse_1', content: '<file name="notes.txt">alpha\nbeta</file>', success: true, executionId: 'e1' } },
  { id: 'a2-say', timestamp: '2026-10-13T13:22:21.057Z', payload: { type: 'assistant', content: 'alpha, beta', operationType: 'Say', executionId: 'e1' } },
  { id: 'e1-usage', timestamp: '2026-10-13T13:22:21.200Z', payload: { type: 'usage_summary', promptTurnSummaries: [{ unit: 'credit', usage: 0.05 }], elapsedTime: 5000, status: 'success', executionId: 'e1' } },
  { id: 'e1-turn-end', timestamp: '2026-10-13T13:22:21.201Z', payload: { type: 'turn_end', stopReason: 'end_turn', executionId: 'e1' } },
  { id: 'session_start_1', timestamp: '2026-10-13T13:22:21.300Z', payload: { type: 'session_start', agentType: 'vibe', content: 'You are Kiro...' } },
  { id: 'u2', timestamp: '2026-10-13T13:22:33.000Z', payload: { type: 'user', content: 'Now reply with only the first of those two words.', documents: [], images: [] } },
  { id: 'a3-say', timestamp: '2026-10-13T13:22:34.955Z', payload: { type: 'assistant', content: 'alpha', operationType: 'Say', executionId: 'e2' } },
].map((entry) => JSON.stringify(entry)).join('\n') + '\n';

const NATIVE: ProviderCommandConfig = { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } };
const WSL: ProviderCommandConfig = { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'wsl', distro: 'Ubuntu' } };

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeStore(sessionJson = SESSION_JSON()): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cats-kiro-store-'));
  tempDirs.push(root);
  const dir = join(root, '0a72772e56783f0f', SESSION_A);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'session.json'), sessionJson, 'utf8');
  await writeFile(join(dir, 'messages.jsonl'), MESSAGES_JSONL, 'utf8');
  // A second workspace with an older, empty session.
  const other = join(root, '7303841f51bcad36', SESSION_B);
  await mkdir(other, { recursive: true });
  await writeFile(join(other, 'session.json'), SESSION_JSON({
    id: SESSION_B, title: 'PONG', workspacePaths: ['C:\\repo\\beta'],
    createdAt: '2026-10-12T10:00:00.000Z', lastModifiedAt: '2026-10-12T10:00:05.000Z', modelId: 'auto',
  }), 'utf8');
  // The V2 store next to them is not a V3 session directory, nor is a stray file.
  await mkdir(join(root, 'cli', 'ac0ee9ce-60f6-4cec-a998-4c0d96f59a8a'), { recursive: true });
  await writeFile(join(root, 'cli', `${SESSION_V2}.json`), '{}', 'utf8');
  await writeFile(join(root, '0a72772e56783f0f', 'notes.txt'), 'not a session', 'utf8');
  return root;
}

const unusedRunner = () => vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

describe('KiroNativeSessionService', () => {
  it('lists V3 sessions from the store, newest first, without running kiro-cli', async () => {
    const runner = unusedRunner();
    const service = new KiroNativeSessionService({ commandConfig: NATIVE, sessionsDir: await makeStore(), runner });

    expect(await service.listAllSessions()).toEqual([
      {
        providerSessionId: SESSION_A,
        cwd: 'C:/repo/alpha',
        summary: 'Read And Summarize Notes File',
        messageCount: 2,
        lastActivity: '2026-10-13T13:22:35.099Z',
        model: 'claude-haiku-4.5',
      },
      {
        providerSessionId: SESSION_B,
        cwd: 'C:/repo/beta',
        summary: 'PONG',
        messageCount: 0,
        lastActivity: '2026-10-12T10:00:05.000Z',
        model: 'auto',
      },
    ]);
    expect(runner).not.toHaveBeenCalled();
    expect((await service.listSessions('C:/repo/alpha')).map((s) => s.providerSessionId)).toEqual([SESSION_A]);
    expect(await service.listSessions('C:/repo/gamma')).toEqual([]);
  });

  it('lists nothing when the store does not exist yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cats-kiro-empty-'));
    tempDirs.push(root);
    const service = new KiroNativeSessionService({
      commandConfig: NATIVE, sessionsDir: join(root, 'missing'), runner: unusedRunner(),
    });

    expect(await service.listAllSessions()).toEqual([]);
  });

  it('loads the transcript as user prompts and spoken replies', async () => {
    const service = new KiroNativeSessionService({ commandConfig: NATIVE, sessionsDir: await makeStore(), runner: unusedRunner() });

    expect(await service.loadHistory(SESSION_A)).toEqual([
      { role: 'user', text: 'Read notes.txt with your file read tool, then reply with the two words it contains separated by a comma.', timestamp: '2026-10-13T13:22:16.100Z' },
      { role: 'assistant', text: "I'll read the notes.txt file for you.", timestamp: '2026-10-13T13:22:19.122Z' },
      { role: 'assistant', text: 'alpha, beta', timestamp: '2026-10-13T13:22:21.057Z' },
      { role: 'user', text: 'Now reply with only the first of those two words.', timestamp: '2026-10-13T13:22:33.000Z' },
      { role: 'assistant', text: 'alpha', timestamp: '2026-10-13T13:22:34.955Z' },
    ]);
    expect(await service.loadHistory(SESSION_B)).toEqual([]);
    expect(await service.loadHistory('sess_unknown')).toEqual([]);
    await expect(service.loadHistory('../escape')).rejects.toThrow('Invalid Kiro session id.');
  });

  it('refuses a transcript whose store schema it does not understand', async () => {
    const service = new KiroNativeSessionService({
      commandConfig: NATIVE,
      sessionsDir: await makeStore(SESSION_JSON({ schemaVersion: '2.0.0' })),
      runner: unusedRunner(),
    });

    await expect(service.loadHistory(SESSION_A)).rejects.toThrow('Unsupported Kiro session schema 2.0.0');
  });

  it('deletes through kiro-cli and reports its exit code', async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => (
      args[2] === SESSION_A ? { code: 0, stdout: `✔ Deleted chat session ${SESSION_A}\n`, stderr: '' }
        : { code: 1, stdout: '', stderr: 'Session not found.' }
    ));
    const service = new KiroNativeSessionService({ commandConfig: NATIVE, sessionsDir: await makeStore(), runner });

    expect(await service.deleteSession(SESSION_A)).toBe(true);
    expect(runner).toHaveBeenCalledWith('kiro-cli', ['chat', '--delete-session', SESSION_A], {});
    expect(await service.deleteSession('sess_gone')).toBe(false);
    await expect(service.deleteSession('a b')).rejects.toThrow('Invalid Kiro session id.');
  });

  it('reads the store and runs kiro-cli inside the WSL distro through its shell', async () => {
    const scripts: string[] = [];
    const runner = vi.fn(async (command: string, args: string[]) => {
      expect(command).toBe('wsl');
      expect(args.slice(0, 4)).toEqual(['-d', 'Ubuntu', 'bash', '-lc']);
      const script = args[4]!;
      scripts.push(script);
      if (script.includes('--delete-session')) {
        return { code: 0, stderr: '', stdout: `✔ Deleted chat session ${SESSION_A}\n` };
      }
      if (script.includes('grep -c')) {
        const meta = SESSION_JSON({ workspacePaths: ['/mnt/c/repo/alpha'] });
        return { code: 0, stderr: '', stdout: `${meta}\u001f2\n\u001e` };
      }
      return { code: 0, stderr: '', stdout: `${SESSION_JSON()}\u001f${MESSAGES_JSONL}` };
    });
    const service = new KiroNativeSessionService({ commandConfig: WSL, runner });

    expect(await service.listSessions('C:/repo/alpha')).toEqual([{
      providerSessionId: SESSION_A,
      cwd: 'C:/repo/alpha',
      summary: 'Read And Summarize Notes File',
      messageCount: 2,
      lastActivity: '2026-10-13T13:22:35.099Z',
      model: 'claude-haiku-4.5',
    }]);
    expect(scripts[0]).toContain(`root="$HOME"/'.kiro/sessions'`);
    expect(scripts[0]).toContain('for f in "$root"/*/*/session.json');

    expect(await service.loadHistory(SESSION_A)).toHaveLength(5);
    expect(scripts[1]).toContain(`for d in "$root"/*/'${SESSION_A}'`);

    expect(await service.deleteSession(SESSION_A)).toBe(true);
    expect(scripts[2]).toBe(`'kiro-cli' 'chat' '--delete-session' '${SESSION_A}'`);
  });

  it('skips WSL discovery when startIfNeeded is false and the distro is stopped', async () => {
    const runner = unusedRunner();
    const service = new KiroNativeSessionService({
      commandConfig: WSL, runner, wslInspector: async () => false,
    });

    expect(await service.listAllSessions({ startIfNeeded: false })).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('Kiro V3 store parsers', () => {
  it('reads session metadata and ignores files that are not a session', () => {
    expect(parseSessionMeta(SESSION_JSON())).toEqual({
      id: SESSION_A,
      schemaVersion: '1.0.0',
      title: 'Read And Summarize Notes File',
      workspacePath: 'C:\\repo\\alpha',
      createdAt: '2026-10-13T13:22:15.000Z',
      lastModifiedAt: '2026-10-13T13:22:35.099Z',
      modelId: 'claude-haiku-4.5',
      effortLevel: undefined,
    });
    expect(parseSessionMeta('{}')).toBeNull();
    expect(parseSessionMeta('not json')).toBeNull();
    expect(parseSessionMeta(null)).toBeNull();
  });

  it('counts prompts and tolerates a partially written trailing line', () => {
    expect(countUserMessages(`${MESSAGES_JSONL}{"id":"partial","timestamp":"2026-`)).toBe(2);
    expect(parseKiroMessages('')).toEqual([]);
  });
});
