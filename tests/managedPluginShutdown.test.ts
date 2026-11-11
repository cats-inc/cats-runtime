import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';
import { resolveRuntimeSkillManifest } from '../src/core/skills/catalog.js';
import { AGENCY_DIGEST, AGENCY_SKILLS, observeManagedPlugin, registerManagedPlugin, type PluginDescriptor } from '../src/core/skills/managedPlugins.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';

for (const timeout of [false, true]) {
  it(`waits for actual native close during shutdown and retains receipts on timeout (${timeout})`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-plugin-shutdown-'));
    const ready = join(root, 'ready'); const child = join(root, 'fake-native.cjs');
    writeFileSync(child, `require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready');
      process.on('SIGTERM', () => setTimeout(() => process.exit(0), 150));
      setInterval(() => {}, 100); setTimeout(() => process.exit(0), 3000);`);
    const config = loadConfig(createRuntimeTestEnv(root), { providerYaml: 'providers: { claude: { instances: { native: {} } } }' });
    Object.assign(config.providerInstances.claude!.native.commandConfig, { path: process.execPath, args: [child], runner: 'direct' });
    const runtime = createRuntimeServer(config, { compatibility: { getCachedAssessment: () => undefined, setTargetGuard: () => {} } as never });
    const descriptor: PluginDescriptor = { protocol: 1, hostId: randomUUID(), id: 'agency-agents', version: '0.1.0',
      digest: AGENCY_DIGEST, generation: 1, enabled: true, skills: Object.keys(AGENCY_SKILLS).map(id => ({ id,
        markdown: readFileSync(new URL(`./fixtures/managed-plugins/${id.split('/').at(-1)}.md`, import.meta.url), 'utf8') })) };
    registerManagedPlugin(config.sessionBaseDir, descriptor);
    resolveRuntimeSkillManifest({ requestedSkills: [descriptor.skills[0].id], strict: true }, {
      sessionBaseDir: config.sessionBaseDir, sessionId: 'selected-cat', providerName: 'claude', providerBackend: 'cli', cwd: root,
    });
    runtime.context.registry.create({ id: 'selected-cat', providerName: 'claude', cwd: root });
    const worker = runtime.context.pool.spawn('selected-cat', 'claude', { cwd: root }, 'native');
    const closed = once(worker, 'process-stopped');
    try {
      await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
      expect(observeManagedPlugin(config.sessionBaseDir).pendingRuns).toHaveLength(1);
      if (timeout) {
        expect(await runtime.context.pool.killAllAndWait(1)).toBe(false);
        expect(worker.processRunning).toBe(true);
        expect(observeManagedPlugin(config.sessionBaseDir).pendingRuns).toHaveLength(1);
        expect(() => runtime.context.pool.spawn('new-cat', 'claude', { cwd: root }, 'native')).toThrow(/shutting down/);
        expect(() => runtime.context.pool.reserveExternalExecution('external', 'claude', 'native', () => {})).toThrow(/shutting down/);
        await closed;
      }
      await runtime.close();
      expect(worker.processRunning).toBe(false);
      expect(observeManagedPlugin(config.sessionBaseDir).pendingRuns).toHaveLength(0);
      vi.resetModules();
      const restarted = await import('../src/core/skills/managedPlugins.js');
      expect(restarted.observeManagedPlugin(config.sessionBaseDir).restorable).toBe(true);
      restarted.restoreManagedPlugin(config.sessionBaseDir, descriptor);
      expect(() => restarted.assertManagedPluginContext(config.sessionBaseDir, 'selected-cat')).not.toThrow();
    } finally {
      worker.kill(); await closed; await runtime.close(); rmSync(root, { recursive: true, force: true });
    }
  });
}
