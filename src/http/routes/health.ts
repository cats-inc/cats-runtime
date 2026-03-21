import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import {
  RUNTIME_LIFECYCLE_EVENTS,
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
  getRuntimeReadinessSnapshot,
} from '../../startup.js';

type RuntimeRouteEnv = {
  Variables: {
    ctx: AppContext;
  };
};

export const healthRoutes = new Hono<RuntimeRouteEnv>();

healthRoutes.get('/health', (c) => {
  const ctx = c.get('ctx');
  const readiness = getRuntimeReadinessSnapshot(ctx.startup);
  return c.json({
    service: RUNTIME_SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: RUNTIME_VERSION,
    contract: {
      startup: ctx.startup.contractVersion,
      readinessPath: ctx.startup.readinessPath,
      lifecycleEvents: [...RUNTIME_LIFECYCLE_EVENTS],
    },
    readiness,
    startup: {
      contractVersion: ctx.startup.contractVersion,
      mode: ctx.startup.mode,
      managedBy: ctx.startup.managedBy,
      phase: ctx.startup.phase,
      readySignal: ctx.startup.readySignal,
      ready: readiness.ready,
      pid: ctx.startup.pid,
      startedAt: ctx.startup.startedAt,
      address: ctx.startup.address,
      shutdownReason: ctx.startup.shutdownReason,
      lastEvent: ctx.startup.lastEvent,
    },
  });
});
