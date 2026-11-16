import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// CI skips application checks when a change touches only docs/ or the root
// agent instructions (AGENTS.md, CLAUDE.md, CODEX.md, GEMINI.md), so no test or
// script may read repository documentation or those files. Executable inputs
// live under tests/fixtures/ (captured provider output under
// tests/fixtures/provider-captures/).
const repoRoot = process.cwd();
const scanned = ['tests', 'scripts', 'src'];
const sourceFile = /\.(?:[cm]?js|[cm]?ts|tsx)$/;
// A quoted path that starts at docs/, or a 'docs' segment passed to join/resolve.
const docsPath = /['"`](?:\.{1,2}\/)*docs\/|['"`]docs['"`]\s*[,)]/;
// A quoted root agent instruction file. Nested copies such as sub/AGENTS.md
// are ordinary files that CI tests.
const agentFile = /['"`](?:\.{1,2}\/)*(?:AGENTS|CLAUDE|CODEX|GEMINI)\.md['"`]/;
// Checking that a root agent file exists does not read it; the skill sync
// script requires the root AGENTS.md this way.
const existenceCheck = /\b(?:exists|l?stat|access)(?:Sync)?\(/;
const readsFile = /read/i;

// A single line that names docs/ or a root agent file without reading it
// carries a trailing `docs-boundary-ignore: <reason>` comment.
const ignoreMarker = /docs-boundary-ignore: \S/;

// Files whose docs/ and agent file paths name files generated inside a temporary
// workspace or repository, never this repository's documentation.
const generatedWorkspacePaths: Record<string, string> = {
  'tests/workspace-substrate.test.ts': 'asserts files WorkspaceSubstrateService writes into temporary workspaces',
  'tests/workspace-substrate-bin.test.ts': 'asserts files the substrate CLI writes into a temporary workspace',
  'tests/ci-workflow.test.ts': 'runs the CI path rules against temporary repositories',
};

function listSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'generated' ? [] : listSources(path);
    return sourceFile.test(entry.name) ? [path] : [];
  });
}

function readsDocumentation(line: string): boolean {
  if (ignoreMarker.test(line)) return false;
  if (docsPath.test(line)) return true;
  return agentFile.test(line) && !(existenceCheck.test(line) && !readsFile.test(line));
}

describe('documentation boundary', () => {
  it('covers root agent instructions but allows existence checks', () => {
    expect(readsDocumentation("readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')")).toBe(true);
    expect(readsDocumentation("await readFile(path.join(root, 'CLAUDE.md'));")).toBe(true);
    expect(readsDocumentation('readFileSync(`../GEMINI.md`);')).toBe(true);
    expect(readsDocumentation("const rules = './CODEX.md';")).toBe(true);
    expect(readsDocumentation("if (existsSync('CODEX.md')) readFileSync('CODEX.md');")).toBe(true);
    expect(readsDocumentation("if (!existsSync(join(projectRoot, 'AGENTS.md'))) {")).toBe(false);
    expect(readsDocumentation("readFileSync(join(root, 'sub/AGENTS.md'), 'utf8')")).toBe(false);
    expect(readsDocumentation("readFileSync('AGENTS.md.bootstrap', 'utf8')")).toBe(false);
    expect(readsDocumentation("seed(root, 'AGENTS.md'); // docs-boundary-ignore: temporary workspace")).toBe(false);
    expect(readsDocumentation("readFileSync(join(repoRoot, 'docs', 'guide.md'))")).toBe(true);
  });

  it('keeps tests and scripts independent of repository docs and root agent instructions', () => {
    const violations = scanned.flatMap(root => listSources(join(repoRoot, root)))
      .map(path => relative(repoRoot, path).split(sep).join('/'))
      .filter(path => path !== 'tests/docs-boundary.test.ts' && !(path in generatedWorkspacePaths))
      // Production source is packaged without docs; only its tests and scripts can read them.
      .filter(path => !path.startsWith('src/') || /\.test\.[cm]?[jt]sx?$/.test(path))
      .flatMap(path => readFileSync(join(repoRoot, path), 'utf8').split(/\r?\n/)
        .map((line, index) => ({ line, at: `${path}:${index + 1}` }))
        .filter(({ line }) => readsDocumentation(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`));
    expect(violations,
      'Move executable inputs under tests/fixtures/ instead of reading docs/ or the root agent instructions.')
      .toEqual([]);
  });
});
