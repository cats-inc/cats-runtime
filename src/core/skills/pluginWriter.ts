import { randomUUID } from 'node:crypto';
import { closeSync, linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/** A dead writer can be reclaimed once. The retained hard-link tombstone makes
 * concurrent reclaimers lose without unlinking a replacement writer's lock. */
export function acquirePluginWriter(lock: string): () => void {
  let fd: number;
  try { fd = openSync(lock, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = JSON.parse(readFileSync(lock, 'utf8')) as { pid: number; token: string };
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !/^[a-f0-9-]{36}$/.test(owner.token)) throw new Error('Unverified Plugin writer; preserve lock for recovery.');
    let dead = false;
    try { process.kill(owner.pid, 0); } catch (probe) { dead = (probe as NodeJS.ErrnoException).code === 'ESRCH'; }
    if (!dead) throw new Error('Plugin writer is active or cannot be verified.');
    const retired = `${lock}.${owner.token}.retired`;
    linkSync(lock, retired);
    if (JSON.parse(readFileSync(retired, 'utf8')).token !== owner.token) throw new Error('Plugin writer changed during recovery.');
    unlinkSync(lock);
    fd = openSync(lock, 'wx');
  }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token: randomUUID() })); }
  catch (error) { closeSync(fd); throw error; }
  return () => { closeSync(fd); unlinkSync(lock); };
}
