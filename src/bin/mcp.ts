#!/usr/bin/env node

import { loadRuntimeEnvFiles } from '../core/dotenv.js';
import { isDirectCliEntrypoint } from '../core/cliEntrypoint.js';
import {
  formatSetupDiagnosticEntrySummary,
  generateSetupDiagnosticEntryArtifact,
} from '../core/diagnostics/setupDiagnosticEntry.js';
import {
  applyRuntimeCliEnvOverrides,
  parseRuntimeCliOptions,
} from '../startup.js';
import { createHttpMcpProxyHandler, inspectMcpProxy } from '../mcp/proxy.js';
import { startMcpStdioServer } from '../mcp/stdio.js';

function parseMcpCliOptions(argv: string[]): {
  inspectProxy: boolean;
  passthroughArgv: string[];
} {
  let inspectProxy = false;
  const passthroughArgv: string[] = [];

  for (const arg of argv) {
    if (arg === '--inspect-proxy') {
      inspectProxy = true;
      continue;
    }
    passthroughArgv.push(arg);
  }

  return {
    inspectProxy,
    passthroughArgv,
  };
}

function getHelpText(): string {
  return [
    'cats-runtime mcp',
    '',
    'Proxy stdio MCP requests to the primary cats-runtime HTTP /mcp endpoint.',
    'Published package usage: cats-runtime mcp',
    'Repo-local equivalent: node build/runtime/bin/mcp.js',
    '',
    'Options:',
    '  --host <host>          Override the target runtime host when deriving the proxy URL',
    '  --port <port>          Override the target runtime port when deriving the proxy URL',
    '  --diagnose-setup       Generate a local setup diagnostic report and exit',
    '  --inspect-proxy        Resolve the MCP proxy target, run a ping preflight, and exit',
    '  --refresh-setup-scan   Refresh the shared setup scan before generating a diagnostic report',
    '  --managed-by <name>    Accepted for compatibility; ignored in proxy mode',
    '  --help, -h             Show this help text',
    '',
    'Proxy target resolution:',
    '  1. CATS_RUNTIME_MCP_PROXY_URL',
    '  2. http://<CATS_RUNTIME_HOST|127.0.0.1>:<CATS_RUNTIME_PORT|3110>/mcp',
    '  Timeout: CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS (default 1800000)',
  ].join('\n');
}

export async function runMcpCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const mcpCliOptions = parseMcpCliOptions(argv);
  const cliOptions = parseRuntimeCliOptions(mcpCliOptions.passthroughArgv);
  if (cliOptions.help) {
    process.stdout.write(`${getHelpText()}\n`);
    return;
  }

  loadRuntimeEnvFiles();
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
  if (mcpCliOptions.inspectProxy) {
    const inspection = await inspectMcpProxy({
      env: process.env,
    });
    const statusLine = inspection.probe.status === 'ok'
      ? `cats-runtime MCP proxy target ${inspection.target.url} is reachable (timeout ${inspection.target.timeoutMs}ms).\n`
      : `cats-runtime MCP proxy preflight failed: ${inspection.probe.message}\n`;
    process.stderr.write(statusLine);
    process.stdout.write(`${JSON.stringify(inspection)}\n`);
    if (inspection.probe.status !== 'ok') {
      process.exitCode = 1;
    }
    return;
  }
  const server = startMcpStdioServer({
    handleJsonRpc: createHttpMcpProxyHandler({
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
  runMcpCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
    process.exit(1);
  });
}
