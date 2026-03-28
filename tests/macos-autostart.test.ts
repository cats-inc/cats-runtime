import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

interface MacosScriptTestContext {
  envFile: string;
  env: NodeJS.ProcessEnv;
  launchctlLog: string;
  managedNodeBin: string;
  nodeBin: string;
  npmLog: string;
  plistFile: string;
  root: string;
  runnerScript: string;
}

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');
const setupAutostartScript = join(runtimeRoot, 'scripts', 'macos', 'setup-autostart.sh');
const restartServerScript = join(runtimeRoot, 'scripts', 'macos', 'restart-server.sh');
const tempRoots: string[] = [];

function writeExecutable(path: string, body: string): void {
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -euo pipefail
${body}
`,
    'utf8',
  );
  chmodSync(path, 0o755);
}

function createMacosScriptTestContext(): MacosScriptTestContext {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-macos-'));
  const binDir = join(root, 'bin');
  const homeDir = join(root, 'home');
  const envFile = join(root, 'cats-runtime.env');
  const supportDir = join(root, 'support');
  const plistDir = join(root, 'LaunchAgents');
  const logDir = join(root, 'logs');
  const launchctlLog = join(root, 'launchctl.log');
  const npmLog = join(root, 'npm.log');
  const nodeBin = join(binDir, 'node');
  const managedNodeBin = join(root, 'managed-node', 'node');
  const npmBin = join(binDir, 'npm');
  const launchctlBin = join(binDir, 'launchctl');
  const curlBin = join(binDir, 'curl');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(dirname(managedNodeBin), { recursive: true });

  writeExecutable(
    nodeBin,
    `
if [[ "\${1:-}" == "--version" ]]; then
  echo "v24.99.0"
  exit 0
fi

printf '%s\\n' "$*" >>"\${NODE_LOG_PATH:?}"
`,
  );
  writeExecutable(
    managedNodeBin,
    `
if [[ "\${1:-}" == "--version" ]]; then
  echo "v24.98.0"
  exit 0
fi

printf '%s\\n' "$*" >>"\${NODE_LOG_PATH:?}"
`,
  );
  writeExecutable(
    npmBin,
    `
printf '%s\\n' "$*" >>"\${NPM_LOG_PATH:?}"
`,
  );
  writeExecutable(
    launchctlBin,
    `
printf '%s\\n' "$*" >>"\${LAUNCHCTL_LOG_PATH:?}"
case "\${1:-}" in
  print)
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
`,
  );
  writeExecutable(
    curlBin,
    `
printf '%s\\n' '{"status":"ok","bootstrapRequired":false}'
`,
  );

  tempRoots.push(root);

  return {
    root,
    envFile,
    managedNodeBin,
    nodeBin,
    runnerScript: join(supportDir, 'start-cats-runtime.sh'),
    plistFile: join(plistDir, 'io.sammykenny2.cats-runtime.plist'),
    launchctlLog,
    npmLog,
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      ENV_FILE: envFile,
      CATS_RUNTIME_SUPPORT_DIR: supportDir,
      CATS_RUNTIME_LAUNCHD_PLIST_DIR: plistDir,
      CATS_RUNTIME_LOG_DIR: logDir,
      CATS_RUNTIME_API_KEY: '',
      LAUNCHCTL_LOG_PATH: launchctlLog,
      NODE_LOG_PATH: join(root, 'node.log'),
      NPM_LOG_PATH: npmLog,
    },
  };
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function writeEnvFile(path: string, body: string): void {
  writeFileSync(path, body, 'utf8');
}

function seedStaleLaunchdInstall(context: MacosScriptTestContext): void {
  mkdirSync(dirname(context.runnerScript), { recursive: true });
  writeFileSync(
    context.runnerScript,
    `#!/usr/bin/env bash
set -euo pipefail
cd ${runtimeRoot}
exec node dist/index.js
`,
    'utf8',
  );
  chmodSync(context.runnerScript, 0o755);

  mkdirSync(dirname(context.plistFile), { recursive: true });
  writeFileSync(
    context.plistFile,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>io.sammykenny2.cats-runtime</string>
  </dict>
</plist>
`,
    'utf8',
  );
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('macOS autostart scripts', () => {
  const runIfPosix = process.platform === 'win32' ? it.skip : it;

  runIfPosix('writes an absolute node binary into the launchd runner during install', () => {
    const context = createMacosScriptTestContext();
    const result = spawnSync(
      'bash',
      [setupAutostartScript, '--install'],
      {
        cwd: runtimeRoot,
        encoding: 'utf8',
        env: context.env,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const runnerScript = readText(context.runnerScript);
    expect(runnerScript).toContain(
      `export PATH=${dirname(context.nodeBin)}:"$HOME/.npm-global/bin":"$HOME/.local/bin"`,
    );
    expect(runnerScript).toContain(`exec ${context.nodeBin} dist/index.js`);
    expect(runnerScript).not.toContain('exec node dist/index.js');

    const plist = readText(context.plistFile);
    expect(plist).toContain(context.runnerScript);

    const launchctlLog = readText(context.launchctlLog);
    expect(launchctlLog).toContain(`bootstrap gui/${process.getuid?.()} ${context.plistFile}`);
  });

  runIfPosix('refreshes a stale launchd runner during install without requiring --force', () => {
    const context = createMacosScriptTestContext();
    seedStaleLaunchdInstall(context);

    const result = spawnSync(
      'bash',
      [setupAutostartScript, '--install'],
      {
        cwd: runtimeRoot,
        encoding: 'utf8',
        env: context.env,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('Existing launchd runner is stale. Refreshing install.');

    const runnerScript = readText(context.runnerScript);
    expect(runnerScript).toContain(
      `export PATH=${dirname(context.nodeBin)}:"$HOME/.npm-global/bin":"$HOME/.local/bin"`,
    );
    expect(runnerScript).toContain(`exec ${context.nodeBin} dist/index.js`);
    expect(runnerScript).not.toContain('exec node dist/index.js');
  });

  runIfPosix('refreshes an existing launchd runner before restart bootstraps the agent', () => {
    const context = createMacosScriptTestContext();
    seedStaleLaunchdInstall(context);

    const result = spawnSync(
      'bash',
      [restartServerScript, '--port', '3110'],
      {
        cwd: runtimeRoot,
        encoding: 'utf8',
        env: context.env,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('Starting cats-runtime via launchd...');

    const runnerScript = readText(context.runnerScript);
    expect(runnerScript).toContain(
      `export PATH=${dirname(context.nodeBin)}:"$HOME/.npm-global/bin":"$HOME/.local/bin"`,
    );
    expect(runnerScript).toContain(`exec ${context.nodeBin} dist/index.js`);
    expect(runnerScript).not.toContain('exec node dist/index.js');

    const launchctlLog = readText(context.launchctlLog);
    expect(launchctlLog).toContain(`bootstrap gui/${process.getuid?.()} ${context.plistFile}`);
    expect(readText(context.npmLog)).toContain('run build');
  }, 15_000);

  runIfPosix('reads CATS_RUNTIME_NODE_BIN from .env when the shell env does not export it', () => {
    const context = createMacosScriptTestContext();
    writeEnvFile(
      context.envFile,
      `CATS_RUNTIME_PORT=3110
CATS_RUNTIME_NODE_BIN=${context.managedNodeBin}
`,
    );

    const result = spawnSync(
      'bash',
      [setupAutostartScript, '--install'],
      {
        cwd: runtimeRoot,
        encoding: 'utf8',
        env: context.env,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const runnerScript = readText(context.runnerScript);
    expect(runnerScript).toContain(
      `export PATH=${dirname(context.managedNodeBin)}:"$HOME/.npm-global/bin":"$HOME/.local/bin"`,
    );
    expect(runnerScript).toContain(`exec ${context.managedNodeBin} dist/index.js`);
    expect(result.stdout).toContain(`Node binary: ${context.managedNodeBin}`);
  });
});
