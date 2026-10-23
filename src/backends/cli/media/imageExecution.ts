import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { ProviderInstanceConfig } from '../config.js';
import { IMAGE_MAX_BYTES, ImageError, type ImageMetadata, type ImageProfile, type ImageProvider } from '../../../core/media/contracts.js';
import type { StreamEvent } from '../../../core/types.js';

export interface ImageExecution {
  id: string; prompt: string; provider: ImageProvider; instance: string; profile: ImageProfile;
  cwd: string; target: ProviderInstanceConfig; env: NodeJS.ProcessEnv; signal: AbortSignal;
  observe?: (event: StreamEvent) => void;
}
export interface ImageExecutionResult {
  bytes: Buffer; metadata: ImageMetadata;
  /** `stopped_after_image`: the runner ended the process once the verified image existed. */
  executionOutcome: 'completed' | 'stopped_after_image';
}

export const IMAGE_PROCESS_DEADLINE_MS = 300_000;
export const IMAGE_PROCESS_OUTPUT_LIMIT = 2 * 1024 * 1024;
// Decoders allocate width x height x 4 bytes; both caps apply before any pixel is decoded.
const MAX_PIXELS = 8 * 1024 * 1024;
const MAX_EDGE = 4096;

function measured(bytes: Buffer, mimeType: ImageMetadata['mimeType'], width: number, height: number,
  transparency: ImageMetadata['transparency']): ImageMetadata {
  if (!width || !height || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new ImageError('invalid_image');
  return { mimeType, bytes: bytes.length, width, height, sha256: createHash('sha256').update(bytes).digest('hex'), transparency };
}

/** Complete decode of the original bytes; the format comes from the signature, never a file name. */
export function validateImage(bytes: Buffer): ImageMetadata {
  if (!bytes.length || bytes.length > IMAGE_MAX_BYTES) throw new ImageError('invalid_image');
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new ImageError('invalid_image');
    try {
      const decoded = jpeg.decode(bytes, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: MAX_PIXELS / (1024 * 1024), maxMemoryUsageInMB: 160 });
      return measured(bytes, 'image/jpeg', decoded.width, decoded.height, 'opaque');
    } catch (error) { if (error instanceof ImageError) throw error; throw new ImageError('invalid_image'); }
  }
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.toString('latin1', 12, 16) === 'IHDR') {
    const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
    measured(bytes, 'image/png', width, height, 'opaque'); // Size caps before decoding.
    try {
      const decoded = PNG.sync.read(bytes, { checkCRC: true });
      let transparent = false;
      for (let index = 3; index < decoded.data.length; index += 4) if (decoded.data[index] !== 255) { transparent = true; break; }
      return measured(bytes, 'image/png', decoded.width, decoded.height, transparent ? 'has-transparency' : 'opaque');
    } catch (error) { if (error instanceof ImageError) throw error; throw new ImageError('invalid_image'); }
  }
  throw new ImageError('invalid_image');
}

/** No symbolic link may stand anywhere between `root` and `file`, and `file` must sit directly in `folder`. */
export async function containedImageFile(root: string, folder: string, file: string) {
  if (path.dirname(path.resolve(file)) !== path.resolve(folder)) throw new ImageError('invalid_image_source');
  const segments = path.relative(path.resolve(root), path.resolve(file)).split(path.sep);
  if (segments.some((segment) => segment === '..' || !segment)) throw new ImageError('invalid_image_source');
  let current = path.resolve(root);
  for (const candidate of [current, ...segments.map((segment) => (current = path.join(current, segment)))]) {
    if ((await lstat(candidate)).isSymbolicLink()) throw new ImageError('invalid_image_source');
  }
  if (path.dirname(await realpath(file)) !== await realpath(folder)) throw new ImageError('invalid_image_source');
}

/** Reads a regular, single-link file that does not change while it is read. */
export async function readStableImage(file: string, signal: AbortSignal): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 4 || before.size > IMAGE_MAX_BYTES) throw new ImageError('invalid_image');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const next = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!next.bytesRead) throw new ImageError('invalid_image');
      offset += next.bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || signal.aborted) throw new ImageError('invalid_image');
    return bytes;
  } finally { await handle.close(); }
}

/** Ends the whole process tree; the runner owns its child, so nothing it started outlives it. */
export function stopProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
    const killTimer = setTimeout(() => { child.kill(); killer.kill(); }, 2000);
    killer.on('close', () => { clearTimeout(killTimer); child.kill(); });
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

export function classifyImageFailure(text: string): string {
  if (/not signed in|login|authentication|unauthorized/i.test(text)) return 'auth_required';
  if (/quota|usage limit|rate.limit|insufficient|credits/i.test(text)) return 'quota_exhausted';
  if (/privacy|zero.data|\bzdr\b/i.test(text)) return 'privacy_required';
  if (/refus|content.policy|not.allowed|moderation/i.test(text)) return 'generation_refused';
  return 'generation_failed';
}
