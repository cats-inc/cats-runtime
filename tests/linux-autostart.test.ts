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

interface LinuxScriptTestContext {
  envFile: string;
  managedNodeBin: string;
  env: NodeJS.ProcessEnv;
  nodeBin: string;
  root: string;
  systemctlLog: string;
  unitFile: string;
}

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');
const setupAutostartScript = join(runtimeRoot, 'scripts', 'linux', 'setup-autostart.sh');
const restartServerScript = join(runtimeRoot, 'scripts', 'linux', 'restart-server.sh');
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

function createLinuxScriptTestContext(): LinuxScriptTestContext {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-linux-'));
  const binDir = join(root, 'bin');
  const homeDir = join(root, 'home');
  const envFile = join(root, 'cats-runtime.env');
  const unitDir = join(root, 'systemd-user');
  const systemctlLog = join(root, 'systemctl.log');
  const npmLog = join(root, 'npm.log');
  const nodeBin = join(binDir, 'node');
  const managedNodeBin = join(root, 'managed-node', 'node');
  const npmBin = join(binDir, 'npm');
  const systemctlBin = join(binDir, 'systemctl');
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
    systemctlBin,
    `
printf '%s\\n' "$*" >>"\${SYSTEMCTL_LOG_PATH:?}"
if [[ "$*" == *" is-active "* ]]; then
  exit "\${SYSTEMCTL_IS_ACTIVE_STATUS:-1}"
fi
if [[ "$*" == *" is-enabled "* ]]; then
  exit "\${SYSTEMCTL_IS_ENABLED_STATUS:-1}"
fi
if [[ "$*" == *" cat "* ]]; then
  exit "\${SYSTEMCTL_CAT_STATUS:-0}"
fi
exit 0
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
    systemctlLog,
    unitFile: join(unitDir, 'cats-runtime.service'),
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      ENV_FILE: envFile,
      CATS_RUNTIME_SYSTEMD_UNIT_DIR: unitDir,
      SYSTEMCTL_LOG_PATH: systemctlLog,
      SYSTEMCTL_CAT_STATUS: '0',
      SYSTEMCTL_IS_ACTIVE_STATUS: '1',
      SYSTEMCTL_IS_ENABLED_STATUS: '1',
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

function seedStaleSystemdInstall(context: LinuxScriptTestContext): void {
  mkdirSync(dirname(context.unitFile), { recursive: true });
  writeFileSync(
    context.unitFile,
    `[Unit]
Description=Cats Runtime - embedded runtime service
After=network.target

[Service]
Type=simple
WorkingDirectory=${runtimeRoot}
ExecStart=/usr/bin/env node build/runtime/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`,
    'utf8',
  );
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('Linux autostart scripts', () => {
  const runIfPosix = process.platform === 'win32' ? it.skip : it;

  runIfPosix('writes an absolute node binary into the systemd unit during install', () => {
    const context = createLinuxScriptTestContext();
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

    const unitFile = readText(context.unitFile);
    expect(unitFile).toContain(`ExecStart=${context.nodeBin} build/runtime/index.js`);
    expect(unitFile).not.toContain('ExecStart=/usr/bin/env node build/runtime/index.js');

    const systemctlLog = readText(context.systemctlLog);
    expect(systemctlLog).toContain('--user daemon-reload');
    expect(systemctlLog).toContain('--user start cats-runtime.service');
  });

  runIfPosix('refreshes a stale systemd unit during install without requiring --force', () => {
    const context = createLinuxScriptTestContext();
    seedStaleSystemdInstall(context);

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
    expect(result.stdout).toContain('Existing systemd unit is stale. Refreshing install.');

    const unitFile = readText(context.unitFile);
    expect(unitFile).toContain(`ExecStart=${context.nodeBin} build/runtime/index.js`);
    expect(unitFile).not.toContain('ExecStart=/usr/bin/env node build/runtime/index.js');
  });

  runIfPosix('refreshes an existing systemd unit before restart restarts the service', () => {
    const context = createLinuxScriptTestContext();
    seedStaleSystemdInstall(context);

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
    expect(result.stdout).toContain('Starting cats-runtime via systemd...');

    const unitFile = readText(context.unitFile);
    expect(unitFile).toContain(`ExecStart=${context.nodeBin} build/runtime/index.js`);
    expect(unitFile).not.toContain('ExecStart=/usr/bin/env node build/runtime/index.js');

    const systemctlLog = readText(context.systemctlLog);
    expect(systemctlLog).toContain('--user daemon-reload');
    expect(systemctlLog).toContain('--user start cats-runtime.service');
  });

  runIfPosix('reads CATS_RUNTIME_NODE_BIN from .env when the shell env does not export it', () => {
    const context = createLinuxScriptTestContext();
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
    expect(readText(context.unitFile)).toContain(`ExecStart=${context.managedNodeBin} build/runtime/index.js`);
    expect(result.stdout).toContain(`Node binary: ${context.managedNodeBin}`);
  });
});
