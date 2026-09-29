import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupTempDirWithRetries } from './tempCleanup.js';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(runtimeRoot, 'scripts', 'testing', 'session-mcp-stub-server.mjs');
const TOKEN = 'synthetic-stub-bearer-secret';

describe('session MCP stub server (SPEC-035 smoke helper)', () => {
  let tempDir: string;
  let child: ChildProcessWithoutNullStreams | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cats-session-mcp-stub-'));
  });

  afterEach(() => {
    child?.kill();
    child = undefined;
    cleanupTempDirWithRetries(tempDir);
  });

  async function start(): Promise<{ url: string; logFile: string }> {
    const logFile = join(tempDir, 'stub.log');
    const proc = spawn(process.execPath, [script, '--port', '0', '--log', logFile], {
      env: { ...process.env, CATS_MCP_STUB_TOKEN: TOKEN },
    });
    child = proc;
    const port = await new Promise<number>((resolvePort, reject) => {
      let buffered = '';
      proc.once('error', reject);
      proc.once('exit', (code) => reject(new Error(`stub exited with ${code}`)));
      proc.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        const line = buffered.split('\n')[0];
        if (buffered.includes('\n') && line) resolvePort(JSON.parse(line).listening as number);
      });
    });
    return { url: `http://127.0.0.1:${port}/mcp`, logFile };
  }

  function call(url: string, authorization: string | undefined, body: unknown) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('serves the echo tool to the expected bearer and never logs the token', async () => {
    const { url, logFile } = await start();
    const bearer = `Bearer ${TOKEN}`;

    const init = await call(url, bearer, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(await init.json()).toMatchObject({ id: 1, result: { capabilities: { tools: {} } } });
    expect((await call(url, bearer, { jsonrpc: '2.0', method: 'notifications/initialized' })).status)
      .toBe(202);
    expect(await (await call(url, bearer, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json())
      .toMatchObject({ result: { tools: [{ name: 'echo' }] } });
    expect(await (await call(url, bearer, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } },
    })).json()).toMatchObject({ result: { content: [{ type: 'text', text: 'echo: hi' }] } });

    // An unexpanded placeholder, a wrong token and no header are all refused.
    for (const [id, authorization] of [
      [4, 'Bearer ${CATS_MCP_CATS_TOKEN}'],
      [5, 'Bearer wrong'],
      [6, undefined],
    ] as const) {
      expect((await call(url, authorization, { jsonrpc: '2.0', id, method: 'tools/list' })).status)
        .toBe(401);
    }

    const log = readFileSync(logFile, 'utf8');
    expect(log).not.toContain(TOKEN);
    const entries = log.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.map((entry) => entry.auth)).toEqual([
      'ok', 'ok', 'ok', 'ok', 'literal-placeholder', 'other', 'absent',
    ]);
    expect(entries[3]).toMatchObject({ method: 'tools/call', tool: 'echo', args: { text: 'hi' } });
  });
});
