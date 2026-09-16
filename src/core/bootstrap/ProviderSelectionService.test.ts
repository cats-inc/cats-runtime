import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadConfig } from '../config.js';
import { listProviderCatalog } from '../providerCatalog.js';
import { ProviderSelectionService } from './ProviderSelectionService.js';
import { BootstrapService } from './BootstrapService.js';
import { ProviderModelCatalogService } from '../models/providerModelCatalog.js';
import type { ProviderCompatibilityService } from '../compatibility/ProviderCompatibilityService.js';
import { createRuntimeTestEnv, createRuntimeTestPaths } from '../../../tests/support/runtimeTestPaths.js';
import { cleanupTempDirWithRetriesAsync } from '../../../tests/tempCleanup.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await cleanupTempDirWithRetriesAsync(root); });

const claude = { provider: 'claude', backend: 'cli', instance: 'native' } as const;
const codex = { provider: 'codex', backend: 'cli', instance: 'native' } as const;
const ollama = { provider: 'ollama', backend: 'local', instance: 'local' } as const;
const openclaw = { provider: 'openclaw', backend: 'agent', instance: 'gateway' } as const;

function fixture(yaml?: string) {
  const root = mkdtempSync(join(tmpdir(), 'cats-selection-'));
  roots.push(root);
  const paths = createRuntimeTestPaths(root);
  mkdirSync(paths.configDir, { recursive: true });
  if (yaml !== undefined) writeFileSync(paths.configPath, yaml);
  const config = loadConfig(createRuntimeTestEnv(root));
  const options = { config, configPath: paths.configPath, dataDir: paths.dataDir };
  const selection = new ProviderSelectionService(options);
  return { ...options, paths, selection };
}

describe('provider intent and resource scope', () => {
  it('holds non-cancellable CLI model discovery until it completes', async () => {
    const f = fixture();
    const pi = { provider: 'pi', backend: 'cli', instance: 'native' };
    const { revision } = f.selection.save([pi], 'missing');
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const catalog = new ProviderModelCatalogService(f.config, {
      beginProviderOperation: (target) => {
        const id = f.selection.acquireOperation({ provider: target.providerName,
          backend: target.backend, instance: target.instanceId }, revision);
        return () => f.selection.releaseOperation(id);
      },
      piModelDiscoveryRunner: { run: async () => { started(); await gate;
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 }; } },
    });
    const pending = catalog.getCatalog('pi', 'cli/native', { forceRefresh: true });
    await ready;
    expect(() => f.selection.save([], revision)).toThrow('running provider operation');
    release();
    await pending;
    expect(f.selection.save([], revision).state).toBe('empty');
  });

  it('keeps the loaded revision when config is deleted before service construction', () => {
    const f = fixture();
    const snapshot = f.selection.save([claude], 'missing');
    unlinkSync(f.paths.configPath);
    const selection = new ProviderSelectionService(f);
    expect(selection.getSnapshot()).toMatchObject({ state: 'selected', revision: snapshot.revision,
      targets: [claude], diskChanged: true });
    expect(() => selection.save([claude], snapshot.revision)).toThrow('Selection changed');
  });

  it('uses normalized routing and provider default values when removing targets', () => {
    const f = fixture(`providers: {claude: {default_instance: ' native ', instances: {native: {}, other: {}}}}
routing: {providers: {claude: {default_target: {backend: CLI, instance: ' ', instance_id: ' native '}}}}
`);
    f.selection.save([{ ...claude, instance: 'other' }], f.selection.getSnapshot().revision);
    expect(f.selection.getSnapshot().targets).toEqual([{ ...claude, instance: 'other' }]);
  });

  it('only exposes local native targets to host installers', () => {
    const f = fixture(`backends:
  cli:
    providers:
      claude:
        instances:
          native: { runtime: wsl, distro: Ubuntu, command: claude }
      codex:
        instances:
          native: { runtime: native, command: codex }
  local:
    providers:
      ollama:
        instances:
          local: { transport: ollama, base_url: 'http://remote.example:11434' }
`);
    expect(f.selection.getSnapshot().nativeSetupTargets).toEqual([codex]);
    expect(f.selection.getSnapshot().targets).toHaveLength(3);
  });

  it('does not restart services for an unchanged save unless bootstrap requires activation', () => {
    const f = fixture();
    f.selection.save([claude], 'missing');
    const activated = vi.fn();
    let bootstrapRequired = false;
    const selection = new ProviderSelectionService({ ...f, activated,
      activationRequired: () => bootstrapRequired });
    selection.save([claude], selection.getSnapshot().revision);
    expect(activated).not.toHaveBeenCalled();
    bootstrapRequired = true;
    selection.save([claude], selection.getSnapshot().revision);
    expect(activated).toHaveBeenCalledOnce();
  });

  it.each(['backends: []', 'backends: {cli: false}', 'backends: {api: {providers: []}}',
    'backends: {unknown: {providers: {}}}'])('rejects malformed configuration on reload: %s', (yaml) => {
    const f = fixture();
    const { revision } = f.selection.save([claude], 'missing');
    writeFileSync(f.paths.configPath, yaml);
    expect(() => f.selection.reload(revision)).toThrow('Invalid provider configuration');
    expect(f.selection.getSnapshot().targets).toEqual([claude]);
  });

  it.each(['instance', 'instance_id', 'instanceId'])('removes routing references using %s', (alias) => {
    const f = fixture(`providers: {claude: {instances: {native: {}, other: {}}}}
routing: {providers: {claude: {default_target: {${alias}: native}}}}
`);
    f.selection.save([{ ...claude, instance: 'other' }], f.selection.getSnapshot().revision);
    expect(parse(readFileSync(f.paths.configPath, 'utf8')).routing.providers.claude).toBeUndefined();
  });

  it('has no implicit providers without config and accepts an explicit idle selection', () => {
    const f = fixture();
    expect(listProviderCatalog(f.config)).toEqual({});
    expect(f.selection.getSnapshot()).toMatchObject({ state: 'missing', targets: [] });
    expect(() => f.selection.resolveTargets()).toThrow('Save a valid');
    const saved = f.selection.save([], 'missing');
    expect(saved.state).toBe('empty');
    expect(f.selection.resolveTargets()).toEqual([]);
    expect(listProviderCatalog(loadConfig(createRuntimeTestEnv(roots[0]!)))).toEqual({});
  });

  it('saves unavailable CLI, local, and agent choices without probing', () => {
    const f = fixture();
    const snapshot = f.selection.save([claude, ollama, openclaw], 'missing');
    expect(snapshot.targets).toEqual(expect.arrayContaining([claude, ollama, openclaw]));
    expect(snapshot.targets).toHaveLength(3);
    expect(() => f.selection.resolveTargets([codex])).toThrow('not selected');
    expect(() => f.selection.resolveTargets([{ ...claude, backend: 'api' }])).toThrow('not selected');
  });

  it('keeps Devin on its executable ACP backend', () => {
    const f = fixture();
    const target = { provider: 'devin', backend: 'agent', instance: 'acp' };
    f.selection.save([target], 'missing');
    const catalog = listProviderCatalog(f.config);
    expect(catalog.devin!.instances).toHaveLength(1);
    expect(catalog.devin!.instances[0]!.remoteInstance).toMatchObject({ command: 'devin', args: ['acp'] });
  });

  it('preserves custom settings, comments, and retained API routing', () => {
    const f = fixture(`version: 1\n# custom provider settings\nrouting:\n  providers:\n    claude:\n      default_target: { backend: api, instance: personal }\nbackends:\n  cli:\n    providers:\n      claude:\n        instances:\n          native:\n            command: custom-claude\n            launch: { args: [--chrome] }\n  api:\n    providers:\n      claude:\n        transport: anthropic\n        api_key_env: PERSONAL_KEY\n        instances:\n          personal: { model: my-model }\n`);
    const api = { provider: 'claude', backend: 'api', instance: 'personal' };
    f.selection.save([claude, api, codex], f.selection.getSnapshot().revision);
    const source = readFileSync(f.paths.configPath, 'utf8');
    const doc = parse(source);
    expect(source).toContain('# custom provider settings');
    expect(doc.backends.cli.providers.claude.instances.native).toEqual({ command: 'custom-claude', launch: { args: ['--chrome'] } });
    expect(doc.backends.api.providers.claude.api_key_env).toBe('PERSONAL_KEY');
    expect(doc.routing.providers.claude.default_target).toEqual({ backend: 'api', instance: 'personal' });
    f.selection.save([api], f.selection.getSnapshot().revision);
    expect(f.selection.getSnapshot().targets).toEqual([api]);
  });

  it('rejects stale editors and external edits before overwriting the file', () => {
    const f = fixture();
    f.selection.save([claude], 'missing');
    expect(() => f.selection.save([codex], 'missing')).toThrow('Selection changed');
    const revision = f.selection.getSnapshot().revision;
    const externallyEdited = `${readFileSync(f.paths.configPath, 'utf8')}# hand edit\n`;
    writeFileSync(f.paths.configPath, externallyEdited);
    expect(f.selection.getSnapshot().diskChanged).toBe(true);
    expect(() => f.selection.save([], revision)).toThrow('Selection changed');
    expect(readFileSync(f.paths.configPath, 'utf8')).toBe(externallyEdited);
    expect(f.selection.reload(revision).diskChanged).toBe(false);
  });

  it('rejects invalid candidates without changing the file or active scope', () => {
    const f = fixture();
    f.selection.save([claude], 'missing');
    const before = readFileSync(f.paths.configPath, 'utf8');
    expect(() => f.selection.save([{ ...codex, configuration: { runtime: 'invalid' } }], f.selection.getSnapshot().revision)).toThrow('Invalid provider configuration');
    expect(readFileSync(f.paths.configPath, 'utf8')).toBe(before);
    expect(f.selection.getSnapshot().targets).toEqual([claude]);
  });

  it('holds host provider operations inside the accepted selection until released', () => {
    const f = fixture();
    const snapshot = f.selection.save([claude, codex], 'missing');
    const id = f.selection.acquireOperation(claude, snapshot.revision);
    expect(() => f.selection.save([codex], snapshot.revision)).toThrow('running provider operation');
    expect(() => f.selection.acquireOperation(ollama, snapshot.revision)).toThrow('not selected');
    f.selection.releaseOperation(id);
    expect(f.selection.save([codex], snapshot.revision).targets).toEqual([codex]);
  });

  it('makes host operation admission idempotent and rejects a delayed acquire after release', () => {
    const f = fixture();
    const { revision } = f.selection.save([claude, codex], 'missing');
    const id = '971b6135-b220-4b8d-9696-1174a562cf99';
    expect(f.selection.acquireOperation(claude, revision, id)).toBe(id);
    expect(f.selection.acquireOperation(claude, revision, id)).toBe(id);
    expect(() => f.selection.acquireOperation(codex, revision, id)).toThrow('different target');
    f.selection.releaseOperation(id);
    expect(() => f.selection.acquireOperation(claude, revision, id)).toThrow('already released');
    const delayedId = 'b47a53e6-4b17-49c9-9155-a0eecbecc6b2';
    f.selection.releaseOperation(delayedId);
    expect(() => f.selection.acquireOperation(claude, revision, delayedId)).toThrow('already released');
    expect(f.selection.save([], revision).state).toBe('empty');
  });

  it('scans only the saved scope and discards late results after deselection', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const assessCliTarget = vi.fn(async (_target: unknown) => {
      await gate;
      return { setup: { command: { status: 'ready', resolvedCommand: 'fake' }, version: {}, auth: { status: 'unknown' }, remediation: [] } };
    });
    // Only the assessment seam is used; no executable or host provider files are accessed.
    const compatibility = { assessCliTarget } as unknown as ProviderCompatibilityService;
    const bootstrap = new BootstrapService({ ...f, compatibility, scanConcurrency: 1 });
    bootstrap.saveSelection([claude, codex], 'missing');
    const scan = bootstrap.scan();
    await vi.waitFor(() => expect(assessCliTarget).toHaveBeenCalledTimes(1));
    expect(assessCliTarget.mock.calls[0]![0]).toMatchObject({ providerName: 'claude' });
    bootstrap.saveSelection([codex], bootstrap.getSelection().revision);
    release();
    expect((await scan).providers).toEqual([]);
    expect(assessCliTarget).toHaveBeenCalledTimes(1);
    expect(await bootstrap.getLatestScan()).toBeNull();
    await bootstrap.scan({ manual: true });
    expect(assessCliTarget).toHaveBeenCalledTimes(2);
    expect((await bootstrap.getLatestScan())!.providers.map((target) => target.provider)).toEqual(['codex']);
  });

  it('does not coalesce different target subsets into an unrelated scan result', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const assessCliTarget = vi.fn(async () => { await gate; throw new Error('fake unavailable target'); });
    const bootstrap = new BootstrapService({ ...f,
      compatibility: { assessCliTarget } as unknown as ProviderCompatibilityService });
    bootstrap.saveSelection([claude, codex], 'missing');
    const first = bootstrap.scan({ targets: [claude] });
    expect(bootstrap.startScan({ targets: [claude] }).started).toBe(false);
    expect(() => bootstrap.startScan({ targets: [codex] })).toThrow('different provider scan');
    expect(() => bootstrap.startScan({ targets: [ollama] })).toThrow('not selected');
    release();
    await first;
  });

  it('activates committed selection even when optional setup metadata cannot be written', () => {
    const f = fixture();
    mkdirSync(f.paths.dataDir, { recursive: true });
    writeFileSync(join(f.paths.dataDir, 'setup'), 'block setup directory creation');
    const activated = vi.fn();
    const bootstrap = new BootstrapService({ ...f, activated,
      compatibility: {} as ProviderCompatibilityService });
    expect(bootstrap.saveSelection([ollama], 'missing').targets).toEqual([ollama]);
    expect(activated).toHaveBeenCalledTimes(1);
    expect(listProviderCatalog(f.config).ollama!.instances).toHaveLength(1);
  });

  it('keeps the active revision when disk changes between loading and construction', () => {
    const f = fixture();
    f.selection.save([claude], 'missing');
    const activeRevision = f.config.providerSelectionRevision;
    writeFileSync(f.paths.configPath, 'version: 1\nbackends: {}\n');
    const reattached = new ProviderSelectionService(f);
    expect(reattached.getSnapshot()).toMatchObject({ revision: activeRevision, targets: [claude], diskChanged: true });
    expect(() => reattached.save([], activeRevision)).toThrow('Selection changed');
    expect(reattached.reload(activeRevision).targets).toEqual([]);
  });
});
