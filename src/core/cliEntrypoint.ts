import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isDirectCliEntrypoint(
  importMetaUrl: string,
  argvPath: string | undefined,
  resolveRealPath: (path: string) => string = realpathSync,
): boolean {
  if (!argvPath) {
    return false;
  }

  const argvHref = pathToFileURL(argvPath).href;
  if (importMetaUrl === argvHref) {
    return true;
  }

  try {
    return importMetaUrl === pathToFileURL(resolveRealPath(argvPath)).href;
  } catch {
    return false;
  }
}
