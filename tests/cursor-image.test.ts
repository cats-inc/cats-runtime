import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import jpeg from 'jpeg-js';
import { cursorImageInvocation, collectCursorImage, executeCursorImage } from '../src/backends/cli/media/cursorImage.js';
import type { ImageExecution } from '../src/backends/cli/media/imageExecution.js';
import { loadImageProfiles } from '../src/core/media/profiles.js';
import { ImageGenerationService } from '../src/core/media/ImageGenerationService.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
const picture = () => Buffer.from(jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(64, 200) }).data);
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cats-cursor-image-')); roots.push(root);
  const cwd = path.join(root, 'workspace'); await mkdir(cwd);
  const input: ImageExecution = { id: randomUUID(), prompt: 'An orange cat on a blue background', provider: 'cursor', instance: 'native', cwd,
    env: createRuntimeTestEnv(root), signal: new AbortController().signal,
    profile: loadImageProfiles().find((profile) => profile.provider === 'cursor')!,
    target: { id: 'native', providerName: 'cursor', commandConfig: { path: process.execPath, runner: 'direct', runtime: { mode: 'native' } } } };
  const file = path.join(cwd, '.cursor-data', 'projects', 'workspace-key', 'assets', 'studio-image.jpg');
  return { root, input, file };
}
const session = 'cursor-session-0000';
const init = { type: 'system', subtype: 'init', session_id: session };
const tool = (subtype: string, call = 'one-image', fields: Record<string, unknown> = {}) => ({ type: 'tool_call', subtype, call_id: call, session_id: session,
  tool_call: { generateImageToolCall: { args: { description: 'An orange cat on a blue background', filePath: 'studio-image.png', aspectRatio: '1:1', toolCallId: call }, ...fields },
    hookAdditionalContexts: [], toolCallId: call, startedAtMs: '1', ...(subtype === 'completed' ? { completedAtMs: '2' } : {}) } });
const lookup = (subtype: string, server = 'cursor', call = 'lookup-one') => ({ type: 'tool_call', subtype, call_id: call, session_id: session,
  tool_call: { getMcpToolsToolCall: { args: { server, toolName: 'GenerateImage', toolCallId: call } }, hookAdditionalContexts: [], toolCallId: call, startedAtMs: '1' } });
async function fakeCli(root: string, lines: unknown[], image?: { file: string; bytes: Buffer }, exit = false) {
  const program = path.join(root, `cli-${randomUUID()}.cjs`);
  if (image) { await mkdir(path.dirname(image.file), { recursive: true }); await writeFile(image.file, image.bytes); }
  await writeFile(program, `for (const line of ${JSON.stringify(lines)}) console.log(JSON.stringify(line));
${exit ? 'setTimeout(() => process.exit(0), 50);' : 'setInterval(() => {}, 1000);'}`);
  return ((_command: string, _args: string[], options: Parameters<typeof spawn>[2]) => spawn(process.execPath, [program], options)) as typeof spawn;
}

describe('bounded Cursor image generation', () => {
  it('pins GLM 5.3 max and advertises only configured native instances', async () => {
    const { root, input } = await fixture();
    const { args, env } = cursorImageInvocation(input);
    expect(args[args.indexOf('--model') + 1]).toBe('glm-5p3[reasoning=max]');
    expect(args[args.indexOf('--sandbox') + 1]).toBe(process.platform === 'win32' ? 'disabled' : 'enabled');
    expect(args[args.indexOf('--workspace') + 1]).toBe(input.cwd);
    expect(args).not.toContain('--force');
    expect(args.at(-1)).toContain(JSON.stringify(input.prompt));
    expect(env.CURSOR_DATA_DIR).toBe(path.join(input.cwd, '.cursor-data'));
    const gated = new ImageGenerationService({ root: path.join(root, 'gated-receipts'), env: input.env,
      profiles: loadImageProfiles().map((profile) => ({ ...profile, enabled: false })),
      targets: (provider) => provider === 'cursor' ? [input.target] : [], supports: () => true, execute: () => { throw new Error('not called'); } });
    expect(gated.capabilities().targets).toEqual([]);
    const service = new ImageGenerationService({ root: path.join(root, 'receipts'), env: input.env,
      profiles: loadImageProfiles().map((profile) => profile.provider === 'cursor' ? { ...profile, enabled: true } : profile),
      targets: (provider) => provider === 'cursor' ? [input.target] : [], supports: () => true, execute: () => { throw new Error('not called'); } });
    expect(service.capabilities().targets).toEqual([{ id: 'cursor/native', provider: 'cursor', instance: 'native' }]);
    expect(service.capabilities().profiles[0]).toMatchObject({ id: 'cursor-generate', agentConfigs: [{ model: 'glm-5p3[reasoning=max]', effort: 'max' }] });
    input.target.commandConfig.runner = 'shell';
    expect(() => cursorImageInvocation(input)).toThrow('image_transport_unsupported');
  });
  it('collects only its completed native call, preserves JPEG bytes despite a PNG request and stops the child', async () => {
    const { root, input, file } = await fixture(); const bytes = picture();
    const result = await executeCursorImage(input, await fakeCli(root, [init, lookup('started'), lookup('completed'), tool('started'), tool('completed', 'one-image', { result: { success: { filePath: file } } })], { file, bytes }));
    expect(result).toMatchObject({ executionOutcome: 'stopped_after_image', metadata: { mimeType: 'image/jpeg', width: 4, height: 4 }, warnings: [] });
    expect(result.bytes.equals(bytes)).toBe(true);
    const permissions = JSON.parse(await readFile(path.join(input.cwd, '.cursor', 'cli.json'), 'utf8')).permissions;
    expect(permissions.deny).toContain('Shell(*)'); expect(permissions.deny).not.toContain('Write(*)');
    expect(permissions.allow).toContain(`Write(${path.join(input.cwd, '.cursor-data').replaceAll('\\', '/')}/projects/**)`);
  });
  it('rejects foreign tools, a second image, wrong session, uncorrelated or missing results and output flooding', async () => {
    const cases = [
      [init, { ...tool('started'), tool_call: { shellToolCall: { args: { command: 'echo no' } } } }],
      [init, tool('started'), tool('started', 'second-image')],
      [init, lookup('started', 'other-server')],
      [init, lookup('started'), lookup('completed'), lookup('started', 'cursor', 'second-lookup')],
      [init, { ...tool('started'), session_id: 'other-session-0000' }],
      [init, tool('completed', 'unstarted', { result: { success: { filePath: '/untrusted.jpg' } } })],
      [init, tool('started')],
      [{ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] } }],
    ];
    const errors = ['image_tool_limit', 'image_tool_limit', 'image_tool_limit', 'image_tool_limit', 'invalid_image_source', 'invalid_image_source', 'generation_failed', 'image_output_limit'];
    for (let i = 0; i < cases.length; i++) {
      const { root, input } = await fixture();
      await expect(executeCursorImage(input, await fakeCli(root, cases[i]!, undefined, true))).rejects.toThrow(errors[i]);
    }
  });
  it('never scans another project or falls back to an assistant-mentioned file; corrupt images and cancellation fail', async () => {
    const { root, input, file } = await fixture();
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, picture());
    for (const foreign of [path.join(root, 'other.jpg'), path.join(input.cwd, '.cursor-data', 'projects', 'key', 'file.jpg'), 'studio-image.jpg']) {
      await expect(collectCursorImage(input, foreign)).rejects.toThrow('invalid_image_source');
    }
    await writeFile(file, 'not an image');
    await expect(collectCursorImage(input, file)).rejects.toThrow('invalid_image');
    const controller = new AbortController(); input.signal = controller.signal;
    const pending = executeCursorImage(input, await fakeCli(root, [init]));
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow('cancelled');
  });
});
