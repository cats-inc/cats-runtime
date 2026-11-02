import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export function sameHostedWorkspace(expected: string, reported: unknown): boolean {
  if (typeof reported !== 'string' || !isAbsolute(reported)) return false;
  if (relative(resolve(expected), resolve(reported)) === '') return true;
  try { return relative(realpathSync(expected), realpathSync(reported)) === ''; }
  catch { return false; }
}
