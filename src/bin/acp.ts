#!/usr/bin/env node

import { loadRuntimeEnvFiles } from '../core/dotenv.js';
import { isDirectCliEntrypoint } from '../core/cliEntrypoint.js';
import { inspectRuntimeConfig, shouldEnterBootstrapMode } from '../core/configInspection.js';
import {
  formatSetupDiagnosticEntrySummary,
  generateSetupDiagnosticEntryArtifact,
} from '../core/diagnostics/setupDiagnosticEntry.js';
import { loadConfig } from '../core/config.js';
import { createRuntimeServer } from '../server.js';
import {
  applyRuntimeCliEnvOverrides,
  markRuntimeStopped,
  markRuntimeStopping,
  parseRuntimeCliOptions,
  resolveRuntimeStartupState,
  validateRuntimeServerStartupState,
} from '../startup.js';
import { createHttpAcpProxyHandler } from '../acp/proxy.js';
import { startAcpStdioServer } from '../acp/stdio.js';

export function parseAcpCliOptions(argv: string[]): {
  serveRuntime: boolean;
  passthroughArgv: string[];
} {
  let serveRuntime = false;
  const passthroughArgv: string[] = [];

  for (const arg of argv) {
    if (arg === '--serve-runtime') {
      serveRuntime = true;
      continue;
    }
    passthroughArgv.push(arg);
  }

  return {
    serveRuntime,
    passthroughArgv,
  };
}

function getHelpText(): string {
  return [
    'cats-runtime acp',
    '',
    'Serve stdio ACP either by proxying to the primary cats-runtime HTTP /acp endpoint',
    'or by running a direct runtime-backed ACP stdio server in-process.',
    'Published package usage: cats-runtime acp',
    'Repo-local equivalent: node build/runtime/bin/acp.js',
    '',
    'Options:',
    '  --host <host>          Override the target runtime host when deriving the proxy URL',
    '  --port <port>          Override the target runtime port when deriving the proxy URL',
    '  --serve-runtime        Start a direct runtime-backed ACP stdio server instead of proxy mode',
    '  --diagnose-setup       Generate a local setup diagnostic report and exit',
    '  --refresh-setup-scan   Refresh the shared setup scan before generating a diagnostic report',
    '  --managed-by <name>    Forwarded to runtime startup when using --serve-runtime',
    '  --help, -h             Show this help text',
    '',
    'Proxy target resolution (default mode):',
    '  1. CATS_RUNTIME_ACP_PROXY_URL',
    '  2. http://<CATS_RUNTIME_HOST|127.0.0.1>:<CATS_RUNTIME_PORT|3110>/acp',
    '  Timeout: CATS_RUNTIME_ACP_PROXY_TIMEOUT_MS (default 1800000)',
    '',
    'Direct runtime mode:',
    '  --serve-runtime starts a standalone cats-runtime ACP stdio carrier in-process.',
    '  This mode enables bidirectional ACP prompt turns over stdio without requiring',
    '  a separately running HTTP cats-runtime instance.',
  ].join('\n');
}

export async function runAcpCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const acpCliOptions = parseAcpCliOptions(argv);
  const cliOptions = parseRuntimeCliOptions(acpCliOptions.passthroughArgv);
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

  let closeRuntimeServer: ((
    reason?: 'sigint' | 'sigterm' | 'stdin_closed',
  ) => Promise<void>) | undefined;
  const server = acpCliOptions.serveRuntime
    ? (() => {
        const startup = resolveRuntimeStartupState(cliOptions, process.env);
        validateRuntimeServerStartupState(cliOptions, process.env, startup);
        const inspection = inspectRuntimeConfig(process.env);
        if (shouldEnterBootstrapMode(inspection, cliOptions.bootstrap === true)) {
          startup.bootstrapRequired = true;
        }

        const runtimeServer = createRuntimeServer(loadConfig(), { startup });
        let runtimeServerClosed = false;
        closeRuntimeServer = async (reason) => {
          if (runtimeServerClosed) {
            return;
          }
          runtimeServerClosed = true;
          markRuntimeStopping(startup, reason);
          await runtimeServer.close();
          markRuntimeStopped(startup, reason);
        };
        return startAcpStdioServer({
          ctx: runtimeServer.context,
          onClose: async () => {
            await closeRuntimeServer?.('stdin_closed');
          },
        });
      })()
    : startAcpStdioServer({
        handleJsonRpc: createHttpAcpProxyHandler({
          env: process.env,
        }),
      });

  const requestShutdown = (reason: 'sigint' | 'sigterm') => {
    void closeRuntimeServer?.(reason);
    void server.close().then(() => {
      process.exit(process.exitCode ?? 0);
    });
  };

  process.on('SIGINT', () => {
    requestShutdown('sigint');
  });
  process.on('SIGTERM', () => {
    requestShutdown('sigterm');
  });
}

if (isDirectCliEntrypoint(import.meta.url, process.argv[1])) {
  runAcpCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
    process.exit(1);
  });
}
