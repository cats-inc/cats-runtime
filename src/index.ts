#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { loadDotEnv } from './core/dotenv.js';
import { loadConfig } from './core/config.js';
import { createRuntimeServer } from './server.js';
import {
  applyRuntimeCliEnvOverrides,
  createRuntimeStartupState,
  formatRuntimeReadyMessage,
  formatRuntimeStoppedMessage,
  formatRuntimeStoppingMessage,
  formatRuntimeStartupError,
  getRuntimeHelpText,
  markRuntimeStopping,
  parseRuntimeCliOptions,
  resolveRuntimeStartupState,
  type RuntimeShutdownReason,
} from './startup.js';

export { loadConfig } from './core/config.js';
export { createRuntimeServer } from './server.js';
export { createRuntimeApp } from './http/app.js';

let startup = createRuntimeStartupState();

async function main(): Promise<void> {
  const cliOptions = parseRuntimeCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    process.stdout.write(`${getRuntimeHelpText()}\n`);
    return;
  }

  loadDotEnv();
  applyRuntimeCliEnvOverrides(cliOptions, process.env);

  startup = resolveRuntimeStartupState(cliOptions, process.env);
  const config = loadConfig();
  const runtime = createRuntimeServer(config, { startup });
  let shutdownPromise: Promise<void> | null = null;

  const writeLifecycle = (line: string | null) => {
    if (line) {
      process.stdout.write(line);
    }
  };

  const shutdown = (reason: RuntimeShutdownReason): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    markRuntimeStopping(startup, reason);
    writeLifecycle(formatRuntimeStoppingMessage(startup, reason));

    shutdownPromise = runtime.close()
      .then(() => {
        writeLifecycle(formatRuntimeStoppedMessage(startup, reason));
      })
      .catch((error) => {
        process.stderr.write(
          `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      })
      .finally(() => {
        process.exit(process.exitCode ?? 0);
      });

    return shutdownPromise;
  };

  const requestShutdown = (reason: RuntimeShutdownReason) => {
    void shutdown(reason);
  };

  process.on('SIGINT', () => {
    requestShutdown('sigint');
  });
  process.on('SIGTERM', () => {
    requestShutdown('sigterm');
  });

  if (startup.mode === 'app-managed' && process.stdin.readable && !process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on('end', () => {
      requestShutdown('stdin_closed');
    });
  }

  const address = await runtime.start();
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  const readyMessage = formatRuntimeReadyMessage(startup, {
    host: address.host,
    port: address.port,
    healthUrl: `http://${address.host}:${address.port}/health`,
  });
  writeLifecycle(readyMessage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(formatRuntimeStartupError(startup, error));
    process.exitCode = 1;
    process.exit(1);
  });
}
