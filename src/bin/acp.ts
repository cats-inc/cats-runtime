#!/usr/bin/env node

import { loadDotEnv } from '../core/dotenv.js';
import { isDirectCliEntrypoint } from '../core/cliEntrypoint.js';
import {
  formatSetupDiagnosticEntrySummary,
  generateSetupDiagnosticEntryArtifact,
} from '../core/diagnostics/setupDiagnosticEntry.js';
import {
  applyRuntimeCliEnvOverrides,
  parseRuntimeCliOptions,
} from '../startup.js';
import { createHttpAcpProxyHandler } from '../acp/proxy.js';
import { startAcpStdioServer } from '../acp/stdio.js';

function getHelpText(): string {
  return [
    'cats-runtime acp',
    '',
    'Proxy stdio ACP requests to the primary cats-runtime HTTP /acp endpoint.',
    'Published package usage: cats-runtime acp',
    'Repo-local equivalent: node build/runtime/bin/acp.js',
    '',
    'Options:',
    '  --host <host>          Override the target runtime host when deriving the proxy URL',
    '  --port <port>          Override the target runtime port when deriving the proxy URL',
    '  --diagnose-setup       Generate a local setup diagnostic report and exit',
    '  --refresh-setup-scan   Refresh the shared setup scan before generating a diagnostic report',
    '  --managed-by <name>    Accepted for compatibility; ignored in proxy mode',
    '  --help, -h             Show this help text',
    '',
    'Proxy target resolution:',
    '  1. CATS_RUNTIME_ACP_PROXY_URL',
    '  2. http://<CATS_RUNTIME_HOST|127.0.0.1>:<CATS_RUNTIME_PORT|3110>/acp',
    '  Timeout: CATS_RUNTIME_ACP_PROXY_TIMEOUT_MS (default 1800000)',
  ].join('\n');
}

export async function runAcpCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const cliOptions = parseRuntimeCliOptions(argv);
  if (cliOptions.help) {
    process.stdout.write(`${getHelpText()}\n`);
    return;
  }

  loadDotEnv();
  applyRuntimeCliEnvOverrides(cliOptions, process.env);
  if (cliOptions.diagnoseSetup) {
    const result = await generateSetupDiagnosticEntryArtifact(cliOptions, process.env);
    process.stderr.write(formatSetupDiagnosticEntrySummary(result));
    process.stdout.write(`${JSON.stringify({
      status: 'generated',
      artifactPath: result.artifactPath,
      report: result.report,
    })}\n`);
    return;
  }

  const server = startAcpStdioServer({
    handleJsonRpc: createHttpAcpProxyHandler({
      env: process.env,
    }),
  });

  const requestShutdown = () => {
    void server.close().then(() => {
      process.exit(process.exitCode ?? 0);
    });
  };

  process.on('SIGINT', requestShutdown);
  process.on('SIGTERM', requestShutdown);
}

if (isDirectCliEntrypoint(import.meta.url, process.argv[1])) {
  runAcpCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
    process.exit(1);
  });
}
