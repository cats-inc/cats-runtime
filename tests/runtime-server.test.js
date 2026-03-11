import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import test from 'node:test';

import { createRuntimeServer } from '../dist/server.js';

function createMockBackend(routeHandler) {
  return createHttpServer((request, response) => {
    void routeHandler(request, response);
  });
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to read server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) {
    return;
  }
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  server.close();
  await once(server, 'close');
}

test('POST /sessions proxies JSON payloads and upstream auth', async () => {
  const seen = { auth: '', body: '' };
  const backend = createMockBackend(async (request, response) => {
    if (request.url !== '/sessions' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }

    seen.auth = request.headers.authorization ?? '';
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    seen.body = Buffer.concat(chunks).toString('utf8');

    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'session-1', status: 'ready' }));
  });

  const backendUrl = await listen(backend);
  const runtime = createRuntimeServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: '',
    backendBaseUrl: backendUrl,
    backendApiKey: 'fleet-secret',
    backendTimeoutMs: 5000,
  });

  const runtimeAddress = await runtime.start();
  const response = await fetch(
    `http://${runtimeAddress.host}:${runtimeAddress.port}/sessions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', permissionMode: 'skip' }),
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 'session-1', status: 'ready' });
  assert.equal(seen.auth, 'Bearer fleet-secret');
  assert.equal(
    seen.body,
    JSON.stringify({ provider: 'claude', permissionMode: 'skip' }),
  );

  await runtime.close();
  await close(backend);
});

test('POST /sessions/:id/messages relays NDJSON streams unchanged', async () => {
  const backend = createMockBackend(async (request, response) => {
    if (request.url !== '/sessions/session-1/messages' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
    });
    response.write('{"type":"text","text":"hello"}\n');
    response.write('{"type":"result","usage":{"inputTokens":1,"outputTokens":2}}\n');
    response.end();
  });

  const backendUrl = await listen(backend);
  const runtime = createRuntimeServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: '',
    backendBaseUrl: backendUrl,
    backendApiKey: '',
    backendTimeoutMs: 5000,
  });

  const runtimeAddress = await runtime.start();
  const response = await fetch(
    `http://${runtimeAddress.host}:${runtimeAddress.port}/sessions/session-1/messages`,
    {
      method: 'POST',
      headers: {
        accept: 'application/x-ndjson',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'hi' }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  assert.equal(
    await response.text(),
    '{"type":"text","text":"hello"}\n'
      + '{"type":"result","usage":{"inputTokens":1,"outputTokens":2}}\n',
  );

  await runtime.close();
  await close(backend);
});

test('GET /kiro/models proxies the current model catalog', async () => {
  const backend = createMockBackend(async (request, response) => {
    if (request.url !== '/kiro/models' || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        runtime: { mode: 'wsl' },
        source: 'static',
        models: ['claude-sonnet-4.5', 'deepseek-3.2'],
      }),
    );
  });

  const backendUrl = await listen(backend);
  const runtime = createRuntimeServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: '',
    backendBaseUrl: backendUrl,
    backendApiKey: '',
    backendTimeoutMs: 5000,
  });

  const runtimeAddress = await runtime.start();
  const response = await fetch(
    `http://${runtimeAddress.host}:${runtimeAddress.port}/kiro/models`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    runtime: { mode: 'wsl' },
    source: 'static',
    models: ['claude-sonnet-4.5', 'deepseek-3.2'],
  });

  await runtime.close();
  await close(backend);
});

test('GET /health enforces optional inbound auth', async () => {
  const backend = createMockBackend(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
  });

  const backendUrl = await listen(backend);
  const runtime = createRuntimeServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: 'runtime-secret',
    backendBaseUrl: backendUrl,
    backendApiKey: '',
    backendTimeoutMs: 5000,
  });

  const runtimeAddress = await runtime.start();
  const unauthenticated = await fetch(
    `http://${runtimeAddress.host}:${runtimeAddress.port}/health`,
  );
  assert.equal(unauthenticated.status, 401);

  const authenticated = await fetch(
    `http://${runtimeAddress.host}:${runtimeAddress.port}/health`,
    {
      headers: { authorization: 'Bearer runtime-secret' },
    },
  );

  assert.equal(authenticated.status, 200);
  const payload = await authenticated.json();
  assert.equal(payload.service, 'cats-runtime');
  assert.equal(payload.status, 'ok');
  assert.equal(payload.backend.kind, 'agent-fleet');
  assert.equal(payload.backend.reachable, true);
  assert.equal(payload.backend.status, 'ok');
  assert.equal(payload.backend.version, '0.1.0');
  assert.equal(typeof payload.timestamp, 'string');

  await runtime.close();
  await close(backend);
});
