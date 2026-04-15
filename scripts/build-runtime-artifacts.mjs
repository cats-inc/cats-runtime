#!/usr/bin/env node

import process from 'node:process';
import { spawn } from 'node:child_process';

function resolveSidecarLayout(value) {
  if (value === undefined || value === null || value === '') {
    return 'split';
  }
  if (value === 'split' || value === 'bundle') {
    return value;
  }
  throw new Error(`Unsupported sidecar layout: ${value}`);
}

function resolveNpmInvocation(args) {
  const npmExecPath = process.env.npm_execpath?.trim();
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}

async function runNpmScript(scriptName) {
  const invocation = resolveNpmInvocation(['run', scriptName]);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(
        `${invocation.command} ${invocation.args.join(' ')} exited with code ${code ?? 'null'}`,
      ));
    });
    child.once('error', reject);
  });
}

const sidecarLayout = resolveSidecarLayout(process.env.CATS_DESKTOP_SIDECAR_LAYOUT);

await runNpmScript('build:runtime');
if (sidecarLayout === 'bundle') {
  await runNpmScript('build:runtime-bundle');
}
