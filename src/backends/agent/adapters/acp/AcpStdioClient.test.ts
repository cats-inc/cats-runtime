import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AcpJsonRpcClientError,
  AcpStdioClient,
} from './AcpStdioClient.js';
import type { AgentProcessSpawner, AgentSpawnedProcess } from '../../types.js';

class FakeAcpProcess extends EventEmitter implements AcpSpawnedProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0, null);
    return true;
  }
}

async function readNextLine(stream: PassThrough): Promise<string> {
  const rl = createInterface({ input: stream });
  try {
    return await new Promise<string>((resolve) => {
      rl.once('line', (line) => resolve(line));
    });
  } finally {
    rl.close();
  }
}

function createSpawner(process: FakeAcpProcess): AgentProcessSpawner {
  return () => process;
}

describe('AcpStdioClient', () => {
  const activeClients: AcpStdioClient[] = [];

  afterEach(async () => {
    while (activeClients.length > 0) {
      await activeClients.pop()?.close();
    }
  });

  it('sends JSON-RPC requests and resolves matching responses', async () => {
    const process = new FakeAcpProcess();
    const client = new AcpStdioClient({
      command: 'codex-acp',
      args: ['serve'],
      spawnProcess: createSpawner(process),
    });
    activeClients.push(client);

    const responsePromise = client.request('initialize', {
      protocolVersion: 1,
    });

    const requestLine = await readNextLine(process.stdin);
    await expect(Promise.resolve(JSON.parse(requestLine))).resolves.toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: 1,
      },
    });

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: 1,
      },
    }) + '\n');

    await expect(responsePromise).resolves.toEqual({
      protocolVersion: 1,
    });
  });

  it('routes notifications to the notification callback', async () => {
    const process = new FakeAcpProcess();
    const received: Array<{ method: string; params?: unknown }> = [];
    const client = new AcpStdioClient({
      command: 'codex-acp',
      spawnProcess: createSpawner(process),
      onNotification(message) {
        received.push({
          method: message.method,
          params: message.params,
        });
      },
    });
    activeClients.push(client);

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
        },
      },
    }) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([
      {
        method: 'session/update',
        params: {
          sessionId: 'sess-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
          },
        },
      },
    ]);
  });

  it('responds to server requests through the injected handler', async () => {
    const process = new FakeAcpProcess();
    const client = new AcpStdioClient({
      command: 'codex-acp',
      spawnProcess: createSpawner(process),
      onServerRequest(message) {
        expect(message.method).toBe('session/request_permission');
        return {
          outcome: {
            outcome: 'selected',
            optionId: 'allow-once',
          },
        };
      },
    });
    activeClients.push(client);

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-1',
      },
    }) + '\n');

    const responseLine = await readNextLine(process.stdin);
    await expect(Promise.resolve(JSON.parse(responseLine))).resolves.toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: 'allow-once',
        },
      },
    });
  });

  it('handles server requests carrying string JSON-RPC ids', async () => {
    // JSON-RPC 2.0 allows String, Number, or NULL ids. Devin's ACP server issues
    // fs/read_text_file with a string UUID; a number-only request guard sent that
    // frame to failAll, which tore down the session on the first file read.
    const process = new FakeAcpProcess();
    const seen: string[] = [];
    const client = new AcpStdioClient({
      command: 'devin',
      args: ['acp'],
      spawnProcess: createSpawner(process),
      onServerRequest(message) {
        seen.push(message.method);
        return { content: 'alpha\nbravo\n' };
      },
    });
    activeClients.push(client);

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'd36679fd-d753-4cfd-97f5-f5aa657f4160',
      method: 'fs/read_text_file',
      params: { sessionId: 'humorous-sprite', path: '/work/sample.txt' },
    }) + '\n');

    const responseLine = await readNextLine(process.stdin);
    expect(JSON.parse(responseLine)).toEqual({
      jsonrpc: '2.0',
      id: 'd36679fd-d753-4cfd-97f5-f5aa657f4160',
      result: { content: 'alpha\nbravo\n' },
    });
    expect(seen).toEqual(['fs/read_text_file']);
  });

  it('rejects pending requests when the process exits early', async () => {
    const process = new FakeAcpProcess();
    const client = new AcpStdioClient({
      command: 'codex-acp',
      spawnProcess: createSpawner(process),
    });
    activeClients.push(client);

    const responsePromise = client.request('session/new', {
      cwd: '/repo',
    });
    await readNextLine(process.stdin);

    process.emit('close', 1, null);

    await expect(responsePromise).rejects.toThrow(
      /ACP stdio process exited before the client finished/,
    );
  });

  it('turns JSON-RPC error responses into typed client errors', async () => {
    const process = new FakeAcpProcess();
    const client = new AcpStdioClient({
      command: 'codex-acp',
      spawnProcess: createSpawner(process),
    });
    activeClients.push(client);

    const responsePromise = client.request('session/load', {
      sessionId: 'sess-404',
    });
    await readNextLine(process.stdin);

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      error: {
        code: -32001,
        message: 'resource missing',
        data: {
          sessionId: 'sess-404',
        },
      },
    }) + '\n');

    await expect(responsePromise).rejects.toBeInstanceOf(AcpJsonRpcClientError);
    await expect(responsePromise).rejects.toMatchObject({
      code: -32001,
      data: {
        sessionId: 'sess-404',
      },
    });
  });

  it('times out requests that never receive a response', async () => {
    const process = new FakeAcpProcess();
    const client = new AcpStdioClient({
      command: 'codex-acp',
      spawnProcess: createSpawner(process),
    });
    activeClients.push(client);

    const responsePromise = client.request('initialize', {
      protocolVersion: 1,
    }, {
      timeoutMs: 10,
    });
    await readNextLine(process.stdin);

    await expect(responsePromise).rejects.toThrow(
      /ACP stdio request 'initialize' timed out after 10ms/,
    );
  });
});
