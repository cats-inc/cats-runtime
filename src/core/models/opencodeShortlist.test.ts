import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { ProviderModelCatalogService } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';

describe('OpenCode curated shortlist', () => {
  it('keeps all six selections across refresh, ignores a configured default, and resolves exact IDs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-opencode-shortlist-'));
    try {
      const paths = createRuntimeTestPaths(root);
      ensureRuntimeTestDirs(paths);
      const env = createRuntimeTestEnv(root, {
        CATS_RUNTIME_PACKAGE_ROOT: fileURLToPath(new URL('../../../', import.meta.url)),
        XDG_CONFIG_HOME: join(root, '.config'),
      });
      mkdirSync(join(root, '.config', 'opencode'), { recursive: true });
      writeFileSync(join(root, '.config', 'opencode', 'opencode.json'),
        JSON.stringify({ model: 'openai/custom-configured-model' }));
      expect(loadCuratedModelCatalog({ env }).warnings).toEqual([]);
      const commandConfig = { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } } as const;
      const config = {
        ...paths,
        providerDefaultTargets: { opencode: { backend: 'cli', instance: 'native' } },
        providerDefaultInstances: {},
        providerInstances: { opencode: { native: { id: 'native', providerName: 'opencode', commandConfig } } },
        providerCommands: { opencode: commandConfig },
        remoteProviderCatalog: { api: {}, local: {}, agent: {} },
      };
      const runner = { run: vi.fn(async () => { throw new Error('Shortlist must not probe the CLI'); }) };
      const service = new ProviderModelCatalogService(config as never, {
        env, opencodeModelDiscoveryRunner: runner,
      });
      const expected = [
        { id: 'opencode-go/union-alpha', label: 'Union Alpha Free' },
        { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
        { id: 'opencode-go/hy4-preview', label: 'Hy4 preview' },
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM-5.3-Flash' },
        { id: 'opencode-go/qwen3.8-flash', label: 'Qwen3.8 Flash' },
        { id: 'opencode-go/minimax-m3', label: 'MiniMax-M3' },
      ];
      const immediate = service.getImmediateCatalog('opencode');
      expect(immediate.models).toEqual(expected);
      expect(immediate.defaultModel).toBeNull();
      expect(immediate.warnings).toEqual([]);
      expect(await service.getCatalog('opencode')).toEqual(immediate);
      expect(await service.getCatalog('opencode', undefined, { forceRefresh: true })).toEqual(immediate);
      expect(runner.run).not.toHaveBeenCalled();
      const knowledge = service.getImmediateAdvancedKnowledge('opencode');
      expect(knowledge.catalog.entries.map(({ id, label }) => ({ id, label }))).toEqual(expected);
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      expect(knowledge.catalog.defaultSelection).toBeNull();
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      for (const { id } of expected) {
        const resolved = resolveProviderSelection(knowledge, { entryMode: 'explicit', entryId: id });
        expect(resolved.execution.model).toBe(id);
        expect(resolved.resolution.controls).toBeUndefined();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
