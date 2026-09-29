#!/usr/bin/env node
//
// Script: session-mcp-stub-server.mjs
// Description: Loopback Streamable HTTP MCP stub for SPEC-035 session MCP
//   server smokes. It serves one `echo` tool, requires the bearer token from an
//   environment variable, and logs one JSON line per request. Logs classify the
//   Authorization header (`ok`, `absent`, `literal-placeholder`, `other`) and
//   never contain the token, so a provider CLI that sends an unexpanded
//   `${VAR}` placeholder is visible without exposing the secret.
//
// Usage: node scripts/testing/session-mcp-stub-server.mjs [OPTIONS]
//
// Options:
//   --port <n>         Port on 127.0.0.1 (default 47651; 0 picks a free port)
//   --token-env <var>  Environment variable holding the expected bearer token
//                      (default CATS_MCP_STUB_TOKEN; unset means no auth check)
//   --log <file>       Also append the JSON request log to this file
//   -h, --help         Show this help message
//
// The first stdout line is `{"listening":<port>}`. The token is never read
// from argv, so it stays out of process listings as SPEC-035 requires.
//
// Examples:
//   CATS_MCP_STUB_TOKEN=secret node scripts/testing/session-mcp-stub-server.mjs --port 0
//
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const USAGE = `Usage: node scripts/testing/session-mcp-stub-server.mjs [--port <n>] [--token-env <var>] [--log <file>]
  --port <n>         Port on 127.0.0.1 (default 47651; 0 picks a free port)
  --token-env <var>  Environment variable with the expected bearer (default CATS_MCP_STUB_TOKEN)
  --log <file>       Also append the JSON request log to this file
  -h, --help         Show this help message`;

function parseArgs(argv) {
  const options = { port: 47651, tokenEnv: 'CATS_MCP_STUB_TOKEN', log: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === '--port') {
      options.port = Number(value());
    } else if (arg === '--token-env') {
      options.tokenEnv = value();
    } else if (arg === '--log') {
      options.log = value();
    } else {
      throw new Error(`Unknown option ${arg}\n${USAGE}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('--port must be an integer from 0 to 65535');
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const expected = process.env[options.tokenEnv] || '';

function classifyAuth(header) {
  if (!header) return 'absent';
  if (expected && header === `Bearer ${expected}`) return 'ok';
  if (/\$\{|\{env:/.test(header)) return 'literal-placeholder';
  return 'other';
}

function log(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  if (options.log) appendFileSync(options.log, `${line}\n`);
  process.stdout.write(`${line}\n`);
}

function respond(message) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: message.params?.protocolVersion || '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cats-session-mcp-stub', version: '1.0.0' },
    };
  }
  if (message.method === 'tools/list') {
    return {
      tools: [{
        name: 'echo',
        description: 'Echo the given text back verbatim.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      }],
    };
  }
  if (message.method === 'tools/call' && message.params?.name === 'echo') {
    return { content: [{ type: 'text', text: `echo: ${String(message.params?.arguments?.text ?? '')}` }] };
  }
  if (message.method === 'ping') return {};
  return undefined;
}

const server = createServer((req, res) => {
  const auth = classifyAuth(req.headers.authorization);
  if (req.method !== 'POST') {
    log({ http: req.method, url: req.url, auth });
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) {
      log({
        http: 'POST',
        url: req.url,
        auth,
        method: message.method,
        id: message.id ?? null,
        ...(message.method === 'tools/call'
          ? { tool: message.params?.name, args: message.params?.arguments }
          : {}),
      });
    }
    if (expected && auth !== 'ok') {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const replies = messages
      .filter((message) => message.id !== undefined && message.id !== null)
      .map((message) => {
        const result = respond(message);
        return result === undefined
          ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }
          : { jsonrpc: '2.0', id: message.id, result };
      });
    if (replies.length === 0) {
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'stub-session' });
    res.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
  });
});

server.listen(options.port, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ listening: server.address().port })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
