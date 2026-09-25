import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildRuntimeSkillInstructionOverlay, listRuntimeSkillCatalog, resolveRuntimeSkillManifest,
  verifyRuntimeSkillCatalog } from './catalog.js';

const ids = ['cats-inc-development', 'cats-platform-operation', 'cats-practice-and-distill'];
const library = join(process.cwd(), 'runtime-skills');
const roots: string[] = [];
function root() {
  const result = mkdtempSync(join(tmpdir(), 'cats-preview-library-'));
  roots.push(result);
  return result;
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('ships three complete preview packages alongside the unchanged ordinary library', () => {
  const catalog = listRuntimeSkillCatalog(library);
  expect(verifyRuntimeSkillCatalog(library).totalSkills).toBe(36);
  expect(catalog.filter((skill) => ids.includes(skill.id)).map((skill) => skill.id).sort()).toEqual(ids);
  const releaseRoot = join(root(), 'runtime-skills');
  cpSync(library, releaseRoot, { recursive: true });
  writeFileSync(join(releaseRoot, 'content-profile.json'), JSON.stringify({ schemaVersion: 1, profile: 'release' }));
  const ordinary = listRuntimeSkillCatalog(releaseRoot);
  expect(ordinary).toHaveLength(33);
  expect(ordinary.map((skill) => skill.id).sort()).toEqual(catalog.filter((skill) => !ids.includes(skill.id)).map((skill) => skill.id).sort());
  for (const id of ids) expect(() => resolveRuntimeSkillManifest({ requestedSkills: [id] }, {
    sessionId: id, providerName: 'claude', providerBackend: 'cli', cwd: root(),
    sessionBaseDir: root(), skillsRoot: releaseRoot,
  })).toThrow(/Unknown runtime skill/u);
}, 30_000);

it.each(['claude', 'pi', 'codex'])('delivers the actual supplement to %s without a provider call', (providerName) => {
  const cwd = root();
  const state = resolveRuntimeSkillManifest({ requestedSkills: ids }, {
    sessionId: 'preview-delivery', providerName, providerBackend: 'cli',
    cwd, sessionBaseDir: root(), workspaceMode: 'isolated', skillsRoot: library,
  })!;
  expect(state.delivery.status).toBe('applied');
  expect(state.resolvedSkills.every((skill) => skill.contentProfile === 'preview')).toBe(true);
  if (providerName !== 'codex') {
    const delivered = providerName === 'pi'
      ? readFileSync(state.delivery.instructions!.filePath, 'utf8')
      : buildRuntimeSkillInstructionOverlay(state)!;
    for (const id of ids) {
      const source = readFileSync(join(library, 'preview', id, 'SKILL.md'), 'utf8');
      expect(delivered).toContain(source.split(/\r?\n---\r?\n/u)[1].trim());
    }
    return;
  }
  for (const id of ids) {
    const source = join(library, 'preview', id);
    const target = join(cwd, '.agents', 'skills', id);
    expect(readFileSync(join(target, 'SKILL.md'))).toEqual(readFileSync(join(source, 'SKILL.md')));
    for (const name of readdirSync(join(source, 'references'))) {
      expect(readFileSync(join(target, 'references', name))).toEqual(readFileSync(join(source, 'references', name)));
    }
  }
});
