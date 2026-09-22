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
import { GooseProvider } from '../../backends/cli/providers/goose.js';
import { GooseNativeSessionService } from '../../backends/cli/goose/GooseNativeSessionService.js';

const expected = [
  { id: 'chatgpt_codex/gpt-5.6-sol', label: 'gpt-5.6-sol — Off' },
  { id: 'chatgpt_codex/gpt-5.6-terra', label: 'gpt-5.6-terra — Off' },
  { id: 'chatgpt_codex/gpt-5.6-luna', label: 'gpt-5.6-luna — Off' },
  { id: 'chatgpt_codex/gpt-5.6', label: 'gpt-5.6 — Off' },
  { id: 'chatgpt_codex/gpt-5.5', label: 'gpt-5.5 — Off' },
  { id: 'chatgpt_codex/gpt-5.4', label: 'gpt-5.4 — Off' },
];
const ids = expected.map(model => model.id);

describe('Goose shortlist', () => {
  it.each([true, false])('keeps six entries through refresh and sends explicit native Off suffixes (curated: %s)', async (curated) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-goose-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const commandConfig = { path: 'goose', runner: 'auto', runtime: { mode: 'native' } } as const;
    const instance = { id: 'test', providerName: 'goose', commandConfig };
    const config = {
      ...paths,
      providerDefaultTargets: { goose: { backend: 'cli', instance: 'test' } },
      providerDefaultInstances: {},
      providerInstances: { goose: { test: instance } },
      providerCommands: { goose: commandConfig },
      remoteProviderCatalog: { api: {}, local: {}, agent: {} },
    };
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const curatedCatalog = findCuratedCliCatalog(loaded.document, 'goose')!;
      expect(curatedCatalog).toMatchObject({ version: '1.51.0', selectionMode: 'shortlist',
        lastUpdated: '2026-09-23' });
      expect(curatedCatalog.providers?.[0].models.map(({ name, label }) => ({ id: name, label }))).toEqual(expected);
      expect(curatedCatalog.providers?.[0].models.every(model => !model.default && !model.options)).toBe(true);
      expect(curatedCatalog.providers?.[0]).toMatchObject({ name: 'chatgpt_codex',
        sharedOptions: [{ name: 'Thinking effort', values: [{ name: 'Off' }] }] });
      if (!curated) writeFileSync(paths.curatedModelCatalogPath, 'schema_version: 1\ncatalogs: []\n');
      const service = new ProviderModelCatalogService(config as never, { env });
      for (const result of [service.getImmediateCatalog('goose'),
        await service.getCatalog('goose', undefined, { forceRefresh: true })]) {
        expect(result.models.map(({ id, label }) => ({ id, label }))).toEqual(expected);
        expect(result.models.every(model => !model.default)).toBe(true);
        expect(result.defaultModel).toBeNull();
        expect(result.warnings).toEqual([]);
      }
      expect(getStaticProviderModels({ providerName: 'goose', backend: 'cli', cliInstance: instance }))
        .toEqual(expected);
      const knowledge = service.getImmediateAdvancedKnowledge('goose');
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      // Entry-only metadata has no provider default; UI initialization selects the first row.
      expect(knowledge.catalog.defaultSelection).toEqual({ entryId: ids[0], entryMode: 'explicit' });
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      const native = new GooseNativeSessionService({ command: 'goose', sessionDbPath: join(root, 'unused.db'),
        projectsIndexPath: join(root, 'unused-index.json'), runner: async () => { throw new Error('No CLI calls allowed'); } });
      for (const id of ids) {
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        const provider = new GooseProvider(native);
        expect(resolved.resolution.controls).toEqual({ 'goose.thinking_effort': 'off' });
        expect(() => resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit',
          controls: { 'goose.thinking_effort': 'high' } })).toThrow(/not supported/);
        for (const resumeSessionId of [undefined, 'test-session']) {
          for (const modelControls of [undefined, resolved.resolution.controls]) {
            const args = provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
              modelControls, resumeSessionId });
            expect(args).toEqual(['run', '--output-format', 'stream-json', '--quiet', '--max-turns', '100',
              '--provider', 'chatgpt_codex', '--model', `${id.split('/')[1]}-none`,
              ...(resumeSessionId ? ['--name', resumeSessionId, '--resume'] : [])]);
          }
        }
      }
      for (const id of ['Vendor/CaseSensitive.Model', 'chatgpt_codex/future-model-high']) {
        expect(new GooseProvider(native).buildSpawnArgs({ cwd: root, model: id })).toEqual([
          'run', '--output-format', 'stream-json', '--quiet', '--max-turns', '100',
          '--provider', id.split('/')[0], '--model', id.split('/')[1],
        ]);
      }
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });
});
