import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CursorProvider } from '../../backends/cli/providers/cursor.js';
import { ProviderModelCatalogService } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { normalizeCursorCuratedModelId } from './curatedModelCatalogNormalization.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from '../../../tests/support/runtimeTestPaths.js';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = JSON.parse(readFileSync(join(packageRoot,
  'docs/research/fixtures/cursor-2026.09.15-d2fe57e/selected-variants.redacted.json'), 'utf8')) as {
  presets: Array<{ id: string; label: string }>;
};

describe('Cursor fixed preset execution', () => {
  it('keeps six exact expressions through refresh, saved snapshots, resolution and argv', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-cursor-presets-'));
    try {
      const paths = createRuntimeTestPaths(root);
      ensureRuntimeTestDirs(paths);
      const env = createRuntimeTestEnv(root, { CATS_RUNTIME_PACKAGE_ROOT: packageRoot });
      mkdirSync(join(root, '.cursor'));
      writeFileSync(join(root, '.cursor', 'cli-config.json'), JSON.stringify({ model: { modelId: 'auto' } }));
      mkdirSync(join(paths.dataDir, 'provider-model-catalog'));
      writeFileSync(join(paths.dataDir, 'provider-model-catalog', 'snapshots.json'), JSON.stringify({
        version: 1,
        snapshots: [{ key: 'cursor:cli:native:injected', cachedAt: new Date().toISOString(),
          source: 'dynamic', models: [{ id: 'auto', label: 'Auto', default: true }], warnings: [] }],
        backoffs: [],
      }));
      const commandConfig = { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'native' } } as const;
      // Catalog-service fixture intentionally contains only the configuration
      // surfaces this service reads; it never launches a CLI or model turn.
      const config = {
        ...paths,
        providerDefaultTargets: { cursor: { backend: 'cli', instance: 'native' } },
        providerDefaultInstances: {},
        providerInstances: { cursor: { native: { id: 'native', providerName: 'cursor', commandConfig } } },
        providerCommands: { cursor: commandConfig },
        remoteProviderCatalog: { api: {}, local: {}, agent: {} },
      };
      const runner = { run: vi.fn(async () => { throw new Error('Shortlist must not enumerate upstream models'); }) };
      const service = new ProviderModelCatalogService(config as never, { env, cursorModelDiscoveryRunner: runner });
      const expected = evidence.presets.map(({ id, label }) => ({ id, label }));
      const initial = service.getImmediateCatalog('cursor');
      expect(initial.models).toEqual(expected);
      expect(initial.defaultModel).toBeNull();
      expect(initial.warnings).toEqual([]);
      expect(await service.getCatalog('cursor', undefined, { forceRefresh: true })).toEqual(initial);
      expect(runner.run).not.toHaveBeenCalled();

      const knowledge = service.getImmediateAdvancedKnowledge('cursor');
      expect(knowledge.catalog.entries.map(({ id, label }) => ({ id, label }))).toEqual(expected);
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.entries.every(entry => entry.default === undefined)).toBe(true);
      const provider = new CursorProvider();
      for (const preset of evidence.presets) {
        expect(normalizeCursorCuratedModelId({ name: preset.id, label: preset.label })).toBe(preset.id);
        const resolved = resolveProviderSelection(knowledge, { entryId: preset.id, entryMode: 'explicit' });
        expect(resolved.execution.model).toBe(preset.id);
        const argv = provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model });
        expect(argv.slice(argv.indexOf('--model'))).toEqual(['--model', preset.id]);
      }
      // Custom input uses the raw model path and must remain outside the menu.
      const custom = 'claude-opus-5[thinking=false,context=1m,effort=max,fast=true]';
      const customArgs = provider.buildSpawnArgs({ cwd: root, model: custom });
      expect(customArgs.slice(customArgs.indexOf('--model'))).toEqual(['--model', custom]);

      // Explicit refresh reloads edited curator data, rather than cached live results.
      const yaml = readFileSync(join(packageRoot, 'config/curated-model-catalogs.yaml.example'), 'utf8');
      writeFileSync(paths.curatedModelCatalogPath, yaml.replace('Cursor Grok 4.6 — Extra High Fast', 'Updated preset label'));
      expect((await service.getCatalog('cursor', undefined, { forceRefresh: true })).models[0].label)
        .toBe('Updated preset label');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
