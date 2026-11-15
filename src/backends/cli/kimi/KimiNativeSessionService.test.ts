import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempDirWithRetries } from '../../../../tests/tempCleanup.js';
import type { ProviderCommandConfig } from '../config.js';
import type { AgentProcessSpawner, AgentSpawnedProcess } from '../../agent/types.js';
import {
  KimiNativeSessionService,
  digestKimiWire,
  parseKimiSessionListJson,
  parseKimiWireHistory,
} from './KimiNativeSessionService.js';

const fixtureDir = fileURLToPath(new URL('../../../../tests/fixtures/provider-captures/kimi-2.5.3/', import.meta.url));
const SESSION_ID = 'session_1f05d96e-47c2-40ca-a357-c0a3cf66f97c';
const WORKDIR = 'wd_work_4bc2d6c3509e';
const native: ProviderCommandConfig = { path: 'kimi', runner: 'auto', runtime: { mode: 'native' } };

let root: string;
let kimiHome: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cats-kimi-store-'));
  kimiHome = join(root, '.kimi-code');
  cpSync(join(fixtureDir, 'session-store'), kimiHome, { recursive: true });
});

afterEach(() => {
  cleanupTempDirWithRetries(root);
});

function writeSession(id: string, state: Record<string, unknown>, wire = ''): void {
  const dir = join(kimiHome, 'sessions', 'wd_other_123', id);
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id, version: 2, ...state }));
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), wire);
}

describe('KimiNativeSessionService native store', () => {
  it('lists a captured session with its user turns, first prompt and model', async () => {
    const sessions = await new KimiNativeSessionService({ commandConfig: native, kimiHome }).listAllSessions();

    expect(sessions).toEqual([{
      providerSessionId: SESSION_ID,
      // The runtime adapter reports host paths with forward slashes, as for Kiro.
      cwd: 'C:/work/kimi-project',
      summary: 'USE_TOOL please read hello.txt',
      messageCount: 2,
      lastActivity: new Date(1794766555757).toISOString(),
      model: 'mock-model',
    }]);
  });

  it('skips index directories, foreign ids, other state versions and unreadable state', async () => {
    mkdirSync(join(kimiHome, 'sessions', '.index-cache', 'session_x'), { recursive: true });
    writeSession('session_old', { version: 1, cwd: 'C:\\a' });
    writeSession('session_mismatch', { id: 'session_other', cwd: 'C:\\a' });
    writeSession('session_nocwd', {});
    mkdirSync(join(kimiHome, 'sessions', 'wd_other_123', 'session_broken'), { recursive: true });
    writeFileSync(join(kimiHome, 'sessions', 'wd_other_123', 'session_broken', 'state.json'), '{');

    const ids = (await new KimiNativeSessionService({ commandConfig: native, kimiHome }).listAllSessions())
      .map((session) => session.providerSessionId);

    expect(ids).toEqual([SESSION_ID]);
  });

  it('names a Cats-run session after the user text, prefers a stored title and sorts newest first', async () => {
    const prompt = JSON.stringify({ type: 'turn.prompt', origin: { kind: 'user' },
      input: [{ type: 'text', text: 'Instructions:\nBe brief.\n\nUser message:\n請整理 README\nsecond line' }] });
    writeSession('session_cats', { cwd: 'C:\\b', updatedAt: 1894766555757 }, `${prompt}\n`);
    writeSession('session_titled', { cwd: 'C:\\c', title: 'Refactor parser', updatedAt: 1694766555757 });

    const sessions = await new KimiNativeSessionService({ commandConfig: native, kimiHome }).listAllSessions();

    expect(sessions.map((session) => [session.providerSessionId, session.summary, session.messageCount])).toEqual([
      ['session_cats', '請整理 README', 1],
      [SESSION_ID, 'USE_TOOL please read hello.txt', 2],
      ['session_titled', 'Refactor parser', 0],
    ]);
  });

  it('filters by workspace, case-insensitively on Windows', async () => {
    const service = new KimiNativeSessionService({ commandConfig: native, kimiHome });
    const cwd = process.platform === 'win32' ? 'c:/WORK/kimi-project/' : 'C:\\work\\kimi-project';

    expect((await service.listSessions(cwd)).map((session) => session.providerSessionId)).toEqual([SESSION_ID]);
    expect(await service.listSessions('C:\\elsewhere')).toEqual([]);
  });

  it('reads the visible transcript without injected reminders or tool traffic', async () => {
    const history = await new KimiNativeSessionService({ commandConfig: native, kimiHome }).loadHistory(SESSION_ID);

    expect(history.map((message) => [message.role, message.text])).toEqual([
      ['user', 'USE_TOOL please read hello.txt'],
      ['assistant', 'Reading the file.'],
      ['assistant', 'The file says hello.'],
      ['user', 'MULTILINE now'],
      ['assistant', '第一行\nsecond line'],
    ]);
    expect(history[0].timestamp).toMatch(/^\d{4}-\d\d-\d\dT/u);
    expect(await new KimiNativeSessionService({ commandConfig: native, kimiHome }).loadHistory('session_missing'))
      .toEqual([]);
    await expect(new KimiNativeSessionService({ commandConfig: native, kimiHome }).loadHistory('../x'))
      .rejects.toThrow('Invalid Kimi session id.');
  });

  it('refuses a wire journal from an unknown protocol major', () => {
    expect(() => parseKimiWireHistory('{"type":"metadata","protocol_version":"2.0"}\n'))
      .toThrow('Unsupported Kimi wire protocol 2.0; expected 1.x.');
    expect(digestKimiWire('')).toEqual({ userTurns: 0 });
  });
});

describe('KimiNativeSessionService inside WSL or Docker', () => {
  const wsl: ProviderCommandConfig = { path: '/home/dev/.kimi-code/bin/kimi', runner: 'auto',
    runtime: { mode: 'wsl', distro: 'Ubuntu' } };

  it('enumerates with kimi session list and reads each journal through the shell', async () => {
    const list = readFileSync(join(fixtureDir, 'session-list.all.redacted.json'), 'utf8');
    const wire = readFileSync(join(kimiHome, 'sessions', WORKDIR, SESSION_ID, 'agents', 'main', 'wire.jsonl'), 'utf8');
    const scripts: string[] = [];
    const runner = async (_command: string, args: string[]) => {
      const script = args.at(-1) ?? '';
      scripts.push(script);
      if (script.includes('session list --all --json')) return { code: 0, stdout: list, stderr: '' };
      return { code: 0, stdout: script.includes(SESSION_ID) ? wire : '', stderr: '' };
    };
    const service = new KimiNativeSessionService({ commandConfig: wsl, runner, wslInspector: async () => true });

    const sessions = await service.listAllSessions({ startIfNeeded: false });

    expect(sessions).toHaveLength(parseKimiSessionListJson(list).length);
    expect(sessions.find((session) => session.providerSessionId === SESSION_ID)).toMatchObject({
      messageCount: 2, summary: 'USE_TOOL please read hello.txt', model: 'mock-model',
    });
    expect(scripts[0]).toContain("KIMI_CODE_NO_AUTO_UPDATE=1 '/home/dev/.kimi-code/bin/kimi' session list --all --json");
    expect((await service.loadHistory(SESSION_ID)).at(-1)).toMatchObject({ role: 'assistant', text: '第一行\nsecond line' });
  });

  it('skips a stopped distro during background discovery', async () => {
    const service = new KimiNativeSessionService({ commandConfig: wsl, wslInspector: async () => false,
      runner: async () => { throw new Error('should not run'); } });

    expect(await service.listAllSessions({ startIfNeeded: false })).toEqual([]);
  });
});

interface FakeAcp {
  spawner: AgentProcessSpawner;
  requests: Array<{ method: string; params: unknown }>;
  launches: Array<{ command: string; args: string[]; env?: Record<string, string> }>;
}

/** A `kimi acp` stand-in answering initialize and session/delete. */
function fakeAcp(options: { canDelete?: boolean; deleteError?: { code: number; message: string } } = {}): FakeAcp {
  const requests: FakeAcp['requests'] = [];
  const launches: FakeAcp['launches'] = [];
  const spawner: AgentProcessSpawner = (command, args, spawnOptions) => {
    launches.push({ command, args, env: spawnOptions.env });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let buffered = '';
    stdin.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const message = JSON.parse(buffered.slice(0, newline)) as { id: number; method: string; params: unknown };
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
        requests.push({ method: message.method, params: message.params });
        const reply = message.method === 'initialize'
          ? { result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities:
            options.canDelete === false ? { list: {} } : { list: {}, delete: {} } } } }
          : options.deleteError ? { error: options.deleteError } : { result: {} };
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply })}\n`);
      }
    });
    const process: AgentSpawnedProcess = {
      stdin, stdout, stderr, exitCode: null,
      kill: () => { stdout.end(); return true; },
      on: () => process,
    } as unknown as AgentSpawnedProcess;
    return process;
  };
  return { spawner, requests, launches };
}

describe('KimiNativeSessionService.deleteSession', () => {
  it('deletes through kimi acp with the updater off and the same Kimi home', async () => {
    const acp = fakeAcp();
    const service = new KimiNativeSessionService({ commandConfig: native, kimiHome, acpSpawner: acp.spawner });

    expect(await service.deleteSession(SESSION_ID)).toBe(true);
    expect(acp.requests.map((request) => request.method)).toEqual(['initialize', 'session/delete']);
    expect(acp.requests[1].params).toEqual({ sessionId: SESSION_ID });
    expect(acp.launches[0].args).toEqual(['acp']);
    expect(acp.launches[0].env).toMatchObject({ KIMI_CODE_HOME: kimiHome, KIMI_CODE_NO_AUTO_UPDATE: '1' });
  });

  it('counts an id Kimi no longer knows as deleted', async () => {
    const acp = fakeAcp({ deleteError: { code: -32602, message: 'Unknown sessionId: session_gone' } });

    expect(await new KimiNativeSessionService({ commandConfig: native, kimiHome, acpSpawner: acp.spawner })
      .deleteSession('session_gone')).toBe(true);
  });

  it('fails when Kimi refuses or cannot delete', async () => {
    const refused = fakeAcp({ deleteError: { code: -32000, message: 'Session is in use' } });
    await expect(new KimiNativeSessionService({ commandConfig: native, kimiHome, acpSpawner: refused.spawner })
      .deleteSession(SESSION_ID)).rejects.toThrow('Session is in use');

    const unsupported = fakeAcp({ canDelete: false });
    await expect(new KimiNativeSessionService({ commandConfig: native, kimiHome, acpSpawner: unsupported.spawner })
      .deleteSession(SESSION_ID)).rejects.toThrow('does not offer ACP session deletion');
    expect(unsupported.requests.map((request) => request.method)).toEqual(['initialize']);

    await expect(new KimiNativeSessionService({ commandConfig: native, kimiHome }).deleteSession('a/b'))
      .rejects.toThrow('Invalid Kimi session id.');
  });
});
