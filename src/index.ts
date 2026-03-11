import { pathToFileURL } from 'node:url';

import { AgentFleetBackend } from './adapters/agentFleetBackend.js';
import { loadConfig } from './core/config.js';
import { loadDotEnv } from './core/dotenv.js';
import { createRuntimeServer } from './server.js';

export { AgentFleetBackend } from './adapters/agentFleetBackend.js';
export { loadConfig } from './core/config.js';
export { createRuntimeServer } from './server.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const runtime = createRuntimeServer(config, new AgentFleetBackend(config));
  const address = await runtime.start();
  process.stdout.write(
    `cats-runtime listening on http://${address.host}:${address.port}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
