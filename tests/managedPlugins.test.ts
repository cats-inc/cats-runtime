import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createRuntimeTestPaths, createRuntimeTestEnv } from './support/runtimeTestPaths.js';
import { loadConfig } from '../src/core/config.js';
import { assertManagedPluginContext, AGENCY_DIGEST, AGENCY_SKILLS, bindManagedNativeIdentity, finishManagedPluginRun, inheritManagedPluginContext, listManagedPluginSkills, observeManagedPlugin, recordManagedPluginRun, registerManagedPlugin, renewManagedPlugin, type PluginDescriptor } from '../src/core/skills/managedPlugins.js';
import { buildRuntimeSkillInstructionOverlay, resolveRuntimeSkillManifest } from '../src/core/skills/catalog.js';
import { hydrateSessionState } from '../src/core/hydration/sessionHydration.js';
import { managedPluginRoutes, stopFencedPluginRuns } from '../src/http/routes/managedPlugins.js';
import type { AppContext } from '../src/http/app.js';
import { WorkerPool } from '../src/backends/cli/pool/WorkerPool.js';
import { SessionRegistry } from '../src/backends/cli/pool/SessionRegistry.js';

const skills = Object.keys(AGENCY_SKILLS).map(id => ({ id, markdown: readFileSync(new URL(`./fixtures/managed-plugins/${id.split('/').at(-1)}.md`, import.meta.url), 'utf8') }));
describe('managed Plugin pilot', () => {
  let temporary: string; let root: string; let descriptor: PluginDescriptor;
  beforeEach(() => {
    temporary = mkdtempSync(join(tmpdir(), 'cats-plugin-test-'));
    root = createRuntimeTestPaths(temporary).sessionBaseDir;
    descriptor = { protocol: 1, hostId: randomUUID(), id: 'agency-agents', version: '0.1.0', digest: AGENCY_DIGEST, generation: 1, enabled: true, skills };
  });
  afterEach(() => { vi.useRealTimers(); rmSync(temporary, { recursive: true, force: true }); });
  const resolveSkill = (root: string, id = 'session-a') => resolveRuntimeSkillManifest({ requestedSkills: [skills[0].id], strict: true }, { sessionBaseDir: root, sessionId: id, providerName: 'codex', providerBackend: 'cli', cwd: temporary });
  it('resolves the pinned content as instructions, then blocks cache rebuild and retained contexts after fencing', () => {
    registerManagedPlugin(root, descriptor);
    const state = resolveSkill(root)!;
    expect(state.delivery).toMatchObject({ mode: 'instructions', status: 'applied' });
    expect(listManagedPluginSkills(root)).toHaveLength(2);
    expect(buildRuntimeSkillInstructionOverlay(state)).toContain('Code Reviewer');
    registerManagedPlugin(root, { ...descriptor, generation: 2, enabled: false, skills: [] });
    expect(listManagedPluginSkills(root)).toHaveLength(0);
    expect(() => buildRuntimeSkillInstructionOverlay(state)).toThrow(/unavailable Plugin/);
    expect(() => assertManagedPluginContext(root, 'session-a')).toThrow(/new conversation/);
    expect(() => renewManagedPlugin(root, descriptor)).toThrow();
  });
  it('rejects unreviewed bytes, expired generation resurrection and other profiles', () => {
    expect(() => registerManagedPlugin(root, { ...descriptor, skills: [{ ...skills[0], markdown: 'evil' }, skills[1]] })).toThrow();
    registerManagedPlugin(root, descriptor);
    expect(() => registerManagedPlugin(root, { ...descriptor, hostId: randomUUID(), generation: 2 })).toThrow();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31_000);
    expect(() => renewManagedPlugin(root, descriptor)).toThrow();
    expect(() => registerManagedPlugin(root, descriptor)).toThrow(/Generation/);
    registerManagedPlugin(root, { ...descriptor, generation: 2 });
    expect(listManagedPluginSkills(root)).toHaveLength(2);
  });
  it('does not admit a forged stopRequested descriptor or clear a pending execution on fence', () => {
    registerManagedPlugin(root, descriptor); resolveSkill(root); recordManagedPluginRun(root, 'session-a', 'execution-a');
    registerManagedPlugin(root, { ...descriptor, generation: 2, enabled: false, skills: [], stopRequested: true } as PluginDescriptor);
    expect(observeManagedPlugin(root)).toMatchObject({ stopAuthorized: false, pendingRuns: [{ runId: 'execution-a' }] });
    finishManagedPluginRun(root, 'session-a', 'different-execution');
    expect(observeManagedPlugin(root).pendingRuns).toHaveLength(1);
    finishManagedPluginRun(root, 'session-a', 'execution-a');
    expect(observeManagedPlugin(root).pendingRuns).toHaveLength(0);
  });
  it('inherits exposure even after reset removed hydration and requested skills', async () => {
    registerManagedPlugin(root, descriptor); resolveSkill(root);
    await hydrateSessionState({ trigger: 'fork', sourceSessionId: 'session-a', sessionId: 'child', providerName: 'codex', providerBackend: 'cli', runtimeCwd: temporary, sessionBaseDir: root });
    registerManagedPlugin(root, { ...descriptor, generation: 2, enabled: false, skills: [] });
    expect(() => assertManagedPluginContext(root, 'child')).toThrow();
    expect(() => inheritManagedPluginContext(root, 'session-a', 'child-2')).toThrow();
  });
  it('binds rediscovered native contexts to the durable exposure and fails closed after restart', async () => {
    registerManagedPlugin(root, descriptor); resolveSkill(root); recordManagedPluginRun(root, 'session-a', 'execution-a');
    const session = { id: 'session-a', providerName: 'codex', providerBackend: 'cli', providerInstanceId: 'native' };
    bindManagedNativeIdentity(root, session, 'native-session');
    registerManagedPlugin(root, { ...descriptor, generation: 2, enabled: false, skills: [] });
    expect(() => bindManagedNativeIdentity(root, { ...session, id: 'rediscovered' }, 'native-session')).toThrow();
    vi.resetModules();
    const restarted = await import('../src/core/skills/managedPlugins.js');
    expect(restarted.observeManagedPlugin(root).pendingRuns[0].orphaned).toBe(true);
    expect(() => restarted.bindManagedNativeIdentity(root, { ...session, id: 'unknown' }, 'unknown-native')).toThrow(/unknown native lineage/);
    expect(() => restarted.bindManagedNativeIdentity(root, { ...session, id: 'clean' }, 'fresh-native', true)).not.toThrow();
    expect(() => restarted.bindManagedNativeIdentity(root, { ...session, id: 'clean-rediscovered' }, 'fresh-native')).not.toThrow();
  });
  it('recovers only a verifiably dead writer and rejects damaged state', () => {
    registerManagedPlugin(root, descriptor);
    writeFileSync(join(root, '.managed-plugins', 'writer.lock'), JSON.stringify({ pid: 2147483647, token: randomUUID() }));
    renewManagedPlugin(root, descriptor);
    writeFileSync(join(root, '.managed-plugins', 'state.json'), '{bad');
    expect(() => listManagedPluginSkills(root)).toThrow(/cannot be verified/);
  });
  it('releases a lifetime receipt when direct-launch validation proves no owned process was started', () => {
    const config = loadConfig(createRuntimeTestEnv(temporary), { providerYaml: 'providers: { codex: { instances: { native: {} } } }' });
    config.providerInstances.codex!.native.commandConfig.path = 'cmd.exe';
    config.providerInstances.codex!.native.commandConfig.runner = 'direct';
    const registry = new SessionRegistry(undefined, root);
    const pool = new WorkerPool(config, registry, {} as never, {} as never, {} as never, {} as never, {} as never, { getCachedAssessment: () => undefined } as never);
    registerManagedPlugin(root, descriptor); resolveSkill(root);
    expect(() => pool.spawn('session-a', 'codex', { cwd: temporary }, 'native')).toThrow(/direct native/);
    expect(observeManagedPlugin(root).pendingRuns).toHaveLength(0);
  });
  it('requires explicit auth and policy; changed impact leaves the fence but does not stop work', async () => {
    const config = loadConfig(createRuntimeTestEnv(temporary, { CATS_PLUGIN_POLICY: 'internal-experiment' }));
    config.apiKey = 'test-plugin-key';
    const close = vi.fn();
    const ctx = { config, registry: { get: () => ({ id: 'session-a' }) }, runtime: { close } } as unknown as AppContext;
    const app = new Hono<{ Variables: { ctx: AppContext } }>(); app.use('*', async (c, next) => { c.set('ctx', ctx); await next(); }); app.route('/', managedPluginRoutes);
    const call = (path: string, method: string, body?: unknown) => app.request(`/plugins/managed${path}`, { method, headers: { Authorization: 'Bearer test-plugin-key', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await app.request('/plugins/managed')).status).toBe(401);
    expect((await call('', 'PUT', descriptor)).status).toBe(200);
    resolveSkill(root); recordManagedPluginRun(root, 'session-a', 'execution-a');
    const fenced = { ...descriptor, generation: 2, enabled: false, skills: [] };
    expect((await call('', 'PUT', fenced)).status).toBe(200);
    await stopFencedPluginRuns(ctx); expect(close).not.toHaveBeenCalled();
    expect((await call('/stop', 'POST', { ...fenced, confirmedSessions: [], confirmedRuns: [] })).status).toBe(409);
    expect((await call('/stop', 'POST', { ...fenced, confirmedSessions: ['session-a'], confirmedRuns: ['execution-a'] })).status).toBe(200);
    expect(close).toHaveBeenCalledOnce(); expect(observeManagedPlugin(root).pendingRuns).toHaveLength(1);
    config.apiKey = '';
    expect((await call('', 'GET')).status).toBe(401);
  });

  it('supports the dedicated management credential without enabling default-off hosts', async () => {
    const make = (enabled: boolean) => {
      const config = loadConfig(createRuntimeTestEnv(temporary, { CATS_PLUGIN_MANAGEMENT_KEY: 'isolated-management', ...(enabled ? { CATS_PLUGIN_POLICY: 'internal-experiment' } : {}) }));
      const app = new Hono<{ Variables: { ctx: AppContext } }>();
      app.use('*', async (c, next) => { c.set('ctx', { config } as AppContext); await next(); });
      app.route('/', managedPluginRoutes); return app;
    };
    const request = { headers: { Authorization: 'Bearer isolated-management' } };
    expect((await make(false).request('/plugins/managed', request)).status).toBe(403);
    expect((await make(true).request('/plugins/managed', request)).status).toBe(200);
    expect((await make(true).request('/plugins/managed')).status).toBe(401);
  });
});
