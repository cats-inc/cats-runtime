import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from '../../../tests/support/runtimeTestPaths.js';
import { ProviderModelCatalogService, getStaticProviderModels } from './providerModelCatalog.js';
import { findCuratedCliCatalog, loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { normalizeCuratedModelId } from './curatedModelCatalogNormalization.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';

const expected = [
  { id: 'adaptive', label: 'Adaptive' },
  { id: 'claude-fable-5-1-medium', label: 'Claude Fable 5.1 — Medium' },
  { id: 'gemini-3-8-flash-medium', label: 'Gemini 3.8 Flash — Medium' },
  { id: 'gpt-6-astra-medium', label: 'GPT-6 Astra — Medium' },
  { id: 'grok-4-6-medium', label: 'Grok 4.6 — Medium' },
  { id: 'nemotron-3-ultra-high', label: 'Nemotron 3 Ultra — High' },
];

describe('Devin ACP shortlist', () => {
  it('serves six fixed combinations immediately and on refresh, without defaults or live sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-devin-catalog-'));
    const paths = createRuntimeTestPaths(root);
    ensureRuntimeTestDirs(paths);
    const env = createRuntimeTestEnv(root);
    const instance = {
      id: 'acp', providerName: 'devin', backend: 'agent', transport: 'acp_stdio',
      command: 'devin', args: ['acp'], model: 'another-configured-model',
    } as const;
    const config = {
      configPath: paths.configPath, sessionBaseDir: paths.sessionBaseDir,
      providerDefaultTargets: { devin: { backend: 'agent', instance: 'acp' } },
      providerDefaultInstances: {}, providerInstances: {}, providerCommands: {},
      remoteProviderCatalog: { api: {}, local: {}, agent: { devin: { acp: instance } } },
    };
    const listModels = vi.fn();
    try {
      const loaded = loadCuratedModelCatalog({ env });
      expect(loaded.warnings).toEqual([]);
      const curated = findCuratedCliCatalog(loaded.document, 'devin')!;
      expect(curated).toMatchObject({ version: '3000.10.31', lastUpdated: '2026-09-18', selectionMode: 'shortlist' });
      expect(curated.models?.map(model => ({ id: normalizeCuratedModelId('devin', model), label: model.label }))).toEqual(expected);
      expect(curated.models?.every(model => model.default === undefined && !model.options?.length)).toBe(true);
      const service = new ProviderModelCatalogService(config as never, { env, agentBackend: { listModels } as never });
      const initial = service.getImmediateCatalog('devin');
      const refreshed = await service.getCatalog('devin', 'agent/acp', { refresh: true });
      for (const catalog of [initial, refreshed]) {
        expect(catalog.models.map(({ id, label }) => ({ id, label }))).toEqual(expected);
        expect(catalog.defaultModel).toBeNull();
        expect(catalog.models.every(model => !model.default)).toBe(true);
        expect(catalog.warnings).toEqual([]);
      }
      expect(listModels).not.toHaveBeenCalled();
      const knowledge = await service.getAdvancedKnowledge('devin');
      expect(knowledge.catalog.controls).toEqual([]);
      expect(knowledge.catalog.presets).toEqual([]);
      expect(knowledge.catalog.defaultSelection).toBeNull();
      for (const entry of expected) {
        expect(resolveProviderSelection(knowledge, { entryMode: 'explicit', entryId: entry.id }).execution.model).toBe(entry.id);
      }
      expect(getStaticProviderModels({ providerName: 'devin', backend: 'agent', remoteInstance: instance })).toEqual(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not advertise ACP models for unsupported Devin execution targets', () => {
    expect(getStaticProviderModels({ providerName: 'devin', backend: 'cli' })).toEqual([]);
    expect(getStaticProviderModels({ providerName: 'devin', backend: 'agent', remoteInstance: {
      id: 'http', providerName: 'devin', backend: 'agent', transport: 'acp', baseUrl: 'http://example.invalid',
    } })).toEqual([]);
  });
});
