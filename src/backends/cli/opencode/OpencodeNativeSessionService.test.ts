import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildPowerShellCommandScript } from '../runtime/runtime.js';
import {
  buildOpencodeServerSpawnConfig,
  OpencodeNativeSessionService,
  parseOpencodeModel,
} from './OpencodeNativeSessionService.js';

describe('OpencodeNativeSessionService', () => {
  it('lists sessions from an already-running OpenCode server', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname === '/global/health') {
        return jsonResponse({ ok: true });
      }
      if (url.pathname === '/session') {
        return jsonResponse([
          {
            id: 'oc-1',
            directory: '/tmp/repo',
            title: 'Existing OpenCode Session',
            time: { updated: 1710000000000 },
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const launcher = vi.fn();
    const service = new OpencodeNativeSessionService({
      command: 'opencode',
      fetchFn: fetchFn as typeof fetch,
      launcher,
    });

    await expect(service.listAllSessions({ startIfNeeded: false })).resolves.toEqual([
      {
        providerSessionId: 'oc-1',
        cwd: '/tmp/repo',
        summary: 'Existing OpenCode Session',
        messageCount: 0,
        lastActivity: '2024-03-09T16:00:00.000Z',
      },
    ]);
    expect(launcher).not.toHaveBeenCalled();
  });

  it('returns no sessions when passive discovery is asked not to start the server', async () => {
    const service = new OpencodeNativeSessionService({
      command: 'opencode',
      fetchFn: vi.fn(async () => { throw new Error('not running'); }) as typeof fetch,
      launcher: vi.fn(),
    });

    await expect(service.listAllSessions({ startIfNeeded: false })).resolves.toEqual([]);
  });

  it('resolves the Windows npm shim when launching the embedded OpenCode server', () => {
    const previous = {
      APPDATA: process.env.APPDATA,
      npm_config_prefix: process.env.npm_config_prefix,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
    };
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const tempRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-opencode-'));
    const npmPrefix = join(tempRoot, 'npm-global');
    const shimPath = join(npmPrefix, 'opencode.cmd');

    mkdirSync(npmPrefix, { recursive: true });
    writeFileSync(shimPath, '@echo off\r\n');

    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.APPDATA = '';
      process.env.npm_config_prefix = npmPrefix;
      process.env.PATH = '';
      process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';

      const spawnConfig = buildOpencodeServerSpawnConfig(
        {
          path: 'opencode',
          runner: 'auto',
          runtime: {
            mode: 'native',
          },
        },
        '127.0.0.1',
        4097,
        'C:\\Users\\kenne\\repo',
      );

      expect(spawnConfig).toEqual({
        command: expect.stringContaining('powershell'),
        args: [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          buildPowerShellCommandScript(),
        ],
        shell: false,
        cwd: 'C:\\Users\\kenne\\repo',
        env: {
          CATS_RUNTIME_PWSH_EXEC_B64: Buffer.from(JSON.stringify({
            command: shimPath,
            args: [
              'serve',
              '--hostname=127.0.0.1',
              '--port=4097',
            ],
          }), 'utf8').toString('base64'),
        },
      });
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor);
      }
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates sessions, loads history, and deletes them through the HTTP API', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());

      if (url.pathname === '/global/health') {
        throw new Error('not running');
      }

      if (url.pathname === '/session' && init?.method === 'POST') {
        expect(url.searchParams.get('directory')).toBe('/tmp/repo');
        return jsonResponse({
          id: 'oc-new',
          directory: '/tmp/repo',
          title: 'Fresh Session',
          time: { created: 1710000000000 },
        });
      }

      if (url.pathname === '/session/oc-new/message' && init?.method === 'GET') {
        return jsonResponse([
          {
            info: {
              id: 'user-1',
              role: 'user',
              time: { created: 1710000000000 },
            },
            parts: [{ id: 'part-1', type: 'text', text: 'hello' }],
          },
          {
            info: {
              id: 'assistant-1',
              sessionID: 'oc-new',
              role: 'assistant',
              providerID: 'anthropic',
              modelID: 'claude-sonnet-4.5',
              time: { created: 1710000001000, completed: 1710000002000 },
              cost: 0,
              mode: 'chat',
              agent: 'build',
              path: { cwd: '/tmp/repo', root: '/tmp/repo' },
              tokens: { input: 10, output: 20 },
            },
            parts: [{ id: 'part-2', type: 'text', text: 'world' }],
          },
        ]);
      }

      if (url.pathname === '/session/oc-new' && init?.method === 'DELETE') {
        return jsonResponse(true);
      }

      throw new Error(`Unexpected request: ${url} ${init?.method}`);
    });
    const launcher = vi.fn(async () => ({
      url: 'http://127.0.0.1:4097',
      close: vi.fn(),
    }));
    const service = new OpencodeNativeSessionService({
      command: 'opencode',
      fetchFn: fetchFn as typeof fetch,
      launcher,
    });

    await expect(service.createSession('/tmp/repo')).resolves.toEqual({
      providerSessionId: 'oc-new',
      cwd: '/tmp/repo',
      summary: 'Fresh Session',
      messageCount: 0,
      lastActivity: '2024-03-09T16:00:00.000Z',
    });
    await expect(service.loadHistory('/tmp/repo', 'oc-new')).resolves.toEqual([
      { role: 'user', text: 'hello', timestamp: '2024-03-09T16:00:00.000Z' },
      { role: 'assistant', text: 'world', timestamp: '2024-03-09T16:00:01.000Z' },
    ]);
    await expect(service.deleteSession('/tmp/repo', 'oc-new')).resolves.toBe(true);
    expect(launcher).toHaveBeenCalledTimes(1);
  });

  it('parses prompt responses into normalized text, usage, and tool metadata', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname === '/global/health') {
        return jsonResponse({ ok: true });
      }
      if (url.pathname === '/session/oc-1/message' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          model?: { providerID: string; modelID: string };
          parts: Array<{ type: string; text?: string }>;
        };
        expect(body.model).toEqual({
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4.5',
        });
        expect(body.parts).toEqual([{ type: 'text', text: 'Ship it' }]);

        return jsonResponse({
          info: {
            id: 'assistant-1',
            sessionID: 'oc-1',
            role: 'assistant',
            providerID: 'anthropic',
            modelID: 'claude-sonnet-4.5',
            time: { created: 1710000001000, completed: 1710000002000 },
            cost: 0,
            mode: 'chat',
            agent: 'build',
            path: { cwd: '/tmp/repo', root: '/tmp/repo' },
            tokens: { input: 12, output: 34 },
          },
          parts: [
            { id: 'tool-1', type: 'tool', callID: 'tool-call-1', tool: 'write' },
            { id: 'text-1', type: 'text', text: 'Done.' },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method}`);
    });
    const service = new OpencodeNativeSessionService({
      command: 'opencode',
      fetchFn: fetchFn as typeof fetch,
      launcher: vi.fn(),
    });

    await expect(service.prompt({
      cwd: '/tmp/repo',
      sessionId: 'oc-1',
      content: 'Ship it',
      model: 'anthropic/claude-sonnet-4.5',
    })).resolves.toEqual({
      sessionId: 'oc-1',
      messageId: 'assistant-1',
      text: 'Done.',
      usage: {
        inputTokens: 12,
        outputTokens: 34,
      },
      toolUses: [
        { toolId: 'tool-call-1', toolName: 'write' },
      ],
    });
  });

  it('surfaces a clear error when OpenCode accepts a prompt but returns no assistant payload', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname === '/global/health') {
        return jsonResponse({ ok: true });
      }
      if (url.pathname === '/session/oc-1/message' && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.pathname === '/session/oc-1/message' && init?.method === 'GET') {
        return jsonResponse([
          {
            info: {
              id: 'user-1',
              sessionID: 'oc-1',
              role: 'user',
              time: { created: 1710000000000 },
            },
            parts: [{ id: 'part-1', type: 'text', text: 'Ship it' }],
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url} ${init?.method}`);
    });
    const service = new OpencodeNativeSessionService({
      command: 'opencode',
      fetchFn: fetchFn as typeof fetch,
      launcher: vi.fn(),
    });

    await expect(service.prompt({
      cwd: '/tmp/repo',
      sessionId: 'oc-1',
      content: 'Ship it',
      model: 'opencode/glm-5',
    })).rejects.toThrow(
      "OpenCode returned no assistant response for model 'opencode/glm-5'",
    );
  });

  it('parses provider/model strings for OpenCode prompt requests', () => {
    expect(parseOpencodeModel('anthropic/claude-sonnet-4.5')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4.5',
    });
    expect(parseOpencodeModel('openai:gpt-5')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5',
    });
    expect(parseOpencodeModel('minimax m2.5')).toEqual({
      providerID: 'opencode-go',
      modelID: 'minimax-m2.5',
    });
    expect(parseOpencodeModel('kimi k2.5')).toEqual({
      providerID: 'opencode-go',
      modelID: 'kimi-k2.5',
    });
    expect(parseOpencodeModel('glm-5')).toEqual({
      providerID: 'opencode-go',
      modelID: 'glm-5',
    });
    expect(parseOpencodeModel('minimax m2.5 free')).toEqual({
      providerID: 'opencode',
      modelID: 'minimax-m2.5-free',
    });
    expect(parseOpencodeModel('mimo v2 flash free')).toEqual({
      providerID: 'openrouter',
      modelID: 'xiaomi/mimo-v2-flash:free',
    });
    expect(parseOpencodeModel('big pickle')).toEqual({
      providerID: 'opencode',
      modelID: 'big-pickle',
    });
    expect(parseOpencodeModel('gpt-5')).toBeUndefined();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
