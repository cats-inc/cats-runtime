import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { executeMuseImage, museImageInvocation, recoverMuseImage, supportsMuseImage } from '../src/backends/cli/media/museImage.js';
import { ImageGenerationService } from '../src/core/media/ImageGenerationService.js';
import { validateImage, type ImageExecution } from '../src/backends/cli/media/imageExecution.js';
import { loadImageProfiles } from '../src/core/media/profiles.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
const muse = loadImageProfiles().find((profile) => profile.id === 'muse-generate')!;
function png(width: number, height: number, alpha = 255) {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) image.data.set([240, 140, 40, alpha], index);
  return PNG.sync.write(image);
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cats-muse-image-')); roots.push(root);
  const cwd = path.join(root, 'workspace'); await mkdir(cwd);
  const input: ImageExecution = { id: randomUUID(), prompt: 'An orange cat', provider: 'muse', instance: 'native', profile: muse, cwd,
    env: createRuntimeTestEnv(root), signal: new AbortController().signal,
    target: { id: 'native', providerName: 'muse', commandConfig: { path: process.execPath, runner: 'direct', runtime: { mode: 'native' } } } };
  return { root, input };
}
// Muse 1.4 exec --json records, reduced to the fields the adapter reads.
const records = (session: string) => {
  const record = (payload_type: string, payload: Record<string, unknown>) => ({ schema_version: 1, stream: { kind: 'session', id: session },
    record_type: 'event', payload_type, payload });
  return {
    proposed: (task: string, tool: string) => record('task.lifecycle.proposed', { kind: 'task_lifecycle', task_id: task, event: { task_id: task, task_kind: `tool.${tool}` } }),
    intent: (task: string, call: string) => record('task.lifecycle.side_effect_intent', { kind: 'task_lifecycle', task_id: task, event: { task_id: task, idempotency_key: `tool:${call}` } }),
    result: (call: string, text: string, tool = 'image_generation', outcome = 'success') => record('tool.result',
      { kind: 'tool_result', call_id: call, text, correlation_facts: { tool_name: tool, outcome } }),
    completed: () => record('run.terminal.completed', { kind: 'run_terminal' }),
    failed: (reason: string) => record('run.terminal.failed', { kind: 'run_terminal', reason }),
  };
};
/** A temporary Node program stands in for muse; it writes the image where muse 1.4 does and then never exits on its own. */
async function fakeMuse(root: string, lines: unknown[], { image, exit = false }: { image?: { call: string; bytes: Buffer; extension?: string }; exit?: boolean } = {}) {
  const program = path.join(root, `muse-${randomUUID()}.cjs`);
  const bytes = image ? path.join(root, `${image.call}.bin`) : null;
  if (image && bytes) await writeFile(bytes, image.bytes);
  await writeFile(program, `const fs = require('fs'), path = require('path');
${image ? `fs.mkdirSync('generated_images', { recursive: true }); fs.copyFileSync(${JSON.stringify(bytes)}, path.join('generated_images', ${JSON.stringify(`${image.call}.${image.extension ?? 'png'}`)}));` : ''}
for (const line of ${JSON.stringify(lines)}) console.log(JSON.stringify(line));
${exit ? '' : 'setInterval(() => {}, 1000);'}`);
  return ((_command: string, _args: string[], options: Parameters<typeof spawn>[2]) => spawn(process.execPath, [program], options)) as typeof spawn;
}

describe('bounded Muse image generation', () => {
  it('limits the run before it starts: one model step, no parallel calls, no shell/web tools, its own session', async () => {
    const { input } = await fixture();
    const { args } = museImageInvocation(input);
    const end = args.lastIndexOf('--');
    const options = args.slice(0, end);
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(options[options.indexOf('--model') + 1]).toBe('muse-spark-1.3');
    expect(options[options.indexOf('--reasoning-effort') + 1]).toBe('xhigh');
    expect(options[options.indexOf('--max-model-steps') + 1]).toBe('1');
    expect(options[options.indexOf('--session-id') + 1]).toBe(input.id);
    for (const flag of ['--no-parallel-tool-calls', '--disable-shell', '--disable-web-tools', '--disable-approval',
      '--disable-reminders', '--disable-request-user-input', '--no-foreign-personal-context']) expect(options).toContain(flag);
    // The image tool is a workspace write in muse 1.4; disabling writes removes it.
    expect(options).not.toContain('--disable-write');
    expect(args[end + 1]).toContain(JSON.stringify(input.prompt));
    expect(args).toHaveLength(end + 2);
    input.target.commandConfig.runner = 'shell';
    expect(supportsMuseImage(input.target)).toBe(false);
    expect(() => museImageInvocation(input)).toThrow('image_transport_unsupported');
  });
  it('collects the matching saved PNG as soon as the tool reports it and stops a run that keeps going', async () => {
    const { root, input } = await fixture(); const r = records(input.id); const bytes = png(3, 2);
    const launch = await fakeMuse(root, [r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'),
      r.result('call_1', 'Saved generated image to generated_images/call_1.png')], { image: { call: 'call_1', bytes } });
    const result = await executeMuseImage(input, launch);
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.metadata).toMatchObject({ mimeType: 'image/png', width: 3, height: 2, bytes: bytes.length, transparency: 'opaque' });
    expect(result.executionOutcome).toBe('stopped_after_image');
    const finished = await fakeMuse(root, [r.proposed('t1', 'image_generation'), r.intent('t1', 'call_2'),
      r.result('call_2', 'Saved generated image to generated_images/call_2.png'), r.completed()], { image: { call: 'call_2', bytes: png(2, 2, 0) }, exit: true });
    expect((await executeMuseImage(input, finished)).metadata.transparency).toBe('has-transparency');
  });
  it.each(['jpg', 'jpeg'])('collects a matching Muse %s result without changing its original JPEG bytes', async (extension) => {
    const { root, input } = await fixture(); const r = records(input.id);
    const bytes = jpeg.encode({ width: 3, height: 2, data: Buffer.alloc(24, 255) }).data;
    const launch = await fakeMuse(root, [r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'),
      r.result('call_1', `Saved generated image to generated_images/call_1.${extension}`)], { image: { call: 'call_1', bytes, extension } });
    const result = await executeMuseImage(input, launch);
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.metadata).toMatchObject({ mimeType: 'image/jpeg', width: 3, height: 2, transparency: 'opaque' });
    expect(result.executionOutcome).toBe('stopped_after_image');
  });
  it('rejects JPEG results with a foreign call, traversal, an unsupported extension or mismatched bytes', async () => {
    const { root, input } = await fixture(); const r = records(input.id);
    for (const result of ['generated_images/other.jpg', '../call_1.jpg', 'generated_images/call_1.webp']) {
      const launch = await fakeMuse(root, [r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'),
        r.result('call_1', `Saved generated image to ${result}`)], { exit: true });
      await expect(executeMuseImage(input, launch)).rejects.toThrow('invalid_image_source');
    }
    const launch = await fakeMuse(root, [r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'),
      r.result('call_1', 'Saved generated image to generated_images/call_1.jpg')], { image: { call: 'call_1', extension: 'jpg', bytes: png(2, 2) } });
    await expect(executeMuseImage(input, launch)).rejects.toThrow('invalid_image');
  }, 15_000);
  it('stops on any other tool, a second image call, a foreign result or session, and never accepts a stray file', async () => {
    const { root, input } = await fixture(); const r = records(input.id); const image = { call: 'call_1', bytes: png(2, 2) };
    const saved = r.result('call_1', 'Saved generated image to generated_images/call_1.png');
    const cases: [unknown[], string][] = [
      [[r.proposed('t1', 'read_file')], 'image_tool_limit'],
      [[r.proposed('t1', 'image_generation'), r.proposed('t2', 'image_generation')], 'image_tool_limit'],
      [[r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'), r.result('call_1', 'done', 'write_file')], 'image_tool_limit'],
      [[r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'), r.result('call_1', 'Saved generated image to generated_images/other.png')], 'invalid_image_source'],
      [[r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'), r.result('call_1', 'Saved generated image to ../call_1.png')], 'invalid_image_source'],
      [[records(randomUUID()).proposed('t1', 'image_generation')], 'invalid_image_source'],
      [[r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'), r.result('call_1', 'Usage limit reached', 'image_generation', 'error')], 'quota_exhausted'],
      [[r.failed('not signed in')], 'auth_required'],
    ];
    for (const [lines, code] of cases) {
      await rm(path.join(input.cwd, 'generated_images'), { recursive: true, force: true });
      await expect(executeMuseImage(input, await fakeMuse(root, lines, { image, exit: code === 'auth_required' }))).rejects.toThrow(code);
    }
    // A file with the right name but no matching tool result is never collected.
    await expect(executeMuseImage(input, await fakeMuse(root, [r.completed()], { image, exit: true }))).rejects.toThrow('generation_failed');
    // A symbolic link in place of the saved image is rejected even with matching evidence.
    await rm(path.join(input.cwd, 'generated_images'), { recursive: true, force: true });
    await mkdir(path.join(input.cwd, 'generated_images'));
    const outside = path.join(root, 'outside.png'); await writeFile(outside, png(2, 2));
    try { await symlink(outside, path.join(input.cwd, 'generated_images', 'call_1.png')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error; return; }
    await expect(executeMuseImage(input, await fakeMuse(root, [r.proposed('t1', 'image_generation'), r.intent('t1', 'call_1'), saved])))
      .rejects.toThrow('invalid_image_source');
  }, 30_000);
  it('honours cancellation before an image exists and leaves no stray process output behind', async () => {
    const { root, input } = await fixture(); const controller = new AbortController();
    const launch = await fakeMuse(root, [records(input.id).proposed('t1', 'image_generation')]);
    const running = executeMuseImage({ ...input, signal: controller.signal }, launch);
    setTimeout(() => controller.abort(), 100);
    await expect(running).rejects.toThrow('cancelled');
    expect(await readdir(input.cwd)).toEqual([]);
  });
});

describe('Muse source failure recollection', () => {
  async function savedAttempt() {
    const { root, input } = await fixture();
    const receipts = path.join(root, 'receipts');
    input.cwd = path.join(receipts, input.id, 'workspace');
    input.createdAt = '2026-10-23T19:03:14.439Z';
    input.target.museSessionsDir = path.join(root, '.local', 'share', 'muse', 'sessions');
    const transcript = path.join(input.target.museSessionsDir, '2026', '10', '24', input.id, 'session.jsonl');
    await mkdir(path.dirname(transcript), { recursive: true });
    await mkdir(path.join(input.cwd, 'generated_images'), { recursive: true });
    const bytes = jpeg.encode({ width: 3, height: 2, data: Buffer.alloc(24, 255) }).data;
    const image = path.join(input.cwd, 'generated_images', 'call_1.jpg');
    await writeFile(image, bytes);
    const record = (payload_type: string, payload: unknown) => ({ stream: { kind: 'session', id: input.id }, payload_type, payload });
    const task = (event: object, task_id = 't1') => record('runtime.session', { kind: 'task', run_id: 'run-1', task_id, event });
    const lines = [
      record('runtime.session.metadata', { record: { workspace_root: path.toNamespacedPath(input.cwd) } }),
      record('runtime.session', { kind: 'run', run_id: 'run-1', event: { kind: 'started', prompt: museImageInvocation(input).args.at(-1) } }),
      task({ kind: 'proposed', task_kind: 'model.meta.response' }, 'model-task'),
      task({ kind: 'proposed', task_kind: 'tool.image_generation' }),
      task({ kind: 'side_effect_intent', operation: 'tool:image_generation', idempotency_key: 'tool:call_1' }),
      task({ kind: 'output', chunk: 'Saved generated image to generated_images/call_1.jpg', final_result: true }),
      task({ kind: 'completed' }),
    ];
    const text = lines.map((line) => JSON.stringify(line)).join('\n');
    await writeFile(transcript, text);
    return { root, input, receipts, bytes, image, transcript, text, lines, task };
  }
  it.each([false, true])('recollects the existing JPEG, backs up and survives restart without execution (batch=%s)', async (batch) => {
    const { input, receipts, bytes, transcript, lines } = await savedAttempt();
    if (batch) await writeFile(transcript, JSON.stringify({ children: lines.map((line) => ({ record_json: JSON.stringify(line) })) }));
    const original = JSON.stringify({ schemaVersion: 2, id: input.id, targetId: 'muse/native', provider: 'muse', instance: 'native',
      profileId: muse.id, profileRevision: String(muse.revision), agentConfigId: muse.agentConfig.id,
      agentModel: muse.agentConfig.model, agentEffort: muse.agentConfig.effort, operation: 'image.generate', prompt: input.prompt,
      sourceIds: [], options: {}, status: 'failed', createdAt: input.createdAt, updatedAt: input.createdAt,
      error: 'invalid_image_source', warnings: [], executionOutcome: null, output: null });
    const receipt = path.join(receipts, input.id, 'job.json'); await writeFile(receipt, original);
    const execute = vi.fn();
    const options = { root: receipts, profiles: [muse], targets: () => [input.target], supports: () => true,
      env: input.env, execute, recover: recoverMuseImage };
    const service = new ImageGenerationService(options);
    expect(await service.get(input.id)).toMatchObject({ status: 'succeeded', error: null,
      output: { mimeType: 'image/jpeg', width: 3, height: 2 }, executionOutcome: 'stopped_after_image' });
    expect(await readFile(path.join(receipts, input.id, 'job.before-image-source-recovery.json'), 'utf8')).toBe(original);
    expect((await service.image(input.id)).bytes.equals(bytes)).toBe(true);
    const restarted = new ImageGenerationService(options);
    expect((await restarted.get(input.id)).status).toBe('succeeded');
    expect((await restarted.image(input.id)).bytes.equals(bytes)).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    await service.close(); await restarted.close();
  });
  it('requires the exact session, workspace, prompt, one tool call, matching file and completed tool', async () => {
    const { input, transcript, text, lines, task, image } = await savedAttempt();
    for (const invalid of [
      text.replaceAll(input.id, randomUUID()),
      text.replace('workspace_root', 'wrong_workspace'),
      text.replace('An orange cat', 'Another image'),
      text.replace('tool:call_1', 'tool:other'),
      text.replace('generated_images/call_1.jpg', '../call_1.jpg'),
      lines.slice(0, -1).map((line) => JSON.stringify(line)).join('\n'),
      text + '\n' + JSON.stringify(task({ kind: 'proposed', task_kind: 'tool.image_generation' }, 't2')),
      text + '\n' + JSON.stringify(task({ kind: 'proposed', task_kind: 'tool.write_file' }, 't2')),
      JSON.stringify({ children: [{ record_json: '{' }] }),
      text + '\n' + JSON.stringify({ children: [{ record_json: '{}' }] }),
      text + '\n' + JSON.stringify({ children: [{ record_json: '1' }] }),
      text + '\n' + JSON.stringify({ payload_type: 'runtime.session', payload: { kind: 'task', event: { kind: 'failed' } } }),
      ...['failed', 'cancelled', 'timed_out', 'rejected'].map((kind) => text + '\n' + JSON.stringify(task({ kind }))),
      'x'.repeat(2 * 1024 * 1024 + 1),
    ]) {
      await writeFile(transcript, invalid);
      await expect(recoverMuseImage(input)).rejects.toThrow('invalid_image_source');
    }
    await writeFile(transcript, text); await writeFile(image, Buffer.from('not a JPEG'));
    await expect(recoverMuseImage(input)).rejects.toThrow('invalid_image');
  });
});

describe('image validation', () => {
  it('decodes PNG completely, measures alpha, and rejects corrupt, oversized or unknown bytes', () => {
    expect(validateImage(png(5, 3))).toMatchObject({ mimeType: 'image/png', width: 5, height: 3, transparency: 'opaque' });
    expect(validateImage(png(2, 2, 128)).transparency).toBe('has-transparency');
    const corrupt = Buffer.from(png(4, 4)); corrupt[corrupt.length - 20] ^= 0xff;
    expect(() => validateImage(corrupt)).toThrow('invalid_image');
    const huge = Buffer.from(png(1, 1)); huge.writeUInt32BE(20000, 16); huge.writeUInt32BE(20000, 20);
    expect(() => validateImage(huge)).toThrow('invalid_image');
    expect(() => validateImage(Buffer.from('GIF89a........................'))).toThrow('invalid_image');
  });
});
