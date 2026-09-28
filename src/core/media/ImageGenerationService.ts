import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderInstanceConfig } from '../../backends/cli/config.js';
import { IMAGE_AGENT_MODEL, type ImageExecution, type ImageExecutionResult } from '../../backends/cli/media/grokImage.js';
import { IMAGE_ID, IMAGE_MAX_BYTES, ImageError, parseImageRequest, type ImageJob } from './contracts.js';

export interface ImageServiceOptions {
  root: string;
  targets: () => ProviderInstanceConfig[];
  execute: (input: ImageExecution) => Promise<ImageExecutionResult>;
  env: NodeJS.ProcessEnv;
}
/** Durable execution receipts; Platform owns Core tasks, works and retained assets. No retry scheduler. */
export class ImageGenerationService {
  private active = new Map<string, { controller: AbortController; done?: Promise<void> }>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  constructor(private readonly options: ImageServiceOptions) {}
  capabilities() {
    return { schemaVersion: 1, operation: 'image.generate', aspectRatio: '1:1', maxPromptLength: 2000,
      maxImageBytes: IMAGE_MAX_BYTES, targets: this.options.targets().filter((target) =>
        target.commandConfig.runtime.mode === 'native' && ['auto', 'direct'].includes(target.commandConfig.runner)
        && !target.commandConfig.args?.length && target.grokSessionsDir)
        .map((target) => ({ provider: 'grok', instance: target.id, agentModel: IMAGE_AGENT_MODEL })) };
  }
  private folder(id: string) {
    if (!IMAGE_ID.test(id)) throw new ImageError('invalid_image_id');
    return path.join(this.options.root, id);
  }
  private async read(id: string): Promise<ImageJob | null> {
    try {
      const value = JSON.parse(await readFile(path.join(this.folder(id), 'job.json'), 'utf8')) as ImageJob;
      if (value.schemaVersion !== 1 || value.id !== id || !['running', 'succeeded', 'failed', 'cancelling', 'cancelled', 'interrupted'].includes(value.status)) throw new ImageError('image_state_invalid', 503);
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  private async write(job: ImageJob) {
    const folder = this.folder(job.id);
    const temporary = path.join(folder, `job-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(job), { flag: 'wx' });
    await rename(temporary, path.join(folder, 'job.json'));
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(action); this.tail = next; return next;
  }
  async get(id: string): Promise<ImageJob> {
    return this.serial(async () => {
      const job = await this.read(id);
      if (!job) throw new ImageError('image_not_found', 404);
      if (['running', 'cancelling'].includes(job.status) && !this.active.has(id)) {
        job.status = 'interrupted'; job.error = 'execution_interrupted'; job.updatedAt = new Date().toISOString();
        await this.write(job);
      }
      return job;
    });
  }
  async submit(value: unknown): Promise<ImageJob> {
    const input = parseImageRequest(value);
    return this.serial(async () => {
      const previous = await this.read(input.id);
      if (previous) {
        if (previous.instance !== input.instance || previous.prompt !== input.prompt) throw new ImageError('image_request_conflict', 409);
        return previous; // Existing receipts never authorize another CLI invocation.
      }
      if (this.closing) throw new ImageError('image_service_stopping', 503);
      if (this.active.size) throw new ImageError('image_service_busy', 429);
      const target = this.options.targets().find((entry) => entry.id === input.instance);
      if (!target || !this.capabilities().targets.some((entry) => entry.instance === input.instance)) throw new ImageError('image_transport_unsupported', 503);
      await mkdir(this.options.root, { recursive: true });
      if ((await readdir(this.options.root)).length >= 500) throw new ImageError('image_storage_limit', 409);
      const folder = this.folder(input.id);
      // An incomplete pre-spawn directory is ambiguous. Never overwrite/retry it.
      try { await mkdir(folder); } catch { throw new ImageError('execution_interrupted', 409); }
      const cwd = path.join(folder, 'workspace');
      await mkdir(cwd);
      const now = new Date().toISOString();
      const job: ImageJob = { ...input, schemaVersion: 1, provider: 'grok', agentModel: IMAGE_AGENT_MODEL,
        status: 'running', createdAt: now, updatedAt: now, error: null, output: null };
      await this.write(job);
      if (this.closing) {
        job.status = 'interrupted'; job.error = 'execution_interrupted'; await this.write(job); return job;
      }
      const active = { controller: new AbortController(), done: undefined as Promise<void> | undefined };
      this.active.set(input.id, active);
      active.done = this.run(job, { ...input, target, cwd, env: this.options.env, signal: active.controller.signal });
      return job;
    });
  }
  private async run(job: ImageJob, input: ImageExecution): Promise<void> {
    try {
      const result = await this.options.execute(input);
      if (input.signal.aborted) throw new ImageError('cancelled');
      const temporary = path.join(this.folder(job.id), 'image.tmp');
      await writeFile(temporary, result.bytes, { flag: 'wx' });
      await rename(temporary, path.join(this.folder(job.id), 'image.jpg'));
      await this.serial(async () => {
        const current = await this.read(job.id);
        if (current && (input.signal.aborted || current.status === 'cancelling')) {
          await this.write({ ...job, status: 'cancelled', error: 'cancelled', updatedAt: new Date().toISOString() }); return;
        }
        if (current?.status !== 'running') return;
        await this.write({ ...job, status: 'succeeded', output: result.metadata, updatedAt: new Date().toISOString() });
      });
    } catch (error) {
      await this.serial(async () => {
        const current = await this.read(job.id);
        if (!current || !['running', 'cancelling'].includes(current.status)) return;
        const code = input.signal.aborted ? 'cancelled' : error instanceof ImageError ? error.code
          : (error as NodeJS.ErrnoException).code === 'ENOSPC' ? 'storage_full' : 'generation_failed';
        await this.write({ ...job, status: code === 'cancelled' ? 'cancelled' : 'failed', error: code, updatedAt: new Date().toISOString() });
      }).catch(() => { /* Receipt stays nonterminal; recovery reports interrupted and never repeats it. */ });
    } finally { this.active.delete(job.id); }
  }
  async cancel(id: string) {
    this.active.get(id)?.controller.abort();
    let stopped: Promise<void> | undefined;
    await this.serial(async () => {
      this.active.get(id)?.controller.abort();
      stopped = this.active.get(id)?.done;
      const job = await this.read(id);
      if (!job) throw new ImageError('image_not_found', 404);
      if (job.status === 'running') {
        job.status = stopped ? 'cancelling' : 'interrupted';
        job.error = stopped ? 'cancelled' : 'execution_interrupted';
        job.updatedAt = new Date().toISOString(); await this.write(job);
      }
      return job;
    });
    await stopped; // Outside the queue: completion also needs the serial writer.
    return this.get(id);
  }
  async image(id: string): Promise<Buffer> {
    const job = await this.get(id);
    if (job.status !== 'succeeded' || !job.output) throw new ImageError('image_not_ready', 409);
    const file = await open(path.join(this.folder(id), 'image.jpg'), 'r');
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size !== job.output.bytes || info.size > IMAGE_MAX_BYTES) throw new ImageError('invalid_image');
      bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const next = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!next.bytesRead) throw new ImageError('invalid_image');
        offset += next.bytesRead;
      }
    } finally { await file.close(); }
    if (bytes.length !== job.output.bytes || createHash('sha256').update(bytes).digest('hex') !== job.output.sha256) throw new ImageError('invalid_image');
    return bytes;
  }
  async close() {
    this.closing = true;
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((active) => active.done));
  }
}
