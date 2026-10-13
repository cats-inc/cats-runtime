// Kiro's V3 engine reports every model with its effort levels, effort default and thinking
// flags in the ACP `config_option_update` it sends while creating a session. `kiro-cli chat
// --list-models` has none of that, and the session-free `_kiro/config/template` reply omits the
// model option (Kiro 2.30.0). So this reader runs `kiro-cli acp`, creates one empty session in
// a private directory, keeps the model option, deletes the session through `session/delete`
// and exits. No prompt is ever sent, so no credits are spent; the catalog probe is the only
// caller and documents the exception to its no-session rule.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const KIRO_ACP_ARGS = ['acp', '--agent-engine', 'v3', '--auth-method', 'cli'];
const AUTH_PATTERN = /not (?:logged|signed) in|not authenticated|unauthori[sz]ed|please (?:log|sign) ?in|\blogin required|authentication (?:required|failed)|access token|\b401\b/i;
const MODEL_OPTION_WAIT_MS = 5000;

/** A failure that already knows its probe status and reason, like the probe's SourceFailure. */
export class KiroAcpError extends Error {
  constructor(status, reason, message) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const str = (value) => (typeof value === 'string' && value.trim() ? value : null);
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function compact(fields) {
  const kept = Object.entries(fields).filter(([, value]) => value !== null && value !== undefined);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/** The `model` option of a `config_option_update`, or null when the update has none. */
export function findKiroModelOption(configOptions) {
  if (!Array.isArray(configOptions)) return null;
  return configOptions.find((option) => option?.id === 'model' && Array.isArray(option.options)) ?? null;
}

/**
 * Projects the model option to probe rows: `{ id, label, efforts, effortDefault, evidence }`.
 * `efforts` is `[]` for a row Kiro marks without effort and null when it says nothing.
 */
export function parseKiroModelOptions(modelOption) {
  if (!modelOption || !Array.isArray(modelOption.options)) {
    throw new KiroAcpError('error', 'parse', 'Kiro ACP sent no model option.');
  }
  return modelOption.options.map((row) => {
    if (typeof row?.value !== 'string' || !row.value) {
      throw new KiroAcpError('error', 'parse', 'A Kiro model option has no value.');
    }
    const kiro = row._meta?.kiro && typeof row._meta.kiro === 'object' ? row._meta.kiro : {};
    const levels = Array.isArray(kiro.effortLevels) ? kiro.effortLevels.filter((level) => typeof level === 'string') : null;
    const efforts = kiro.hasEffort === true ? (levels ?? []) : kiro.hasEffort === false ? [] : levels;
    const evidence = compact({
      displayName: str(row.name),
      description: str(row.description),
      rateMultiplier: num(kiro.rateMultiplier),
      rateUnit: str(kiro.rateUnit),
      effortSchemaPath: str(kiro.effortSchemaPath),
      thinkingToggleable: typeof kiro.thinkingToggleable === 'boolean' ? kiro.thinkingToggleable : null,
      defaultThinkingEnabled: typeof kiro.defaultThinkingEnabled === 'boolean' ? kiro.defaultThinkingEnabled : null,
      // The session's current selection, not a catalog default (kiro.md).
      currentModel: modelOption.currentValue === row.value || null,
    });
    return {
      id: row.value,
      label: row.value,
      efforts,
      effortDefault: efforts && efforts.length > 0 ? str(kiro.defaultEffortLevel) : null,
      ...(evidence ? { evidence } : {}),
    };
  });
}

function removeQuietly(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Left for the OS temp cleanup.
  }
}

/**
 * Runs the ACP exchange and returns `{ rows, sessionId, sessionDeleted }`. `command`/`args`
 * default to `kiro-cli acp --agent-engine v3 --auth-method cli`; tests pass a fake server.
 */
export async function readKiroModelOptions({
  command = 'kiro-cli',
  args = KIRO_ACP_ARGS,
  env = process.env,
  cwd,
  timeoutMs = 60000,
  modelOptionWaitMs = MODEL_OPTION_WAIT_MS,
} = {}) {
  const workDir = cwd ?? mkdtempSync(join(tmpdir(), 'cats-kiro-acp-probe-'));
  const child = spawn(command, args, { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  const stderr = [];
  let nextId = 1;
  let exited = null;
  let buffer = '';
  let modelOption = null;
  let modelOptionWaiter = null;

  const failPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const exitError = () => new KiroAcpError('error', 'launch',
    `kiro-cli acp exited with code ${exited?.code ?? 'null'}${stderr.length ? `: ${stderr.at(-1)}` : ''}.`);

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message?.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new KiroAcpError('error', 'rpc', `${message.error.message ?? 'ACP request failed'}`));
        else resolve(message.result);
        continue;
      }
      if (message?.method === 'session/update' && message.params?.update?.sessionUpdate === 'config_option_update') {
        const found = findKiroModelOption(message.params.update.configOptions);
        if (found) {
          modelOption = found;
          modelOptionWaiter?.();
        }
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim() && !line.startsWith('[INFO]')) stderr.push(line.trim());
    }
  });
  child.on('error', (error) => {
    exited = { code: null };
    failPending(new KiroAcpError('error', 'launch', `kiro-cli acp could not start: ${error.message}`));
  });
  child.on('exit', (code) => {
    exited = { code };
    failPending(exitError());
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    if (exited) {
      reject(exitError());
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new KiroAcpError('unavailable', 'timeout', `kiro-cli acp did not answer within ${timeoutMs} ms.`)), timeoutMs);
  });

  const exchange = async () => {
    await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'cats-catalog-probe', version: '1' },
    });
    const created = await request('session/new', { cwd: workDir, mcpServers: [] });
    const sessionId = str(created?.sessionId);
    if (!modelOption) {
      await new Promise((resolve) => {
        modelOptionWaiter = resolve;
        setTimeout(resolve, modelOptionWaitMs);
      });
    }
    let sessionDeleted = false;
    if (sessionId) {
      try {
        await request('session/delete', { sessionId });
        sessionDeleted = true;
      } catch {
        sessionDeleted = false;
      }
    }
    if (!modelOption) {
      throw new KiroAcpError('error', 'parse', 'Kiro ACP sent no model option while creating a session.');
    }
    return { rows: parseKiroModelOptions(modelOption), sessionId, sessionDeleted };
  };

  try {
    return await Promise.race([exchange(), deadline]);
  } catch (error) {
    const text = `${error?.message ?? error} ${stderr.join(' ')}`;
    if (!(error instanceof KiroAcpError) || error.reason === 'rpc' || error.reason === 'launch') {
      if (AUTH_PATTERN.test(text)) {
        throw new KiroAcpError('unavailable', 'not-signed-in', 'kiro-cli acp reported that Kiro is not signed in.');
      }
    }
    if (error instanceof KiroAcpError) throw error;
    throw new KiroAcpError('error', 'internal', String(error?.message ?? error));
  } finally {
    clearTimeout(timer);
    if (!exited) {
      // Wait for the child to release its working directory before it is removed.
      await new Promise((resolve) => {
        const settle = setTimeout(resolve, 2000);
        child.once('exit', () => {
          clearTimeout(settle);
          resolve();
        });
        child.kill();
      });
    }
    if (!cwd) removeQuietly(workDir);
  }
}
