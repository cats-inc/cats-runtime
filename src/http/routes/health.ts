import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { RUNTIME_VERSION } from '../../startup.js';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  return c.json({
    service: 'cats-runtime',
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: RUNTIME_VERSION,
    startup: {
      mode: ctx.startup.mode,
      managedBy: ctx.startup.managedBy,
      readySignal: ctx.startup.readySignal,
      ready: ctx.startup.ready,
      pid: ctx.startup.pid,
      startedAt: ctx.startup.startedAt,
      address: ctx.startup.address,
    },
  });
});
