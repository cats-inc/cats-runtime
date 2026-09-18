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
import { KiroProvider } from '../../backends/cli/providers/kiro.js';
import { KiroNativeSessionService } from '../../backends/cli/kiro/KiroNativeSessionService.js';

const ids = ['claude-opus-5', 'claude-sonnet-5', 'gpt-5.6-sol', 'gpt-5.6-terra',
  'gpt-5.6-luna', 'claude-haiku-4.5'];
const expected = ids.map(id => ({ id, label: id }));

describe.each(['native', 'wsl'] as const)('Kiro shortlist (%s)', (mode) => {
  it.each([true, false])('keeps six entries through refresh and sends exact model ids (curated: %s)', async (curated) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-kiro-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const commandConfig = { path: 'kiro-cli', runner: 'auto', runtime: { mode } } as const;
    const instance = { id: 'test', providerName: 'kiro', commandConfig };
    const config = {
      ...paths,
      providerDefaultTargets: { kiro: { backend: 'cli', instance: 'test' } },
      providerDefaultInstances: {},
      providerInstances: { kiro: { test: instance } },
      providerCommands: { kiro: commandConfig },
      remoteProviderCatalog: { api: {}, local: {}, agent: {} },
    };
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const curatedCatalog = findCuratedCliCatalog(loaded.document, 'kiro')!;
      expect(curatedCatalog).toMatchObject({ version: '2.22.0', selectionMode: 'shortlist',
        lastUpdated: '2026-09-18' });
      expect(curatedCatalog.models?.map(model => model.name)).toEqual(ids);
      expect(curatedCatalog.sharedOptions).toBeUndefined();
      if (!curated) writeFileSync(paths.curatedModelCatalogPath, 'schema_version: 1\ncatalogs: []\n');
      const service = new ProviderModelCatalogService(config as never, { env });
      for (const result of [service.getImmediateCatalog('kiro'),
        await service.getCatalog('kiro', undefined, { forceRefresh: true })]) {
        expect(result.models.map(({ id, label }) => ({ id, label }))).toEqual(expected);
        expect(result.models.every(model => !model.default)).toBe(true);
        expect(result.defaultModel).toBeNull();
        expect(result.warnings).toEqual([]);
      }
      expect(getStaticProviderModels({ providerName: 'kiro', backend: 'cli', cliInstance: instance }))
        .toEqual(expected);
      const knowledge = service.getImmediateAdvancedKnowledge('kiro');
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      // Entry-only metadata has no provider default; UI initialization selects the first row.
      expect(knowledge.catalog.defaultSelection).toBeNull();
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      const native = new KiroNativeSessionService({ command: 'kiro-cli', dbPath: join(root, 'unused.sqlite'),
        runtime: { mode } });
      for (const id of ids) {
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        const provider = new KiroProvider(native);
        expect(provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
          modelControls: resolved.resolution.controls })).toEqual([
          'chat', '--no-interactive', '--wrap', 'never', '--model', id,
        ]);
      }
      expect(new KiroProvider(native).buildSpawnArgs({ cwd: root, model: 'Vendor/CaseSensitive.Model' }))
        .toEqual(['chat', '--no-interactive', '--wrap', 'never', '--model', 'Vendor/CaseSensitive.Model']);
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });
});
