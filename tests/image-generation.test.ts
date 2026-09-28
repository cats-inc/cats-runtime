import { afterEach, describe, expect, it, vi } from 'vitest';
import * as files from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Hono } from 'hono';
import jpeg from 'jpeg-js';
import { ImageGenerationService } from '../src/core/media/ImageGenerationService.js';
import { collectGrokImage, executeGrokImage, imageInvocation, validateImage, type ImageExecution } from '../src/backends/cli/media/grokImage.js';
import { IMAGE_MAX_BYTES, parseImageRequest } from '../src/core/media/contracts.js';
import { imageRoutes } from '../src/http/routes/images.js';
import type { RuntimeRouteEnv } from '../src/http/routes/diagnosticsSupport.js';
import type { AppContext } from '../src/http/app.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';
import { rm } from 'node:fs/promises';

const roots: string[] = [];
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
const picture = () => jpeg.encode({ width: 2, height: 2, data: Buffer.alloc(16, 255) }).data;
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cats-image-test-')); roots.push(root);
  const cwd = path.join(root, 'work'); await mkdir(cwd);
  const input: ImageExecution = { id: randomUUID(), prompt: 'a cat', instance: 'native', cwd,
    env: createRuntimeTestEnv(root), signal: new AbortController().signal,
    target: { id: 'native', providerName: 'grok', grokSessionsDir: path.join(root, '.grok', 'sessions'),
      commandConfig: { path: process.execPath, runner: 'direct', runtime: { mode: 'native' } } } };
  return { root, input };
}
async function output(input: ImageExecution) {
  const folder = path.join(input.target.grokSessionsDir!, encodeURIComponent(input.cwd), input.id, 'images');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, '1.jpg'); await writeFile(file, picture()); return file;
}
async function settle(service: ImageGenerationService, id: string) {
  for (let n = 0; n < 80; n++) {
    const job = await service.get(id); if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture did not finish');
}
describe('bounded image generation', () => {
  it('expands the default home-relative session directory before enforcing containment', async () => {
    const { root, input } = await fixture(); const file = await output(input);
    input.env.HOME = root; input.env.USERPROFILE = root;
    input.target.grokSessionsDir = '~/.grok/sessions';
    expect((await collectGrokImage(input, file)).bytes.equals(picture())).toBe(true);
    await expect(collectGrokImage({ ...input, id: randomUUID() }, file)).rejects.toThrow('invalid_image_source');
  });
  it('recollects a legacy source failure from matching session evidence, backs up its receipt and never executes', async () => {
    const { root, input } = await fixture();
    const receiptRoot = path.join(root, 'receipts');
    input.cwd = path.join(receiptRoot, input.id, 'workspace'); await mkdir(input.cwd, { recursive: true });
    const file = await output(input);
    input.env.HOME = root; input.env.USERPROFILE = root; input.target.grokSessionsDir = '~/.grok/sessions';
    const log = [
      { sessionUpdate: 'tool_call', toolCallId: 'one', title: 'image_gen', rawInput: { aspect_ratio: '1:1' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'one', status: 'completed', rawOutput: { type: 'ImageGen', path: file } },
    ].map((update) => JSON.stringify({ params: { sessionId: input.id, update } })).join('\n');
    const logPath = path.join(path.dirname(path.dirname(file)), 'updates.jsonl');
    const now = new Date().toISOString();
    const receipt = { schemaVersion: 1, id: input.id, instance: input.instance, prompt: input.prompt,
      provider: 'grok', agentModel: 'fixture', status: 'failed', error: 'invalid_image_source', output: null, createdAt: now, updatedAt: now };
    const jobPath = path.join(receiptRoot, input.id, 'job.json');
    const original = JSON.stringify(receipt); await writeFile(jobPath, original);
    const execute = vi.fn();
    const options = { root: receiptRoot, targets: () => [input.target], env: input.env, execute };
    const service = new ImageGenerationService(options);
    // No evidence, malformed/mismatched/extra-tool evidence and invalid bytes cannot upgrade a failure.
    expect((await service.get(input.id)).status).toBe('failed');
    for (const invalid of ['{', log.replaceAll(input.id, randomUUID()), log.replace('image_gen', 'image_edit'),
      log + '\n' + log.split('\n')[0], log.replace('"1:1"', '"16:9"'), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      await writeFile(logPath, invalid); expect((await service.get(input.id)).status).toBe('failed');
      expect(await readFile(jobPath, 'utf8')).toBe(original);
    }
    await writeFile(logPath, log); await writeFile(file, Buffer.alloc(IMAGE_MAX_BYTES + 1));
    expect((await service.get(input.id)).status).toBe('failed');
    await writeFile(file, picture());
    const backupPath = path.join(receiptRoot, input.id, 'job.before-image-source-recovery.json');
    await writeFile(backupPath, original.slice(0, 20));
    expect((await service.get(input.id)).status).toBe('failed');
    expect(await readFile(jobPath, 'utf8')).toBe(original); await unlink(backupPath);
    // A persistence failure leaves the original receipt retryable without provider execution.
    const rename = vi.spyOn(files, 'rename').mockRejectedValue(new Error('disk unavailable'));
    for (let n = 0; n < 3; n++) expect((await service.get(input.id)).status).toBe('failed');
    rename.mockRestore();
    expect((await readdir(path.join(receiptRoot, input.id))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(await readFile(jobPath, 'utf8')).toBe(original);
    expect((await service.get(input.id)).status).toBe('succeeded');
    expect(await readFile(path.join(receiptRoot, input.id, 'job.before-image-source-recovery.json'), 'utf8')).toBe(original);
    expect((await service.image(input.id)).equals(picture())).toBe(true);
    const restarted = new ImageGenerationService(options);
    expect((await restarted.get(input.id)).status).toBe('succeeded');
    expect(execute).not.toHaveBeenCalled();
    for (const status of ['cancelled', 'interrupted', 'running']) {
      await writeFile(jobPath, JSON.stringify({ ...receipt, status }));
      expect((await restarted.get(input.id)).status).not.toBe('succeeded');
    }
    await writeFile(jobPath, JSON.stringify({ ...receipt, error: 'generation_failed' }));
    expect((await restarted.get(input.id)).status).toBe('failed');
    expect(execute).not.toHaveBeenCalled(); await service.close(); await restarted.close();
  });
  it('records confirmed cancellation during final image persistence', async () => {
    const { root, input } = await fixture();
    let release!: () => void; let writing!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { writing = resolve; });
    const original = files.rename;
    const rename = vi.spyOn(files, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('image.jpg')) { writing(); await held; }
      return original(from, to);
    });
    const service = new ImageGenerationService({ root: path.join(root, 'receipts'), targets: () => [input.target], env: input.env,
      execute: async () => { const bytes = picture(); return { bytes, metadata: validateImage(bytes) }; } });
    try {
      const job = await service.submit({ id: input.id, instance: input.instance, prompt: input.prompt });
      await entered; const stopped = service.cancel(job.id);
      await new Promise((resolve) => setTimeout(resolve, 20)); release();
      expect((await stopped).status).toBe('cancelled');
      await expect(service.image(job.id)).rejects.toThrow('image_not_ready');
    } finally { release(); await service.close(); rename.mockRestore(); }
  });
  it('validates typed input and invocation without reading credentials or spawning Grok', async () => {
    const { input } = await fixture();
    expect(() => parseImageRequest({ id: input.id, instance: 'native', prompt: ' ' })).toThrow();
    expect(() => parseImageRequest({ id: input.id, instance: 'native', prompt: 'a', command: 'grok' })).toThrow();
    input.env.XAI_API_KEY = 'fixture-only'; input.env.GROK_SESSION_ID = 'fixture-only';
    const invocation = imageInvocation(input);
    expect(invocation.args[invocation.args.indexOf('--max-turns') + 1]).toBe('1');
    expect(invocation.args[invocation.args.indexOf('--tools') + 1]).toBe('image_gen');
    expect(invocation.env.XAI_API_KEY).toBeUndefined(); expect(invocation.env.GROK_SESSION_ID).toBeUndefined();
    expect(invocation.args).toContain(input.id);
    input.target.commandConfig.runner = 'shell';
    expect(() => imageInvocation(input)).toThrow('image_transport_unsupported');
  });
  it('decodes only a bounded square JPEG tied to this exact session and rejects escaped sources', async () => {
    const { root, input } = await fixture(); const file = await output(input);
    expect((await collectGrokImage(input, file)).metadata.width).toBe(2);
    const foreign = path.join(root, 'foreign.jpg'); await writeFile(foreign, picture());
    await expect(collectGrokImage(input, foreign)).rejects.toThrow('invalid_image_source');
    expect(() => validateImage(Buffer.from('<html>not an image</html>'))).toThrow('invalid_image');
    expect(() => validateImage(picture().subarray(0, 30))).toThrow('invalid_image');
    const other = { ...input, id: randomUUID() };
    await expect(collectGrokImage(other, file)).rejects.toThrow('invalid_image_source');
    const linked = path.join(path.dirname(file), 'linked.jpg');
    try { await symlink(foreign, linked); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error; return; }
    await expect(collectGrokImage(input, linked)).rejects.toThrow('invalid_image_source');
  });
  it('accepts real pipe framing and bounded exit 1 only with matching tool output and terminal evidence', async () => {
    const { root, input } = await fixture(); const file = await output(input);
    const program = path.join(root, 'fake.cjs');
    await writeFile(program, `const send = x => console.log(JSON.stringify(x));
send({type:'tool_call', toolName:'image_gen', toolCallId:'one', rawInput:{aspect_ratio:'1:1'}});
send({type:'tool_call_update',toolCallId:'one',status:'completed',rawOutput:{type:'ImageGen',path:${JSON.stringify(file)}}});
send({type:'max_turns_reached'});send({type:'end',sessionId:${JSON.stringify(input.id)}});process.exitCode=1;`);
    // Execute a temporary Node fixture, never the provider binary. Retain actual pipes/options.
    const launch = ((_command: string, _args: string[], options: Parameters<typeof spawn>[2]) => spawn(process.execPath, [program], options)) as typeof spawn;
    const result = await executeGrokImage(input, launch);
    expect(result.bytes.equals(picture())).toBe(true);
    await writeFile(program, `console.log(JSON.stringify({type:'tool_call',toolName:'image_edit',toolCallId:'bad'})); setInterval(()=>{},1000);`);
    await expect(executeGrokImage(input, launch)).rejects.toThrow('image_tool_limit');
  });
  it('persists before dispatch, deduplicates, stores bytes, and survives restart without a second execution', async () => {
    const { root, input } = await fixture(); let calls = 0;
    const options = { root: path.join(root, 'receipts'), targets: () => [input.target], env: input.env,
      execute: async () => { calls++; const bytes = picture(); return { bytes, metadata: validateImage(bytes) }; } };
    const service = new ImageGenerationService(options);
    const request = { id: input.id, prompt: input.prompt, instance: input.instance };
    const [a, b] = await Promise.all([service.submit(request), service.submit(request)]);
    expect(a.id).toBe(b.id); expect(calls).toBe(1);
    expect((await settle(service, a.id)).status).toBe('succeeded');
    await expect(service.submit({ ...request, prompt: 'different' })).rejects.toThrow('image_request_conflict');
    const restarted = new ImageGenerationService(options);
    expect((await restarted.submit(request)).status).toBe('succeeded'); expect(calls).toBe(1);
    expect((await restarted.image(a.id)).equals(picture())).toBe(true);
    await service.close(); await restarted.close();
  });
  it('cancellation wins a late result; unknown receipts are interrupted and never replayed', async () => {
    const { root, input } = await fixture(); let finish!: () => void;
    const service = new ImageGenerationService({ root: path.join(root, 'receipts'), targets: () => [input.target], env: input.env,
      execute: async () => { await new Promise<void>((resolve) => { finish = resolve; }); const bytes = picture(); return { bytes, metadata: validateImage(bytes) }; } });
    const job = await service.submit({ id: input.id, instance: input.instance, prompt: input.prompt });
    const cancelling = service.cancel(job.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await service.get(job.id)).status).toBe('cancelling');
    finish(); await cancelling; await service.close();
    expect((await service.get(job.id)).status).toBe('cancelled');
    await expect(service.image(job.id)).rejects.toThrow('image_not_ready');
    const recordPath = path.join(root, 'receipts', job.id, 'job.json');
    const receipt = JSON.parse(await readFile(recordPath, 'utf8')); receipt.status = 'running';
    await writeFile(recordPath, JSON.stringify(receipt));
    expect((await service.get(job.id)).status).toBe('interrupted');
  });
  it('routes validate bodies and return typed errors without leaking paths', async () => {
    const { root, input } = await fixture();
    const service = new ImageGenerationService({ root: path.join(root, 'receipts'), targets: () => [input.target], env: input.env,
      execute: async () => { const bytes = picture(); return { bytes, metadata: validateImage(bytes) }; } });
    const app = new Hono<RuntimeRouteEnv>();
    app.use('*', async (c, next) => { c.set('ctx', { images: service } as AppContext); await next(); });
    app.route('/', imageRoutes);
    expect((await app.request('/media/images/capabilities')).status).toBe(200);
    expect((await app.request('/media/images/jobs', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await app.request(`/media/images/jobs/${randomUUID()}`)).status).toBe(404);
    const request = { id: input.id, instance: input.instance, prompt: input.prompt };
    expect((await app.request('/media/images/jobs', { method: 'POST', body: JSON.stringify(request) })).status).toBe(202);
    await settle(service, input.id);
    const response = await app.request(`/media/images/jobs/${input.id}/image`);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer()).equals(picture())).toBe(true);
    await service.close();
  });
});
