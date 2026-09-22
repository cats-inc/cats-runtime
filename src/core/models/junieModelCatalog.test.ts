import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';
import { ProviderModelCatalogService, getStaticProviderModels } from './providerModelCatalog.js';
import { findCuratedCliCatalog, loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { JunieProvider } from '../../backends/cli/providers/junie.js';

const combinations = [
  { id: 'Gemini 3.7 Flash', label: 'Gemini 3.7 Flash — Medium', effort: 'medium' },
  { id: 'Claude Fable 5.1', label: 'Claude Fable 5.1 — Low', effort: 'low' },
  { id: 'Gemini 3.8 Flash', label: 'Gemini 3.8 Flash — Medium', effort: 'medium' },
  { id: 'GPT-5.6-SOL', label: 'GPT-5.6-SOL — Low', effort: 'low' },
  { id: 'Grok 4.6', label: 'Grok 4.6 — Low', effort: 'low' },
];
const expected = combinations.map(({ id, label }, index) => ({
  id, label, ...(index === 0 ? { default: true } : {}),
}));

describe('Junie fixed combinations', () => {
  it.each([true, false])('keeps five models and applies fixed effort (curated: %s)', async (curated) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-junie-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const commandConfig = { path: 'junie', runner: 'auto', runtime: { mode: 'native' } } as const;
    const config = {
      ...paths,
      providerDefaultTargets: { junie: { backend: 'cli', instance: 'native' } },
      providerDefaultInstances: {},
      providerInstances: { junie: { native: { id: 'native', providerName: 'junie', commandConfig } } },
      providerCommands: { junie: commandConfig },
      remoteProviderCatalog: { api: {}, local: {}, agent: {} },
    };
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const catalog = findCuratedCliCatalog(loaded.document, 'junie')!;
      expect(catalog).toMatchObject({
        version: '26.9.21', selectionMode: 'shortlist', lastUpdated: '2026-09-23',
      });
      expect(catalog.models?.map(model => model.name)).toEqual(expected.map(model => model.id));
      expect(catalog.models?.map(model => model.options)).toEqual(combinations.map(({ effort }) => [
        { name: 'Effort', values: [{ name: effort === 'low' ? 'Low' : 'Medium' }] },
      ]));
      if (!curated) writeFileSync(paths.curatedModelCatalogPath, 'schema_version: 1\ncatalogs: []\n');
      const service = new ProviderModelCatalogService(config as never, { env });
      for (const result of [service.getImmediateCatalog('junie'),
        await service.getCatalog('junie', undefined, { forceRefresh: true })]) {
        expect(result.models.map(model => ({ ...model, default: model.default === true })))
          .toEqual(expected.map(model => ({ ...model, default: model.default === true })));
        expect(result.warnings).toHaveLength(curated ? 0 : 1);
        expect(result.defaultModel).toBe(expected[0].id);
      }
      expect(getStaticProviderModels({ providerName: 'junie', backend: 'cli' })).toEqual(expected);
      const knowledge = service.getImmediateAdvancedKnowledge('junie');
      expect(knowledge.catalog.entries.map(entry => entry.id)).toEqual(expected.map(model => model.id));
      expect(knowledge.catalog.entries.every(entry => !entry.controlDefaults)).toBe(true);
      expect(knowledge.catalog.defaultSelection).toEqual({ entryMode: 'explicit', entryId: expected[0].id });
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      for (const { id, effort } of combinations) {
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        expect(resolved.resolution.controls).toEqual({ 'junie.reasoning_effort': effort });
        const args = new JunieProvider().buildSpawnArgs({ cwd: root, model: resolved.execution.model,
          modelControls: resolved.resolution.controls, resumeSessionId: 'test-resume' });
        expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4))
          .toEqual(['--model', id, '--effort', effort]);
        expect(args.slice(args.indexOf('--session-id'))).toEqual(['--session-id', 'test-resume']);
        expect(() => resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit',
          controls: { 'junie.reasoning_effort': 'high' } })).toThrow(/not supported/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies the same fixed efforts to plain strings, preserving custom models without an inferred effort', () => {
    for (const { id, effort } of combinations) {
      const args = new JunieProvider().buildSpawnArgs({ cwd: '/work', model: id });
      expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4))
        .toEqual(['--model', id, '--effort', effort]);
    }
    const custom = new JunieProvider().buildSpawnArgs({ cwd: '/work', model: 'Vendor/CaseSensitive.Model' });
    expect(custom).toContain('Vendor/CaseSensitive.Model');
    expect(custom).not.toContain('--effort');
    expect(custom).not.toContain('--provider');
    expect(new JunieProvider().buildSpawnArgs({ cwd: '/work' })).not.toContain('--effort');
    expect(() => new JunieProvider().buildSpawnArgs({ cwd: '/work', model: 'Gemini 3.7 Flash',
      modelControls: { 'junie.reasoning_effort': 'max' } })).toThrow(/Unsupported Junie/);
  });
});
