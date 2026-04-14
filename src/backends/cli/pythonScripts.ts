import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { RuntimeAdapter } from './runtime/runtime.js';
import { quoteForBash } from './runtime/runtime.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  cwd?: string;
  shell?: boolean;
  windowsHide?: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions,
) => Promise<CommandResult>;

interface RunPythonJsonScriptOptions {
  runtime: RuntimeAdapter;
  runner: CommandRunner;
  script: string;
  args: string[];
  commandLabel: string;
  parseLabel: string;
}

const PYTHON_TEMP_PREFIX = 'cats-runtime-python-';
let stalePythonTempCleanup: Promise<void> | null = null;

export async function runPythonJsonScript<T>(
  options: RunPythonJsonScriptOptions,
): Promise<T> {
  const stdout = await runPythonScript(options);
  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse ${options.parseLabel} JSON: ${String(error)}. Output: ${stdout}`,
    );
  }
}

async function runPythonScript(
  options: RunPythonJsonScriptOptions,
): Promise<string> {
  if (options.runtime.mode === 'native') {
    return runNativePythonScript(options);
  }

  const { command, args } = options.runtime.buildShellInvocation(
    buildEmbeddedPythonCommand(options.script, options.args),
  );
  return runCommand(options.runner, command, args, {}, options.commandLabel);
}

async function runNativePythonScript(
  options: RunPythonJsonScriptOptions,
): Promise<string> {
  await ensureStalePythonTempDirsCleaned();

  const tempDir = await mkdtemp(join(tmpdir(), buildPythonTempPrefix(process.pid)));
  try {
    const scriptPath = join(tempDir, 'script.py');
    await writeFile(scriptPath, options.script, 'utf8');
    const command = process.platform === 'win32'
      ? await resolveWindowsPythonCommand(options.runner)
      : {
        command: 'python3',
        argsPrefix: [] as string[],
        runnerOptions: {},
      };

    const stdout = await runCommand(
      options.runner,
      command.command,
      [...command.argsPrefix, scriptPath, ...options.args],
      command.runnerOptions,
      options.commandLabel,
    );
    return stdout;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function cleanupStalePythonTempDirs(
  rootDir: string = tmpdir(),
  currentPid: number = process.pid,
): Promise<void> {
  const entries = await readdir(rootDir, { withFileTypes: true });

  await Promise.all(entries
    .filter((entry) => entry.name.startsWith(PYTHON_TEMP_PREFIX))
    .filter((entry) => shouldRemovePythonTempEntry(entry.name, currentPid))
    .map(async (entry) => {
      try {
        await rm(join(rootDir, entry.name), { recursive: true, force: true });
      } catch {
        // Best-effort cleanup for temp dirs orphaned by previous process exits.
      }
    }));
}

async function runCommand(
  runner: CommandRunner,
  command: string,
  args: string[],
  runnerOptions: CommandRunnerOptions,
  commandLabel: string,
): Promise<string> {
  const result = await runner(command, args, runnerOptions);

  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    throw new Error(stderr || stdout || `${commandLabel} failed with code ${result.code}`);
  }

  return result.stdout;
}

function buildEmbeddedPythonCommand(script: string, args: string[]): string {
  const encoded = Buffer.from(script, 'utf-8').toString('base64');
  const python = `import base64; exec(base64.b64decode("${encoded}"))`;
  const quotedArgs = args.map(quoteForBash).join(' ');
  return `python3 -c ${quoteForBash(python)}${quotedArgs ? ` ${quotedArgs}` : ''}`;
}

async function ensureStalePythonTempDirsCleaned(): Promise<void> {
  stalePythonTempCleanup ??= cleanupStalePythonTempDirs().catch(() => undefined);
  await stalePythonTempCleanup;
}

function buildPythonTempPrefix(pid: number): string {
  return `${PYTHON_TEMP_PREFIX}${pid}-`;
}

function shouldRemovePythonTempEntry(name: string, currentPid: number): boolean {
  const pid = parsePythonTempPid(name);
  if (pid === null) {
    return true;
  }

  if (pid === currentPid) {
    return false;
  }

  return !isProcessAlive(pid);
}

function parsePythonTempPid(name: string): number | null {
  const match = /^cats-runtime-python-(\d+)-/.exec(name);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function resolveWindowsPythonCommand(
  runner: CommandRunner,
): Promise<{
  command: string;
  argsPrefix: string[];
  runnerOptions: CommandRunnerOptions;
}> {
  const directExecutable = resolveDirectWindowsPythonExecutable();
  if (directExecutable) {
    return directExecutable;
  }

  const probe = 'import sys; print(sys.executable)';
  const candidates: Array<{
    command: string;
    args: string[];
    runnerOptions: CommandRunnerOptions;
  }> = [
    {
      command: 'python3',
      args: ['-c', probe],
      runnerOptions: { windowsHide: true },
    },
    {
      command: 'python',
      args: ['-c', probe],
      runnerOptions: { windowsHide: true },
    },
    {
      command: 'py',
      args: ['-3', '-c', probe],
      runnerOptions: { windowsHide: true },
    },
  ];

  for (const candidate of candidates) {
    try {
      const result = await runner(candidate.command, candidate.args, candidate.runnerOptions);
      if (result.code !== 0) {
        continue;
      }

      const executable = extractPythonExecutable(result.stdout);
      if (executable) {
        return {
          command: executable,
          argsPrefix: [],
          runnerOptions: { windowsHide: true },
        };
      }
    } catch {
      continue;
    }
  }

  return {
    command: 'python3',
    argsPrefix: [],
    runnerOptions: { windowsHide: true },
  };
}

function resolveDirectWindowsPythonExecutable(): {
  command: string;
  argsPrefix: string[];
  runnerOptions: CommandRunnerOptions;
} | null {
  const pyenvExecutable = resolvePyenvWindowsPythonExecutable();
  if (pyenvExecutable) {
    return pyenvExecutable;
  }

  const pathExecutable = resolveWindowsPythonExecutableFromPath();
  if (pathExecutable) {
    return pathExecutable;
  }

  return null;
}

function resolvePyenvWindowsPythonExecutable(): {
  command: string;
  argsPrefix: string[];
  runnerOptions: CommandRunnerOptions;
} | null {
  const pyenvRoot = process.env.PYENV_ROOT || process.env.PYENV_HOME || process.env.PYENV;
  if (!pyenvRoot) {
    return null;
  }

  const version = (
    process.env.PYENV_VERSION
    || readOptionalFile(join(pyenvRoot, 'version'))
  )?.trim();
  if (!version) {
    return null;
  }

  for (const executableName of ['python.exe', 'python3.exe']) {
    const executablePath = join(pyenvRoot, 'versions', version, executableName);
    if (existsSync(executablePath)) {
      return {
        command: executablePath,
        argsPrefix: [],
        runnerOptions: { windowsHide: true },
      };
    }
  }

  return null;
}

function resolveWindowsPythonExecutableFromPath(): {
  command: string;
  argsPrefix: string[];
  runnerOptions: CommandRunnerOptions;
} | null {
  const pathDirs = (process.env.PATH || '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const dir of pathDirs) {
    for (const executableName of ['python3.exe', 'python.exe']) {
      const executablePath = join(dir, executableName);
      if (existsSync(executablePath)) {
        return {
          command: executablePath,
          argsPrefix: [],
          runnerOptions: { windowsHide: true },
        };
      }
    }

    const pyLauncher = join(dir, 'py.exe');
    if (existsSync(pyLauncher)) {
      return {
        command: pyLauncher,
        argsPrefix: ['-3'],
        runnerOptions: { windowsHide: true },
      };
    }
  }

  return null;
}

function extractPythonExecutable(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/python(?:\d+(?:\.\d+)?)?(\.exe)?$/i.test(line)) {
      return line;
    }
  }

  return null;
}

function readOptionalFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}
