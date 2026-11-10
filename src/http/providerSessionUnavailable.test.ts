import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../backends/cli/config.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { ProviderModelCatalogService } from '../core/models/providerModelCatalog.js';
import { createRuntimeStartupState } from '../startup.js';
import { createRuntimeApp } from './app.js';
import { createRuntimeTestEnv } from '../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../tests/tempCleanup.js';
import { parseCoreNdjson } from '../../tests/streamEventTestUtils.js';

// ADR-006 rule 8 end to end: the captured Grok stdout line travels through the real
// GrokProvider, WorkerProcess and WorkerPool listener, not a synthetic pool event.
const captured = readFileSync(new URL(
  '../../tests/fixtures/provider-captures/grok-1.0.77/resume-missing.error.redacted.ndjson',
  import.meta.url,
), 'utf8');
const staleNativeId = '11111111-2222-4333-8444-555555555555';

function fakeGrok(root: string): { script: string; spawnLog: string } {
  const script = join(root, 'fake-grok.cjs');
  const spawnLog = join(root, 'spawns.jsonl');
  // Prints Grok 1.0.77's answer to an unknown --resume id and exits 1, like the CLI.
  writeFileSync(script, [
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `process.stdout.write(${JSON.stringify(captured)});`,
    'process.exitCode = 1;',
  ].join('\n'));
  return { script, spawnLog };
}

function spawnedArgs(spawnLog: string): string[][] {
  try {
    return readFileSync(spawnLog, 'utf8').trim().split(/\r?\n/u).filter(Boolean)
      .map(line => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

describe('provider session unavailable through a real worker pool', () => {
  it('marks, closes and refuses the session after a captured Grok resume failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-gone-e2e-'));
    try {
      const { script, spawnLog } = fakeGrok(root);
      const workspace = join(root, 'workspace');
      mkdirSync(workspace, { recursive: true });
      const config = loadConfig(createRuntimeTestEnv(root), {
        providerYaml: `providers: { grok: { instances: { native: { path: ${JSON.stringify(process.execPath)}, `
          + `runner: direct, launch: { args: [${JSON.stringify(script)}] } } } } }`,
      });
      const registry = new SessionRegistry(join(root, 'data'), config.sessionBaseDir,
        config.providerDefaultInstances, config.providerDefaultTargets);
      const pool = new WorkerPool(config, registry, {} as never, {} as never, {} as never, {} as never,
        { getCachedAssessment: () => undefined } as never);
      const app = createRuntimeApp({
        config,
        startup: createRuntimeStartupState(),
        registry,
        pool,
        cursorNative: {} as CursorNativeSessionService,
        gooseNative: {} as GooseNativeSessionService,
        kiroNative: {} as KiroNativeSessionService,
        auggieSessions: {} as AuggieSessionService,
        opencodeNative: {} as OpencodeNativeSessionService,
        providerModelCatalog: {} as ProviderModelCatalogService,
      });

      const session = registry.create({ id: 'session-gone', providerName: 'grok', cwd: workspace });
      registry.setProviderSessionId(session.id, staleNativeId);
      pool.spawn(session.id, 'grok', { cwd: workspace, resumeSessionId: staleNativeId });
      registry.updateStatus(session.id, 'ready');
      const spawn = vi.spyOn(pool, 'spawn');

      const first = await app.request(`/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(first.status).toBe(200);
      const events = parseCoreNdjson(await first.text());
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'provider_session_unavailable',
        text: expect.stringContaining('No saved copy of session'),
      });
      expect(registry.get(session.id)).toMatchObject({
        status: 'closed',
        providerSessionUnavailable: { providerSessionId: staleNativeId },
      });
      expect(spawnedArgs(spawnLog)).toHaveLength(1);
      expect(spawnedArgs(spawnLog)[0]).toEqual(expect.arrayContaining(['--resume', staleNativeId]));

      const observed = await (await app.request(`/sessions/${session.id}/observe`)).json() as {
        session: { inspection: { lastRun: Record<string, unknown> } };
      };
      expect(observed.session.inspection.lastRun).toMatchObject({
        status: 'failed', errorCode: 'provider_session_unavailable',
      });

      const view = await (await app.request(`/sessions/${session.id}`)).json() as {
        controls: Record<string, boolean>;
        branching?: { capabilities?: { nativeFork?: Record<string, unknown> } };
      };
      expect(view.controls).toMatchObject({ canSend: false, canResume: false });

      for (const accept of ['application/x-ndjson', 'text/event-stream']) {
        const again = await app.request(`/sessions/${session.id}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept },
          body: JSON.stringify({ message: 'hello again' }),
        });
        expect(again.status).toBe(410);
        expect(await again.json()).toMatchObject({ code: 'provider_session_unavailable' });
      }
      const resumed = await app.request(`/sessions/${session.id}/resume`, { method: 'POST' });
      expect(resumed.status).toBe(410);

      // The stale id never reached the CLI again.
      expect(spawn).not.toHaveBeenCalled();
      expect(spawnedArgs(spawnLog)).toHaveLength(1);
      expect(() => pool.spawn(session.id, 'grok', { cwd: workspace, resumeSessionId: staleNativeId }))
        .toThrow('can no longer resume');
      pool.killAll();
    } finally {
      cleanupTempDirWithRetries(root);
    }
  }, 30_000);
});
