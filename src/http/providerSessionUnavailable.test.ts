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

function fakeProvider(root: string, provider: 'grok' | 'codex'): { script: string; spawnLog: string } {
  const script = join(root, `fake-${provider}.cjs`);
  const spawnLog = join(root, 'spawns.jsonl');
  // Grok uses captured stdout; Codex reconstructs the archived error observed
  // in the installed Windows renderer, answering the actual resume request id.
  writeFileSync(script, [
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    ...(provider === 'grok' ? [
      `process.stdout.write(${JSON.stringify(captured)});`,
      'process.exitCode = 1;',
    ] : [
      "require('node:readline').createInterface({ input: process.stdin }).on('line', line => {",
      '  const frame = JSON.parse(line);',
      "  if (frame.method === 'initialize') process.stdout.write(JSON.stringify({ id: frame.id, result: {} }) + '\\n');",
      "  if (frame.method === 'thread/resume') process.stdout.write(JSON.stringify({ id: frame.id, error: {",
      `    code: -32600, message: ${JSON.stringify(`session ${staleNativeId} is archived. Run \`codex unarchive ${staleNativeId}\` to unarchive it first.`)}`,
      "  } }) + '\\n');",
      '});',
    ]),
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
  it.each(['grok', 'codex'] as const)('marks, closes and refuses the session after a %s resume failure', async provider => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-gone-e2e-'));
    let pool: WorkerPool | undefined;
    try {
      const { script, spawnLog } = fakeProvider(root, provider);
      const workspace = join(root, 'workspace');
      mkdirSync(workspace, { recursive: true });
      const config = loadConfig(createRuntimeTestEnv(root), {
        providerYaml: `providers: { ${provider}: { instances: { native: { path: ${JSON.stringify(process.execPath)}, `
          + `runner: direct, launch: { args: [${JSON.stringify(script)}] } } } } }`,
      });
      const registry = new SessionRegistry(join(root, 'data'), config.sessionBaseDir,
        config.providerDefaultInstances, config.providerDefaultTargets);
      pool = new WorkerPool(config, registry, {} as never, {} as never, {} as never, {} as never,
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

      const session = registry.create({ id: 'session-gone', providerName: provider, cwd: workspace });
      registry.setProviderSessionId(session.id, staleNativeId);
      pool.spawn(session.id, provider, { cwd: workspace, resumeSessionId: staleNativeId });
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
        text: expect.stringContaining(provider === 'grok' ? 'No saved copy of session' : 'is archived'),
      });
      expect(registry.get(session.id)).toMatchObject({
        status: 'closed',
        providerSessionUnavailable: { providerSessionId: staleNativeId },
      });
      expect(spawnedArgs(spawnLog)).toHaveLength(1);
      expect(spawnedArgs(spawnLog)[0]).toEqual(expect.arrayContaining(
        provider === 'grok' ? ['--resume', staleNativeId] : ['app-server'],
      ));

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
      expect(() => pool!.spawn(session.id, provider, { cwd: workspace, resumeSessionId: staleNativeId }))
        .toThrow('can no longer resume');
    } finally {
      pool?.killAll();
      cleanupTempDirWithRetries(root);
    }
  }, 30_000);
});
