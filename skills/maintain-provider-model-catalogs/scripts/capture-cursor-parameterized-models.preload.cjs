'use strict';
// Process-local capture hook for `cursor-agent --list-models`.
//
// Loaded with `node --require <this file> <versionDir>/index.js --list-models`.
// It never touches installed files, config or credentials, and it never reads
// request headers. It only observes already-decoded RPC reply messages that the
// CLI's own model-list command receives, and writes them to the file named by
// CURSOR_PM_CAPTURE_FILE.
//
// How it works:
//   1. Module._load is wrapped. The Cursor CLI is a webpack bundle whose lazy
//      chunks are loaded with plain require("./<n>.index.js"); each chunk
//      returns { ids, modules }. When a chunk carries the module factory for
//      the model-list command (TARGET_COMMAND_MODULE), that factory is wrapped
//      in memory before webpack installs it.
//   2. The wrapped factory receives a Proxy of webpack's require function. When
//      the command module requires the model service (MODEL_SERVICE_MODULES),
//      the exports are proxied: any exported function that is called with a
//      connect client (duck-typed: has an availableModels() method) gets a
//      client Proxy whose availableModels / getUsableModels /
//      getDefaultModelForCli calls are recorded (request + decoded reply).
//   3. The CLI races the parameterized fetch against a 2 s timer and then calls
//      process.exit(). The wrapper therefore waits (bounded) for every watched
//      RPC to settle before handing the result back, then writes the capture
//      synchronously.
//   4. Fail closed: on exit without a successful capture a status record with
//      ok:false and the reached stage is written instead.
//
// Version-specific parts (adjust here when a CLI update breaks the hook):
//   - TARGET_COMMAND_MODULE / MODEL_SERVICE_MODULES: webpack named module ids
//     (source paths) verified against the 2026.10.01-e373342 build.
//   - WATCHED_METHODS: connect RPC method names on the client.
//   - Chunk loading through require() (webpack node target).

const fs = require('node:fs');
const Module = require('node:module');

const OUTPUT = process.env.CURSOR_PM_CAPTURE_FILE;
const WAIT_MS = Number(process.env.CURSOR_PM_WAIT_MS || 40000);
const HOOK_VERSION = 1;

const TARGET_COMMAND_MODULE = './src/commands/models.ts';
const MODEL_SERVICE_MODULES = ['./src/models/model-service.ts'];
const MODEL_SERVICE_FALLBACK = /models?[-_/]service/i;
const WATCHED_METHODS = ['availableModels', 'getUsableModels', 'getDefaultModelForCli'];
// Keys that must never be written. ModelDetails carries a credentials oneof
// (apiKeyCredentials / azureCredentials / bedrockCredentials). Token-count
// fields such as contextTokenLimit or autoContextMaxTokens are not sensitive.
const SENSITIVE_KEY = /(credential|secret|password|passwd|cookie|authorization|apikey|api_key|privatekey|private_key|accesskey|access_key|sessionkey|session_key)/i;
const SENSITIVE_TOKEN_KEY = /^(token|.*(access|refresh|auth|id|session|bearer|api|jwt)_?token)$/i;
function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(key) || SENSITIVE_TOKEN_KEY.test(key);
}

const state = {
  stage: 'preload-loaded',
  chunksSeen: 0,
  commandFactoryWrapped: false,
  commandFactoryRan: false,
  requiredByCommand: [],
  serviceProxied: [],
  clientProxied: 0,
  calls: [],
  pending: new Set(),
  serviceResultSummary: null,
  written: false,
  hookErrors: [],
};

function noteError(where, err) {
  state.hookErrors.push({ where, message: String((err && err.message) || err).slice(0, 500) });
}

function stripSensitive(value, path, dropped) {
  if (Array.isArray(value)) return value.map((v, i) => stripSensitive(v, path + '[' + i + ']', dropped));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        // Record only where a key was dropped, not its name, so the record itself scans clean.
        dropped.push(path);
        continue;
      }
      out[k] = stripSensitive(v, path + '.' + k, dropped);
    }
    return out;
  }
  return value;
}

function bigintSafe(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function messageToJson(msg) {
  if (msg && typeof msg.toJson === 'function') {
    try {
      return { encoding: 'protobuf-es toJson(emitDefaultValues)', typeName: typeNameOf(msg), json: msg.toJson({ emitDefaultValues: true }) };
    } catch (err) {
      noteError('toJson', err);
    }
  }
  return { encoding: 'plain-object', typeName: typeNameOf(msg), json: bigintSafe(msg) };
}

function typeNameOf(msg) {
  try {
    const t = msg && typeof msg.getType === 'function' ? msg.getType() : undefined;
    return t && typeof t.typeName === 'string' ? t.typeName : undefined;
  } catch {
    return undefined;
  }
}

function writeRecord(record) {
  if (!OUTPUT) return;
  fs.writeFileSync(OUTPUT, JSON.stringify(record, null, 2));
}

function buildRecord(ok, reason) {
  const dropped = [];
  const calls = state.calls.map((c) => {
    const entry = { method: c.method, startedAtMs: c.startedAtMs, settledAtMs: c.settledAtMs, status: c.status };
    if (c.request) entry.request = stripSensitive(c.request, c.method + '.request', dropped);
    if (c.response) entry.response = stripSensitive(c.response, c.method + '.response', dropped);
    if (c.error) entry.error = c.error;
    return entry;
  });
  return {
    ok,
    reason,
    hookVersion: HOOK_VERSION,
    stage: state.stage,
    cliArgv: process.argv.slice(2),
    nodeVersion: process.version,
    diagnostics: {
      chunksSeen: state.chunksSeen,
      commandFactoryWrapped: state.commandFactoryWrapped,
      commandFactoryRan: state.commandFactoryRan,
      requiredByCommand: state.requiredByCommand,
      serviceProxied: state.serviceProxied,
      clientProxied: state.clientProxied,
      hookErrors: state.hookErrors,
    },
    serviceResultSummary: state.serviceResultSummary,
    droppedSensitiveKeyPaths: dropped,
    calls,
  };
}

function finalize() {
  const avail = state.calls.find((c) => c.method === 'availableModels' && c.status === 'fulfilled');
  const models = avail && avail.response && avail.response.json && avail.response.json.models;
  if (!avail) {
    writeRecord(buildRecord(false, 'availableModels reply was not observed'));
  } else if (!Array.isArray(models) || models.length === 0) {
    writeRecord(buildRecord(false, 'availableModels reply had no models'));
  } else {
    writeRecord(buildRecord(true, undefined));
  }
  state.written = true;
}

function wrapClient(client) {
  state.clientProxied += 1;
  const cache = new Map();
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !WATCHED_METHODS.includes(prop) || typeof value !== 'function') return value;
      if (cache.has(prop)) return cache.get(prop);
      const wrapped = function (...args) {
        const call = { method: prop, startedAtMs: Date.now(), status: 'pending' };
        state.calls.push(call);
        try {
          if (args[0]) call.request = messageToJson(args[0]);
        } catch (err) {
          noteError('request-serialize', err);
        }
        let promise;
        try {
          promise = Promise.resolve(value.apply(target, args));
        } catch (err) {
          promise = Promise.reject(err);
        }
        const settled = promise.then(
          (res) => {
            call.status = 'fulfilled';
            call.settledAtMs = Date.now();
            try {
              call.response = messageToJson(res);
            } catch (err) {
              noteError('response-serialize', err);
            }
          },
          (err) => {
            call.status = 'rejected';
            call.settledAtMs = Date.now();
            call.error = {
              name: err && err.name,
              code: err && err.code,
              message: String((err && (err.rawMessage || err.message)) || err).slice(0, 500),
            };
          },
        );
        state.pending.add(settled);
        settled.finally(() => state.pending.delete(settled));
        return promise;
      };
      cache.set(prop, wrapped);
      return wrapped;
    },
  });
}

async function waitForPending() {
  const deadline = Date.now() + WAIT_MS;
  while (state.pending.size > 0 && Date.now() < deadline) {
    let timer;
    await Promise.race([
      Promise.allSettled([...state.pending]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      }),
    ]);
    clearTimeout(timer);
  }
}

function summarizeServiceResult(result) {
  if (!result || typeof result !== 'object') return null;
  const pm = Array.isArray(result.parameterizedModels) ? result.parameterizedModels : undefined;
  const am = Array.isArray(result.availableModels) ? result.availableModels : undefined;
  return {
    parameterizedModelsFetchStatus: result.parameterizedModelsFetchStatus,
    cliParameterizedModelNames: pm ? pm.map((m) => m && m.name) : null,
    cliAvailableModelIds: am ? am.map((m) => m && m.modelId) : null,
    defaultModelId: result.defaultModel ? result.defaultModel.modelId : null,
    modelSelectionRestrictionMessage: result.modelSelectionRestrictionMessage,
    usableModelsErrorPresent: result.usableModelsError !== undefined,
  };
}

function wrapServiceExports(id, exportsObj) {
  if (!exportsObj || (typeof exportsObj !== 'object' && typeof exportsObj !== 'function')) return exportsObj;
  state.serviceProxied.push(id);
  const cache = new Map();
  return new Proxy(exportsObj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (cache.has(prop)) return cache.get(prop);
      const wrapped = function (...args) {
        const client = args[0];
        if (!client || typeof client !== 'object' || typeof client.availableModels !== 'function') {
          return Reflect.apply(value, this, args);
        }
        state.stage = 'model-service-called';
        args[0] = wrapClient(client);
        const out = Reflect.apply(value, this, args);
        if (!out || typeof out.then !== 'function') return out;
        return out.then(async (result) => {
          state.stage = 'model-service-returned';
          try {
            state.serviceResultSummary = summarizeServiceResult(result);
          } catch (err) {
            noteError('summarize', err);
          }
          await waitForPending();
          state.stage = 'rpc-settled';
          try {
            finalize();
          } catch (err) {
            noteError('finalize', err);
          }
          return result;
        });
      };
      cache.set(prop, wrapped);
      return wrapped;
    },
  });
}

function wrapRequire(webpackRequire) {
  return new Proxy(webpackRequire, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      const id = args[0];
      try {
        if (typeof id === 'string') {
          // Bundled package ids embed build-machine paths; keep only source-relative ids.
          if (id.startsWith('.')) state.requiredByCommand.push(id);
          if (MODEL_SERVICE_MODULES.includes(id) || MODEL_SERVICE_FALLBACK.test(id)) {
            return wrapServiceExports(id, result);
          }
        }
      } catch (err) {
        noteError('require-proxy', err);
      }
      return result;
    },
  });
}

function patchChunk(chunk) {
  if (!chunk || typeof chunk !== 'object' || !chunk.modules || typeof chunk.modules !== 'object' || !Array.isArray(chunk.ids)) return;
  state.chunksSeen += 1;
  if (!Object.prototype.hasOwnProperty.call(chunk.modules, TARGET_COMMAND_MODULE)) return;
  const original = chunk.modules[TARGET_COMMAND_MODULE];
  if (typeof original !== 'function' || original.__cursorPmWrapped) return;
  const wrappedFactory = function (module, exportsObj, webpackRequire) {
    state.commandFactoryRan = true;
    state.stage = 'command-module-loaded';
    return original.call(this, module, exportsObj, wrapRequire(webpackRequire));
  };
  wrappedFactory.__cursorPmWrapped = true;
  chunk.modules[TARGET_COMMAND_MODULE] = wrappedFactory;
  state.commandFactoryWrapped = true;
  state.stage = 'command-factory-wrapped';
}

if (!OUTPUT) {
  // Without an explicit output file the hook does nothing at all.
} else {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    const result = originalLoad.apply(this, arguments);
    try {
      if (typeof request === 'string' && /\.index\.js$/.test(request)) patchChunk(result);
    } catch (err) {
      noteError('patch-chunk', err);
    }
    return result;
  };
  process.on('exit', () => {
    if (state.written) return;
    try {
      writeRecord(buildRecord(false, 'process exited before the capture completed'));
    } catch {
      // nothing else can be done during exit
    }
  });
}
