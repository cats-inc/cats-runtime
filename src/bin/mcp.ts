#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { loadDotEnv } from '../core/dotenv.js';
import { loadConfig } from '../core/config.js';
import { generateSetupDiagnosticEntryArtifact } from '../core/diagnostics/setupDiagnosticEntry.js';
import { createRuntimeServer } from '../server.js';
import {
  applyRuntimeCliEnvOverrides,
  createRuntimeStartupState,
  parseRuntimeCliOptions,
} from '../startup.js';
import { startMcpStdioServer } from '../mcp/stdio.js';

function getHelpText(): string {
  return [
    'cats-runtime-mcp',
    '',
    'Start the cats-runtime MCP facade over stdio.',
    '',
    'Options:',
    '  --config <path>       Use an explicit providers config file',
    '  --managed-by <name>   Record the supervising host name',
    '  --diagnose-setup      Generate a setup diagnostic report and exit',
    '  --refresh-setup-scan  Refresh the shared setup scan before generating a diagnostic report',
    '  --help, -h            Show this help text',
  ].join('\n');
}

async function main(): Promise<void> {
  const cliOptions = parseRuntimeCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    process.stdout.write(`${getHelpText()}\n`);
    return;
  }

  loadDotEnv();
  applyRuntimeCliEnvOverrides(cliOptions, process.env);
  if (cliOptions.diagnoseSetup) {
    const result = await generateSetupDiagnosticEntryArtifact(cliOptions, process.env);
    process.stdout.write(`${JSON.stringify({
      status: 'generated',
      artifactPath: result.artifactPath,
      report: result.report,
    })}\n`);
    return;
  }
  const config = loadConfig();
  const startup = createRuntimeStartupState({
    mode: 'app-managed',
    managedBy: cliOptions.managedBy ?? 'mcp-host',
    readyOutput: 'silent',
  });
  const runtime = createRuntimeServer(config, { startup });
  const server = startMcpStdioServer({
    ctx: runtime.context,
    onClose: async () => {
      await runtime.close();
    },
  });

  const requestShutdown = () => {
    void server.close().then(() => {
      process.exit(process.exitCode ?? 0);
    });
  };

  process.on('SIGINT', requestShutdown);
  process.on('SIGTERM', requestShutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
    process.exit(1);
  });
}
