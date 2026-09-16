import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRuntimeTestEnv } from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from '../../../tests/tempCleanup.js';
import { buildProviderAdvancedKnowledge } from './providerAdvancedKnowledge.js';
import { resolveProviderSelection } from './providerSelectionResolution.js';
import { getStaticProviderModels } from './providerModelCatalog.js';
import { ANTIGRAVITY_EFFORT_CONTROL } from './antigravityModelCatalog.js';
import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import { AntigravityProvider } from '../../backends/cli/providers/antigravity.js';

const target: ProviderTargetDescriptor = {
  providerName: 'antigravity', backend: 'cli', instanceId: 'native', defaultTarget: true,
};
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

function buildKnowledge(env?: NodeJS.ProcessEnv) {
  return buildProviderAdvancedKnowledge(target, {
    provider: 'antigravity', backend: 'cli', instance: 'native', defaultModel: null,
    source: 'static', cache: null, models: getStaticProviderModels(target), warnings: [],
  }, env ? { env } : {});
}

describe('Antigravity picker execution projection', () => {
  it.each(['bundled', 'static'])('%s keeps all fourteen verified executions behind seven picker families', (source) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-agy-models-'));
    try {
      const knowledge = buildKnowledge(source === 'bundled'
        ? createRuntimeTestEnv(root, { CATS_RUNTIME_PACKAGE_ROOT: packageRoot }) : undefined);
      expect(knowledge.catalog.warnings).toEqual([]);
      expect(knowledge.catalog.entries).toHaveLength(7);
      expect(knowledge.catalog.defaultModel).toBeNull();
      expect(knowledge.catalog.entries.every((entry) => !entry.default && !entry.controlDefaults)).toBe(true);
      expect(knowledge.entryDefaults).toEqual({});
      const executions: string[] = [];
      for (const entry of knowledge.catalog.entries) {
        const control = knowledge.catalog.controls[0];
        const values = (control.values ?? []).filter((value) => typeof value === 'object'
          && value.applicableEntryIds?.includes(entry.id));
        for (const option of values) {
          if (typeof option !== 'object') continue;
          expect(option.label).toBe(option.value);
          const result = resolveProviderSelection(knowledge, {
            entryId: entry.id, entryMode: 'explicit',
            controls: { [ANTIGRAVITY_EFFORT_CONTROL]: option.value },
          });
          expect(result.resolution.entryId).toBe(entry.id);
          const adapter = new AntigravityProvider();
          adapter.prepareEphemeralTurn({ message: 'Isolated argv check' });
          const argv = adapter.buildSpawnArgs({ cwd: root, model: result.execution.model });
          expect(argv[argv.indexOf('--model') + 1]).toBe(result.execution.model);
          expect(argv).not.toContain('--effort');
          executions.push(result.execution.model);
        }
        if (!values.length) {
          executions.push(resolveProviderSelection(knowledge, {
            entryId: entry.id, entryMode: 'explicit',
          }).execution.model);
        }
      }
      const rawEvidence = readFileSync(join(packageRoot,
        'docs/research/fixtures/antigravity-1.1.24/models-command.success.redacted.txt'), 'utf8');
      const verifiedIds = rawEvidence.split(/\r?\n/).filter((line) => line.includes('\t'))
        .map((line) => line.split('\t')[0]);
      expect(executions.sort()).toEqual(verifiedIds.sort());
    } finally {
      cleanupTempDirWithRetries(root);
    }
  });

  it('uses first choices for initialization without claiming provider defaults', () => {
    const knowledge = buildKnowledge();
    const result = resolveProviderSelection(knowledge, { entryMode: 'auto' });
    expect(result.execution.model).toBe('gemini-3.8-flash-low');
    expect(result.resolution.controls).toEqual({ [ANTIGRAVITY_EFFORT_CONTROL]: 'low' });
    expect(knowledge.catalog.defaultSelection?.controls).toBeUndefined();
    expect(knowledge.catalog.controls[0].values?.some((value) =>
      typeof value === 'object' && /default/i.test(value.label))).toBe(false);
  });

  it('honors explicit and request effort and rejects unavailable combinations', () => {
    const knowledge = buildKnowledge();
    const selection = {
      entryId: 'gemini-3.1-pro-low', entryMode: 'explicit' as const,
      controls: { [ANTIGRAVITY_EFFORT_CONTROL]: 'high' },
    };
    expect(resolveProviderSelection(knowledge, selection).execution.model).toBe('gemini-3.1-pro-high');
    expect(resolveProviderSelection(knowledge, selection, {
      requestControls: { [ANTIGRAVITY_EFFORT_CONTROL]: 'low' },
    }).execution.model).toBe('gemini-3.1-pro-low');
    expect(() => resolveProviderSelection(knowledge, {
      ...selection, controls: { [ANTIGRAVITY_EFFORT_CONTROL]: 'medium' },
    })).toThrow('must be one of: low, high');
    for (const entryId of ['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium']) {
      expect(() => resolveProviderSelection(knowledge, { ...selection, entryId }))
        .toThrow('not applicable');
    }
  });
});
