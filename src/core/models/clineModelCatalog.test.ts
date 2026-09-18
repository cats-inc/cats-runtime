import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';
import { ProviderModelCatalogService, getStaticProviderModels } from './providerModelCatalog.js';
import { findCuratedCliCatalog, loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { normalizeCuratedModelId } from './curatedModelCatalogNormalization.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { ClineProvider } from '../../backends/cli/providers/cline.js';

const expected = [
  { id: 'cline-pass/glm-5.3', label: 'GLM-5.3 — Medium' },
  { id: 'cline-pass/kimi-k3', label: 'Kimi K3 — Medium' },
  { id: 'cline-pass/qwen3.8-max', label: 'Qwen3.8 Max — Medium' },
  { id: 'cline-pass/deepseek-v4-pro', label: 'DeepSeek V4 Pro — Medium' },
  { id: 'cline-pass/minimax-m3', label: 'MiniMax-M3 — Medium' },
  { id: 'cline-pass/mimo-v2.5-pro', label: 'MiMo-V2.5-Pro — Medium' },
];

describe('ClinePass fixed combinations', () => {
  it.each([true, false])('keeps six choices and sends ClinePass plus Medium (curated: %s)', async (curated) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-cline-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const commandConfig = { path: 'cline', runner: 'auto', runtime: { mode: 'native' } } as const;
    const config = {
      ...paths,
      providerDefaultTargets: { cline: { backend: 'cli', instance: 'native' } },
      providerDefaultInstances: {},
      providerInstances: { cline: { native: { id: 'native', providerName: 'cline', commandConfig } } },
      providerCommands: { cline: commandConfig },
      remoteProviderCatalog: { api: {}, local: {}, agent: {} },
    };
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const catalog = findCuratedCliCatalog(loaded.document, 'cline')!;
      expect(catalog).toMatchObject({ version: '3.0.62', selectionMode: 'shortlist', lastUpdated: '2026-09-18' });
      expect(catalog.models?.map(model => ({ id: normalizeCuratedModelId('cline', model), label: model.label }))).toEqual(expected);
      expect(catalog.sharedOptions).toEqual([{ name: 'Effort', values: [{ name: 'Medium' }] }]);
      if (!curated) writeFileSync(paths.curatedModelCatalogPath, 'schema_version: 1\ncatalogs: []\n');
      const service = new ProviderModelCatalogService(config as never, { env });
      const initial = service.getImmediateCatalog('cline');
      for (const result of [initial, await service.getCatalog('cline', undefined, { forceRefresh: true })]) {
        expect(result.models).toEqual(expected);
        expect(result.defaultModel).toBeNull();
        expect(result.warnings).toEqual([]);
      }
      expect(getStaticProviderModels({ providerName: 'cline', backend: 'cli' })).toEqual(expected);
      const knowledge = service.getImmediateAdvancedKnowledge('cline');
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      expect(knowledge.catalog.defaultSelection).toEqual({ entryMode: 'explicit', entryId: expected[0].id });
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      for (const { id } of expected) {
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        expect(resolved.resolution.controls).toEqual({ 'cline.reasoning_effort': 'medium' });
        const provider = new ClineProvider();
        provider.prepareEphemeralTurn({ message: 'Test request' });
        expect(provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
          modelControls: resolved.resolution.controls })).toEqual([
          '--json', '--cwd', root, '--provider', 'cline-pass', '--model', id,
          '--thinking', 'medium', '--auto-approve', 'false', '--', 'Test request',
        ]);
        expect(() => resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit',
          controls: { 'cline.reasoning_effort': 'high' } })).toThrow(/not supported/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies a fixed effort to a known plain model string, without applying it to custom models', () => {
    const argsFor = (model?: string) => {
      const provider = new ClineProvider();
      provider.prepareEphemeralTurn({ message: 'Test request' });
      return provider.buildSpawnArgs({ cwd: '/work', model });
    };
    expect(argsFor(expected[0].id)).toContain('--thinking');
    const custom = argsFor('cline-pass/future-model');
    expect(custom).toContain('cline-pass/future-model');
    expect(custom.slice(custom.indexOf('--provider'), custom.indexOf('--provider') + 2))
      .toEqual(['--provider', 'cline-pass']);
    expect(custom).not.toContain('--thinking');
    const other = argsFor('vendor/CaseSensitive.Model');
    expect(other).toContain('vendor/CaseSensitive.Model');
    expect(other).not.toContain('--provider');
    expect(other).not.toContain('--thinking');
    expect(argsFor()).not.toContain('--model');
    expect(normalizeCuratedModelId('cline', { name: ' vendor/CaseSensitive.Model ' }))
      .toBe('vendor/CaseSensitive.Model');
  });
});
