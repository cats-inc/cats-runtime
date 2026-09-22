import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { afterEach, it as test } from 'vitest';
import { browserCommand, browserUrl, startCliInteraction, type CliInteractionOptions } from '../src/core/cliInteraction.js';

class Terminal extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(value: boolean) { this.isRaw = value; return this; }
}
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(overrides: Partial<CliInteractionOptions> = {}) {
  const input = (overrides.input as unknown as Terminal) ?? new Terminal();
  const output = (overrides.output as unknown as Terminal) ?? new Terminal();
  const opened: string[] = [];
  const stopped: string[] = [];
  let text = '';
  output.on('data', chunk => { text += chunk; });
  const dispose = startCliInteraction({
    url: 'http://127.0.0.1:12345/setup', mode: 'standalone', readyOutput: 'plain', env: {},
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    openUrl: async url => { opened.push(url); },
    onQuit: reason => { stopped.push(reason); },
    ...overrides,
  });
  cleanups.push(() => { dispose(); input.destroy(); output.destroy(); });
  return { input, output, opened, stopped, dispose, text: () => text };
}

test('ready terminal opens once, o reopens, q requests cleanup once and restores raw mode', async () => {
  const f = fixture();
  await tick();
  assert.deepEqual(f.opened, ['http://127.0.0.1:12345/setup']);
  assert.match(f.text(), /o  open browser.*q  stop service.*Ctrl\+C/);
  assert.equal(f.input.isRaw, true);
  f.input.write('o');
  await tick();
  assert.equal(f.opened.length, 2);
  f.input.write('q');
  f.input.write('q');
  assert.deepEqual(f.stopped, ['keyboard']);
  assert.equal(f.input.isRaw, false);
  assert.equal(f.input.readableFlowing, false);
});

test('Ctrl+C follows the signal shutdown path while raw mode is enabled', () => {
  const f = fixture({ noOpen: true });
  f.input.write('\x03');
  assert.deepEqual(f.stopped, ['sigint']);
  assert.equal(f.input.isRaw, false);
});

test('--no-open preserves the manual o shortcut', async () => {
  const f = fixture({ noOpen: true });
  await tick();
  assert.equal(f.opened.length, 0);
  f.input.write('o');
  await tick();
  assert.equal(f.opened.length, 1);
});

test('a browser failure leaves shortcuts available and the address visible', async () => {
  let attempts = 0;
  const f = fixture({ openUrl: async () => { attempts++; throw new Error('no browser'); } });
  await tick();
  assert.match(f.text(), /Could not open the browser.*http:\/\/127\.0\.0\.1:12345\/setup/);
  assert.deepEqual(f.stopped, []);
  f.input.write('o');
  await tick();
  assert.equal(attempts, 2);
  f.input.write('q');
  assert.deepEqual(f.stopped, ['keyboard']);
});

test('managed, machine-readable and CI sessions never take over input or open a browser', async () => {
  const configurations: Partial<CliInteractionOptions>[] = [
    { mode: 'app-managed' }, { readyOutput: 'json' }, { readyOutput: 'silent' }, { env: { CI: 'true' } },
  ];
  for (const config of configurations) {
    const f = fixture(config);
    f.input.write('oq\x03');
    await tick();
    assert.equal(f.input.isRaw, false);
    assert.deepEqual(f.opened, []);
    assert.deepEqual(f.stopped, []);
    assert.doesNotMatch(f.text(), /q  stop service/);
    if (config.mode || config.readyOutput) assert.equal(f.text(), '');
  }
});

test('redirected input or output keeps the URL but never consumes keyboard input', async () => {
  for (const direction of ['input', 'output']) {
    const stream = new Terminal();
    stream.isTTY = false;
    const f = fixture({ [direction]: stream });
    await tick();
    assert.deepEqual(f.opened, []);
    assert.equal(f.input.isRaw, false);
    assert.match(f.text(), /http:/);
    assert.doesNotMatch(f.text(), /q  stop service/);
    stream.destroy();
  }
});

test('dispose restores an already raw terminal and cancels queued automatic opening', async () => {
  const input = new Terminal();
  input.isRaw = true;
  input.resume();
  const f = fixture({ input: input as unknown as NodeJS.ReadStream });
  f.dispose();
  await tick();
  assert.equal(input.isRaw, true);
  assert.equal(input.readableFlowing, true);
  assert.deepEqual(f.opened, []);
  input.destroy();
});

test('browser URLs use the actual port, bootstrap path and dialable wildcard addresses', () => {
  assert.equal(browserUrl('0.0.0.0', 32123, '/setup'), 'http://127.0.0.1:32123/setup');
  assert.equal(browserUrl('::', 32124), 'http://[::1]:32124/');
  assert.equal(browserUrl('[::1]', 32125), 'http://[::1]:32125/');
  assert.equal(browserUrl('localhost', 32126), 'http://localhost:32126/');
});

test('OS openers receive a literal HTTP URL and reject credentials or executable protocols', () => {
  const url = "http://localhost:12345/a'b?x=1&y=2";
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
  const [command, args] = browserCommand(url, 'win32');
  assert.equal(command, 'powershell.exe');
  assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'),
    "Start-Process -FilePath 'http://localhost:12345/a''b?x=1&y=2'");
  assert.throws(() => browserCommand('file:///tmp/test'), /HTTP/);
  assert.throws(() => browserCommand('https://secret@example.com'), /credentials/);
});
