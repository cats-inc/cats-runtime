import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export function isWithinRuntimeSessions(root: string, target: string): boolean {
  const suffix = relative(resolve(root), resolve(target));
  return Boolean(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
    && !isAbsolute(suffix);
}

/** The configured root may be an alias; descendants must not escape through links. */
export function assertUnlinkedRuntimeSessionPath(root: string, target: string): void {
  if (!isWithinRuntimeSessions(root, target)) throw new Error('Unsafe Runtime transcript path');
  let current = resolve(root);
  for (const segment of relative(current, resolve(target)).split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Linked Runtime transcript path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

export function runtimeCompactionDirectory(root: string, sessionId: string): string {
  if (!sessionId || /[<>:"/\\|?*\u0000-\u001f]/u.test(sessionId)
    || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?: *\.| *$)/iu.test(sessionId)
    || /[. ]$/u.test(sessionId)) {
    throw new Error('Unsafe Runtime compaction session id');
  }
  const directory = join(resolve(root), 'compactions', sessionId);
  assertUnlinkedRuntimeSessionPath(root, directory);
  return directory;
}
