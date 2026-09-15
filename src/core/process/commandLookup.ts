import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, resolve } from 'node:path';

/** Resolve an executable in a child environment without running it or changing process.env. */
export async function lookupNativeCommand(
  command: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ available: boolean; resolvedPath?: string }> {
  const cwd = resolve(options.cwd || process.cwd());
  const env = { ...process.env, ...options.env };
  const readEnv = (name: string) => {
    const key = process.platform === 'win32'
      ? Object.keys(env).sort().find((key) => key.toUpperCase() === name)
      : name;
    return key ? env[key] : undefined;
  };
  const explicit = isAbsolute(command) || /[\\/]/.test(command);
  const dirs = explicit ? [''] : [
    ...(process.platform === 'win32' ? [cwd] : []),
    ...(readEnv('PATH') || '').split(delimiter).map((dir) => dir.replace(/^"|"$/g, '')),
  ];
  const extensions = process.platform === 'win32' && !extname(command)
    ? ['', ...(readEnv('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';')]
    : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = resolve(cwd, dir, `${command}${extension}`);
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return { available: true, resolvedPath: candidate };
      } catch {
        // Try the next PATH entry. Missing metadata never launches the command.
      }
    }
  }
  return { available: false };
}
