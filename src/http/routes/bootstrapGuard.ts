import type { Context, Next } from 'hono';
import type { AppContext } from '../app.js';

const GUARDED_PREFIXES = [
  '/sessions',
  '/messages',
  '/mcp',
  '/observe',
  '/history',
  '/codex',
  '/cursor',
  '/kiro',
  '/auggie',
  '/opencode',
  '/browse',
  '/delivery',
  '/wakeup',
];

export function bootstrapGuard() {
  return async (c: Context, next: Next) => {
    const ctx = c.get('ctx' as never) as AppContext | undefined;
    if (!ctx?.startup?.bootstrapRequired) {
      return await next();
    }

    const path = c.req.path;
    const guarded = GUARDED_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (!guarded) {
      return await next();
    }

    return c.json(
      {
        error: 'runtime_bootstrap_required',
        message: 'Runtime is in bootstrap mode. Complete provider setup before using session APIs.',
      },
      409,
    );
  };
}
