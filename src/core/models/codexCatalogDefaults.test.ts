import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../backends/cli/config.js';
import { ProviderModelCatalogService } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { createRuntimeTestEnv } from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';

const observedModels = [
  ['gpt-6-astra', 'medium', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']],
  ['gpt-5.6-sol', 'low', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']],
  ['gpt-5.6-terra', 'medium', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']],
  ['gpt-5.6-luna', 'medium', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-5.5', 'medium', ['low', 'medium', 'high', 'xhigh']],
] as const;

describe.each(['bundled', 'fallback'])('Codex 0.154.0 %s catalog', (source) => {
  it('preserves every model default and reasoning menu through catalog and execution resolution', () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-codex-defaults-'));
    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_PACKAGE_ROOT: source === 'bundled'
        ? fileURLToPath(new URL('../../../', import.meta.url))
        : root,
    });
    try {
      const config = loadConfig(env);
      config.providerDefaultTargets.codex = { backend: 'cli', instance: 'default' };
      config.providerInstances.codex = {
        default: {
          id: 'default', providerName: 'codex',
          commandConfig: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
        },
      };
      const service = new ProviderModelCatalogService(config, { env });
      const knowledge = service.getImmediateAdvancedKnowledge('codex');
      const catalog = knowledge.catalog;
      expect(catalog.warnings).toEqual([]);
      expect(catalog.entries.map((entry) => entry.id)).toEqual(observedModels.map(([id]) => id));
      expect(catalog.entries.map((entry) => entry.label)).toEqual(observedModels.map(([id]) => id));
      expect(catalog.entries.filter((entry) => entry.default).map((entry) => entry.id))
        .toEqual(['gpt-6-astra']);
      expect(catalog.defaultSelection).toMatchObject({
        entryId: 'gpt-6-astra', controls: { 'codex.reasoning_effort': 'medium' },
      });
      const control = catalog.controls.find((entry) => entry.key === 'codex.reasoning_effort')!;
      for (const [id, defaultEffort, values] of observedModels) {
        expect(catalog.entries.find((entry) => entry.id === id)?.controlDefaults)
          .toEqual({ 'codex.reasoning_effort': defaultEffort });
        const applicableValues = control.values!.flatMap((option) => {
          if (typeof option !== 'object') return [option];
          return !option.applicableEntryIds?.length || option.applicableEntryIds.includes(id)
            ? [option.value] : [];
        });
        expect(applicableValues).toEqual([...values]);
        expect(resolveProviderSelection(knowledge, { entryMode: 'explicit', entryId: id })
          .resolution.controls).toEqual({ 'codex.reasoning_effort': defaultEffort });
      }
      expect(() => resolveProviderSelection(knowledge, {
        entryMode: 'explicit', entryId: 'gpt-5.6-luna', controls: { 'codex.reasoning_effort': 'ultra' },
      })).toThrow(/must be one of/u);
      expect(() => resolveProviderSelection(knowledge, {
        entryMode: 'explicit', entryId: 'gpt-5.5', controls: { 'codex.reasoning_effort': 'max' },
      })).toThrow(/must be one of/u);
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });
});
