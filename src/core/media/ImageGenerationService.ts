import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderInstanceConfig } from '../../backends/cli/config.js';
import type { ImageExecution, ImageExecutionResult } from '../../backends/cli/media/imageExecution.js';
import {
  IMAGE_ID, IMAGE_MAX_BYTES, IMAGE_MAX_PROMPT, ImageError, imageTargetId, parseImageRequest, parseImageTargetId,
  type ImageJob, type ImageMetadata, type ImageProfile, type ImageProvider, type ImageRequest, type ImageStatus,
} from './contracts.js';

export interface ImageServiceOptions {
  root: string;
  profiles: ImageProfile[];
  targets: (provider: ImageProvider) => ProviderInstanceConfig[];
  /** Whether this configured instance has a transport the provider's runner can bound. */
  supports: (provider: ImageProvider, target: ProviderInstanceConfig) => boolean;
  execute: (input: ImageExecution) => Promise<ImageExecutionResult>;
  /** Collection-only recovery of a completed attempt that failed source validation. Never runs a CLI. */
  recover?: (input: ImageExecution) => Promise<ImageExecutionResult> | null;
  env: NodeJS.ProcessEnv;
}
const STATUSES: ImageStatus[] = ['running', 'succeeded', 'failed', 'cancelling', 'cancelled', 'interrupted'];
const imageFile = (job: Pick<ImageJob, 'output'>) => job.output?.mimeType === 'image/png' ? 'image.png' : 'image.jpg';

interface SchemaOneReceipt {
  schemaVersion: 1; id: string; instance: string; prompt: string; provider: 'grok'; agentModel: string; status: ImageStatus;
  createdAt: string; updatedAt: string; error: string | null; output: Omit<ImageMetadata, 'transparency'> | null;
}
/** Schema 1 receipts are Grok square JPEG generations; the upgrade adds what they implied and invents nothing else. */
function upgradeSchemaOne(value: SchemaOneReceipt): ImageJob {
  return { schemaVersion: 2, id: value.id, targetId: imageTargetId('grok', value.instance), provider: 'grok', instance: value.instance,
    profileId: 'grok-generate', profileRevision: '1', agentConfigId: null, agentModel: value.agentModel, agentEffort: null,
    operation: 'image.generate', prompt: value.prompt, sourceIds: [], options: {}, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt, error: value.error, warnings: [],
    executionOutcome: value.status === 'succeeded' ? 'completed' : null,
    output: value.output ? { ...value.output, transparency: 'opaque' } : null };
}
function validSchemaOne(value: Partial<SchemaOneReceipt>, id: string): value is SchemaOneReceipt {
  return value.id === id && value.provider === 'grok' && typeof value.instance === 'string' && typeof value.prompt === 'string'
    && typeof value.agentModel === 'string' && STATUSES.includes(value.status as ImageStatus)
    && (value.output === null || (value.output?.mimeType === 'image/jpeg' && typeof value.output.sha256 === 'string'));
}

/** Durable execution receipts; Platform owns Core tasks, works and retained assets. No retry scheduler. */
export class ImageGenerationService {
  private active = new Map<string, { controller: AbortController; done?: Promise<void> }>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  constructor(private readonly options: ImageServiceOptions) {}
  /** The configured view: enabled profiles x supported configured instances. No CLI, sign-in or quota probe. */
  capabilities() {
    const targets: { id: string; provider: ImageProvider; instance: string }[] = [];
    const profiles = [];
    for (const profile of this.options.profiles.filter((entry) => entry.enabled)) {
      const ids = this.options.targets(profile.provider).filter((target) => this.options.supports(profile.provider, target))
        .map((target) => ({ id: imageTargetId(profile.provider, target.id), provider: profile.provider, instance: target.id }));
      if (!ids.length) continue;
      for (const target of ids) if (!targets.some((entry) => entry.id === target.id)) targets.push(target);
      profiles.push({ id: profile.id, revision: profile.revision, operation: profile.operation, targetIds: ids.map((target) => target.id),
        agentConfigs: [{ ...profile.agentConfig }], inputs: { min: 0, max: 0 }, aspectRatio: profile.aspectRatio });
    }
    const revision = createHash('sha256').update(JSON.stringify({ targets, profiles })).digest('hex').slice(0, 16);
    return { schemaVersion: 2 as const, revision, maxPromptLength: IMAGE_MAX_PROMPT, maxImageBytes: IMAGE_MAX_BYTES,
      sourceSessionYield: true as const, targets, profiles };
  }
  private resolve(input: ImageRequest) {
    const target = parseImageTargetId(input.targetId);
    const profile = this.options.profiles.find((entry) => entry.id === input.profileId);
    if (!target || !profile || !profile.enabled || profile.provider !== target.provider) throw new ImageError('image_profile_unavailable', 409);
    // A request built against another catalog revision or configuration never silently runs this one.
    if (String(profile.revision) !== input.profileRevision || profile.agentConfig.id !== input.agentConfigId) throw new ImageError('image_profile_changed', 409);
    const instance = this.options.targets(target.provider).find((entry) => entry.id === target.instance);
    if (!instance || !this.options.supports(target.provider, instance)) throw new ImageError('image_transport_unsupported', 503);
    return { ...target, profile, config: instance };
  }
  private folder(id: string) {
    if (!IMAGE_ID.test(id)) throw new ImageError('invalid_image_id');
    return path.join(this.options.root, id);
  }
  private async read(id: string): Promise<ImageJob | null> {
    let value: Partial<ImageJob> | Partial<SchemaOneReceipt>;
    try { value = JSON.parse(await readFile(path.join(this.folder(id), 'job.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw new ImageError('image_state_invalid', 503);
      throw error;
    }
    if (value.schemaVersion === 1) {
      if (!validSchemaOne(value as Partial<SchemaOneReceipt>, id)) throw new ImageError('image_state_invalid', 503);
      return this.upgrade(value as SchemaOneReceipt);
    }
    if (value.schemaVersion !== 2 || value.id !== id || !STATUSES.includes(value.status as ImageStatus)
      || (value.sourceSessionId !== undefined && (typeof value.sourceSessionId !== 'string'
        || !value.sourceSessionId || value.sourceSessionId.length > 200 || /[\u0000-\u001f\u007f]/.test(value.sourceSessionId)))) {
      throw new ImageError('image_state_invalid', 503);
    }
    return value as ImageJob;
  }
  /**
   * Back up the original, then replace atomically. `job.json` holds the original until that replace, so a backup
   * left partial by a crash is rewritten from it; a rerun finds the same backup and finishes.
   */
  private async upgrade(original: SchemaOneReceipt) {
    const backup = path.join(this.folder(original.id), 'job.schema-1.json');
    const text = await readFile(path.join(this.folder(original.id), 'job.json'), 'utf8');
    if (await readFile(backup, 'utf8').catch(() => null) !== text) {
      const temporary = path.join(this.folder(original.id), `job.schema-1-${randomUUID()}.tmp`);
      try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, backup); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    const upgraded = upgradeSchemaOne(original);
    await this.write(upgraded);
    return upgraded;
  }
  private async write(job: ImageJob) {
    const folder = this.folder(job.id);
    const temporary = path.join(folder, `job-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(job), { flag: 'wx' });
      await rename(temporary, path.join(folder, 'job.json'));
    } finally { await unlink(temporary).catch(() => {}); }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(action); this.tail = next; return next;
  }
  private execution(job: ImageJob, cwd: string, signal: AbortSignal): ImageExecution | null {
    const profile = this.options.profiles.find((entry) => entry.id === job.profileId);
    const target = this.options.targets(job.provider).find((entry) => entry.id === job.instance);
    return profile && target ? { id: job.id, prompt: job.prompt, provider: job.provider, instance: job.instance, profile, cwd, target, createdAt: job.createdAt,
      env: this.options.env, signal, ...(job.sourceSessionId ? { sourceSessionId: job.sourceSessionId } : {}) } : null;
  }
  async get(id: string): Promise<ImageJob> {
    return this.serial(async () => {
      const job = await this.read(id);
      if (!job) throw new ImageError('image_not_found', 404);
      if (['running', 'cancelling'].includes(job.status) && !this.active.has(id)) {
        job.status = 'interrupted'; job.error = 'execution_interrupted'; job.updatedAt = new Date().toISOString();
        await this.write(job);
      }
      if (job.status === 'failed' && job.error === 'invalid_image_source' && !this.active.has(id)) {
        const input = this.execution(job, path.join(this.folder(id), 'workspace'), new AbortController().signal);
        const recovery = input && this.options.recover?.(input);
        if (recovery) {
          try {
            const result = await recovery;
            // Keep the original failure receipt before atomically retaining the already-generated bytes.
            const backup = path.join(this.folder(id), 'job.before-image-source-recovery.json');
            const original = JSON.stringify(job);
            try { await writeFile(backup, original, { flag: 'wx' }); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
              // A partial backup from an interrupted write must never authorize replacement.
              const saved = await open(backup, 'r');
              try {
                if ((await saved.stat()).size !== Buffer.byteLength(original)
                  || await saved.readFile('utf8') !== original) throw new ImageError('invalid_image_receipt');
              } finally { await saved.close(); }
            }
            const recovered: ImageJob = { ...job, status: 'succeeded', error: null, output: result.metadata,
              executionOutcome: result.executionOutcome, updatedAt: new Date().toISOString() };
            const temporary = path.join(this.folder(id), `image-${randomUUID()}.tmp`);
            try {
              await writeFile(temporary, result.bytes, { flag: 'wx' });
              await rename(temporary, path.join(this.folder(id), imageFile(recovered)));
            } finally { await unlink(temporary).catch(() => {}); }
            await this.write(recovered);
            return recovered;
          } catch { /* Missing or invalid evidence preserves the original failure; never execute again. */ }
        }
      }
      return job;
    });
  }
  async submit(value: unknown): Promise<ImageJob> {
    const input = parseImageRequest(value);
    return this.serial(async () => {
      const previous = await this.read(input.id);
      if (previous) {
        // Receipts upgraded from schema 1 recorded no configuration, so only the request itself can be compared.
        const sameConfig = previous.agentConfigId === null || (previous.profileId === input.profileId
          && previous.profileRevision === input.profileRevision && previous.agentConfigId === input.agentConfigId);
        if (previous.targetId !== input.targetId || previous.operation !== input.operation || previous.prompt !== input.prompt || !sameConfig
          || (previous.sourceSessionId ?? null) !== (input.sourceSessionId ?? null)) {
          throw new ImageError('image_request_conflict', 409);
        }
        return previous; // Existing receipts never authorize another CLI invocation.
      }
      if (this.closing) throw new ImageError('image_service_stopping', 503);
      if (this.active.size) throw new ImageError('image_service_busy', 429);
      const { provider, instance, profile, config } = this.resolve(input);
      await mkdir(this.options.root, { recursive: true });
      if ((await readdir(this.options.root)).length >= 500) throw new ImageError('image_storage_limit', 409);
      const folder = this.folder(input.id);
      // An incomplete pre-spawn directory is ambiguous. Never overwrite/retry it.
      try { await mkdir(folder); } catch { throw new ImageError('execution_interrupted', 409); }
      const cwd = path.join(folder, 'workspace');
      await mkdir(cwd);
      const now = new Date().toISOString();
      const job: ImageJob = { schemaVersion: 2, id: input.id, targetId: input.targetId, provider, instance,
        profileId: profile.id, profileRevision: String(profile.revision), agentConfigId: profile.agentConfig.id,
        agentModel: profile.agentConfig.model, agentEffort: profile.agentConfig.effort, operation: input.operation,
        prompt: input.prompt, sourceIds: [], options: {}, status: 'running', createdAt: now, updatedAt: now,
        error: null, warnings: [], executionOutcome: null, output: null,
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}) };
      await this.write(job);
      if (this.closing) {
        job.status = 'interrupted'; job.error = 'execution_interrupted'; await this.write(job); return job;
      }
      const active = { controller: new AbortController(), done: undefined as Promise<void> | undefined };
      this.active.set(input.id, active);
      active.done = this.run(job, { id: job.id, prompt: job.prompt, provider, instance, profile, cwd, target: config,
        env: this.options.env, signal: active.controller.signal,
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}) });
      return job;
    });
  }
  private async run(job: ImageJob, input: ImageExecution): Promise<void> {
    try {
      const result = await this.options.execute(input);
      if (input.signal.aborted) throw new ImageError('cancelled');
      const saved: ImageJob = { ...job, status: 'succeeded', output: result.metadata, executionOutcome: result.executionOutcome, warnings: result.warnings ?? [] };
      const temporary = path.join(this.folder(job.id), 'image.tmp');
      await writeFile(temporary, result.bytes, { flag: 'wx' });
      await rename(temporary, path.join(this.folder(job.id), imageFile(saved)));
      await this.serial(async () => {
        const current = await this.read(job.id);
        if (current && (input.signal.aborted || current.status === 'cancelling')) {
          await this.write({ ...job, status: 'cancelled', error: 'cancelled', updatedAt: new Date().toISOString() }); return;
        }
        if (current?.status !== 'running') return;
        await this.write({ ...saved, updatedAt: new Date().toISOString() });
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
  /** Deletes a receipt and its image unless its attempt is still live (cancel first); a missing receipt is already gone. */
  async remove(id: string): Promise<{ deleted: true }> {
    return this.serial(async () => {
      // Only a live attempt can still write here; a receipt left nonterminal by a failed final write is stale.
      if (this.active.has(id)) throw new ImageError('image_not_deletable', 409);
      await rm(this.folder(id), { recursive: true, force: true });
      return { deleted: true as const };
    });
  }
  async image(id: string): Promise<{ bytes: Buffer; mimeType: ImageMetadata['mimeType'] }> {
    const job = await this.get(id);
    if (job.status !== 'succeeded' || !job.output) throw new ImageError('image_not_ready', 409);
    const file = await open(path.join(this.folder(id), imageFile(job)), 'r');
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
    return { bytes, mimeType: job.output.mimeType };
  }
  async close() {
    this.closing = true;
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((active) => active.done));
  }
}
