export interface RuntimeStartupTrace {
  enabled: boolean;
  trace(phase: string, details?: Record<string, unknown>): void;
}

interface RuntimeStartupTraceOptions {
  env?: Readonly<NodeJS.ProcessEnv>;
  now?: () => Date;
  write?: (line: string) => void;
  startedAtMs?: number;
  pid?: number;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

export function isRuntimeStartupTraceEnabled(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): boolean {
  return parseBooleanEnv(env.CATS_RUNTIME_STARTUP_TRACE);
}

export function createRuntimeStartupTrace(
  options: RuntimeStartupTraceOptions = {},
): RuntimeStartupTrace {
  const env = options.env ?? process.env;
  const enabled = isRuntimeStartupTraceEnabled(env);
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line: string) => {
    process.stderr.write(line);
  });
  const startedAtMs = options.startedAtMs ?? Date.now();
  const pid = options.pid ?? process.pid;

  return {
    enabled,
    trace(phase, details = {}) {
      if (!enabled) {
        return;
      }

      const timestamp = now();
      write(`${JSON.stringify({
        event: 'runtime.startup_trace',
        service: 'cats-runtime',
        pid,
        phase,
        timestamp: timestamp.toISOString(),
        elapsedMs: Math.max(0, timestamp.getTime() - startedAtMs),
        details,
      })}\n`);
    },
  };
}
