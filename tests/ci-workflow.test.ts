import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// A push to main skips the release preflight only when its merged pull request
// already passed on the same tree, and npm publication skips release:check only
// when the preflight passed on the commit on main. These tests run the workflows'
// own shell steps against a local origin and a stubbed gh.
interface Step { id?: string; name?: string; if?: string; run?: string }
const preflight = parse(readFileSync('.github/workflows/release-preflight.yml', 'utf8'));
const publish = parse(readFileSync('.github/workflows/npm-publish.yml', 'utf8'));
const bash = process.platform === 'win32'
  ? resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '../../../bin/bash.exe')
  : 'bash';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function runStep(script: string, cwd: string, env: Record<string, string>): string {
  const output = join(tempRoot('cats-ci-output-'), 'output');
  writeFileSync(output, '');
  const result = spawnSync(bash, ['-e', '-o', 'pipefail', '-c', script], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env, GITHUB_OUTPUT: output.replaceAll('\\', '/') },
  });
  expect(result.status, result.stderr || String(result.error)).toBe(0);
  return readFileSync(output, 'utf8').trim();
}

function stubGh(bin: string): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$2" >> "$STUB_LOG"',
    'case "$2" in',
    '  */pulls) [ -n "${STUB_PULLS:-}" ] || exit 1; printf \'%s\\n\' "$STUB_PULLS" ;;',
    '  */actions/workflows/*) printf \'%s\\n\' "${STUB_PASSED:-0}" ;;',
    '  *) exit 1 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
}

describe('CI workflows', () => {
  it('lets a main push reuse its merged pull request\'s green run only for that exact tree on the previous main', () => {
    const changes = preflight.jobs.changes;
    const merged = (changes.steps as Step[]).find((step) => step.id === 'merged');
    expect(merged?.if).toBe("github.event_name == 'push' && steps.paths.outputs.code == 'true'");
    expect(changes.permissions).toEqual({ contents: 'read', 'pull-requests': 'read', actions: 'read' });
    expect(preflight.jobs['release-preflight'].if).toContain("needs.changes.outputs.tested != 'true'");
    const root = tempRoot('cats-ci-merged-');
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    const bin = join(root, 'bin');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', [
      '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args,
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), content);
    };
    const commit = (message: string) => {
      git(work, 'add', '.');
      git(work, 'commit', '-m', message);
      return git(work, 'rev-parse', 'HEAD');
    };
    git(root, 'init', '--bare', '--initial-branch=main', origin);
    mkdirSync(work);
    git(work, 'init', '--initial-branch=main');
    git(work, 'remote', 'add', 'origin', origin);
    write('src/code.ts', 'base\n');
    const base = commit('base');
    // Pull request #7 is up to date with main, so its squash lands the same tree.
    git(work, 'switch', '-c', 'pr-7');
    write('src/code.ts', 'pull request seven\n');
    const head7 = commit('pr 7');
    git(work, 'push', '--quiet', 'origin', `${head7}:refs/pull/7/head`);
    git(work, 'switch', 'main');
    git(work, 'merge', '--squash', 'pr-7');
    const squash7 = commit('squash #7');
    // Pull request #8 branched from the old main, and main moved before its squash.
    git(work, 'switch', '-c', 'pr-8', base);
    write('src/other.ts', 'pull request eight\n');
    const head8 = commit('pr 8');
    git(work, 'push', '--quiet', 'origin', `${head8}:refs/pull/8/head`);
    git(work, 'switch', 'main');
    git(work, 'merge', '--squash', 'pr-8');
    const squash8 = commit('squash #8');
    stubGh(bin);
    const reuse = (head: string, before: string, pulls: string, passed: string) => {
      git(work, 'checkout', '--quiet', head);
      return runStep(merged?.run ?? '', work, {
        PATH: `${bin}${delimiter}${process.env.PATH}`, REPO: 'cats-inc/cats-runtime', BEFORE: before,
        STUB_PULLS: pulls, STUB_PASSED: passed, STUB_LOG: join(root, 'gh.log'),
      });
    };
    expect(reuse(squash7, base, `7 ${head7}`, '1')).toBe('tested=true');
    expect(readFileSync(join(root, 'gh.log'), 'utf8')).toContain(
      `actions/workflows/release-preflight.yml/runs?head_sha=${head7}&event=pull_request&status=success`);
    expect(reuse(squash7, base, `7 ${head7}`, '0'), 'the pull request must have passed CI').toBe('tested=false');
    expect(reuse(squash7, base, '', '1'), 'a failed lookup runs every check').toBe('tested=false');
    expect(reuse(squash7, base, `7 ${head8}`, '1'), 'the reported head must be the pull request ref').toBe('tested=false');
    expect(reuse(squash7, base, `9 ${head7}`, '1'), 'an unknown pull request ref runs every check').toBe('tested=false');
    expect(reuse(squash7, '', `7 ${head7}`, '1')).toBe('tested=false');
    expect(reuse(squash8, base, `8 ${head8}`, '1'), 'a push of several commits runs every check').toBe('tested=false');
    expect(reuse(squash8, squash7, `8 ${head8}`, '1'), 'a head without the previous main was tested on other code')
      .toBe('tested=false');
  }, 60_000);

  it('skips release:check in npm publication only after the preflight passed on the commit on main', () => {
    expect(publish.permissions.actions).toBe('read');
    const steps = publish.jobs.publish.steps as Step[];
    const gate = steps.find((step) => step.name === 'Run release gate');
    expect(gate?.if).toBe("steps.ci.outputs.tested != 'true'");
    expect(steps.find((step) => step.name === 'Install dependencies')?.if).toBeUndefined();
    const check = steps.find((step) => step.id === 'ci');
    expect(check?.if, 'the lookup itself always runs').toBeUndefined();
    const root = tempRoot('cats-publish-check-');
    const bin = join(root, 'bin');
    stubGh(bin);
    const sha = 'a'.repeat(40);
    const lookup = (passed: string) => runStep(check?.run ?? '', root, {
      PATH: `${bin}${delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'cats-inc/cats-runtime', GITHUB_SHA: sha,
      STUB_PASSED: passed, STUB_LOG: join(root, 'gh.log'),
    });
    expect(lookup('1')).toBe('tested=true');
    expect(readFileSync(join(root, 'gh.log'), 'utf8')).toContain(
      `actions/workflows/release-preflight.yml/runs?head_sha=${sha}&event=push&branch=main&status=success`);
    expect(lookup('0'), 'without a passing main run the gate runs as before').toBe('tested=false');
    expect(lookup(''), 'a failed lookup runs the gate').toBe('tested=false');
  }, 30_000);
});
