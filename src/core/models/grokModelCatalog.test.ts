import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createRuntimeTestEnv } from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { GrokProvider } from '../../backends/cli/providers/grok.js';
import { buildProviderAdvancedKnowledge } from './providerAdvancedKnowledge.js';
import { getStaticProviderModels } from './providerModelCatalog.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';

it('projects the Grok picker labels into all seven verified executions without default claims', () => {
  const root = mkdtempSync(join(tmpdir(), 'cats-grok-catalog-'));
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    const target = { providerName: 'grok', backend: 'cli' as const,
      instanceId: 'native', defaultTarget: true };
    const knowledge = buildProviderAdvancedKnowledge(target, {
      provider: 'grok', backend: 'cli', instance: 'native', defaultModel: null,
      source: 'static', cache: null, models: getStaticProviderModels(target), warnings: [],
    }, { env: createRuntimeTestEnv(root, { CATS_RUNTIME_PACKAGE_ROOT: packageRoot }) });
    expect(knowledge.catalog.warnings).toEqual([]);
    expect(knowledge.catalog.defaultModel).toBeNull();
    expect(knowledge.entryDefaults).toEqual({});
    expect(knowledge.catalog.defaultSelection?.controls).toBeUndefined();
    const source = readFileSync(join(packageRoot,
      'docs/research/fixtures/grok-1.0.13/models-cache.success.redacted.txt'), 'utf8');
    const manifest = JSON.parse(source.slice(source.indexOf('{'))) as {
      models: Record<string, { info: { reasoning_efforts: { value: string; label: string }[] } }>;
    };
    const control = knowledge.catalog.controls.find((item) => item.key === 'grok.reasoning_effort')!;
    let executions = 0;
    for (const entry of knowledge.catalog.entries) {
      expect(entry.default).toBeUndefined();
      expect(entry.controlDefaults).toBeUndefined();
      const options = (control.values ?? []).filter((option) => typeof option === 'object'
        && option.applicableEntryIds?.includes(entry.id));
      expect(options.map((option) => typeof option === 'object'
        ? { value: option.value, label: option.label } : null))
        .toEqual(manifest.models[entry.id].info.reasoning_efforts.map(({ value, label }) => ({ value, label })));
      for (const option of options) {
        if (typeof option !== 'object') continue;
        const resolved = resolveProviderSelection(knowledge, {
          entryId: entry.id, entryMode: 'explicit', controls: { [control.key]: option.value },
        });
        const provider = new GrokProvider();
        provider.prepareEphemeralTurn({ message: 'Isolated argv verification' });
        const argv = provider.buildSpawnArgs({ cwd: root, model: resolved.execution.model,
          modelControls: resolved.resolution.controls });
        expect(argv[argv.indexOf('--model') + 1]).toBe(entry.id);
        expect(argv[argv.indexOf('--reasoning-effort') + 1]).toBe(option.value);
        executions += 1;
      }
    }
    expect(executions).toBe(7);
    expect(() => resolveProviderSelection(knowledge, {
      entryId: 'grok-4.5', entryMode: 'explicit', controls: { [control.key]: 'xhigh' },
    })).toThrow('must be one of: high, medium, low');
  } finally {
    cleanupTempDirWithRetries(root);
  }
});
