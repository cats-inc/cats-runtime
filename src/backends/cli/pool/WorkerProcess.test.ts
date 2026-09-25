import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderCommandConfig } from '../config.js';
import { WorkerProcess } from './WorkerProcess.js';
import { CodexProvider } from '../providers/codex.js';
import { cleanupTempDirWithRetries } from '../../../../tests/tempCleanup.js';
import { buildPowerShellCommandScript, buildPowerShellExecEnv } from '../runtime/runtime.js';
import type { Provider, StreamEvent } from '../providers/types.js';

describe('WorkerProcess PowerShell helpers', () => {
  it('builds a short PowerShell loader command for env-based argv passthrough', () => {
    const script = buildPowerShellCommandScript();

    expect(script).toBe(
      '$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:CATS_RUNTIME_PWSH_EXEC_B64)); '
      + '$payload = $payloadJson | ConvertFrom-Json; '
      + '$runtimeArgs = @(); '
      + 'foreach ($item in $payload.args) { $runtimeArgs += [string]$item }; '
      + '& ([string]$payload.command) @runtimeArgs; '
      + 'exit $LASTEXITCODE',
    );
  });

  it('encodes the command path and argv into a PowerShell exec payload env var', () => {
    const env = buildPowerShellExecEnv('copilot', [
      '--output-format',
      'json',
      '--stream',
      'on',
      '-p',
      "Let's go",
    ]);

    expect(env).toEqual({
      CATS_RUNTIME_PWSH_EXEC_B64: Buffer.from(JSON.stringify({
        command: 'copilot',
        args: ['--output-format', 'json', '--stream', 'on', '-p', "Let's go"],
      }), 'utf8').toString('base64'),
    });
  });

  it('times out silent ephemeral providers by default', async () => {
    const worker = new WorkerProcess(
      createCompletionOnlyProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10 },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      'Provider did not respond within 10ms',
    );
  });

  it('surfaces a classified stderr refusal instead of synthesizing a timeout', async () => {
    const worker = new WorkerProcess(
      createRefusalBeforeTimeoutProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10 },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      'Antigravity has no capacity available for the selected model right now.',
    );
  });

  it('fails fast on a classified stderr refusal instead of waiting for the timeout window', async () => {
    const worker = new WorkerProcess(
      createRefusalBeforeTimeoutProvider(4000),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10_000 },
    );

    const startedAt = Date.now();
    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      'Antigravity has no capacity available for the selected model right now.',
    );
    expect(Date.now() - startedAt).toBeLessThan(2500);
  });

  it('lets completion-only ephemeral providers disable the first-event timeout', async () => {
    const worker = new WorkerProcess(
      createCompletionOnlyProvider(0),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10 },
    );

    await expect(worker.sendMessage('ignored')).resolves.toEqual([
      { type: 'result', sessionId: 'junie-session' },
    ]);
  });

  it('emits multiple events when a provider parses one line into text and result', async () => {
    const worker = new WorkerProcess(
      createMultiEventProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10 },
    );

    await expect(worker.sendMessage('ignored')).resolves.toEqual([
      { type: 'text', text: 'hello' },
      { type: 'result', sessionId: 'multi-session' },
    ]);
  });

  it('surfaces the real process exit error when an ephemeral provider exits before emitting any events', async () => {
    const worker = new WorkerProcess(
      createMaskingErrorProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 1000 },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      /Process exited with code 127 before responding\..*stderr: sh: 1: auggie: not found/s,
    );
  });

  it('does not misclassify an unrelated port number as a provider refusal status code', async () => {
    const worker = new WorkerProcess(
      createPortNumberOnlyErrorProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 1000 },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      /Process exited with code 1 before responding\..*stderr: daemon listening on port 429/s,
    );
  });

  it('surfaces a timeout promptly even if the provider ignores SIGTERM for a while', async () => {
    const worker = new WorkerProcess(
      createSigtermIgnoringSilentProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 20 },
    );

    const startedAt = Date.now();
    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      'Provider did not respond within 20ms',
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('times out a stalled turn after a non-terminal init event', async () => {
    const worker = new WorkerProcess(
      createInitThenStallProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 1500 },
    );

    const stream = worker.streamMessage('ignored');
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'init', sessionId: 'antigravity-session' },
    });

    const startedAt = Date.now();
    await expect(stream.next()).rejects.toThrow(
      'Antigravity stopped responding after the initial response for 1500ms.',
    );
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });
});

it('routes native Codex read requests through the real Worker transport and shared filesystem tools', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cats-codex-native-read-'));
  writeFileSync(join(cwd, 'README.md'), 'workspace-read-marker');
  const script = [
    "const rl = require('node:readline').createInterface({ input: process.stdin });",
    "const send = value => process.stdout.write(JSON.stringify(value) + '\\n');",
    "const fail = text => send({ method: 'turn/failed', params: { text } });",
    'rl.on("line", line => {',
    ' const msg = JSON.parse(line);',
    ' if (msg.method === "initialize") {',
    '   if (!msg.params.capabilities?.experimentalApi) return fail("missing capability");',
    '   send({ id: msg.id, result: {} });',
    ' } else if (msg.method === "thread/start") {',
    '   const names = msg.params.dynamicTools?.map(tool => tool.type + ":" + tool.name).sort().join(",");',
    '   if (names !== "function:list_files,function:read_file") return fail("missing read registration");',
    '   send({ method: "thread/started", params: { thread: { id: "thread" } } });',
    '   send({ id: msg.id, result: { thread: { id: "thread" } } });',
    ' } else if (msg.method === "turn/start") {',
    '   send({ id: msg.id, result: { turn: { id: "turn" } } });',
    '   send({ id: 90, method: "item/commandExecution/requestApproval",',
    '     params: { command: "Get-Content README.md", commandActions: [{ type: "read" }] } });',
    ' } else if (msg.id === 90) {',
    '   if (msg.result.decision !== "decline") return fail("shell was widened");',
    '   send({ method: "item/started", params: { item: { id: "read", type: "dynamicToolCall", tool: "read_file" } } });',
    '   send({ id: 91, method: "item/tool/call", params: { threadId: "thread", turnId: "turn",',
    '     callId: "read", tool: "read_file", arguments: { path: "README.md" } } });',
    ' } else if (msg.id === 91) {',
    '   if (!msg.result.success) return fail("read failed");',
    '   send({ method: "item/agentMessage/delta", params: { delta: msg.result.contentItems[0].text } });',
    '   send({ id: 92, method: "item/tool/call", params: { threadId: "thread", turnId: "turn",',
    '     callId: "list", tool: "list_files", arguments: { path: ".", max_entries: 10 } } });',
    ' } else if (msg.id === 92) {',
    '   if (!msg.result.success) return fail("list failed");',
    '   send({ method: "item/agentMessage/delta", params: { delta: msg.result.contentItems[0].text } });',
    '   send({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn" } } });',
    ' }',
    '});',
  ].join('\n');
  const worker = new WorkerProcess(new CodexProvider(), { cwd, permissionMode: 'whitelist',
    allowedTools: ['read_file', 'list_files', 'apply_patch'] },
  { ...createNodeCommandConfig(), runtime: { mode: 'native', environmentId: 'named-native' },
    args: ['-e', script] });
  try {
    worker.start();
    const events = await worker.sendMessage('Read and list the admitted workspace.');
    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', text: 'workspace-read-marker' }, { type: 'text', text: 'README.md' },
    ]);
    expect(events.some((event) => event.type === 'tool_use' && event.toolName === 'read_file')).toBe(true);
    expect(events.at(-1)?.type).toBe('result');
  } finally {
    if (worker.alive) {
      const exited = once(worker, 'exit');
      worker.kill();
      await exited;
    }
    cleanupTempDirWithRetries(cwd);
  }
});

function createNodeCommandConfig(): ProviderCommandConfig {
  return {
    path: process.execPath,
    runner: 'direct',
    runtime: { mode: 'native' },
  };
}

function createCompletionOnlyProvider(
  timeoutOverrideMs?: number,
): Provider {
  return {
    name: 'junie',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "setTimeout(() => {",
          "  process.stdout.write(JSON.stringify({ sessionId: 'junie-session', result: 'done' }) + '\\n');",
          '}, 50);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
      const data = JSON.parse(line) as { sessionId?: string };
      return {
        type: 'result',
        sessionId: data.sessionId,
      };
    },
    resolveFirstEventTimeoutMs(defaultTimeoutMs: number): number {
      return timeoutOverrideMs ?? defaultTimeoutMs;
    },
  };
}

function createRefusalBeforeTimeoutProvider(exitDelayMs = 50): Provider {
  return {
    name: 'antigravity',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "process.stderr.write('429 Too Many Requests. Retry after 2s.\\n');",
          `setTimeout(() => process.exit(0), ${exitDelayMs});`,
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine() {
      return null;
    },
    classifyLaunchFailure() {
      return {
        category: 'capacity_exhausted',
        message: 'Antigravity has no capacity available for the selected model right now.',
        statusCode: 429,
        retryable: true,
        source: 'stderr',
        evidenceSummary: '429 Too Many Requests. Retry after 2s.',
      };
    },
  };
}

function createMultiEventProvider(): Provider {
  return {
    name: 'junie',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        "process.stdout.write('{}\\n');",
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine(): StreamEvent[] {
      return [
        { type: 'text', text: 'hello' },
        { type: 'result', sessionId: 'multi-session' },
      ];
    },
    resolveFirstEventTimeoutMs() {
      return 0;
    },
  };
}

function createMaskingErrorProvider(): Provider {
  return {
    name: 'auggie',
    capabilities: { resume: true, fork: false, permissions: true },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "process.stderr.write('sh: 1: auggie: not found\\n');",
          'process.exit(127);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine() {
      return null;
    },
    async afterTurn() {
      throw new Error('Auggie exited without emitting a usable JSON result.');
    },
  };
}

function createPortNumberOnlyErrorProvider(): Provider {
  return {
    name: 'ollama',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "process.stderr.write('daemon listening on port 429\\n');",
          'process.exit(1);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine() {
      return null;
    },
  };
}

function createSigtermIgnoringSilentProvider(): Provider {
  return {
    name: 'antigravity',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "process.on('SIGTERM', () => {});",
          'setTimeout(() => process.exit(0), 2000);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine() {
      return null;
    },
  };
}

function createInitThenStallProvider(): Provider {
  return {
    name: 'antigravity',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "process.stdout.write(JSON.stringify({ type: 'init', session_id: 'antigravity-session' }) + '\\n');",
          "process.on('SIGTERM', () => {});",
          'setTimeout(() => process.exit(0), 2000);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine(line: string): StreamEvent | null {
      const data = JSON.parse(line) as { type?: string; session_id?: string };
      if (data.type !== 'init') {
        return null;
      }
      return {
        type: 'init',
        sessionId: data.session_id,
      };
    },
  };
}
