import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as policy from './contentPolicy.js';
import { buildRuntimeSkillInstructionOverlay, clearRuntimeSkillState, listRuntimeSkillCatalog,
  resolveRuntimeSkillManifest } from './catalog.js';
import { hydrateSessionState, type HydrateSessionStateInput } from '../hydration/sessionHydration.js';
import { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(profile?: 'preview' | 'release') {
  const root = mkdtempSync(join(tmpdir(), 'cats-content-policy-'));
  roots.push(root);
  const skillsRoot = join(root, 'runtime-skills');
  const cwd = join(root, 'workspace');
  const sessionBaseDir = join(root, 'sessions');
  mkdirSync(cwd, { recursive: true });
  for (const [relative, id, text] of [
    ['chat/companion', 'companion', 'Ordinary product guidance.'],
    ['preview/cats-development', 'cats-development', 'PRIVATE_PREVIEW_INSTRUCTION'],
  ]) {
    const dir = join(skillsRoot, relative);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'),
      `---\nname: ${id}\ndescription: Fixture.\nfamily: chat\n---\n${text}\n`);
  }
  const setProfile = (value: 'preview' | 'release') => writeFileSync(
    join(skillsRoot, policy.SKILL_CONTENT_MANIFEST), JSON.stringify({ schemaVersion: 1, profile: value }),
  );
  if (profile) setProfile(profile);
  const input: HydrateSessionStateInput = {
    trigger: 'create', sessionId: 'session-one', providerName: 'claude', providerBackend: 'cli',
    runtimeCwd: cwd, sessionBaseDir, skillsRoot,
  };
  const resolve = (ids: string[], providerName = 'claude', workspaceMode: 'shared' | 'isolated' = 'shared') =>
    resolveRuntimeSkillManifest({ requestedSkills: ids }, {
      sessionId: input.sessionId, providerName, providerBackend: 'cli', cwd,
      sessionBaseDir, skillsRoot, workspaceMode,
    });
  return { root, cwd, skillsRoot, sessionBaseDir, input, resolve, setProfile };
}

describe('artifact skill content policy', () => {
  it('missing manifest means release and nearby preview bytes are not discoverable', () => {
    const f = fixture();
    expect(policy.loadRuntimeSkillContentPolicy(f.skillsRoot).profile).toBe('release');
    expect(listRuntimeSkillCatalog(f.skillsRoot).map((s) => s.id)).toEqual(['companion']);
    expect(() => f.resolve(['cats-development'])).toThrow(/Unknown runtime skill/u);
    expect(existsSync(f.sessionBaseDir)).toBe(false);
  });

  it.each([
    '{', '{"schemaVersion":2,"profile":"preview"}',
    '{"schemaVersion":1,"profile":"debug"}',
    '{"schemaVersion":1,"profile":"preview","grant":true}',
    '{"schemaVersion":1,"profile":"preview"}' + ' '.repeat(1024),
  ])('refuses invalid manifest %s', (manifest) => {
    const f = fixture();
    writeFileSync(join(f.skillsRoot, policy.SKILL_CONTENT_MANIFEST), manifest);
    expect(() => listRuntimeSkillCatalog(f.skillsRoot)).toThrow(/Invalid package/u);
  });

  it('profile changes invalidate a populated catalog and instruction cache', () => {
    const f = fixture('preview');
    expect(listRuntimeSkillCatalog(f.skillsRoot)).toHaveLength(2);
    const state = f.resolve(['cats-development']);
    expect(buildRuntimeSkillInstructionOverlay(state)).toContain('PRIVATE_PREVIEW_INSTRUCTION');
    f.setProfile('release');
    expect(listRuntimeSkillCatalog(f.skillsRoot).map((s) => s.id)).toEqual(['companion']);
    expect(() => f.resolve(['cats-development'])).toThrow();
    expect(() => buildRuntimeSkillInstructionOverlay(state)).toThrow(/release context/u);
    expect(buildRuntimeSkillInstructionOverlay(f.resolve(['companion']))).toContain('Ordinary product');
  });

  it('resource changes invalidate preview identity and are delivered with the package', () => {
    const f = fixture('preview');
    const resource = join(f.skillsRoot, 'preview', 'cats-development', 'procedure.md');
    writeFileSync(resource, 'First reviewed procedure.');
    const first = listRuntimeSkillCatalog(f.skillsRoot).find((s) => s.id === 'cats-development')!;
    writeFileSync(resource, 'Changed reviewed procedure.');
    const second = f.resolve(['cats-development'], 'codex', 'isolated')!;
    expect(second.resolvedSkills[0].fingerprint).not.toBe(first.fingerprint);
    expect(readFileSync(join(f.cwd, '.agents', 'skills', 'cats-development', 'procedure.md'), 'utf8'))
      .toBe('Changed reviewed procedure.');
    expect(f.resolve(['cats-development'], 'codex', 'isolated')?.delivery.mode).toBe('filesystem');
  });

  it('does not let a package-root environment override choose artifact authority', () => {
    const f = fixture('release');
    const before = policy.resolveArtifactSkillsRoot();
    vi.stubEnv('CATS_RUNTIME_PACKAGE_ROOT', f.root);
    expect(policy.resolveArtifactSkillsRoot()).toBe(before);
  });

  it('a package with missing assets cannot inherit an ancestor preview manifest', () => {
    const f = fixture('preview');
    const artifact = join(f.root, 'installed');
    mkdirSync(artifact);
    writeFileSync(join(artifact, 'package.json'), '{"name":"@cats-inc/cats-runtime"}');
    const resolved = policy.resolveArtifactSkillsRoot(pathToFileURL(join(artifact, 'build', 'entry.js')).href);
    expect(resolved).toBe(join(artifact, 'runtime-skills'));
    expect(policy.loadRuntimeSkillContentPolicy(resolved).profile).toBe('release');
  });

  it('marks preview intent before delivery failure and skill cleanup never clears it', () => {
    const f = fixture('preview');
    expect(() => resolveRuntimeSkillManifest({ requestedSkills: ['cats-development'], strict: true }, {
      sessionId: f.input.sessionId, providerName: 'unsupported-provider', providerBackend: 'cli',
      cwd: f.cwd, sessionBaseDir: f.sessionBaseDir, skillsRoot: f.skillsRoot,
    })).toThrow(/Strict runtime skill/u);
    expect(policy.hasRecordedPreviewExposure(f.sessionBaseDir, f.input.sessionId)).toBe(true);
    clearRuntimeSkillState(f.sessionBaseDir, f.input.sessionId);
    policy.recordPreviewExposure(f.sessionBaseDir, f.input.sessionId);
    expect(policy.hasRecordedPreviewExposure(f.sessionBaseDir, f.input.sessionId)).toBe(true);
  });

  it('fresh release resolution refuses stale Runtime-owned filesystem content without deleting it', () => {
    const f = fixture('preview');
    const state = f.resolve(['cats-development'], 'codex', 'isolated');
    expect(state?.delivery.mode).toBe('filesystem');
    const entry = join(f.cwd, '.agents', 'skills', 'cats-development', 'SKILL.md');
    const bytes = readFileSync(entry, 'utf8');
    f.setProfile('release');
    expect(() => f.resolve(['companion'], 'codex', 'isolated')).toThrow(/fresh workspace/u);
    expect(readFileSync(entry, 'utf8')).toBe(bytes);
  });

  it('preserves monotonic exposure through clear, metadata forgery, and fork', async () => {
    const f = fixture('preview');
    const fresh = await hydrateSessionState({ ...f.input, requestedSkills: { requestedSkills: ['cats-development'] } });
    expect(policy.readSkillContentProvenance(fresh.hydration)?.releaseCompatible).toBe(false);
    const cleared = await hydrateSessionState({ ...f.input, trigger: 'message',
      existingHydration: fresh.hydration,
      metadata: { runtimeSkillContent: { schemaVersion: 1, releaseCompatible: true } },
    });
    expect(cleared.skills).toBeUndefined();
    expect(policy.readSkillContentProvenance(cleared.hydration)?.releaseCompatible).toBe(false);
    const forked = await hydrateSessionState({ ...f.input, trigger: 'fork', sessionId: 'child',
      existingHydration: cleared.hydration });
    expect(policy.readSkillContentProvenance(forked.hydration)?.releaseCompatible).toBe(false);
    const release = policy.loadRuntimeSkillContentPolicy(fixture('release').skillsRoot);
    vi.spyOn(policy, 'getRuntimeSkillContentPolicy').mockReturnValue(release);
    await expect(hydrateSessionState({ ...f.input, trigger: 'resume', existingHydration: cleared.hydration }))
      .rejects.toThrow(/Start a new session/u);
  });

  it('ordinary preview sessions remain release-compatible, unknown retained contexts do not', async () => {
    const f = fixture('preview');
    const fresh = await hydrateSessionState({ ...f.input, requestedSkills: { requestedSkills: ['companion'] } });
    expect(policy.readSkillContentProvenance(fresh.hydration)?.releaseCompatible).toBe(true);
    const release = policy.loadRuntimeSkillContentPolicy(fixture('release').skillsRoot);
    vi.spyOn(policy, 'getRuntimeSkillContentPolicy').mockReturnValue(release);
    const resumed = await hydrateSessionState({ ...f.input, trigger: 'resume',
      existingHydration: fresh.hydration, existingSkills: fresh.skills });
    expect(resumed.skills?.appliedSkillIds).toEqual(['companion']);
    for (const trigger of ['resume', 'fork', 'message'] as const) {
      await expect(hydrateSessionState({ ...f.input, trigger })).rejects.toThrow(/Start a new session/u);
    }
    const cleanNew = await hydrateSessionState({ ...f.input, sessionId: 'new-release' });
    expect(policy.readSkillContentProvenance(cleanNew.hydration)?.releaseCompatible).toBe(true);
  });

  it('a crash marker overrides a previously persisted clean receipt', async () => {
    const f = fixture('preview');
    const fresh = await hydrateSessionState(f.input);
    policy.recordPreviewExposure(f.sessionBaseDir, f.input.sessionId);
    const release = policy.loadRuntimeSkillContentPolicy(fixture('release').skillsRoot);
    expect(() => policy.assertRetainedSkillContent({ policy: release, cwd: f.cwd,
      hydration: fresh.hydration, sessionId: f.input.sessionId, sessionBaseDir: f.sessionBaseDir,
    })).toThrow(/Start a new session/u);
    // Discovery aliases do not inherit the original's clean metadata.
    expect(() => policy.assertRetainedSkillContent({ policy: release, cwd: f.cwd })).toThrow();
  });

  it('rerooting or junctions cannot reclassify the reserved supplement as ordinary content', () => {
    const f = fixture('preview');
    expect(listRuntimeSkillCatalog(join(f.skillsRoot, 'preview'))).toEqual([]);
    if (process.platform === 'win32') {
      expect(listRuntimeSkillCatalog(join(f.skillsRoot, 'preview').toUpperCase())).toEqual([]);
    }
    const alias = join(f.root, 'alias');
    symlinkSync(join(f.skillsRoot, 'preview'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => listRuntimeSkillCatalog(alias)).toThrow(/junction/u);
  });

  it('a linked transitive preview resource is rejected before any exposure or delivery', () => {
    const f = fixture('preview');
    const link = join(f.skillsRoot, 'preview', 'cats-development', 'linked');
    symlinkSync(f.cwd, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => f.resolve(['cats-development'])).toThrow(/bounded local tree/u);
    expect(policy.hasRecordedPreviewExposure(f.sessionBaseDir, f.input.sessionId)).toBe(false);
  });

  it('new contexts in a preview-materialized workspace and forks after failed delivery stay tainted', async () => {
    const f = fixture('preview');
    const before = await hydrateSessionState(f.input);
    f.resolve(['cats-development'], 'codex', 'isolated');
    const fresh = await hydrateSessionState({ ...f.input, sessionId: 'new-in-same-workspace' });
    expect(policy.readSkillContentProvenance(fresh.hydration)?.releaseCompatible).toBe(false);
    const cleanCwd = join(f.root, 'clean-child');
    mkdirSync(cleanCwd);
    const child = await hydrateSessionState({ ...f.input, trigger: 'fork', sessionId: 'child',
      runtimeCwd: cleanCwd, existingHydration: before.hydration });
    expect(policy.hasRecordedPreviewExposure(f.sessionBaseDir, 'child')).toBe(true);
    expect(policy.readSkillContentProvenance(child.hydration)?.releaseCompatible).toBe(false);
  });

  it('workspace aliases cannot hide a preview marker on a physical ancestor', () => {
    const f = fixture('preview');
    f.resolve(['cats-development'], 'codex', 'isolated');
    const subdir = join(f.cwd, 'nested');
    mkdirSync(subdir);
    const alias = join(f.root, 'workspace-alias');
    symlinkSync(subdir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const release = policy.loadRuntimeSkillContentPolicy(fixture('release').skillsRoot);
    for (const cwd of [alias, join(alias, 'not-created-yet')]) {
      expect(() => policy.assertReleaseWorkspace(cwd, release)).toThrow(/fresh workspace/u);
    }
  });

  it('cwd-only discovery cannot attach old native history with clean provenance', async () => {
    const f = fixture('preview');
    const fresh = await hydrateSessionState(f.input);
    const registry = new SessionRegistry();
    registry.create({ id: f.input.sessionId, providerName: 'claude', cwd: f.cwd, hydration: fresh.hydration });
    const attached = registry.upsertDiscovered('unknown-native-thread', { providerName: 'claude', cwd: f.cwd });
    expect(attached?.id).toBe(f.input.sessionId);
    expect(policy.readSkillContentProvenance(attached?.hydration)?.releaseCompatible).toBe(false);
  });

  it('loaded aliases never discard exposure authority or become clean through merge order', async () => {
    const f = fixture('preview');
    const fresh = await hydrateSessionState(f.input);
    const registry = new SessionRegistry();
    const session = registry.create({ id: f.input.sessionId, providerName: 'claude', cwd: f.cwd, hydration: fresh.hydration });
    registry.setProviderSessionId(session.id, 'same-native-thread');
    for (const firstHasHydration of [true, false]) {
      const dataDir = join(f.root, firstHasHydration ? 'first-proof' : 'second-proof');
      mkdirSync(dataDir);
      writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify([
        { ...session, hydration: firstHasHydration ? fresh.hydration : undefined },
        { ...session, id: 'discarded-alias', hydration: fresh.hydration },
      ]));
      const restored = new SessionRegistry(dataDir, f.sessionBaseDir);
      expect(restored.list()).toHaveLength(1);
      expect(policy.readSkillContentProvenance(restored.list()[0].hydration)?.releaseCompatible).toBe(false);
      restored.flush();
    }
  });
});
