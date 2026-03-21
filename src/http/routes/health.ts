import { Hono } from 'hono';
import { type RuntimeRouteEnv } from './diagnosticsSupport.js';
import {
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
  getRuntimeLifecycleContract,
  getRuntimeOperationalStatus,
  getRuntimeReadinessSnapshot,
  getRuntimeShutdownContract,
} from '../../startup.js';

export const healthRoutes = new Hono<RuntimeRouteEnv>();

healthRoutes.get('/health', (c) => {
  const ctx = c.get('ctx');
  const readiness = getRuntimeReadinessSnapshot(ctx.startup);
  const runtime = getRuntimeOperationalStatus(ctx.startup);
  return c.json({
    service: RUNTIME_SERVICE_NAME,
    status: runtime.status,
    summary: runtime.summary,
    timestamp: new Date().toISOString(),
    version: RUNTIME_VERSION,
    contract: getRuntimeLifecycleContract(ctx.startup),
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
    shutdown: getRuntimeShutdownContract(ctx.startup),
  });
});
