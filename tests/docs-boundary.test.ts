import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// CI skips application checks when a change touches only docs/, so no test or
// script may read repository documentation. Executable inputs live under
// tests/fixtures/ (captured provider output under tests/fixtures/provider-captures/).
const repoRoot = process.cwd();
const scanned = ['tests', 'scripts', 'src'];
const sourceFile = /\.(?:[cm]?js|[cm]?ts|tsx)$/;
// A quoted path that starts at docs/, or a 'docs' segment passed to join/resolve.
const docsPath = /['"`](?:\.{1,2}\/)*docs\/|['"`]docs['"`]\s*[,)]/;

// A single line that names docs/ without reading it carries a trailing
// `docs-boundary-ignore: <reason>` comment.
const ignoreMarker = /docs-boundary-ignore: \S/;

// Files whose docs/ paths name files generated inside a temporary workspace,
// never this repository's documentation.
const generatedWorkspacePaths: Record<string, string> = {
  'tests/workspace-substrate.test.ts': 'asserts files WorkspaceSubstrateService writes into temporary workspaces',
  'tests/workspace-substrate-bin.test.ts': 'asserts files the substrate CLI writes into a temporary workspace',
};

function listSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'generated' ? [] : listSources(path);
    return sourceFile.test(entry.name) ? [path] : [];
  });
}

describe('documentation boundary', () => {
  it('keeps tests and scripts independent of repository docs', () => {
    const violations = scanned.flatMap(root => listSources(join(repoRoot, root)))
      .map(path => relative(repoRoot, path).split(sep).join('/'))
      .filter(path => path !== 'tests/docs-boundary.test.ts' && !(path in generatedWorkspacePaths))
      // Production source is packaged without docs; only its tests and scripts can read them.
      .filter(path => !path.startsWith('src/') || /\.test\.[cm]?[jt]sx?$/.test(path))
      .flatMap(path => readFileSync(join(repoRoot, path), 'utf8').split(/\r?\n/)
        .map((line, index) => ({ line, at: `${path}:${index + 1}` }))
        .filter(({ line }) => docsPath.test(line) && !ignoreMarker.test(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`));
    expect(violations, 'Move executable inputs under tests/fixtures/ instead of reading docs/.').toEqual([]);
  });
});
