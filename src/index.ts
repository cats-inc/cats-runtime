#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { loadDotEnv } from './core/dotenv.js';
import { createRuntimeServer } from './server.js';

export { loadConfig } from './core/config.js';
export { createRuntimeServer } from './server.js';
export { createRuntimeApp } from './http/app.js';

async function main(): Promise<void> {
  loadDotEnv();
  const runtime = createRuntimeServer();
  const address = await runtime.start();
  process.stdout.write(
    `cats-runtime listening on http://${address.host}:${address.port}\n`,
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(`received ${signal}, shutting down\n`);
    void runtime.close().finally(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
