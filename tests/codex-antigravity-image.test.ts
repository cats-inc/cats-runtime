import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { codexImageInvocation, executeCodexImage } from '../src/backends/cli/media/codexImage.js';
import { antigravityImageInvocation, executeAntigravityImage } from '../src/backends/cli/media/antigravityImage.js';
import type { ImageExecution } from '../src/backends/cli/media/imageExecution.js';
import { loadImageProfiles } from '../src/core/media/profiles.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
const profiles = loadImageProfiles();
const png = () => { const image = new PNG({ width: 4, height: 4 }); image.data.fill(200); return PNG.sync.write(image); };
const jpg = () => Buffer.from(jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(64, 200) }).data);
async function fixture(provider: 'codex' | 'antigravity') {
  const root = await mkdtemp(path.join(tmpdir(), `cats-${provider}-image-`)); roots.push(root);
  const cwd = path.join(root, 'workspace'); await mkdir(cwd);
  const env = { ...createRuntimeTestEnv(root), HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, '.codex') };
  const input: ImageExecution = { id: randomUUID(), prompt: 'An orange cat', provider, instance: 'native', cwd, env, signal: new AbortController().signal,
    profile: profiles.find((profile) => profile.id === `${provider}-generate`)!,
    target: { id: 'native', providerName: provider, commandConfig: { path: process.execPath, runner: 'direct', runtime: { mode: 'native' } } } };
  return { root, input };
}
/** A temporary Node program stands in for the CLI: it prints events, saves an image where the CLI does, and keeps running. */
async function fakeCli(root: string, lines: unknown[], image?: { file: string; bytes: Buffer }, exit = false) {
  const program = path.join(root, `cli-${randomUUID()}.cjs`);
  const source = image ? path.join(root, `${randomUUID()}.bin`) : null;
  if (image && source) await writeFile(source, image.bytes);
  await writeFile(program, `const fs = require('fs'), path = require('path');
for (const line of ${JSON.stringify(lines)}) console.log(JSON.stringify(line));
${image ? `setTimeout(() => { fs.mkdirSync(path.dirname(${JSON.stringify(image.file)}), { recursive: true }); fs.copyFileSync(${JSON.stringify(source)}, ${JSON.stringify(image.file)}); }, 100);` : ''}
${exit ? 'setTimeout(() => process.exit(0), 400);' : 'setInterval(() => {}, 1000);'}`);
  return ((_command: string, _args: string[], options: Parameters<typeof spawn>[2]) => spawn(process.execPath, [program], options)) as typeof spawn;
}

describe('bounded Codex image generation', () => {
  it('runs exec without shell, browser, computer, agent tools, user config or rules', async () => {
    const { input } = await fixture('codex');
    const { args } = codexImageInvocation(input);
    const end = args.indexOf('--');
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    for (const flag of ['--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']) expect(args).toContain(flag);
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    const disabled = args.flatMap((arg, index) => arg === '--disable' ? [args[index + 1]] : []);
    expect(disabled).toEqual(['shell_tool', 'browser_use', 'computer_use', 'multi_agent', 'apps']);
    expect(args).toContain('model="gpt-6.1-sol"'); expect(args).toContain('model_reasoning_effort="xhigh"');
    expect(args[end + 1]).toContain(JSON.stringify(input.prompt)); expect(args).toHaveLength(end + 2);
    input.target.commandConfig.runner = 'shell';
    expect(() => codexImageInvocation(input)).toThrow('image_transport_unsupported');
  });
  it('collects the first saved image of its own thread and ends the run; foreign tools and missing images fail', async () => {
    const { root, input } = await fixture('codex'); const thread = randomUUID();
    const folder = path.join(root, '.codex', 'generated_images', thread);
    // An image of another thread is never collected.
    await mkdir(path.join(root, '.codex', 'generated_images', 'other-thread-0000'), { recursive: true });
    await writeFile(path.join(root, '.codex', 'generated_images', 'other-thread-0000', 'old.png'), png());
    const result = await executeCodexImage(input, await fakeCli(root, [{ type: 'thread.started', thread_id: thread }, { type: 'turn.started' }],
      { file: path.join(folder, 'exec-1.png'), bytes: png() }));
    expect(result).toMatchObject({ executionOutcome: 'stopped_after_image', metadata: { mimeType: 'image/png', width: 4, height: 4 } });
    expect(result.bytes.equals(png())).toBe(true);
    await expect(executeCodexImage(input, await fakeCli(root, [{ type: 'thread.started', thread_id: randomUUID() },
      { type: 'item.started', item: { id: 'i', type: 'file_change' } }]))).rejects.toThrow('image_tool_limit');
    await expect(executeCodexImage(input, await fakeCli(root, [{ type: 'thread.started', thread_id: '../escape' }]))).rejects.toThrow('invalid_image_source');
    await expect(executeCodexImage(input, await fakeCli(root, [{ type: 'thread.started', thread_id: randomUUID() },
      { type: 'turn.failed', error: { message: 'usage limit reached' } }], undefined, true))).rejects.toThrow('quota_exhausted');
  }, 30_000);
});

describe('bounded Antigravity image generation', () => {
  const init = (id: string) => ({ event: 'init', conversation_id: id, init: { cwd: '.', tools: [] } });
  const tool = (index: number, name: string) => ({ event: 'step_update', step_update: { step_index: index, step_type: 'tool', state: 'ACTIVE', tool_name: name, tool_info: { name } } });
  it('prints stream-json with skipped prompts, terminal restrictions and one delegated image call', async () => {
    const { input } = await fixture('antigravity');
    const { args } = antigravityImageInvocation(input);
    expect(args[0]).toBe('-p'); expect(args[1]).toContain('image-generator'); expect(args[1]).toContain('AspectRatio "1:1"');
    expect(args[1]).toContain(JSON.stringify(input.prompt));
    for (const flag of ['--dangerously-skip-permissions', '--sandbox']) expect(args).toContain(flag);
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3.8-flash-high');
  });
  it('collects the first image saved for its own conversation; other tools or a second delegation stop the run', async () => {
    const { root, input } = await fixture('antigravity'); const conversation = randomUUID();
    const brain = path.join(root, '.gemini', 'antigravity-cli', 'brain', conversation);
    await mkdir(brain, { recursive: true }); await writeFile(path.join(brain, 'task.md'), 'not an image');
    const result = await executeAntigravityImage(input, await fakeCli(root, [init(conversation), tool(1, 'invoke_subagent')],
      { file: path.join(brain, 'orange_cat_1.jpg'), bytes: jpg() }));
    expect(result).toMatchObject({ executionOutcome: 'stopped_after_image', metadata: { mimeType: 'image/jpeg', width: 4, height: 4 } });
    for (const lines of [[init(randomUUID()), tool(1, 'run_command')], [init(randomUUID()), tool(1, 'invoke_subagent'), tool(2, 'invoke_subagent')]]) {
      await expect(executeAntigravityImage(input, await fakeCli(root, lines))).rejects.toThrow('image_tool_limit');
    }
    await expect(executeAntigravityImage(input, await fakeCli(root, [init('../../etc')]))).rejects.toThrow('invalid_image_source');
    await expect(executeAntigravityImage(input, await fakeCli(root, [init(randomUUID()), tool(1, 'invoke_subagent')], undefined, true)))
      .rejects.toThrow('generation_failed');
  }, 30_000);
});
