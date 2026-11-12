import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { Hono } from 'hono';
import { ImageGenerationService } from '../src/core/media/ImageGenerationService.js';
import { MediaSourceStore, inspectVideo, resolveMediaTools } from '../src/core/media/sources.js';
import { parseImageRequest } from '../src/core/media/contracts.js';
import { loadImageProfiles } from '../src/core/media/profiles.js';
import { validateImage, type ImageExecution } from '../src/backends/cli/media/imageExecution.js';
import { imageInvocation } from '../src/backends/cli/media/grokImage.js';
import { imageRoutes } from '../src/http/routes/images.js';
import type { AppContext } from '../src/http/app.js';
import type { RuntimeRouteEnv } from '../src/http/routes/diagnosticsSupport.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'cats-media-v3-')); roots.push(root); return root; }
const picture = () => jpeg.encode({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 255) }).data;
const request = (sourceIds: string[]) => ({ contractVersion: 3, id: randomUUID(), targetId: 'grok/native', profileId: 'grok-reference-image',
  profileRevision: '1', agentConfigId: 'grok-4.7-xhigh', operation: 'image.edit', prompt: 'same cat in Paris', sourceIds, options: {} });

describe('reference media contract 3', () => {
  it('starts without FFmpeg: images still work and a video source answers media_decoder_unavailable', async () => {
    const missing = () => { throw Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' }); };
    expect(resolveMediaTools(missing)).toEqual({ ffmpeg: null, ffprobe: null });
    // A package without its downloaded binary counts as missing too.
    expect(resolveMediaTools((name) => name === 'ffprobe-static' ? { path: '/no/such/ffprobe' } : '/no/such/ffmpeg'))
      .toEqual({ ffmpeg: null, ffprobe: null });
    const root = await fixture();
    const sources = new MediaSourceStore(path.join(root, 'sources'), () => ({ ffmpeg: null, ffprobe: null }));
    const image = await sources.put(randomUUID(), Buffer.from(picture()));
    expect(image.kind).toBe('image');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(32)]);
    await expect(sources.put(randomUUID(), mp4)).rejects.toMatchObject({ code: 'media_decoder_unavailable', status: 503 });
  });
  it('uploads immutable bytes, passes exact references, completes once and recovers without another execution', async () => {
    const root = await fixture(); let executions = 0; let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const options = { root: path.join(root, 'receipts'), profiles: loadImageProfiles(), env: createRuntimeTestEnv(root), supports: () => true,
      targets: () => [{ id: 'native', providerName: 'grok' as const, grokSessionsDir: root, commandConfig: { path: process.execPath, runner: 'direct' as const, runtime: { mode: 'native' as const } } }],
      execute: async (input: ImageExecution) => { executions++; expect(input.references).toHaveLength(1);
        expect(await readFile(input.references![0]!)).toEqual(picture()); await wait;
        const bytes = picture(); return { bytes, metadata: validateImage(bytes), executionOutcome: 'completed' as const }; } };
    const service = new ImageGenerationService(options);
    const app = new Hono<RuntimeRouteEnv>(); app.use('*', async (c, next) => { c.set('ctx', { images: service } as AppContext); await next(); }); app.route('/', imageRoutes);
    const source = randomUUID();
    expect((await app.request(`/media/images/sources/${source}`, { method: 'PUT', body: picture() })).status).toBe(201);
    expect((await app.request(`/media/images/sources/${source}`, { method: 'PUT', body: picture() })).status).toBe(201);
    expect((await app.request(`/media/images/sources/${source}`, { method: 'PUT', body: Buffer.from('different') })).status).toBe(409);
    const input = request([source]); expect((await service.submit(input)).schemaVersion).toBe(3);
    expect((await service.submit(input)).id).toBe(input.id);
    await expect(service.submit({ ...input, sourceIds: [randomUUID()] })).rejects.toThrow('image_request_conflict');
    release();
    for (let n = 0; n < 100 && (await service.get(input.id)).status === 'running'; n++) await new Promise(resolve => setTimeout(resolve, 10));
    expect((await service.get(input.id)).status).toBe('succeeded');
    expect((await service.image(input.id)).bytes).toEqual(picture()); await service.close();
    const restarted = new ImageGenerationService(options); expect((await restarted.get(input.id)).status).toBe('succeeded');
    expect((await restarted.submit(input)).id).toBe(input.id); expect(executions).toBe(1); await restarted.close();
  });
  it('validates operation, source count and duration without weakening contract 2', () => {
    const good = request([randomUUID()]); expect(parseImageRequest(good).operation).toBe('image.edit');
    expect(() => parseImageRequest({ ...good, contractVersion: undefined })).toThrow();
    expect(() => parseImageRequest({ ...good, sourceIds: [] })).toThrow();
    expect(() => parseImageRequest({ ...good, operation: 'video.generate', options: { durationSeconds: 15 } })).toThrow();
    expect(parseImageRequest({ ...good, operation: 'video.generate', options: { durationSeconds: 6 } }).options.durationSeconds).toBe(6);
    expect(() => parseImageRequest({ ...good, operation: 'image.generate' })).toThrow();
  });
  it('decodes a short MP4 and uses its measured middle frame as the immutable reference', async () => {
    const root = await fixture(); const require = createRequire(import.meta.url); const ffmpeg = require('ffmpeg-static');
    const file = path.join(root, 'source.mp4');
    const made = spawnSync(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { windowsHide: true });
    expect(made.status).toBe(0);
    const bytes = await readFile(file); const metadata = await inspectVideo(file, bytes);
    expect(metadata).toMatchObject({ mimeType: 'video/mp4', width: 64, height: 64, durationSeconds: 1 });
    const sources = new MediaSourceStore(path.join(root, 'sources')); const id = randomUUID();
    await sources.put(id, bytes); const cwd = path.join(root, 'work'); await mkdir(cwd);
    const frames = await sources.materialize([id], cwd); expect(frames).toHaveLength(1);
    expect(validateImage(await readFile(frames[0]!)).mimeType).toBe('image/png');
    expect(await readFile(file)).toEqual(bytes);
    await writeFile(path.join(root, 'sources', id, 'source'), Buffer.from('tampered'));
    await expect(sources.materialize([id], cwd)).rejects.toThrow('invalid_media');
  });
  it('bounds the video invocation to one native tool with the exact source, duration and prompt', async () => {
    const root = await fixture();
    const input: ImageExecution = { id: randomUUID(), prompt: 'cat waves', provider: 'grok', instance: 'native', cwd: root,
      profile: loadImageProfiles().find(p => p.operation === 'video.generate')!, env: createRuntimeTestEnv(root), signal: new AbortController().signal,
      references: [path.join(root, 'reference.png')], options: { durationSeconds: 6 },
      target: { id: 'native', providerName: 'grok', grokSessionsDir: root, commandConfig: { path: process.execPath, runner: 'direct', runtime: { mode: 'native' } } } };
    const invocation = imageInvocation(input); const prompt = invocation.args[invocation.args.indexOf('-p') + 1];
    expect(prompt).toContain('image_to_video exactly once'); expect(prompt).toContain('cat waves');
    expect(invocation.args[invocation.args.indexOf('--max-turns') + 1]).toBe('1');
    expect(invocation.args[invocation.args.indexOf('--disallowed-tools') + 1]).not.toContain('image_to_video');
  });
});
