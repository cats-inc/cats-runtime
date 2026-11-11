import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ffprobe from 'ffprobe-static';
import { ImageError, IMAGE_ID, type MediaMetadata } from './contracts.js';
import { validateImage, stopProcessTree } from '../../backends/cli/media/imageExecution.js';
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string | null;

export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export interface MediaSource { id: string; kind: 'image' | 'video'; metadata: MediaMetadata; }

/** Bounded local decoding only; no network protocols or arbitrary command arguments. */
function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = ''; let error = ''; let failed = false;
    const stop = () => { failed = true; stopProcessTree(child); };
    const timer = setTimeout(stop, 30_000);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on('data', bytes => { output += bytes; if (output.length > 128_000) stop(); });
    child.stderr.on('data', bytes => { error += bytes; if (error.length > 128_000) stop(); });
    child.on('error', () => { failed = true; });
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (failed || code !== 0) reject(new ImageError('invalid_media')); else resolve(output); });
  });
}

export async function inspectVideo(file: string, bytes: Buffer, signal?: AbortSignal): Promise<MediaMetadata> {
  if (!bytes.length || bytes.length > MEDIA_MAX_BYTES || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new ImageError('invalid_media');
  const parsed = JSON.parse(await run(ffprobe.path, ['-v', 'error', '-protocol_whitelist', 'file', '-show_streams', '-show_format', '-of', 'json', file], signal));
  const video = parsed.streams?.filter((row: { codec_type: string; disposition?: { attached_pic?: number } }) => row.codec_type === 'video' && !row.disposition?.attached_pic);
  const duration = Number(parsed.format?.duration);
  if (video?.length !== 1 || video[0].codec_name !== 'h264' || !Number.isFinite(duration) || duration <= 0 || duration > 30
    || !Number.isInteger(video[0].width) || !Number.isInteger(video[0].height) || video[0].width > 1920 || video[0].height > 1920
    || video[0].width < 1 || video[0].height < 1) throw new ImageError('invalid_media');
  if (!ffmpeg) throw new ImageError('media_decoder_unavailable', 503);
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', file, '-map', '0:V:0', '-f', 'null', '-'], signal);
  return { mimeType: 'video/mp4', bytes: bytes.length, width: video[0].width, height: video[0].height,
    durationSeconds: duration, sha256: createHash('sha256').update(bytes).digest('hex'), transparency: 'opaque' };
}

export class MediaSourceStore {
  constructor(private readonly root: string) {}
  private folder(id: string) { if (!IMAGE_ID.test(id)) throw new ImageError('invalid_image_id'); return path.join(this.root, id); }
  async get(id: string): Promise<MediaSource> {
    try { return JSON.parse(await readFile(path.join(this.folder(id), 'source.json'), 'utf8')); }
    catch { throw new ImageError('media_source_not_found', 404); }
  }
  async put(id: string, bytes: Buffer): Promise<MediaSource> {
    const folder = this.folder(id);
    const previous = await this.get(id).catch(() => null);
    if (previous) {
      if (previous.metadata.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new ImageError('image_request_conflict', 409);
      return previous;
    }
    if (!bytes.length || bytes.length > MEDIA_MAX_BYTES) throw new ImageError('invalid_media');
    await mkdir(this.root, { recursive: true });
    const staging = path.join(this.root, `.upload-${randomUUID()}`);
    await mkdir(staging);
    try {
      const isVideo = bytes.toString('ascii', 4, 8) === 'ftyp';
      const file = path.join(staging, 'source'); await writeFile(file, bytes, { flag: 'wx' });
      const metadata = isVideo ? await inspectVideo(file, bytes) : validateImage(bytes);
      const receipt: MediaSource = { id, kind: isVideo ? 'video' : 'image', metadata };
      await writeFile(path.join(staging, 'source.json'), JSON.stringify(receipt), { flag: 'wx' });
      try { await rename(staging, folder); }
      catch (error) {
        const concurrent = await this.get(id).catch(() => null);
        if (!concurrent || concurrent.metadata.sha256 !== metadata.sha256) throw error;
      }
      return receipt;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async materialize(ids: string[], cwd: string): Promise<string[]> {
    const result: string[] = [];
    for (const [index, id] of ids.entries()) {
      const source = await this.get(id); const bytes = await readFile(path.join(this.folder(id), 'source'));
      if (createHash('sha256').update(bytes).digest('hex') !== source.metadata.sha256) throw new ImageError('invalid_media');
      if (source.kind === 'image') {
        const file = path.join(cwd, `reference-${index}.${source.metadata.mimeType === 'image/png' ? 'png' : 'jpg'}`);
        await writeFile(file, bytes, { flag: 'wx' }); result.push(file);
      } else {
        if (!ffmpeg) throw new ImageError('media_decoder_unavailable', 503);
        const input = path.join(cwd, `source-${index}.mp4`); await writeFile(input, bytes, { flag: 'wx' });
        const frame = path.join(cwd, `reference-${index}.png`);
        await run(ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-ss', String((source.metadata.durationSeconds ?? 0) / 2),
          '-i', input, '-map', '0:V:0', '-frames:v', '1', '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', frame]);
        validateImage(await readFile(frame)); result.push(frame);
      }
    }
    return result;
  }
}
