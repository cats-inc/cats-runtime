import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { ProviderModelCatalogService, getStaticProviderModels } from './providerModelCatalog.js';
import { findCuratedCliCatalog, loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { AuggieProvider } from '../../backends/cli/providers/auggie.js';
import { AuggieSessionService } from '../../backends/cli/auggie/AuggieSessionService.js';

const expected = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { id: 'gpt-5-6-sol', label: 'GPT-5.6 Sol' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'grok-4-7', label: 'Grok 4.7' },
  { id: 'butler_a', label: 'Prism (Claude + GPT)' },
];
const ids = expected.map(model => model.id);

describe('Auggie shortlist', () => {
  it.each([true, false])('keeps six entries through refresh and sends exact model ids (curated: %s)', async (curated) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-auggie-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const commandConfig = { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } } as const;
    const instance = { id: 'test', providerName: 'auggie', commandConfig };
    const config = {
      ...paths,
      providerDefaultTargets: { auggie: { backend: 'cli', instance: 'test' } },
      providerDefaultInstances: {},
      providerInstances: { auggie: { test: instance } },
      providerCommands: { auggie: commandConfig },
      remoteProviderCatalog: { api: {}, local: {}, agent: {} },
    };
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const curatedCatalog = findCuratedCliCatalog(loaded.document, 'auggie')!;
      expect(curatedCatalog).toMatchObject({ version: '0.36.0', selectionMode: 'shortlist',
        lastUpdated: '2026-09-23' });
      expect(curatedCatalog.models?.map(({ name, label }) => ({ id: name, label }))).toEqual(expected);
      expect(curatedCatalog.models?.every(model => !model.default && !model.options)).toBe(true);
      expect(curatedCatalog.sharedOptions).toBeUndefined();
      if (!curated) writeFileSync(paths.curatedModelCatalogPath, 'schema_version: 1\ncatalogs: []\n');
      const service = new ProviderModelCatalogService(config as never, { env });
      for (const result of [service.getImmediateCatalog('auggie'),
        await service.getCatalog('auggie', undefined, { forceRefresh: true })]) {
        expect(result.models.map(({ id, label }) => ({ id, label }))).toEqual(expected);
        expect(result.models.every(model => !model.default)).toBe(true);
        expect(result.defaultModel).toBeNull();
        expect(result.warnings).toEqual([]);
      }
      expect(getStaticProviderModels({ providerName: 'auggie', backend: 'cli', cliInstance: instance }))
        .toEqual(expected);
      const knowledge = service.getImmediateAdvancedKnowledge('auggie');
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      // Entry-only metadata has no provider default; UI initialization selects the first row.
      expect(knowledge.catalog.defaultSelection).toBeNull();
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      const native = new AuggieSessionService(join(root, 'unused-sessions'));
      for (const id of ids) {
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        const provider = new AuggieProvider(native);
        expect(provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
          modelControls: resolved.resolution.controls })).toEqual([
          '--print', '--quiet', '--output-format', 'json', '--max-turns', '10',
          '--workspace-root', root, '--model', id,
        ]);
      }
      expect(new AuggieProvider(native).buildSpawnArgs({ cwd: root, model: 'Vendor/CaseSensitive.Model' }))
        .toEqual(['--print', '--quiet', '--output-format', 'json', '--max-turns', '10',
          '--workspace-root', root, '--model', 'Vendor/CaseSensitive.Model']);
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });
});
