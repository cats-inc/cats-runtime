import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProviderModelCatalogService } from '../src/core/models/providerModelCatalog.js';
import { resolveProviderSelection } from '../src/core/models/providerSelectionResolution.js';
import { buildProviderAdvancedKnowledge } from '../src/core/models/providerAdvancedKnowledge.js';
import { createCatalogSnapshot, readCatalogFactory } from '../src/catalogs/resolver.js';
import { convertLegacyCatalog, type LegacyMigrationScope } from '../src/catalogs/conversion.js';
import { applyCatalogPatch, previewCatalogPatch } from '../src/catalogs/patch.js';
import type { CatalogScope } from '../src/catalogs/types.js';
import type { ProviderTargetDescriptor } from '../src/core/providerCatalog.js';
import { PiProvider } from '../src/backends/cli/providers/pi.js';
import { GooseProvider } from '../src/backends/cli/providers/goose.js';
import { JunieProvider } from '../src/backends/cli/providers/junie.js';
import { KiroProvider } from '../src/backends/cli/providers/kiro.js';
import { AuggieProvider } from '../src/backends/cli/providers/auggie.js';
import { CopilotProvider } from '../src/backends/cli/providers/copilot.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

const packageRoot = resolve('.');
const factory = readCatalogFactory({ packageRoot, runtimeRoot: resolve('tmp/unused-readonly-profile') });
const snapshot = createCatalogSnapshot(factory.source);
function target(scope: CatalogScope): ProviderTargetDescriptor {
  return { providerName: scope.provider, backend: scope.backend, instanceId: 'fixture', defaultTarget: true,
    ...(scope.backend !== 'cli' ? { remoteInstance: { id: 'fixture', providerName: scope.provider,
      backend: scope.backend, transport: scope.transport } } : {}) } as ProviderTargetDescriptor;
}
function knowledge(scope: CatalogScope) {
  const current = createCatalogSnapshot(JSON.stringify({ schema_version: 2, catalogs: [scope] }));
  return buildProviderAdvancedKnowledge(target(scope), {
    provider: scope.provider, backend: scope.backend, instance: 'fixture', source: 'static', cache: null,
    catalogRevision: current.catalogRevision, defaultModel: scope.models.find(m => m.default)?.id ?? null,
    models: scope.models.map(({ id, label, default: isDefault }) => ({ id, label, default: isDefault })), warnings: [],
  }, { snapshot: current });
}

describe('factory and executable catalog projections', () => {
  it.each(snapshot.document.catalogs)('projects every entry and explicit binding in $provider/$backend/$transport', scope => {
    const k = knowledge(scope);
    expect(k.catalog.entries.map(e => e.label)).toEqual(scope.models.map(e => e.label));
    for (const model of scope.models) {
      const selected = resolveProviderSelection(k, { entryId: model.id, entryMode: 'explicit', catalogRevision: k.catalog.catalogRevision });
      expect(selected.resolution.controls).toMatchObject(model.execution.fixed_controls ?? {});
      expect(selected.execution.model).toBe(model.execution.variants?.[0]?.model ?? model.execution.model);
      expect(selected.execution.provider).toBe(model.execution.variants?.[0]?.provider ?? model.execution.provider);
      expect(selected.resolution.catalogRevision).toBe(k.catalog.catalogRevision);
      for (const variant of model.execution.variants ?? []) {
        expect(resolveProviderSelection(k, { entryId: model.id, entryMode: 'explicit', controls: variant.when }).execution.model).toBe(variant.model);
      }
      expect(k.catalog.entries.find(e => e.id === model.id)?.default).toBe(model.default);
    }
  });

  it('preserves model-specific descriptions, defaults, and no-default Muse menus', () => {
    const grok = knowledge(snapshot.document.catalogs.find(s => s.provider === 'grok')!);
    const high = (id: string) => grok.catalog.entries.find(e => e.id === id)
      ?.controls?.[0].values?.find(v => typeof v === 'object' && v.value === 'high');
    expect(high('grok-4.7')).toMatchObject({ description: 'Thorough reasoning and quality. Recommended.' });
    expect(high('grok-4.7-build-fast')).toMatchObject({ description: 'Thorough reasoning and quality. Recommended.' });
    expect(high('grok-4.6')).toMatchObject({ description: expect.stringContaining('Higher implementation') });
    expect(high('grok-4.5')).toMatchObject({ description: expect.stringContaining('Highest implementation') });
    const muse = knowledge(snapshot.document.catalogs.find(s => s.provider === 'muse')!);
    expect(muse.catalog.entries.map(e => e.controls?.[0].values?.length)).toEqual([6, 6, 5, 5]);
    expect(muse.catalog.entries.every(e => !e.default && !e.controlDefaults)).toBe(true);
    expect(muse.catalog.controls.flatMap(c => c.values ?? []).every(v => typeof v !== 'object' || !v.label.includes('(default)'))).toBe(true);
  });

  it('starts Junie effort at each model\'s first picker value and emits it as --effort', () => {
    const junie = knowledge(snapshot.document.catalogs.find(s => s.provider === 'junie' && s.backend === 'cli')!);
    expect(junie.catalog.entries).toHaveLength(15);
    expect(junie.catalog.entries.filter(e => e.default).map(e => e.id)).toEqual(['Gemini 3.7 Flash']);
    // The picker shows no effort default, so none is declared and resolution uses the first value.
    expect(junie.catalog.entries.every(e => !e.controlDefaults)).toBe(true);
    const effort = (entryId: string, controls?: Record<string, string>) => resolveProviderSelection(junie,
      { entryId, entryMode: 'explicit', ...(controls ? { controls } : {}) }).resolution.controls['junie.reasoning_effort'];
    expect(effort('GPT-5.6-SOL')).toBe('none');
    expect(effort('Gemini 3.6 Flash')).toBe('minimal');
    expect(effort('Gemini 3.7 Flash')).toBe('low');
    expect(effort('Claude Opus 5.5', { 'junie.reasoning_effort': 'xhigh' })).toBe('xhigh');
    expect(() => effort('Gemini 3.7 Flash', { 'junie.reasoning_effort': 'xhigh' })).toThrow();
    // --model accepts aliases and setting IDs; Junie rejects picker names as an invalid model.
    const executed = junie.catalog.entries.map(e =>
      resolveProviderSelection(junie, { entryId: e.id, entryMode: 'explicit' }).execution.model);
    expect(executed.filter(model => !/^[a-z0-9][a-z0-9.-]*$/.test(model))).toEqual([]);
    const selection = resolveProviderSelection(junie, { entryId: 'GPT-5.6-SOL', entryMode: 'explicit' });
    const args = new JunieProvider().buildSpawnArgs({ cwd: '/tmp', model: selection.execution.model,
      modelControls: selection.resolution.controls });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'gpt-5.6-sol']);
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual(['--effort', 'none']);
  });

  it('starts Kiro effort at each row\'s first picker value and sends --effort only where offered', () => {
    const kiro = knowledge(snapshot.document.catalogs.find(s => s.provider === 'kiro' && s.backend === 'cli')!);
    expect(kiro.catalog.entries).toHaveLength(20);
    expect(kiro.catalog.entries[0].id).toBe('auto');
    // auto is [active] in the picker and default_model in --list-models; neither is a catalog default.
    expect(kiro.catalog.entries.some(e => e.default)).toBe(false);
    // First-row initialization only: no default flag and no effort controls on auto.
    expect(kiro.catalog.defaultSelection).toEqual(expect.objectContaining({ entryId: 'auto', entryMode: 'explicit' }));
    expect(kiro.catalog.defaultSelection?.controls).toBeUndefined();
    expect(kiro.catalog.entries.every(e => !e.controlDefaults)).toBe(true);
    const resolve = (entryId: string, controls?: Record<string, string>) => resolveProviderSelection(kiro,
      { entryId, entryMode: 'explicit', ...(controls ? { controls } : {}) });
    const spawn = (entryId: string, controls?: Record<string, string>) => {
      const selected = resolve(entryId, controls);
      return new KiroProvider({} as never).buildSpawnArgs({ cwd: '/tmp',
        model: selected.execution.model, modelControls: selected.resolution.controls });
    };
    const effort = (entryId: string) => resolve(entryId).resolution.controls['kiro.reasoning_effort'];
    expect(effort('claude-opus-5.5')).toBe('low');
    expect(effort('claude-opus-4.6')).toBe('low');
    expect(effort('gpt-5.6-sol')).toBe('none');
    expect(resolve('claude-opus-4.7', { 'kiro.reasoning_effort': 'xhigh' })
      .resolution.controls['kiro.reasoning_effort']).toBe('xhigh');
    expect(() => resolve('claude-opus-4.6', { 'kiro.reasoning_effort': 'xhigh' })).toThrow();
    expect(() => resolve('claude-haiku-4.5', { 'kiro.reasoning_effort': 'low' })).toThrow();
    expect(kiro.catalog.entries.filter(e => e.controls?.length).map(e => e.id)).toEqual([
      'claude-opus-5.5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4.8', 'gpt-5.6-sol',
      'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-opus-4.7', 'claude-opus-4.6', 'claude-sonnet-4.6',
    ]);

    const auto = spawn('auto');
    expect(auto.slice(auto.indexOf('--model'), auto.indexOf('--model') + 2)).toEqual(['--model', 'auto']);
    expect(auto).not.toContain('--effort');
    expect(spawn('claude-haiku-4.5')).not.toContain('--effort');
    const sol = spawn('gpt-5.6-sol');
    expect(sol.slice(sol.indexOf('--model'), sol.indexOf('--model') + 4))
      .toEqual(['--model', 'gpt-5.6-sol', '--effort', 'none']);
  });

  it('lists the full Auggie picker with Opus 4.8 as default and sends only --model', () => {
    const auggie = knowledge(snapshot.document.catalogs.find(s => s.provider === 'auggie' && s.backend === 'cli')!);
    expect(auggie.catalog.entries).toHaveLength(34);
    expect(auggie.catalog.entries.slice(0, 3).map(e => e.id)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
    expect(auggie.catalog.entries.filter(e => e.default).map(e => e.id)).toEqual(['claude-opus-4-8']);
    expect(auggie.catalog.defaultSelection).toEqual(expect.objectContaining({ entryId: 'claude-opus-4-8', entryMode: 'explicit' }));
    // Effort is recorded in notes only; no auggie.reasoning_effort binding exists.
    expect(auggie.catalog.entries.every(e => !e.controls?.length && !e.controlDefaults)).toBe(true);
    expect(auggie.catalog.entries.find(e => e.id === 'butler_b')?.label).toBe('Prism (GPT)');
    const spawn = (entryId: string) => {
      const selected = resolveProviderSelection(auggie, { entryId, entryMode: 'explicit' });
      return new AuggieProvider({} as never, 10).buildSpawnArgs({ cwd: '/tmp',
        model: selected.execution.model, modelControls: selected.resolution.controls });
    };
    for (const id of ['butler_b', 'claude-opus-4-8', 'gemini-3-1-pro-preview', 'kimi-k2p7']) {
      const args = spawn(id);
      expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', id]);
      expect(args).not.toContain('--reasoning-effort');
    }
  });

  it('lists the Pi openai-codex channel a ChatGPT account can run, with thinking defaulting to medium', () => {
    const pi = knowledge(snapshot.document.catalogs.find(s => s.provider === 'pi' && s.backend === 'cli')!);
    // Pi's registry also lists gpt-5.3-codex-spark, which ChatGPT accounts reject.
    expect(pi.catalog.entries.map(e => e.id)).toEqual([
      'openai-codex/gpt-5.5', 'openai-codex/gpt-5.6-luna', 'openai-codex/gpt-5.6-sol',
      'openai-codex/gpt-5.6-terra', 'openai-codex/gpt-6-astra', 'openai-codex/gpt-6-luna',
      'openai-codex/gpt-6-sol', 'openai-codex/gpt-6.1-sol',
    ]);
    // Labels are bare model ids; the openai-codex channel is shown once, as the scope basis.
    expect(pi.catalog.entries.every(e => e.label === e.id.replace(/^openai-codex\//, ''))).toBe(true);
    expect(pi.catalog.basis).toEqual({ channel: { id: 'openai-codex', label: 'openai-codex' } });
    // Pi's model selector marks no factory default model; its thinking selector marks medium.
    expect(pi.catalog.entries.some(e => e.default)).toBe(false);
    const spawn = (entryId: string, controls?: Record<string, string>) => {
      const selected = resolveProviderSelection(pi, { entryId, entryMode: 'explicit', ...(controls ? { controls } : {}) });
      return new PiProvider().buildSpawnArgs({ cwd: '/tmp', model: selected.execution.model,
        modelProvider: selected.execution.provider, modelControls: selected.resolution.controls });
    };
    expect(spawn('openai-codex/gpt-5.5')).toEqual([
      '--mode', 'rpc', '--provider', 'openai-codex', '--model', 'gpt-5.5', '--thinking', 'medium',
    ]);
    expect(spawn('openai-codex/gpt-6-sol', { 'pi.thinking': 'max' }).slice(-2)).toEqual(['--thinking', 'max']);
    expect(spawn('openai-codex/gpt-5.5', { 'pi.thinking': 'off' }).slice(-2)).toEqual(['--thinking', 'off']);
    // Levels follow each model's thinkingLevelMap: gpt-6-astra and gpt-6.1-sol have no off, gpt-5.5 no max.
    expect(() => spawn('openai-codex/gpt-6-astra', { 'pi.thinking': 'off' })).toThrow();
    expect(() => spawn('openai-codex/gpt-6.1-sol', { 'pi.thinking': 'off' })).toThrow();
    expect(spawn('openai-codex/gpt-6.1-sol', { 'pi.thinking': 'max' }).slice(-4)).toEqual(['--model', 'gpt-6.1-sol', '--thinking', 'max']);
    expect(() => spawn('openai-codex/gpt-5.5', { 'pi.thinking': 'max' })).toThrow();
  });

  it('carries each recorded basis in the advanced catalog without changing selection or arguments', () => {
    const scopeOf = (provider: string) => snapshot.document.catalogs.find(s => s.provider === provider && s.backend === 'cli')!;
    const basisOf = (provider: string) => knowledge(scopeOf(provider)).catalog.basis;
    expect(basisOf('pi')).toEqual({ channel: { id: 'openai-codex', label: 'openai-codex' } });
    expect(basisOf('goose')).toEqual({ channel: { id: 'chatgpt_codex', label: 'chatgpt_codex' } });
    expect(basisOf('cline')).toEqual({ channel: { id: 'cline-pass', label: 'cline-pass' } });
    expect(basisOf('opencode')).toEqual({ channel: { id: 'opencode-go', label: 'opencode-go' } });
    expect(basisOf('kilo')).toEqual({ channel: { id: 'kilo', label: 'kilo' } });
    expect(basisOf('copilot')).toEqual({ plan: { label: 'Copilot Pro' } });
    // First-party lists change through remote updates, not a channel or plan: no basis.
    for (const provider of ['claude', 'codex', 'antigravity', 'grok', 'muse']) expect(basisOf(provider)).toBeUndefined();

    // The field is display-only: the same selection spawns the same arguments without it.
    const pi = scopeOf('pi');
    const { basis: _basis, ...withoutBasis } = pi;
    const spawn = (scope: CatalogScope) => {
      const k = knowledge(scope);
      const selected = resolveProviderSelection(k, { entryId: 'openai-codex/gpt-6-sol', entryMode: 'explicit',
        controls: { 'pi.thinking': 'high' } });
      return new PiProvider().buildSpawnArgs({ cwd: '/tmp', model: selected.execution.model,
        modelProvider: selected.execution.provider, modelControls: selected.resolution.controls });
    };
    expect(spawn(pi)).toEqual(spawn(withoutBasis as CatalogScope));
    expect(spawn(pi)).toEqual(['--mode', 'rpc', '--provider', 'openai-codex', '--model', 'gpt-6-sol', '--thinking', 'high']);
  });

  it('lists the Copilot Pro picker with Terra as default and first-value effort, context and tier', () => {
    const copilot = knowledge(snapshot.document.catalogs.find(s => s.provider === 'copilot' && s.backend === 'cli')!);
    expect(copilot.catalog.entries).toHaveLength(20);
    expect(copilot.catalog.entries.slice(0, 4).map(e => e.id)).toEqual(['auto', 'grok-4.7', 'gpt-5.6-terra', 'mai-code-1.1-flash']);
    expect(copilot.catalog.entries.filter(e => e.default).map(e => e.id)).toEqual(['gpt-5.6-terra']);
    // Plan-unavailable picker rows (Pro+ only) are omitted.
    expect(copilot.catalog.entries.some(e => /opus|fable|astra|sol|^gpt-5\.5$/.test(e.id))).toBe(false);
    const withContext = copilot.catalog.entries.filter(e => e.controls?.some(c => c.key === 'copilot.context'));
    expect(withContext).toHaveLength(12);
    const spawn = (entryId: string, controls?: Record<string, string>) => {
      const selected = resolveProviderSelection(copilot, { entryId, entryMode: 'explicit', ...(controls ? { controls } : {}) });
      const args = new CopilotProvider().buildSpawnArgs({ cwd: '/tmp',
        model: selected.execution.model, modelControls: selected.resolution.controls });
      return args.slice(args.indexOf('--model'));
    };
    expect(spawn('gpt-5.6-terra')).toEqual(['--model', 'gpt-5.6-terra', '--effort', 'none', '--context', 'default']);
    expect(spawn('gemini-3.5-flash')).toEqual(['--model', 'gemini-3.5-flash', '--effort', 'minimal', '--context', 'default']);
    expect(spawn('grok-4.7', { 'copilot.reasoning_effort': 'xhigh', 'copilot.context': 'long_context' }))
      .toEqual(['--model', 'grok-4.7', '--effort', 'xhigh', '--context', 'long_context']);
    expect(spawn('gpt-5.4-mini')).toEqual(['--model', 'gpt-5.4-mini', '--effort', 'none']);
    expect(spawn('auto')).toEqual(['--model', 'auto', '--auto-tier', 'efficiency']);
    expect(spawn('kimi-k2.7-code')).toEqual(['--model', 'kimi-k2.7-code']);
    expect(() => spawn('gpt-5.4-mini', { 'copilot.context': 'long_context' })).toThrow();
  });

  it('emits copilot.context and copilot.auto_tier for an unknown model id from data alone', () => {
    const copilot = knowledge({ provider: 'copilot', backend: 'cli', selection_mode: 'full', models: [{
      id: 'fixture-unlisted-model', label: 'fixture-unlisted-model',
      execution: { model: 'fixture-unlisted-model' },
      controls: [
        { key: 'copilot.context', label: 'Context', kind: 'enum', scope: 'both',
          values: [{ value: 'fixture-context', label: 'fixture-context' }] },
        { key: 'copilot.auto_tier', label: 'Tier', kind: 'enum', scope: 'both',
          values: [{ value: 'fixture-tier', label: 'fixture-tier' }] },
      ],
    }] });
    const selected = resolveProviderSelection(copilot, { entryId: 'fixture-unlisted-model', entryMode: 'explicit' });
    const args = new CopilotProvider().buildSpawnArgs({ cwd: '/tmp',
      model: selected.execution.model, modelControls: selected.resolution.controls });
    expect(args.slice(args.indexOf('--model'))).toEqual(['--model', 'fixture-unlisted-model',
      '--context', 'fixture-context', '--auto-tier', 'fixture-tier']);
  });

  it('emits kiro.reasoning_effort for an unknown model id from data alone', () => {
    const kiro = knowledge({ provider: 'kiro', backend: 'cli', selection_mode: 'full', models: [{
      id: 'fixture-unlisted-model', label: 'fixture-unlisted-model',
      execution: { model: 'fixture-unlisted-model' },
      controls: [{ key: 'kiro.reasoning_effort', label: 'Effort', kind: 'enum', scope: 'both',
        values: [{ value: 'fixture-effort', label: 'fixture-effort' }] }],
    }] });
    const selected = resolveProviderSelection(kiro, { entryId: 'fixture-unlisted-model', entryMode: 'explicit' });
    const args = new KiroProvider({} as never).buildSpawnArgs({ cwd: '/tmp',
      model: selected.execution.model, modelControls: selected.resolution.controls });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4))
      .toEqual(['--model', 'fixture-unlisted-model', '--effort', 'fixture-effort']);
  });

  it('validates controls against the selected entry and omits request-only session defaults', () => {
    const control = { key: 'ollama.temperature', label: 'Temperature', kind: 'number' as const,
      scope: 'both' as const, minimum: 0, maximum: 2, default: 1 };
    const k = knowledge({ provider: 'ollama', backend: 'local', transport: 'ollama', selection_mode: 'discovery', models: [
      { id: 'wide', label: 'Wide', execution: { model: 'wide' }, controls: [control] },
      { id: 'narrow', label: 'Narrow', execution: { model: 'narrow' }, controls: [{ ...control, maximum: 1 }] },
      { id: 'request', label: 'Request', execution: { model: 'request' }, controls: [{ ...control, scope: 'request' }] },
    ] });
    expect(() => resolveProviderSelection(k, { entryId: 'narrow', entryMode: 'explicit', controls: { 'ollama.temperature': 1.5 } })).toThrow();
    expect(resolveProviderSelection(k, { entryId: 'request', entryMode: 'explicit' }).resolution.controls).toEqual({});
  });

  it('changes UI and actual adapter arguments with a data-only unknown ID and rejects stale revisions', ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-data-invocation-'));
    onTestFinished(() => cleanupTempDirWithRetries(root));
    const paths = createRuntimeTestPaths(root); ensureRuntimeTestDirs(paths);
    const config = { ...paths, providerDefaultTargets: { pi: { backend: 'cli', instance: 'fixture' } },
      providerDefaultInstances: {}, providerInstances: { pi: { fixture: { id: 'fixture', providerName: 'pi',
        commandConfig: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } } } } },
      providerCommands: {}, remoteProviderCatalog: { api: {}, local: {}, agent: {} } };
    const run = vi.fn(() => { throw new Error('Managed catalog must not probe'); });
    const service = new ProviderModelCatalogService(config as never, { env: createRuntimeTestEnv(root), piModelDiscoveryRunner: { run } });
    const before = service.getImmediateAdvancedKnowledge('pi');
    const original = resolveProviderSelection(before, { entryId: before.catalog.entries[0].id, entryMode: 'explicit' });
    writeFileSync(paths.curatedModelCatalogPath, JSON.stringify({ schema_version: 2, catalogs: [{
      provider: 'pi', backend: 'cli', selection_mode: 'shortlist', models: [{ id: 'only-in-test/Case.Sensitive',
        label: 'A completely new label [subscription]', execution: { model: 'Case.Sensitive', provider: 'subscription-new', fixed_controls: { 'pi.thinking': 'high' } } }],
    }] }));
    service.reloadCatalogs(before.catalog.catalogRevision!);
    const next = service.getImmediateAdvancedKnowledge('pi');
    expect(next.catalog.entries.map(e => e.label)).toEqual(['A completely new label [subscription]']);
    const selected = resolveProviderSelection(next, next.catalog.defaultSelection!);
    expect(new PiProvider().buildSpawnArgs({ cwd: root, model: selected.execution.model,
      modelProvider: selected.execution.provider, modelControls: selected.resolution.controls })).toEqual([
      '--mode', 'rpc', '--provider', 'subscription-new', '--model', 'Case.Sensitive', '--thinking', 'high',
    ]);
    expect(() => resolveProviderSelection(next, { ...next.catalog.defaultSelection!, catalogRevision: before.catalog.catalogRevision })).toThrow(/Catalog changed/);
    expect(original.resolution.controls).toEqual({ 'pi.thinking': 'medium' });
    expect(run).not.toHaveBeenCalled();
    expect(new GooseProvider().buildSpawnArgs({ cwd: root, model: 'Unlisted.Model', modelProvider: 'new-subscription',
      modelControls: { 'goose.thinking_effort': 'off' } }).join(' ')).toContain('Unlisted.Model-none');
  });
});

describe('explicit conversion and safe patch apply', () => {
  it('converts all frozen legacy scopes without a normalizer or dropping scopes', () => {
    const source = readFileSync('tests/fixtures/catalog-schema1/factory-before-cutover.json', 'utf8');
    const mapping = JSON.parse(readFileSync('config/catalog-schema1-migration.json', 'utf8')) as LegacyMigrationScope[];
    const converted = convertLegacyCatalog(source, mapping);
    expect(converted.catalogs).toHaveLength(16);
    for (const scope of converted.catalogs) {
      // Migration preserves the old profile; later factory refreshes must not rewrite its choices.
      const expected = mapping.find(m => m.scope.provider === scope.provider && m.scope.backend === scope.backend)!;
      expect(scope.models.map(m => [m.id, m.label, m.execution])).toEqual(expected.entries.map(({ model: m }) => [m.id, m.label, { ...m.execution, fixed_controls: m.execution.fixed_controls ?? {} }]));
    }
    const changed = JSON.parse(source); changed.catalogs[0].models[0].name = 'unknown';
    expect(() => convertLegacyCatalog(JSON.stringify(changed), mapping)).toThrow(/Unresolved model/);
  });

  it('checks the previous digest, backs up, replaces atomically, and rejects invalid input', ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-patch-apply-'));
    onTestFinished(() => cleanupTempDirWithRetries(root));
    const paths = { packageRoot, runtimeRoot: root }; const candidate = JSON.stringify({ schema_version: 2, catalogs: [] });
    const preview = previewCatalogPatch(paths, candidate);
    expect(preview.expectedDigest).toBeNull();
    expect(applyCatalogPatch(paths, candidate, null).backupPath).toBeNull();
    const before = previewCatalogPatch(paths, candidate);
    expect(() => applyCatalogPatch(paths, candidate, null)).toThrow(/changed/);
    const result = applyCatalogPatch(paths, candidate, before.expectedDigest);
    expect(readFileSync(result.backupPath!, 'utf8')).toBe(candidate);
    expect(() => applyCatalogPatch(paths, '{}', before.expectedDigest)).toThrow();
    expect(readFileSync(join(root, 'config', 'curated-model-catalogs.yaml'), 'utf8')).toBe(candidate);
  });
});
