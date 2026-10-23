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
import { collectGrokImage, executeGrokImage, imageInvocation, recoverGrokImage } from '../src/backends/cli/media/grokImage.js';
import { validateImage, type ImageExecution, type ImageExecutionResult } from '../src/backends/cli/media/imageExecution.js';
import { IMAGE_MAX_BYTES, parseImageRequest } from '../src/core/media/contracts.js';
import { loadImageProfiles } from '../src/core/media/profiles.js';
import { imageRoutes } from '../src/http/routes/images.js';
import type { RuntimeRouteEnv } from '../src/http/routes/diagnosticsSupport.js';
import type { AppContext } from '../src/http/app.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';
import { rm } from 'node:fs/promises';

const roots: string[] = [];
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
const picture = () => jpeg.encode({ width: 2, height: 2, data: Buffer.alloc(16, 255) }).data;
const profiles = loadImageProfiles();
const grok = profiles.find((profile) => profile.id === 'grok-generate')!;
const generated = (): ImageExecutionResult => { const bytes = picture(); return { bytes, metadata: validateImage(bytes), executionOutcome: 'completed' }; };
const request = (input: ImageExecution, fields: Record<string, unknown> = {}) => ({ id: input.id, targetId: 'grok/native', profileId: 'grok-generate',
  profileRevision: '1', agentConfigId: 'grok-4.7-xhigh', operation: 'image.generate', prompt: input.prompt, sourceIds: [], options: {}, ...fields });
const serviceOptions = (root: string, input: ImageExecution, execute: (input: ImageExecution) => Promise<ImageExecutionResult>) => ({
  root, profiles, targets: (provider: string) => provider === 'grok' ? [input.target] : [], supports: () => true,
  recover: (job: ImageExecution) => recoverGrokImage(job), env: input.env, execute });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cats-image-test-')); roots.push(root);
  const cwd = path.join(root, 'work'); await mkdir(cwd);
  const input: ImageExecution = { id: randomUUID(), prompt: 'a cat', provider: 'grok', instance: 'native', profile: grok, cwd,
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
    const options = serviceOptions(receiptRoot, input, execute);
    const service = new ImageGenerationService(options);
    // The first read upgrades the schema 1 receipt once and keeps the original beside it.
    expect((await service.get(input.id)).status).toBe('failed');
    expect(await readFile(path.join(receiptRoot, input.id, 'job.schema-1.json'), 'utf8')).toBe(original);
    const upgraded = await readFile(jobPath, 'utf8');
    expect(JSON.parse(upgraded)).toMatchObject({ schemaVersion: 2, targetId: 'grok/native', provider: 'grok', profileId: 'grok-generate',
      agentConfigId: null, agentModel: 'fixture', status: 'failed', error: 'invalid_image_source', warnings: [], output: null });
    // No evidence, malformed/mismatched/extra-tool evidence and invalid bytes cannot upgrade a failure.
    for (const invalid of ['{', log.replaceAll(input.id, randomUUID()), log.replace('image_gen', 'image_edit'),
      log + '\n' + log.split('\n')[0], log.replace('"1:1"', '"16:9"'), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      await writeFile(logPath, invalid); expect((await service.get(input.id)).status).toBe('failed');
      expect(await readFile(jobPath, 'utf8')).toBe(upgraded);
    }
    await writeFile(logPath, log); await writeFile(file, Buffer.alloc(IMAGE_MAX_BYTES + 1));
    expect((await service.get(input.id)).status).toBe('failed');
    await writeFile(file, picture());
    const backupPath = path.join(receiptRoot, input.id, 'job.before-image-source-recovery.json');
    await writeFile(backupPath, upgraded.slice(0, 20));
    expect((await service.get(input.id)).status).toBe('failed');
    expect(await readFile(jobPath, 'utf8')).toBe(upgraded); await unlink(backupPath);
    // A persistence failure leaves the original receipt retryable without provider execution.
    const rename = vi.spyOn(files, 'rename').mockRejectedValue(new Error('disk unavailable'));
    for (let n = 0; n < 3; n++) expect((await service.get(input.id)).status).toBe('failed');
    rename.mockRestore();
    expect((await readdir(path.join(receiptRoot, input.id))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(await readFile(jobPath, 'utf8')).toBe(upgraded);
    expect((await service.get(input.id)).status).toBe('succeeded');
    expect(await readFile(path.join(receiptRoot, input.id, 'job.before-image-source-recovery.json'), 'utf8')).toBe(upgraded);
    expect((await service.image(input.id)).bytes.equals(picture())).toBe(true);
    const restarted = new ImageGenerationService(options);
    expect((await restarted.get(input.id)).status).toBe('succeeded');
    expect(execute).not.toHaveBeenCalled();
    const failed = JSON.parse(upgraded);
    for (const status of ['cancelled', 'interrupted', 'running']) {
      await writeFile(jobPath, JSON.stringify({ ...failed, status }));
      expect((await restarted.get(input.id)).status).not.toBe('succeeded');
    }
    await writeFile(jobPath, JSON.stringify({ ...failed, error: 'generation_failed' }));
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
    const service = new ImageGenerationService(serviceOptions(path.join(root, 'receipts'), input, async () => generated()));
    try {
      const job = await service.submit(request(input));
      await entered; const stopped = service.cancel(job.id);
      await new Promise((resolve) => setTimeout(resolve, 20)); release();
      expect((await stopped).status).toBe('cancelled');
      await expect(service.image(job.id)).rejects.toThrow('image_not_ready');
    } finally { release(); await service.close(); rename.mockRestore(); }
  });
  it('validates typed input and invocation without reading credentials or spawning Grok', async () => {
    const { input } = await fixture();
    expect(parseImageRequest(request(input))).toMatchObject({ targetId: 'grok/native', operation: 'image.generate', sourceIds: [], options: {} });
    for (const invalid of [{ prompt: ' ' }, { command: 'grok' }, { targetId: 'claude/native' }, { targetId: 'grok' }, { operation: 'image.edit' },
      { sourceIds: ['x'] }, { options: { aspectRatio: '1:1' } }, { profileRevision: 1 }]) {
      expect(() => parseImageRequest(request(input, invalid))).toThrow('invalid_image_request');
    }
    expect(() => parseImageRequest({ id: input.id, instance: 'native', prompt: 'a' })).toThrow('invalid_image_request');
    input.env.XAI_API_KEY = 'fixture-only'; input.env.GROK_SESSION_ID = 'fixture-only';
    const invocation = imageInvocation(input);
    expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('grok-4.7');
    expect(invocation.args[invocation.args.indexOf('--reasoning-effort') + 1]).toBe('xhigh');
    expect(invocation.args[invocation.args.indexOf('--max-turns') + 1]).toBe('1');
    expect(invocation.args[invocation.args.indexOf('--tools') + 1]).toBe('image_gen');
    expect(invocation.env.XAI_API_KEY).toBeUndefined(); expect(invocation.env.GROK_SESSION_ID).toBeUndefined();
    expect(invocation.args).toContain(input.id);
    input.target.commandConfig.runner = 'shell';
    expect(() => imageInvocation(input)).toThrow('image_transport_unsupported');
  });
  it('decodes only a bounded square JPEG tied to this exact session and rejects escaped sources', async () => {
    const wide = jpeg.encode({ width: 4, height: 2, data: Buffer.alloc(32, 255) }).data;
    const { root, input } = await fixture(); const file = await output(input);
    expect((await collectGrokImage(input, file)).metadata.width).toBe(2);
    const foreign = path.join(root, 'foreign.jpg'); await writeFile(foreign, picture());
    await expect(collectGrokImage(input, foreign)).rejects.toThrow('invalid_image_source');
    expect(() => validateImage(Buffer.from('<html>not an image</html>'))).toThrow('invalid_image');
    expect(() => validateImage(picture().subarray(0, 30))).toThrow('invalid_image');
    // Measured, not assumed: a wide JPEG is valid bytes but not this square Grok attempt's image.
    expect(validateImage(wide)).toMatchObject({ width: 4, height: 2, mimeType: 'image/jpeg', transparency: 'opaque' });
    await writeFile(file, wide); await expect(collectGrokImage(input, file)).rejects.toThrow('invalid_image');
    await writeFile(file, picture());
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
    const options = serviceOptions(path.join(root, 'receipts'), input, async () => { calls++; return generated(); });
    const service = new ImageGenerationService(options);
    const body = request(input);
    const [a, b] = await Promise.all([service.submit(body), service.submit(body)]);
    expect(a.id).toBe(b.id); expect(calls).toBe(1);
    expect(a).toMatchObject({ schemaVersion: 2, provider: 'grok', instance: 'native', agentModel: 'grok-4.7', agentEffort: 'xhigh', agentConfigId: 'grok-4.7-xhigh' });
    expect(await settle(service, a.id)).toMatchObject({ status: 'succeeded', executionOutcome: 'completed',
      output: { mimeType: 'image/jpeg', width: 2, height: 2, transparency: 'opaque' } });
    await expect(service.submit({ ...body, prompt: 'different' })).rejects.toThrow('image_request_conflict');
    await expect(service.submit({ ...body, agentConfigId: 'other' })).rejects.toThrow('image_request_conflict');
    const restarted = new ImageGenerationService(options);
    expect((await restarted.submit(body)).status).toBe('succeeded'); expect(calls).toBe(1);
    expect((await restarted.image(a.id)).bytes.equals(picture())).toBe(true);
    await service.close(); await restarted.close();
  });
  it('cancellation wins a late result; unknown receipts are interrupted and never replayed', async () => {
    const { root, input } = await fixture(); let finish!: () => void;
    const service = new ImageGenerationService(serviceOptions(path.join(root, 'receipts'), input,
      async () => { await new Promise<void>((resolve) => { finish = resolve; }); return generated(); }));
    const job = await service.submit(request(input));
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
    const service = new ImageGenerationService(serviceOptions(path.join(root, 'receipts'), input, async () => generated()));
    const app = new Hono<RuntimeRouteEnv>();
    app.use('*', async (c, next) => { c.set('ctx', { images: service } as AppContext); await next(); });
    app.route('/', imageRoutes);
    const capabilities = await (await app.request('/media/images/capabilities')).json();
    expect(capabilities).toMatchObject({ schemaVersion: 2, maxPromptLength: 2000, targets: [{ id: 'grok/native', provider: 'grok', instance: 'native' }],
      profiles: [{ id: 'grok-generate', revision: 1, operation: 'image.generate', targetIds: ['grok/native'], inputs: { min: 0, max: 0 },
        agentConfigs: [{ id: 'grok-4.7-xhigh', model: 'grok-4.7', effort: 'xhigh' }], aspectRatio: { mode: 'native', options: ['1:1'] } }] });
    expect(capabilities.profiles).toHaveLength(1); // Muse appears only with a configured, supported instance.
    expect((await app.request('/media/images/jobs', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await app.request(`/media/images/jobs/${randomUUID()}`)).status).toBe(404);
    const stale = await app.request('/media/images/jobs', { method: 'POST', body: JSON.stringify(request(input, { id: randomUUID(), profileRevision: '2' })) });
    expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ error: 'image_profile_changed' });
    const muse = await app.request('/media/images/jobs', { method: 'POST', body: JSON.stringify(request(input, { id: randomUUID(), targetId: 'muse/native', profileId: 'muse-generate', agentConfigId: 'muse-spark-1.3-xhigh' })) });
    expect(muse.status).toBe(503); expect(await muse.json()).toEqual({ error: 'image_transport_unsupported' });
    const mismatched = await app.request('/media/images/jobs', { method: 'POST', body: JSON.stringify(request(input, { id: randomUUID(), targetId: 'muse/native' })) });
    expect(await mismatched.json()).toEqual({ error: 'image_profile_unavailable' });
    expect((await app.request('/media/images/jobs', { method: 'POST', body: JSON.stringify(request(input)) })).status).toBe(202);
    await settle(service, input.id);
    const response = await app.request(`/media/images/jobs/${input.id}/image`);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer()).equals(picture())).toBe(true);
    const deleted = await app.request(`/media/images/jobs/${input.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200); expect(await deleted.json()).toEqual({ deleted: true });
    expect((await app.request(`/media/images/jobs/${input.id}`)).status).toBe(404);
    expect((await app.request('/media/images/jobs/not-an-id', { method: 'DELETE' })).status).toBe(400);
    await service.close();
  });
  it('lists each enabled profile only for configured instances its runner supports', async () => {
    const { root, input } = await fixture();
    const museTarget = { id: 'native', providerName: 'muse' as const, commandConfig: { path: process.execPath, runner: 'direct' as const, runtime: { mode: 'native' as const } } };
    const service = new ImageGenerationService({ ...serviceOptions(path.join(root, 'receipts'), input, async () => generated()),
      targets: (provider: string) => provider === 'grok' ? [input.target] : [museTarget, { ...museTarget, id: 'docker' }],
      supports: (_provider: string, target: { id: string }) => target.id !== 'docker' });
    const capabilities = service.capabilities();
    expect(capabilities.targets.map((target) => target.id)).toEqual(['grok/native', 'muse/native']);
    expect(capabilities.profiles.find((profile) => profile.id === 'muse-generate')).toEqual({ id: 'muse-generate', revision: 1,
      operation: 'image.generate', targetIds: ['muse/native'], agentConfigs: [{ id: 'muse-spark-1.3-xhigh', model: 'muse-spark-1.3', effort: 'xhigh' }],
      inputs: { min: 0, max: 0 }, aspectRatio: { mode: 'service' } });
    const disabled = new ImageGenerationService({ ...serviceOptions(path.join(root, 'other'), input, async () => generated()),
      profiles: profiles.map((profile) => ({ ...profile, enabled: profile.provider === 'grok' })), targets: () => [museTarget] });
    expect(disabled.capabilities().profiles.map((profile) => profile.id)).toEqual(['grok-generate']);
    expect(capabilities.revision).not.toBe(disabled.capabilities().revision);
  });
  it('upgrades a saved schema 1 JPEG once, keeps the original receipt and still serves its bytes', async () => {
    const { root, input } = await fixture();
    const receipts = path.join(root, 'receipts'); const folder = path.join(receipts, input.id); await mkdir(folder, { recursive: true });
    const bytes = picture(); const now = new Date().toISOString();
    const original = JSON.stringify({ schemaVersion: 1, id: input.id, instance: 'native', prompt: 'old', provider: 'grok', agentModel: 'grok-4.7-build-fast',
      status: 'succeeded', error: null, output: validateImage(bytes), createdAt: now, updatedAt: now });
    await writeFile(path.join(folder, 'job.json'), original); await writeFile(path.join(folder, 'image.jpg'), bytes);
    const service = new ImageGenerationService(serviceOptions(receipts, input, async () => generated()));
    expect(await service.get(input.id)).toMatchObject({ schemaVersion: 2, targetId: 'grok/native', agentModel: 'grok-4.7-build-fast', agentEffort: null,
      executionOutcome: 'completed', output: { mimeType: 'image/jpeg', transparency: 'opaque' } });
    expect(await readFile(path.join(folder, 'job.schema-1.json'), 'utf8')).toBe(original);
    expect((await service.image(input.id)).bytes.equals(bytes)).toBe(true);
    // The upgraded receipt still answers its original request without running anything.
    expect((await service.submit(request(input, { prompt: 'old' }))).status).toBe('succeeded');
    await expect(service.submit(request(input, { prompt: 'new' }))).rejects.toThrow('image_request_conflict');
    // Unknown or damaged receipts are preserved and refused, never rewritten.
    for (const damaged of ['{', JSON.stringify({ schemaVersion: 3, id: input.id })]) {
      await writeFile(path.join(folder, 'job.json'), damaged);
      await expect(service.get(input.id)).rejects.toThrow(damaged === '{' ? 'image_state_invalid' : 'image_state_invalid');
      expect(await readFile(path.join(folder, 'job.json'), 'utf8')).toBe(damaged);
    }
    await service.close();
  });
  it('deletes only finished receipts with their image and never touches a running attempt', async () => {
    const { root, input } = await fixture(); let finish!: () => void;
    const receipts = path.join(root, 'receipts');
    const service = new ImageGenerationService(serviceOptions(receipts, input,
      async () => { await new Promise<void>((resolve) => { finish = resolve; }); return generated(); }));
    const job = await service.submit(request(input));
    await expect(service.remove(job.id)).rejects.toThrow('image_not_deletable');
    finish(); expect((await settle(service, job.id)).status).toBe('succeeded');
    expect(await readdir(path.join(receipts, job.id))).toContain('image.jpg');
    await expect(service.remove(job.id)).resolves.toEqual({ deleted: true });
    expect(await readdir(receipts)).toEqual([]);
    await expect(service.get(job.id)).rejects.toThrow('image_not_found');
    await expect(service.remove(job.id)).resolves.toEqual({ deleted: true });
    await service.close();
  });
});
