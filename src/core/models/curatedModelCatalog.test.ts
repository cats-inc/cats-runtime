import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findCuratedCliCatalog,
  loadCuratedModelCatalog,
  resolveCuratedCatalogScope,
  resolveEffectiveCuratedModelOptions,
} from './curatedModelCatalog.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from '../../../tests/support/runtimeTestPaths.js';

function createRuntimeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-curated-catalog-'));
  const paths = createRuntimeTestPaths(root);
  ensureRuntimeTestDirs(paths);
  return {
    root,
    paths,
    env: createRuntimeTestEnv(root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('curatedModelCatalog', () => {
  it('loads catalog files and resolves shared option inheritance', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Codex',
        '    version: 0.118.0',
        '    shared_options:',
        '      - name: Temperature',
        '        values: [Low, High]',
        '        default: Low',
        '    providers:',
        '      - name: OpenAI',
        '        shared_options:',
        '          - name: Effort',
        '            values: [Low, Medium, High]',
        '            default: Medium',
        '        models:',
        '          - name: gpt-5.4',
        '            label: GPT-5.4',
        '          - name: gpt-5.3-codex-spark',
        '            options:',
        '              - name: Effort',
        '                default: High',
        '          - name: gpt-5.1-codex-mini',
        '            options: []',
        '',
      ].join('\n'), 'utf8');

      const result = loadCuratedModelCatalog({
        env: runtime.env,
      });

      expect(result.path).toBe(runtime.paths.curatedModelCatalogPath);
      expect(result.warnings).toEqual([]);

      const catalog = findCuratedCliCatalog(result.document, 'codex');
      expect(catalog?.cli).toBe('Codex');

      const scope = resolveCuratedCatalogScope(catalog!, 'codex');
      expect(scope?.sharedOptions).toEqual([
        {
          name: 'Temperature',
          values: [{ name: 'Low' }, { name: 'High' }],
          default: 'Low',
        },
        {
          name: 'Effort',
          values: [{ name: 'Low' }, { name: 'Medium' }, { name: 'High' }],
          default: 'Medium',
        },
      ]);

      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[0])).toEqual([
        {
          name: 'Temperature',
          values: [{ name: 'Low' }, { name: 'High' }],
          default: 'Low',
        },
        {
          name: 'Effort',
          values: [{ name: 'Low' }, { name: 'Medium' }, { name: 'High' }],
          default: 'Medium',
        },
      ]);
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[1])).toEqual([
        {
          name: 'Temperature',
          values: [{ name: 'Low' }, { name: 'High' }],
          default: 'Low',
        },
        {
          name: 'Effort',
          values: [{ name: 'Low' }, { name: 'Medium' }, { name: 'High' }],
          default: 'High',
        },
      ]);
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[2])).toEqual([]);
    } finally {
      runtime.cleanup();
    }
  });

  it('returns a warning when the catalog file is invalid YAML', () => {
    const runtime = createRuntimeRoot();

    try {
      writeFileSync(runtime.paths.curatedModelCatalogPath, 'schema_version: [', 'utf8');

      const result = loadCuratedModelCatalog({
        env: runtime.env,
      });

      expect(result.document).toBeUndefined();
      expect(result.warnings).toEqual([
        expect.stringContaining('could not be parsed'),
      ]);
    } finally {
      runtime.cleanup();
    }
  });
});
