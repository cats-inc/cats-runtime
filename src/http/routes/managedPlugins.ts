import { Hono } from 'hono';
import { getRuntimeConfigEnv } from '../../core/config.js';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import { observeManagedPlugin, registerManagedPlugin, renewManagedPlugin, authorizeManagedPluginStop, type PluginDescriptor, type PluginIdentity } from '../../core/skills/managedPlugins.js';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const managedPluginRoutes = new Hono<{ Variables: { ctx: AppContext } }>();
export function managedPluginPolicyEnabled(ctx: AppContext): boolean {
  const env = getRuntimeConfigEnv(ctx.config);
  return env.CATS_PLUGIN_POLICY === 'internal-experiment' && Boolean(env.CATS_RUNTIME_DIR)
    && resolve(env.CATS_RUNTIME_DIR!) !== resolve(join(homedir(), '.cats', 'runtime'));
}
export async function stopFencedPluginRuns(ctx: AppContext): Promise<void> {
  const observation = observeManagedPlugin(ctx.config.sessionBaseDir);
  if (!observation.stopAuthorized) return;
  const runtime = getRuntimeSessionManager(ctx);
  for (const run of observation.pendingRuns) {
    if (run.orphaned) continue;
    const session = ctx.registry.get(run.sessionId);
    if (session) await runtime.close(session);
  }
}
managedPluginRoutes.use('/plugins/*', async (c, next) => {
  const ctx = c.get('ctx') as AppContext;
  const key = ctx.config.apiKey || getRuntimeConfigEnv(ctx.config).CATS_PLUGIN_MANAGEMENT_KEY;
  if (!key || c.req.header('Authorization') !== `Bearer ${key}`) return c.json({ error: 'Configured bearer authentication is required.' }, 401);
  if (!managedPluginPolicyEnabled(ctx)) return c.json({ error: 'Managed Plugins require an isolated internal experiment profile.' }, 403);
  await next();
});
managedPluginRoutes.get('/plugins/managed', c => {
  const ctx = c.get('ctx') as AppContext;
  try { return c.json(observeManagedPlugin(ctx.config.sessionBaseDir)); }
  catch (error) { return c.json({ error: String(error) }, 409); }
});
managedPluginRoutes.on(['PUT', 'POST'], ['/plugins/managed', '/plugins/managed/renew', '/plugins/managed/stop'], async c => {
  const ctx = c.get('ctx') as AppContext;
  try {
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ error: 'Descriptor required.' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128_000) { await reader.cancel(); return c.json({ error: 'Descriptor too large.' }, 413); }
      chunks.push(chunk.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PluginDescriptor & { confirmedSessions?: string[]; confirmedRuns?: string[] };
    const root = ctx.config.sessionBaseDir;
    if (c.req.path.endsWith('/renew')) renewManagedPlugin(root, body as PluginIdentity);
    else if (c.req.path.endsWith('/stop')) {
      const state = observeManagedPlugin(root);
      if (state.plugin?.enabled || state.plugin?.hostId !== body.hostId || state.plugin?.generation !== body.generation) return c.json({ error: 'Fence this generation before stopping work.' }, 409);
      if (state.affectedSessions.some(id => !body.confirmedSessions?.includes(id))
        || state.pendingRuns.some(run => !body.confirmedRuns?.includes(run.runId))) return c.json({ ...state, error: 'Impact changed; confirm the updated sessions and runs.', confirmationRequired: true }, 409);
      authorizeManagedPluginStop(root);
      await stopFencedPluginRuns(ctx);
    } else if (c.req.method === 'PUT') registerManagedPlugin(root, body);
    else return c.json({ error: 'Method not allowed.' }, 405);
    return c.json(observeManagedPlugin(root));
  } catch (error) { return c.json({ error: String(error) }, 409); }
});
