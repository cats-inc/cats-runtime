import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { ProviderModelCatalogService, getStaticProviderModels } from './providerModelCatalog.js';
import { findCuratedCliCatalog, loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { PiProvider } from '../../backends/cli/providers/pi.js';

const expected = [
  { id: 'openai-codex/gpt-5.6-luna', label: 'gpt-5.6-luna [openai-codex] — medium' },
  { id: 'openai-codex/gpt-5.6-sol', label: 'gpt-5.6-sol [openai-codex] — medium' },
  { id: 'openai-codex/gpt-5.6-terra', label: 'gpt-5.6-terra [openai-codex] — medium' },
  { id: 'openai-codex/gpt-6-astra', label: 'gpt-6-astra [openai-codex] — medium' },
  { id: 'openai-codex/gpt-6-luna', label: 'gpt-6-luna [openai-codex] — medium' },
  { id: 'openai-codex/gpt-6-sol', label: 'gpt-6-sol [openai-codex] — medium' },
];
const ids = expected.map(model => model.id);

describe('Pi shortlist', () => {
  it.each([true, false])('keeps six entries through refresh and sends provider and fixed medium thinking (curated: %s)', async (curated) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-pi-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const commandConfig = { path: 'pi', runner: 'auto', runtime: { mode: 'native' } } as const;
    const instance = { id: 'test', providerName: 'pi', commandConfig };
    const config = {
      ...paths,
      providerDefaultTargets: { pi: { backend: 'cli', instance: 'test' } },
      providerDefaultInstances: {},
      providerInstances: { pi: { test: instance } },
      providerCommands: { pi: commandConfig },
      remoteProviderCatalog: { api: {}, local: {}, agent: {} },
    };
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const curatedCatalog = findCuratedCliCatalog(loaded.document, 'pi')!;
      expect(curatedCatalog).toMatchObject({ version: '0.87.1', selectionMode: 'shortlist',
        lastUpdated: '2026-09-23' });
      expect(curatedCatalog.providers?.[0].models.map(({ name, label }) => ({ id: name, label }))).toEqual(expected);
      expect(curatedCatalog.providers?.[0].models.every(model => !model.default && !model.options)).toBe(true);
      expect(curatedCatalog.providers?.[0]).toMatchObject({ name: 'openai-codex',
        sharedOptions: [{ name: 'Thinking', values: [{ name: 'medium' }] }] });
      if (!curated) writeFileSync(paths.curatedModelCatalogPath, 'schema_version: 1\ncatalogs: []\n');
      const run = vi.fn(async () => { throw new Error('Shortlist reads must not enumerate models'); });
      const service = new ProviderModelCatalogService(config as never, { env, piModelDiscoveryRunner: { run } });
      for (const result of [service.getImmediateCatalog('pi'),
        ...(curated ? [await service.getCatalog('pi', undefined, { forceRefresh: true })] : [])]) {
        expect(result.models.map(({ id, label }) => ({ id, label }))).toEqual(expected);
        expect(result.models.every(model => !model.default)).toBe(true);
        expect(result.defaultModel).toBeNull();
        expect(result.warnings).toEqual([]);
      }
      expect(getStaticProviderModels({ providerName: 'pi', backend: 'cli', cliInstance: instance }))
        .toEqual(expected);
      const knowledge = service.getImmediateAdvancedKnowledge('pi');
      expect(knowledge.catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      // Entry-only metadata has no provider default; UI initialization selects the first row.
      expect(knowledge.catalog.defaultSelection).toEqual({ entryId: ids[0], entryMode: 'explicit' });
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.warnings).toEqual([]);
      expect(run).not.toHaveBeenCalled();
      for (const id of ids) {
        const resolved = resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit' });
        const provider = new PiProvider();
        expect(resolved.resolution.controls).toEqual({ 'pi.thinking': 'medium' });
        expect(() => resolveProviderSelection(knowledge, { entryId: id, entryMode: 'explicit',
          controls: { 'pi.thinking': 'high' } })).toThrow(/not supported/);
        for (const resumeSessionId of [undefined, 'test-session']) {
          for (const modelControls of [undefined, resolved.resolution.controls]) {
            const args = provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
              modelControls, resumeSessionId });
            expect(args).toEqual(['--mode', 'rpc', '--provider', 'openai-codex', '--model', id.split('/')[1],
              '--thinking', 'medium', ...(resumeSessionId ? ['--session', resumeSessionId] : [])]);
          }
        }
      }
      for (const id of ['Vendor/CaseSensitive.Model', 'openai-codex/future-model']) {
        expect(new PiProvider().buildSpawnArgs({ cwd: root, model: id })).toEqual([
          '--mode', 'rpc',
          '--provider', id.split('/')[0], '--model', id.split('/')[1],
        ]);
      }
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });
});
