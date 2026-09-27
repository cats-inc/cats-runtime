#!/usr/bin/env node

// Reads the installed GitHub Copilot CLI's models.list RPC once, over --headless --stdio, and prints
// a redacted projection: id, name, reasoning-effort tokens, context sizes and discount. It uses the
// CLI's existing login, creates no session and sends no prompt. Raw payloads, which can carry
// account policy data, are never printed.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DROP_ENV = ['TERM', 'CI', 'NO_COLOR', 'PAGER', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT', 'GIT_ASKPASS'];
const METHOD_NOT_FOUND = -32601;

export function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]);
}

// Splits complete Content-Length frames off the front of a buffer.
export function readFrames(buffer) {
  const messages = [];
  let rest = buffer;
  while (true) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const match = /Content-Length:\s*(\d+)/i.exec(rest.subarray(0, headerEnd).toString('utf8'));
    if (!match) throw new Error('A response frame has no Content-Length header.');
    const start = headerEnd + 4;
    const end = start + Number(match[1]);
    if (rest.length < end) break;
    messages.push(JSON.parse(rest.subarray(start, end).toString('utf8')));
    rest = rest.subarray(end);
  }
  return { messages, rest };
}

function modelRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.models)) return result.models;
  if (Array.isArray(result?.data)) return result.data;
  return null;
}

export function projectModels(result) {
  const rows = modelRows(result);
  if (!rows) throw new Error('models.list returned no model array.');
  return rows.map((row) => {
    const prices = row.billing?.tokenPrices;
    return {
      id: row.id ?? row.model ?? null,
      name: row.name ?? row.displayName ?? null,
      supportedReasoningEfforts: row.supportedReasoningEfforts ?? null,
      contextMax: prices?.contextMax ?? null,
      longContextMax: prices?.longContext?.contextMax ?? null,
      ...(typeof row.billing?.discountPercent === 'number' ? { discountPercent: row.billing.discountPercent } : {}),
    };
  });
}

// Tries models.list directly; on method-not-found, performs connect (or ping) and retries once.
export function listCopilotModels({ loader, timeoutMs = 30000, cwd = process.cwd(), env = process.env }) {
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (DROP_ENV.includes(key) || key.startsWith('COPILOT_')) delete childEnv[key];
  }
  const child = spawn(process.execPath, [loader, '--headless', '--stdio', '--no-auto-update', '--log-level', 'error'], {
    cwd, env: childEnv, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    let buffer = Buffer.alloc(0);
    let phase = 'direct';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolvePromise(value);
    };
    const send = (id, method) => child.stdin.write(frame({ jsonrpc: '2.0', id, method, params: {} }));
    const timer = setTimeout(() => finish(new Error(`No models.list result within ${timeoutMs} ms (phase ${phase}).`)), timeoutMs);
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => finish(new Error(`The Copilot CLI exited (${code}) before models.list returned.`)));
    child.stdout.on('data', (chunk) => {
      let parsed;
      try {
        parsed = readFrames(Buffer.concat([buffer, chunk]));
      } catch (error) {
        finish(error);
        return;
      }
      buffer = parsed.rest;
      for (const message of parsed.messages) {
        if (message.id === 1 || message.id === 4) {
          if (message.error?.code === METHOD_NOT_FOUND && phase === 'direct') {
            phase = 'connect';
            send(2, 'connect');
          } else if (message.error) {
            finish(new Error(`models.list failed: ${message.error.message ?? message.error.code}`));
          } else {
            try {
              const models = projectModels(message.result);
              finish(null, { observedAt: new Date().toISOString(), phase, elapsedMs: Date.now() - started, count: models.length, models });
            } catch (error) {
              finish(error);
            }
          }
        } else if (message.id === 2) {
          if (message.error?.code === METHOD_NOT_FOUND) {
            phase = 'ping';
            send(3, 'ping');
          } else if (message.error) {
            finish(new Error(`connect failed: ${message.error.message ?? message.error.code}`));
          } else {
            send(4, 'models.list');
          }
        } else if (message.id === 3) {
          send(4, 'models.list');
        }
      }
    });
    send(1, 'models.list');
  });
}

function cliUsage() {
  return [
    'Usage:',
    '  list-copilot-models.mjs --loader <npm-loader.js> [--timeout-ms <ms>]',
    '',
    'The loader is <npm root -g>/@github/copilot/npm-loader.js for an npm install.',
    'Prints JSON: observedAt, phase, elapsedMs, count and models (id, name, supportedReasoningEfforts,',
    'contextMax, longContextMax, discountPercent).',
  ].join('\n');
}

async function main() {
  try {
    const { values } = parseArgs({ options: {
      loader: { type: 'string' },
      'timeout-ms': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    } });
    if (values.help || !values.loader) {
      process.stdout.write(`${cliUsage()}\n`);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const timeoutMs = values['timeout-ms'] ? Number(values['timeout-ms']) : 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('--timeout-ms must be an integer of at least 1000.');
    const result = await listCopilotModels({ loader: resolve(values.loader), timeoutMs });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
