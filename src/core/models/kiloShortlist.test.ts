import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { ProviderModelCatalogService } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { KiloNativeSessionService } from '../../backends/cli/kilo/KiloNativeSessionService.js';
import { KiloProvider } from '../../backends/cli/providers/kilo.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';

describe('Kilo curated shortlist', () => {
  it('keeps six entries across refresh and sends Thinking only for the two approved combinations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-kilo-shortlist-'));
    try {
      const paths = createRuntimeTestPaths(root);
      ensureRuntimeTestDirs(paths);
      const env = createRuntimeTestEnv(root, {
        CATS_RUNTIME_PACKAGE_ROOT: fileURLToPath(new URL('../../../', import.meta.url)),
      });
      expect(loadCuratedModelCatalog({ env }).warnings).toEqual([]);
      const commandConfig = { path: 'kilo', runner: 'auto', runtime: { mode: 'native' } } as const;
      const config = {
        ...paths,
        providerDefaultTargets: { kilo: { backend: 'cli', instance: 'native' } },
        providerDefaultInstances: {},
        providerInstances: { kilo: { native: { id: 'native', providerName: 'kilo', commandConfig } } },
        providerCommands: { kilo: commandConfig },
        remoteProviderCatalog: { api: {}, local: {}, agent: {} },
      };
      const runner = { run: vi.fn(async () => { throw new Error('Shortlist must not probe the CLI'); }) };
      const service = new ProviderModelCatalogService(config as never, {
        env, kiloModelDiscoveryRunner: runner,
      });
      const expected = [
        { id: 'kilo/deepseek/deepseek-v4.1-flash', label: 'DeepSeek: DeepSeek V4.1 Flash' },
        { id: 'kilo/z-ai/glm-5.3-flash', label: 'Z.ai: GLM 5.3 Flash' },
        { id: 'kilo/moonshotai/kimi-k3', label: 'MoonshotAI: Kimi K3' },
        { id: 'kilo/minimax/minimax-m3', label: 'MiniMax: MiniMax M3' },
        { id: 'kilo/bytedance-seed/seed-2-1-turbo', label: 'ByteDance Seed: Seed 2.1 Turbo Thinking' },
        { id: 'kilo/google/gemini-3-pro-image', label: 'Google: Nano Banana Pro (Gemini 3 Pro Image) Thinking' },
      ];
      const immediate = service.getImmediateCatalog('kilo');
      expect(immediate.models).toEqual(expected);
      expect(immediate.defaultModel).toBeNull();
      expect(immediate.warnings).toEqual([]);
      expect(await service.getCatalog('kilo')).toEqual(immediate);
      expect(await service.getCatalog('kilo', undefined, { forceRefresh: true })).toEqual(immediate);
      expect(runner.run).not.toHaveBeenCalled();
      const knowledge = service.getImmediateAdvancedKnowledge('kilo');
      expect(knowledge.catalog.entries.map(({ id, label }) => ({ id, label }))).toEqual(expected);
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      expect(knowledge.catalog.defaultSelection).toEqual({
        entryId: expected[0].id, entryMode: 'explicit',
      });
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);

      const bodies: unknown[] = [];
      const launcher = vi.fn();
      const native = new KiloNativeSessionService({ command: 'kilo', launcher,
        fetchFn: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/global/health') return Response.json({ ok: true });
          if (url.pathname === '/permission' || url.pathname === '/question') return Response.json([]);
          if (url.pathname === '/session/test-session/message' && init?.method === 'POST') {
            bodies.push(JSON.parse(String(init.body)));
            return Response.json({ info: { id: 'reply', sessionID: 'test-session', role: 'assistant',
              providerID: 'kilo', modelID: 'test', time: { created: 1, completed: 2 } },
            parts: [{ type: 'text', text: 'Done.' }] });
          }
          throw new Error(`Unexpected request: ${url.pathname}`);
        },
      });
      try {
        const provider = new KiloProvider(native);
        for (const [index, { id }] of expected.entries()) {
          const resolved = resolveProviderSelection(knowledge, { entryMode: 'explicit', entryId: id });
          expect(resolved.execution.model).toBe(id);
          expect(resolved.resolution.controls).toEqual(index >= 4 ? { 'kilo.variant': 'thinking' } : undefined);
          const events = [];
          for await (const event of provider.streamTurn({ message: 'Test request' }, {
            cwd: root, resumeSessionId: 'test-session', model: resolved.execution.model,
            modelControls: resolved.resolution.controls,
          })) events.push(event);
          expect(events).toContainEqual({ type: 'text', text: 'Done.' });
          expect(bodies[index]).toEqual({
            model: { providerID: 'kilo', modelID: id.slice('kilo/'.length) },
            ...(index >= 4 ? { variant: 'thinking' } : {}),
            parts: [{ type: 'text', text: 'Test request' }],
          });
        }
        expect(launcher).not.toHaveBeenCalled();
      } finally {
        await native.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
