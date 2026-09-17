import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MuseProvider } from '../../backends/cli/providers/muse.js';
import { ProviderModelCatalogService } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { loadCuratedModelCatalog } from './curatedModelCatalog.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs }
  from '../../../tests/support/runtimeTestPaths.js';

describe('Muse per-model effort menus', () => {
  it('loads the bundled menus without defaults and enforces their values through execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-muse-efforts-'));
    try {
      const paths = createRuntimeTestPaths(root);
      ensureRuntimeTestDirs(paths);
      const env = createRuntimeTestEnv(root, {
        CATS_RUNTIME_PACKAGE_ROOT: fileURLToPath(new URL('../../../', import.meta.url)),
      });
      expect(loadCuratedModelCatalog({ env }).warnings).toEqual([]);
      const commandConfig = { path: 'muse', runner: 'auto', runtime: { mode: 'native' } } as const;
      const config = {
        ...paths,
        providerDefaultTargets: { muse: { backend: 'cli', instance: 'native' } },
        providerDefaultInstances: {},
        providerInstances: { muse: { native: { id: 'native', providerName: 'muse', commandConfig } } },
        providerCommands: { muse: commandConfig },
        remoteProviderCatalog: { api: {}, local: {}, agent: {} },
      };
      const service = new ProviderModelCatalogService(config as never, { env });
      const knowledge = service.getImmediateAdvancedKnowledge('muse');
      const { catalog } = knowledge;
      expect(catalog.warnings).toEqual([]);
      expect(catalog.entries.map(entry => entry.id)).toEqual([
        'muse-spark-1.3', 'muse-spark-1.3-contributor',
        'muse-spark-1.2', 'muse-spark-1.2-contributor',
      ]);
      expect(catalog.entries.every(entry => !entry.default && !entry.controlDefaults)).toBe(true);
      expect(catalog.defaultSelection?.controls).toBeUndefined();
      const control = catalog.controls.find(item => item.key === 'muse.reasoning_effort')!;
      expect(control).toBeDefined();
      const provider = new MuseProvider();
      for (const entry of catalog.entries) {
        const values = control.values!.filter(value => typeof value === 'object')
          .filter(value => !value.applicableEntryIds || value.applicableEntryIds.includes(entry.id));
        const expected = ['minimal', 'low', 'medium', 'high', 'xhigh',
          ...(entry.id.includes('1.3') ? ['max'] : [])];
        expect(values.map(value => value.value)).toEqual(expected);
        expect(values.map(value => value.label)).toEqual(expected);
        for (const effort of expected) {
          const resolved = resolveProviderSelection(knowledge, {
            entryId: entry.id, entryMode: 'explicit', controls: { 'muse.reasoning_effort': effort },
          });
          provider.prepareEphemeralTurn({ message: 'No process is spawned by this test.' });
          const args = provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
            modelControls: resolved.resolution.controls });
          expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4)).toEqual([
            '--model', entry.id, '--reasoning-effort', effort,
          ]);
        }
        for (const effort of ['none', 'ultra', ...(entry.id.includes('1.2') ? ['max'] : [])]) {
          expect(() => resolveProviderSelection(knowledge, {
            entryId: entry.id, entryMode: 'explicit', controls: { 'muse.reasoning_effort': effort },
          })).toThrow();
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
