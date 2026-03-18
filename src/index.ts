#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { loadDotEnv } from './core/dotenv.js';
import { loadConfig } from './core/config.js';
import { createRuntimeServer } from './server.js';
import {
  applyRuntimeCliEnvOverrides,
  createRuntimeStartupState,
  formatRuntimeReadyMessage,
  formatRuntimeStartupError,
  getRuntimeHelpText,
  parseRuntimeCliOptions,
  resolveRuntimeStartupState,
} from './startup.js';

export { loadConfig } from './core/config.js';
export { createRuntimeServer } from './server.js';
export { createRuntimeApp } from './http/app.js';

async function main(): Promise<void> {
  const cliOptions = parseRuntimeCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    process.stdout.write(`${getRuntimeHelpText()}\n`);
    return;
  }

  loadDotEnv();
  applyRuntimeCliEnvOverrides(cliOptions, process.env);

  const startup = resolveRuntimeStartupState(cliOptions, process.env);
  const config = loadConfig();
  const runtime = createRuntimeServer(config, { startup });
  const address = await runtime.start();
  const readyMessage = formatRuntimeReadyMessage(startup, {
    host: address.host,
    port: address.port,
    healthUrl: `http://${address.host}:${address.port}/health`,
  });
  if (readyMessage) {
    process.stdout.write(readyMessage);
  }

  let shuttingDown = false;
  const shutdown = (reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(`received ${reason}, shutting down\n`);
    void runtime.close().finally(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  if (startup.mode === 'app-managed' && process.stdin.readable && !process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on('end', () => {
      shutdown('stdin-closed');
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    let startup = createRuntimeStartupState();
    try {
      startup = resolveRuntimeStartupState(
        parseRuntimeCliOptions(process.argv.slice(2)),
        process.env,
      );
    } catch {
      // Fall back to a plain startup context so invalid CLI args still render
      // a readable error instead of causing a secondary parse failure.
    }
    process.stderr.write(formatRuntimeStartupError(startup, error));
    process.exitCode = 1;
  });
}
