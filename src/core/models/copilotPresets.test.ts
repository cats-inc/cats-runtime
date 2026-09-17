import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CopilotProvider } from '../../backends/cli/providers/copilot.js';
import { ProviderModelCatalogService } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { normalizeCopilotModelName } from './curatedModelCatalogNormalization.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from '../../../tests/support/runtimeTestPaths.js';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const presets = [
  ['gpt-5.6-terra', 'GPT-5.6 Terra', 'medium'],
  ['claude-sonnet-5', 'Claude Sonnet 5', 'medium'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'medium'],
  ['grok-4.6', 'Grok 4.6', 'medium'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', 'medium'],
  ['kimi-k3', 'Kimi K3', 'high'],
] as const;

describe('Copilot fixed shortlist', () => {
  it('preserves menu membership/default and resolves each fixed effort without editable controls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-copilot-presets-'));
    try {
      const paths = createRuntimeTestPaths(root);
      ensureRuntimeTestDirs(paths);
      const env = createRuntimeTestEnv(root, { CATS_RUNTIME_PACKAGE_ROOT: packageRoot });
      mkdirSync(join(paths.dataDir, 'provider-model-catalog'));
      writeFileSync(join(paths.dataDir, 'provider-model-catalog', 'snapshots.json'), JSON.stringify({
        version: 1,
        snapshots: [{ key: 'copilot:cli:native:injected', cachedAt: new Date().toISOString(),
          source: 'dynamic', models: [{ id: 'gpt-5.4', label: 'Old model', default: true }], warnings: [] }],
        backoffs: [],
      }));
      const commandConfig = { path: 'copilot', runner: 'auto', model: 'gpt-5.4',
        runtime: { mode: 'native' } } as const;
      // Service-only fixture: no CLI process, authentication or inference.
      const config = {
        ...paths,
        providerDefaultTargets: { copilot: { backend: 'cli', instance: 'native' } },
        providerDefaultInstances: {},
        providerInstances: { copilot: { native: { id: 'native', providerName: 'copilot', commandConfig } } },
        providerCommands: { copilot: commandConfig },
        remoteProviderCatalog: { api: {}, local: {}, agent: {} },
      };
      const service = new ProviderModelCatalogService(config as never, { env });
      const initial = service.getImmediateCatalog('copilot');
      expect(initial.models.map(model => model.id)).toEqual(presets.map(([id]) => id));
      expect(initial.defaultModel).toBe('gpt-5.6-terra');
      expect(initial.models.filter(model => model.default).map(model => model.id)).toEqual(['gpt-5.6-terra']);
      expect(initial.warnings).toEqual([]);
      expect(await service.getCatalog('copilot', undefined, { forceRefresh: true })).toEqual(initial);

      const knowledge = service.getImmediateAdvancedKnowledge('copilot');
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      expect(knowledge.catalog.entries.every(entry => entry.controlDefaults === undefined)).toBe(true);
      expect(knowledge.catalog.defaultSelection).toEqual({ entryId: 'gpt-5.6-terra', entryMode: 'explicit' });
      expect(resolveProviderSelection(knowledge, knowledge.catalog.defaultSelection!).resolution.controls)
        .toEqual({ 'copilot.reasoning_effort': 'medium' });

      const provider = new CopilotProvider();
      for (const [id, name, effort] of presets) {
        expect(normalizeCopilotModelName(name)).toBe(id);
        expect(knowledge.catalog.entries.find(entry => entry.id === id)?.label)
          .toBe(`${name} — ${effort === 'high' ? 'High' : 'Medium'}`);
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        expect(resolved.resolution.controls).toEqual({ 'copilot.reasoning_effort': effort });
        const argv = provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
          modelControls: resolved.resolution.controls });
        expect(argv.slice(argv.indexOf('--model'))).toEqual(['--model', id, '--effort', effort]);
        expect(() => resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit',
          controls: { 'copilot.reasoning_effort': 'low' } })).toThrow('not supported');
      }
      const custom = 'custom-provider/private-model';
      const args = provider.buildSpawnArgs({ cwd: root, model: custom });
      expect(args.slice(args.indexOf('--model'))).toEqual(['--model', custom]);

      const yaml = readFileSync(join(packageRoot, 'config/curated-model-catalogs.yaml.example'), 'utf8');
      writeFileSync(paths.curatedModelCatalogPath, yaml.replace('GPT-5.6 Terra — Medium', 'Changed combo label'));
      expect((await service.getCatalog('copilot', undefined, { forceRefresh: true })).models[0].label)
        .toBe('Changed combo label');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
