import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findCuratedCliCatalog,
  loadCuratedModelCatalog,
  resolveCuratedCatalogScope,
  resolveEffectiveCuratedModelOptions,
} from './curatedModelCatalog.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from '../../../tests/support/runtimeTestPaths.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

  it('falls back to the bundled curated catalog example when the runtime config file is absent', () => {
    const runtime = createRuntimeRoot();
    const packageRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-curated-package-'));

    try {
      mkdirSync(join(packageRoot, 'config'), { recursive: true });
      writeFileSync(join(packageRoot, 'config', 'curated-model-catalogs.yaml.example'), [
        'schema_version: 1',
        'catalogs:',
        '  - cli: Gemini',
        '    version: 0.37.1',
        '    models:',
        '      - name: gemini-3.1-pro-preview',
        '        label: Gemini 3.1 Pro Preview',
        '',
      ].join('\n'), 'utf8');

      const result = loadCuratedModelCatalog({
        env: {
          ...runtime.env,
          CATS_RUNTIME_PACKAGE_ROOT: packageRoot,
        },
      });

      expect(result.path).toBe(join(packageRoot, 'config', 'curated-model-catalogs.yaml.example'));
      expect(result.warnings).toEqual([]);
      expect(result.document?.catalogs).toEqual([
        {
          cli: 'Gemini',
          version: '0.37.1',
          models: [{
            name: 'gemini-3.1-pro-preview',
            label: 'Gemini 3.1 Pro Preview',
          }],
        },
      ]);
    } finally {
      runtime.cleanup();
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it('bundled Cursor example marks Auto as the only default entry', () => {
    const runtime = createRuntimeRoot();

    try {
      const result = loadCuratedModelCatalog({
        env: {
          ...runtime.env,
          CATS_RUNTIME_PACKAGE_ROOT: PACKAGE_ROOT,
        },
      });

      expect(result.path).toBe(join(PACKAGE_ROOT, 'config', 'curated-model-catalogs.yaml.example'));
      expect(result.warnings).toEqual([]);

      const catalog = findCuratedCliCatalog(result.document, 'cursor');
      expect(catalog?.version).toBe('2026.08.11-e8db854');
      expect(catalog?.lastUpdated).toBe('2026-08-26');
      // `name` is the raw `cursor-agent --model` id, matching the identities the
      // dynamic `--list-models` path produces; `label` is the picker text.
      expect(catalog?.models?.slice(0, 2)).toEqual([
        { name: 'auto', label: 'Auto', default: true },
        { name: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low' },
      ]);
      expect(catalog?.models?.filter((model) => model.default).map((model) => model.name))
        .toEqual(['auto']);
      // Cursor's Anthropic id scheme changed at 4.7; both spellings must survive
      // verbatim rather than being re-derived from the label.
      const cursorIds = catalog?.models?.map((model) => model.name) ?? [];
      expect(cursorIds).toContain('claude-4.6-opus-high');
      expect(cursorIds).toContain('claude-opus-4-7-low');
    } finally {
      runtime.cleanup();
    }
  });

  it('bundled Antigravity example carries the probed agy model ids verbatim', () => {
    const runtime = createRuntimeRoot();

    try {
      const result = loadCuratedModelCatalog({
        env: {
          ...runtime.env,
          CATS_RUNTIME_PACKAGE_ROOT: PACKAGE_ROOT,
        },
      });

      expect(result.warnings).toEqual([]);

      const catalog = findCuratedCliCatalog(result.document, 'antigravity');
      expect(catalog?.version).toBe('1.1.20');
      expect(catalog?.lastUpdated).toBe('2026-08-26');

      const scope = resolveCuratedCatalogScope(catalog!, 'antigravity');
      // `name` feeds normalizeVerbatimCuratedModelId, so these are the exact
      // strings handed to `agy --model`; agy echoes labels back on a bad id.
      expect(scope?.models.map((model) => model.name)).toEqual([
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3.5-flash-high',
        'gemini-3.5-flash-medium',
        'gemini-3.5-flash-low',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
      ]);
      // agy reads its default from the per-user settings.json `model` field,
      // so the catalog must not claim one.
      expect(scope?.models.some((model) => model.default)).toBe(false);
    } finally {
      runtime.cleanup();
    }
  });

  it('bundled Codex example matches the refreshed visible CLI catalog', () => {
    const runtime = createRuntimeRoot();

    try {
      const result = loadCuratedModelCatalog({
        env: {
          ...runtime.env,
          CATS_RUNTIME_PACKAGE_ROOT: PACKAGE_ROOT,
        },
      });

      expect(result.warnings).toEqual([]);
      const catalog = findCuratedCliCatalog(result.document, 'codex');
      expect(catalog?.version).toBe('0.149.1');
      expect(catalog?.lastUpdated).toBe('2026-08-26');

      const scope = resolveCuratedCatalogScope(catalog!, 'codex');
      expect(scope?.models.map((model) => model.name)).toEqual([
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex-spark',
      ]);
      expect(scope?.models[0]).toMatchObject({
        default: true,
        context: 272000,
      });
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[0]))
        .toEqual([
          expect.objectContaining({
            name: 'Reasoning Level',
            default: 'Low',
            values: expect.arrayContaining([
              { name: 'Max', notes: ['Maximum reasoning depth for the hardest problems'] },
              { name: 'Ultra', notes: ['Maximum reasoning with automatic task delegation'] },
            ]),
          }),
        ]);
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[2]))
        .toEqual([
          expect.objectContaining({
            name: 'Reasoning Level',
            default: 'Medium',
            values: [
              { name: 'Low' },
              { name: 'Medium' },
              { name: 'High' },
              { name: 'Extra high' },
              { name: 'Max' },
            ],
          }),
        ]);
      expect(scope?.models.at(-1)).toMatchObject({
        name: 'gpt-5.3-codex-spark',
        context: 128000,
      });
    } finally {
      runtime.cleanup();
    }
  });
});
