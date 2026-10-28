import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InteractionError } from './types.js';
import { record } from './validation.js';

interface AdmissionMarker { version: 1; identity: string; requiresHost: true; requiresPolicy: boolean }
class CorruptAdmissionMarker extends InteractionError {
  constructor() { super('interaction_conflict', 'Saved session admission could not be validated. Restore its valid backup before execution.'); }
}

/** Durable admission requirements only. No callbacks, prompts, answers or policy grants. */
export class SessionAdmissionStore {
  constructor(private readonly directory: string, private readonly replaceFile = renameSync) {}

  private paths(identity: string) {
    if (!identity || identity.length > 1024) throw new InteractionError('interaction_invalid', 'Invalid session admission identity.');
    const path = join(this.directory, `${createHash('sha256').update(identity).digest('hex')}.json`);
    return { path, backup: `${path}.bak` };
  }

  private read(path: string, identity: string): AdmissionMarker | undefined {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid marker');
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
      catch (error) { if (error instanceof SyntaxError) throw new CorruptAdmissionMarker(); throw error; }
      const value = record(parsed);
      if (!value || Object.keys(value).some(key => !['version', 'identity', 'requiresHost', 'requiresPolicy'].includes(key))
        || value.version !== 1 || value.identity !== identity || value.requiresHost !== true
        || typeof value.requiresPolicy !== 'boolean') throw new Error('Invalid marker');
      return value as unknown as AdmissionMarker;
    } catch (error) {
      if (error instanceof CorruptAdmissionMarker) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new InteractionError('interaction_conflict', 'Saved session admission could not be validated. Restore its valid backup before execution.');
    }
  }

  get(identity: string): AdmissionMarker | undefined {
    const { path, backup } = this.paths(identity);
    // The backup is written first and is at least as restrictive as the primary.
    const saved = this.read(backup, identity);
    let current: AdmissionMarker | undefined;
    try { current = this.read(path, identity); }
    catch (error) { if (!saved || !(error instanceof CorruptAdmissionMarker)) throw error; return saved; }
    if (!current) return saved;
    return { ...current, requiresPolicy: current.requiresPolicy || saved?.requiresPolicy === true };
  }

  private write(path: string, marker: AdmissionMarker): void {
    mkdirSync(this.directory, { recursive: true });
    if (lstatSync(this.directory).isSymbolicLink()) throw new Error('Admission directory must not be linked.');
    try { if (lstatSync(path).isSymbolicLink()) throw new Error('Admission marker must not be linked.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = `${path}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(marker) + '\n', 'utf8');
      fsyncSync(fd); closeSync(fd); fd = undefined;
      this.replaceFile(temporary, path);
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temporary, { force: true });
    }
  }

  /** Record before execution; compensate only when the caller confirms spawn failed. */
  stage(identity: string, requiresPolicy: boolean): () => void {
    const previous = this.get(identity);
    const marker: AdmissionMarker = { version: 1, identity, requiresHost: true,
      requiresPolicy: requiresPolicy || previous?.requiresPolicy === true };
    const { path, backup } = this.paths(identity);
    const restore = () => {
      if (previous) { this.write(backup, previous); this.write(path, previous); }
      else { rmSync(path, { force: true }); rmSync(backup, { force: true }); }
    };
    try { this.write(backup, marker); this.write(path, marker); }
    catch {
      try { restore(); } catch { /* Keep the restrictive backup if compensation fails. */ }
      throw new InteractionError('interaction_conflict', 'Session admission could not be saved. No new execution is admitted.');
    }
    return restore;
  }
}
