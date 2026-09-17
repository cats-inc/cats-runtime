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

  it('bundled Cursor example contains six fixed combos without a default claim', () => {
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
      expect(catalog?.version).toBe('2026.09.15-d2fe57e');
      expect(catalog?.lastUpdated).toBe('2026-09-18');
      expect(catalog?.selectionMode).toBe('shortlist');
      expect(catalog?.models).toHaveLength(6);
      expect(catalog?.models?.[0]).toEqual({
        name: 'grok-4.6[effort=high,fast=true]',
        label: 'Cursor Grok 4.6 — High Fast',
      });
      expect(catalog?.models?.every(model => model.default === undefined && !model.options)).toBe(true);
      expect(catalog?.models?.map(model => model.name)).toContain(
        'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]',
      );
    } finally {
      runtime.cleanup();
    }
  });

  it('bundled Antigravity example preserves picker families, effort order and no default claims', () => {
    const runtime = createRuntimeRoot();
    try {
      const result = loadCuratedModelCatalog({
        env: { ...runtime.env, CATS_RUNTIME_PACKAGE_ROOT: PACKAGE_ROOT },
      });
      expect(result.warnings).toEqual([]);
      const catalog = findCuratedCliCatalog(result.document, 'antigravity');
      expect(catalog?.version).toBe('1.2.3');
      expect(catalog?.lastUpdated).toBe('2026-09-16');
      const models = resolveCuratedCatalogScope(catalog!, 'antigravity')!.models;
      expect(models.map((model) => model.label)).toEqual([
        'Gemini 3.8 Flash', 'Gemini 3.7 Flash', 'Gemini 3.6 Flash', 'Gemini 3.1 Pro',
        'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)',
      ]);
      expect(models.map((model) => model.options?.[0]?.values?.map((value) => value.name) ?? []))
        .toEqual([
          ['low', 'medium', 'high'], ['low', 'medium', 'high'], ['low', 'medium', 'high'],
          ['low', 'high'], [], [], [],
        ]);
      expect(models.some((model) => model.default || model.options?.some((option) => option.default)))
        .toBe(false);
      expect(models[3].options?.[0]?.values?.[0].notes).toEqual([
        'Faster responses, lighter reasoning — great for simpler tasks',
      ]);
    } finally {
      runtime.cleanup();
    }
  });

  it('bundled Grok example keeps each model own effort menu rather than sharing one', () => {
    const runtime = createRuntimeRoot();

    try {
      const result = loadCuratedModelCatalog({
        env: {
          ...runtime.env,
          CATS_RUNTIME_PACKAGE_ROOT: PACKAGE_ROOT,
        },
      });

      expect(result.warnings).toEqual([]);

      const catalog = findCuratedCliCatalog(result.document, 'grok');
      expect(catalog?.version).toBe('1.0.34');
      expect(catalog?.lastUpdated).toBe('2026-09-17');

      const scope = resolveCuratedCatalogScope(catalog!, 'grok');
      expect(scope?.models.map((model) => model.name)).toEqual(['grok-4.6', 'grok-4.5']);
      // The manifest carries no default field; `grok models` only echoes the
      // per-user config.toml preference, so the catalog must not claim one.
      expect(scope?.models.some((model) => model.default)).toBe(false);

      // Picker labels normalize to verified CLI tokens; preserve per-model menus.
      const effortFor = (name: string) => resolveEffectiveCuratedModelOptions(
        scope!.sharedOptions,
        scope!.models.find((model) => model.name === name)!,
      ).find((option) => option.name === 'Effort');

      expect(effortFor('grok-4.6')?.values?.map((value) => value.name))
        .toEqual(['Extra High Effort', 'High Effort', 'Medium Effort', 'Low Effort']);
      expect(effortFor('grok-4.5')?.values?.map((value) => value.name))
        .toEqual(['High Effort', 'Medium Effort', 'Low Effort']);
      expect(effortFor('grok-4.6')?.default).toBeUndefined();
      expect(effortFor('grok-4.5')?.default).toBeUndefined();
      // The two models describe `high` differently upstream; that wording is
      // what distinguishes their picker screens and must survive verbatim.
      expect(effortFor('grok-4.6')?.values?.find((value) => value.name === 'High Effort')?.notes)
        .toEqual(['High Effort - Higher implementation quality with extensive reasoning']);
      expect(effortFor('grok-4.5')?.values?.find((value) => value.name === 'High Effort')?.notes)
        .toEqual(['High Effort - Highest implementation quality with extensive reasoning']);
    } finally {
      runtime.cleanup();
    }
  });

  it('keeps model-list freshness separate from version-only CLI probes', () => {
    const runtime = createRuntimeRoot();

    try {
      const result = loadCuratedModelCatalog({
        env: {
          ...runtime.env,
          CATS_RUNTIME_PACKAGE_ROOT: PACKAGE_ROOT,
        },
      });

      expect(result.warnings).toEqual([]);
      for (const providerName of ['kilo', 'kiro', 'junie']) {
        const catalog = findCuratedCliCatalog(result.document, providerName);
        expect(catalog?.lastUpdated).toBe('2026-04-17');
        expect(catalog?.notes).toEqual(expect.arrayContaining([
          expect.stringContaining('Entries below remain as of 2026-04-17'),
        ]));
      }
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
      expect(catalog?.version).toBe('0.154.0');
      expect(catalog?.lastUpdated).toBe('2026-09-16');

      const scope = resolveCuratedCatalogScope(catalog!, 'codex');
      expect(scope?.models.map((model) => model.name)).toEqual([
        'gpt-6-astra',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.5',
      ]);
      expect(scope?.models[0]).toMatchObject({
        default: true,
      });
      expect(scope?.models[0].context).toBeUndefined();
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[0]))
        .toEqual([
          expect.objectContaining({
            name: 'Reasoning Level',
            default: 'Medium',
            values: expect.arrayContaining([
              {
                name: 'Max',
                notes: ['For difficult problems when quality matters more than speed · higher usage'],
              },
              {
                name: 'Ultra',
                notes: ['For demanding work using multiple agents · highest usage'],
              },
            ]),
          }),
        ]);
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[1])[0].default)
        .toBe('Low');
      expect(resolveEffectiveCuratedModelOptions(scope!.sharedOptions, scope!.models[3]))
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
        name: 'gpt-5.5',
        context: 272000,
      });
    } finally {
      runtime.cleanup();
    }
  });
});
