import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// CI skips application checks when a change touches only documentation: docs/,
// plus a root AGENTS.md, CLAUDE.md, CODEX.md or GEMINI.md that still exists. So
// no test or script may read repository documentation, and the root agent files
// may only be checked for existence. Executable inputs live under tests/fixtures/
// (captured provider output under tests/fixtures/provider-captures/).
const repoRoot = process.cwd();
const scanned = ['tests', 'scripts', 'src'];
const sourceFile = /\.(?:[cm]?js|[cm]?ts|tsx)$/;
// A quoted path that starts at docs/, or a 'docs' segment passed to join/resolve.
const docsPath = /['"`](?:\.{1,2}\/)*docs\/|['"`]docs['"`]\s*[,)]/;
// A quoted root agent file name. A nested path such as 'sub/AGENTS.md' is code.
const rootAgentFile = /['"`](?:\.{1,2}\/)*(?:AGENTS|CLAUDE|CODEX|GEMINI)\.md['"`]/;
const existenceCheck = /\bexistsSync\(/;

// A single line that names docs/ or a root agent file without reading it carries
// a trailing `docs-boundary-ignore: <reason>` comment.
const ignoreMarker = /docs-boundary-ignore: \S/;

// Files whose docs/ and agent file paths name files generated inside a temporary
// workspace or repository, never this repository's documentation.
const generatedWorkspacePaths: Record<string, string> = {
  'tests/workspace-substrate.test.ts': 'asserts files WorkspaceSubstrateService writes into temporary workspaces',
  'tests/workspace-substrate-bin.test.ts': 'asserts files the substrate CLI writes into a temporary workspace',
  'tests/ci-workflow.test.ts': 'runs the CI path rules against temporary repositories',
};

// Files that name root agent files only inside temporary workspaces or as values.
const agentFileWorkspacePaths: Record<string, string> = {
  ...generatedWorkspacePaths,
  'tests/package-contract.test.ts': 'expects an audit action for a temporary consumer workspace',
  'src/backends/cli/pool/SessionRegistry.test.ts': 'uses AGENTS.md as a changed-path value',
  'src/core/tools/LocalToolRuntime.test.ts': 'asserts workspace substrate files in temporary workspaces',
  'src/http/workspaceSubstrateRoutes.test.ts': 'asserts workspace substrate files in temporary workspaces',
};

function listSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'generated' ? [] : listSources(path);
    return sourceFile.test(entry.name) ? [path] : [];
  });
}

function namesDocs(line: string): boolean {
  return docsPath.test(line) && !ignoreMarker.test(line);
}

function readsRootAgentFile(line: string): boolean {
  return rootAgentFile.test(line) && !existenceCheck.test(line) && !ignoreMarker.test(line);
}

function violations(flagged: (line: string) => boolean, exempt: Record<string, string>): string[] {
  return scanned.flatMap(root => listSources(join(repoRoot, root)))
    .map(path => relative(repoRoot, path).split(sep).join('/'))
    .filter(path => path !== 'tests/docs-boundary.test.ts' && !(path in exempt))
    // Production source is packaged without docs; only its tests and scripts can read them.
    .filter(path => !path.startsWith('src/') || /\.test\.[cm]?[jt]sx?$/.test(path))
    .flatMap(path => readFileSync(join(repoRoot, path), 'utf8').split(/\r?\n/)
      .map((line, index) => ({ line, at: `${path}:${index + 1}` }))
      .filter(({ line }) => flagged(line))
      .map(({ at, line }) => `${at}: ${line.trim()}`));
}

describe('documentation boundary', () => {
  it('keeps tests and scripts independent of repository docs', () => {
    expect(violations(namesDocs, generatedWorkspacePaths), 'Move executable inputs under tests/fixtures/ instead of reading docs/.')
      .toEqual([]);
  });

  it('keeps tests and scripts from reading the root agent instruction files', () => {
    expect(violations(readsRootAgentFile, agentFileWorkspacePaths), 'Check only that a root agent file exists.')
      .toEqual([]);
  });

  it('flags a read of a root agent file but not an existence check or a nested file', () => {
    expect(readsRootAgentFile("readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')")).toBe(true);
    expect(readsRootAgentFile('readFileSync("./CLAUDE.md", "utf8")')).toBe(true);
    expect(readsRootAgentFile("const rules = '../GEMINI.md';")).toBe(true);
    expect(readsRootAgentFile("for (const name of ['CODEX.md']) read(name);")).toBe(true);
    expect(readsRootAgentFile("if (!existsSync(join(projectRoot, 'AGENTS.md'))) {")).toBe(false);
    expect(readsRootAgentFile("readFileSync(join(root, 'sub/AGENTS.md'), 'utf8')")).toBe(false);
    expect(readsRootAgentFile("readFileSync('AGENTS.md.bootstrap', 'utf8')")).toBe(false);
    expect(readsRootAgentFile("join(root, 'AGENTS.md') // docs-boundary-ignore: names a temporary file")).toBe(false);
  });
});
