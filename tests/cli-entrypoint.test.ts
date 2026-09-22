import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { launchCli } from './support/cliProcessHarness.mjs';
import { createRuntimeTestEnv, createRuntimeTestPaths } from './support/runtimeTestPaths.js';

for (const bootstrap of [true, false]) {
  it(`compiled Runtime opens ${bootstrap ? 'Setup' : 'Dashboard'}, handles o and drains on q`, async () => {
    const cli = await launchCli({
      entry: resolve('build/runtime/index.js'),
      environment: (root: string) => {
        if (!bootstrap) {
          const paths = createRuntimeTestPaths(root);
          mkdirSync(paths.configDir, { recursive: true });
          writeFileSync(paths.configPath, '{"providers":{}}');
        }
        return createRuntimeTestEnv(root);
      },
    });
    try {
      await cli.waitFor(({ stdout, stderr }: { stdout: string; stderr: string }) => stdout.includes('q  stop service') && stderr.includes('TEST_BROWSER'));
      assert.match(cli.stdout, new RegExp(`Open Cats: http://127\\.0\\.0\\.1:${cli.port}/${bootstrap ? 'setup' : ''}\\s`));
      assert.equal((await fetch(`http://127.0.0.1:${cli.port}/health`)).ok, true);
      cli.child.stdin.write('o');
      await cli.waitFor(({ stderr }: { stderr: string }) => stderr.split('TEST_BROWSER').length === 3);
      cli.child.stdin.write('q');
      assert.equal((await cli.done).code, 0);
      assert.match(cli.stdout, /cats-runtime stopped \(keyboard\)/);
      assert.match(cli.stderr, /TEST_RAW false/);
      await assert.rejects(fetch(`http://127.0.0.1:${cli.port}/health`, { signal: AbortSignal.timeout(1000) }));
    } finally {
      await cli.close();
    }
  }, 60_000);
}

it('app-managed Runtime keeps stdout structured and closes on private stdin EOF', async () => {
  const cli = await launchCli({
    entry: resolve('build/runtime/index.js'), tty: false,
    args: ['--startup-mode=app-managed', '--managed-by=cli-test', '--ready-output=json', '--no-open'],
    environment: (root: string) => createRuntimeTestEnv(root),
  });
  try {
    await cli.waitFor(({ stdout }: { stdout: string }) => stdout.includes('runtime.ready'));
    assert.doesNotMatch(cli.stderr, /TEST_BROWSER|TEST_RAW/);
    assert.doesNotMatch(cli.stdout, /q  stop service|Open Cats:/);
    cli.child.stdin.end();
    assert.equal((await cli.done).code, 0);
    assert.match(cli.stdout, /"event":"runtime.stopped"/);
    for (const line of cli.stdout.trim().split('\n')) {
      assert.equal(typeof JSON.parse(line).event, 'string');
    }
  } finally {
    await cli.close();
  }
}, 60_000);
