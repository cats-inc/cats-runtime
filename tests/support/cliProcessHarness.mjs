import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const preload = `
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const originalSpawn = cp.spawn;
cp.spawn = function(command, args, options) {
  if (['powershell.exe', 'open', 'xdg-open'].includes(command)) {
    process.stderr.write('TEST_BROWSER ' + JSON.stringify({ command, args, options }) + '\\n');
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => child.emit('exit', 0));
    return child;
  }
  return originalSpawn(command, args, options);
};
require('node:module').syncBuiltinESMExports();
if (process.env.CATS_TEST_TTY === 'true') {
  Object.defineProperty(process.stdin, 'isTTY', { value: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true });
  process.stdin.isRaw = false;
  process.stdin.setRawMode = function(value) {
    this.isRaw = value;
    process.stderr.write('TEST_RAW ' + value + '\\n');
    return this;
  };
}
`;

export async function launchCli({ entry, args = [], tty = true, environment = () => ({}) }) {
  const root = await mkdtemp(join(tmpdir(), 'cats-cli-entry-'));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const preloadPath = join(root, 'terminal.cjs');
  await writeFile(preloadPath, preload);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|SYSTEMDRIVE)$/i.test(key)) env[key] = value;
  }
  Object.assign(env, {
    HOME: root, USERPROFILE: root,
    APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(root, '.config'), XDG_DATA_HOME: join(root, '.local', 'share'),
    CATS_PLATFORM_DIR: join(root, '.cats', 'platform'),
    CATS_RUNTIME_BASE_URL: 'http://127.0.0.1:9',
    CATS_HOST: '127.0.0.1', CATS_PORT: String(port),
    CATS_RUNTIME_HOST: '127.0.0.1', CATS_RUNTIME_PORT: String(port),
    CATS_TEST_TTY: String(tty),
    ...await environment(root),
  });
  const child = spawn(process.execPath, ['--require', preloadPath, entry, ...args], {
    cwd: root, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  // Explicit IPC disconnect can leave ChildProcess's aggregate 'close' event
  // pending on Windows even after exit and both output pipes have closed.
  // Observe the actual process exit and drain the captured output separately.
  const outputClosed = Promise.all([child.stdout, child.stderr].map(stream =>
    new Promise(resolve => stream.once('close', resolve))));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      void outputClosed.then(() => resolve({ code, signal }));
    });
  });
  const waitFor = async predicate => {
    const deadline = Date.now() + 45_000;
    while (!predicate({ stdout, stderr })) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error('CLI did not reach the expected state.\\n' + stdout + '\\n' + stderr);
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  return {
    child, done, port, root, waitFor,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await done;
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
