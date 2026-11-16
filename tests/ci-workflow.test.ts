import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The release preflight skips its steps, never the required job, for documentation
// (docs/ and root agent instruction files that still exist) and for code that
// already passed: the same fingerprint earlier, or the merged pull request's run on
// the same tree. npm publication skips release:check only when the preflight on the
// commit on main ran that gate or skipped it as already tested, never as
// documentation only. These tests run the workflows' own shell steps against local
// repositories and a stubbed gh.
interface Step {
  id?: string; name?: string; if?: string; run?: string; uses?: string;
  with?: Record<string, unknown>; env?: Record<string, string>;
}
const preflight = parse(readFileSync('.github/workflows/release-preflight.yml', 'utf8'));
const publish = parse(readFileSync('.github/workflows/npm-publish.yml', 'utf8'));
const changesSteps = preflight.jobs.changes.steps as Step[];
const preflightSteps = preflight.jobs['release-preflight'].steps as Step[];
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

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [
    '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeIn(work: string, path: string, content: string): void {
  mkdirSync(dirname(join(work, path)), { recursive: true });
  writeFileSync(join(work, path), content);
}

function stepRun(id: string): string {
  const run = changesSteps.find((step) => step.id === id)?.run;
  expect(run, `the changes job has a ${id} step`).toBeTruthy();
  return run ?? '';
}

// A repository with code, docs and agent instruction files; each change starts
// from its base commit, so HEAD^1 is the base as in a pull request's merge.
function agentFilesRepo() {
  const work = tempRoot('cats-ci-paths-');
  git(work, 'init', '--quiet', '--initial-branch=main');
  for (const [path, content] of Object.entries({
    'AGENTS.md': 'shared rules\n', 'CLAUDE.md': 'claude rules\n', 'CODEX.md': 'codex rules\n',
    'docs/guide.md': 'guide\n', 'src/code.ts': 'code\n', 'sub/AGENTS.md': 'nested rules\n',
  })) writeIn(work, path, content);
  git(work, 'add', '.');
  git(work, 'commit', '--quiet', '-m', 'base');
  const base = git(work, 'rev-parse', 'HEAD');
  const change = (edit: () => void) => {
    git(work, 'checkout', '--quiet', '--force', '--detach', base);
    edit();
    git(work, 'add', '--all');
    git(work, 'commit', '--quiet', '--allow-empty', '-m', 'change');
  };
  // A root AGENTS.md replaced by a symlink with the same text: a type change.
  const symlinkAgents = () => {
    git(work, 'checkout', '--quiet', '--force', '--detach', base);
    const blob = git(work, 'rev-parse', `${base}:AGENTS.md`);
    git(work, 'update-index', '--cacheinfo', `120000,${blob},AGENTS.md`);
    git(work, 'commit', '--quiet', '-m', 'symlink');
  };
  return {
    work, base, change, symlinkAgents,
    write: (path: string, content: string) => writeIn(work, path, content),
    remove: (path: string) => git(work, 'rm', '--quiet', path),
    move: (from: string, to: string) => {
      mkdirSync(dirname(join(work, to)), { recursive: true });
      git(work, 'mv', from, to);
    },
  };
}

function stubGh(bin: string): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$2" >> "$STUB_LOG"',
    'case "$2" in',
    '  */pulls) [ -n "${STUB_PULLS:-}" ] || exit 1; printf \'%s\\n\' "$STUB_PULLS" ;;',
    '  */actions/workflows/*) [ -n "${STUB_PASSED:-}" ] || exit 1; printf \'%s\\n\' "$STUB_PASSED" ;;',
    '  */actions/runs/*/jobs) [ -n "${STUB_STEPS:-}" ] || exit 1; printf \'%s\\n\' "$STUB_STEPS" ;;',
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
    expect(changesSteps.find((step) => step.id === 'plan')?.env?.MERGED).toBe('${{ steps.merged.outputs.tested }}');
    const root = tempRoot('cats-ci-merged-');
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    const bin = join(root, 'bin');
    const write = (path: string, content: string) => writeIn(work, path, content);
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

  it('counts docs/ and root agent instruction files that still exist as documentation', () => {
    const repo = agentFilesRepo();
    const detect = (env: Record<string, string> = {}) =>
      runStep(stepRun('paths'), repo.work, { EVENT: 'pull_request', BEFORE: '', ...env });
    const after = (edit: () => void) => {
      repo.change(edit);
      return detect();
    };
    expect(after(() => repo.write('AGENTS.md', 'edited rules\n')), 'a root AGENTS.md edit is documentation')
      .toBe('code=false');
    expect(after(() => {
      repo.write('docs/guide.md', 'edited guide\n');
      repo.write('CODEX.md', 'edited codex rules\n');
      repo.write('GEMINI.md', 'new gemini rules\n');
    }), 'docs/ with edited and added root agent files is documentation').toBe('code=false');
    expect(after(() => repo.write('docs/使用說明.md', '說明\n')), 'a non-ASCII docs/ path is documentation')
      .toBe('code=false');
    expect(after(() => repo.write('src/說明.ts', 'code\n')), 'a non-ASCII path outside docs/ is code')
      .toBe('code=true');
    expect(after(() => repo.remove('CLAUDE.md')), 'a deleted root CLAUDE.md is code').toBe('code=true');
    expect(after(() => repo.move('CODEX.md', 'docs/CODEX.md')), 'a renamed root agent file is code').toBe('code=true');
    expect(after(() => repo.move('src/code.ts', 'docs/code.ts')), 'code moved into docs/ is code').toBe('code=true');
    expect(after(() => repo.write('sub/AGENTS.md', 'edited nested rules\n')), 'a nested sub/AGENTS.md is code')
      .toBe('code=true');
    expect(after(() => repo.write('AGENTS.md.bootstrap', 'proposed rules\n')), 'only the four exact names count')
      .toBe('code=true');
    expect(after(() => {
      repo.write('AGENTS.md', 'edited rules\n');
      repo.write('src/code.ts', 'edited code\n');
    })).toBe('code=true');
    expect(after(() => undefined), 'an empty diff runs every check').toBe('code=true');
    repo.symlinkAgents();
    expect(detect(), 'a root agent file that changes type is code').toBe('code=true');

    repo.change(() => repo.write('AGENTS.md', 'edited rules\n'));
    expect(detect({ EVENT: 'push', BEFORE: repo.base }), 'a push compares with the previous main').toBe('code=false');
    expect(detect({ EVENT: 'push', BEFORE: '' }), 'an unknown base runs every check').toBe('code=true');
    expect(detect({ EVENT: 'push', BEFORE: '0'.repeat(40) }), 'a new branch runs every check').toBe('code=true');
    expect(detect({ EVENT: 'push', BEFORE: 'f'.repeat(40) }), 'a missing base runs every check').toBe('code=true');
    expect(detect({ EVENT: 'workflow_dispatch' }), 'a manual run runs every check').toBe('code=true');
  }, 60_000);

  it('fingerprints every tracked file outside docs/ and the root agent files only by mode, type and path', () => {
    const repo = agentFilesRepo();
    const fingerprint = () => runStep(stepRun('fingerprint'), repo.work, {});
    const base = fingerprint();
    expect(base).toMatch(/^fingerprint=[0-9a-f]{64}$/);
    const after = (edit: () => void) => {
      repo.change(edit);
      return fingerprint();
    };
    expect(after(() => repo.write('AGENTS.md', 'edited rules\n')), 'root agent file content').toBe(base);
    expect(after(() => repo.write('docs/guide.md', 'edited guide\n')), 'docs/ content').toBe(base);
    expect(after(() => repo.write('docs/使用說明.md', '說明\n')), 'a non-ASCII docs/ path').toBe(base);
    expect(after(() => repo.write('GEMINI.md', 'new gemini rules\n')), 'an added root agent file').not.toBe(base);
    expect(after(() => repo.remove('CLAUDE.md')), 'a deleted root agent file').not.toBe(base);
    expect(after(() => repo.write('sub/AGENTS.md', 'edited nested rules\n')), 'a nested AGENTS.md').not.toBe(base);
    expect(after(() => repo.write('src/code.ts', 'edited code\n')), 'code').not.toBe(base);
    repo.symlinkAgents();
    expect(fingerprint(), 'a root agent file that changes type').not.toBe(base);
  }, 60_000);

  it('skips documentation first, then code that already passed, and otherwise runs every step', () => {
    const root = tempRoot('cats-ci-plan-');
    const plan = (CODE: string, GREEN: string, MERGED: string) => runStep(stepRun('plan'), root, { CODE, GREEN, MERGED });
    expect(plan('false', 'true', 'true')).toBe('skip=docs');
    expect(plan('true', 'true', '')).toBe('skip=tested');
    expect(plan('true', '', 'true')).toBe('skip=tested');
    expect(plan('true', 'false', 'false')).toBe('skip=');
    expect(plan('true', '', '')).toBe('skip=');
    expect(plan('', '', ''), 'a failed detection runs every step').toBe('skip=');
  });

  it('skips the preflight steps, never the required job, and records only a full green run', () => {
    const changes = preflight.jobs.changes;
    expect(changes.outputs).toEqual({
      code: '${{ steps.paths.outputs.code }}',
      fingerprint: '${{ steps.fingerprint.outputs.fingerprint }}',
      skip: '${{ steps.plan.outputs.skip }}',
    });
    const green = changesSteps.find((step) => step.id === 'green');
    expect(green?.uses).toBe('actions/cache/restore@v4');
    expect(green?.if).toBe("steps.paths.outputs.code == 'true' && github.event_name != 'workflow_dispatch'");
    expect(green?.with).toEqual({
      path: '.ci-green', key: 'ci-green-v1-${{ steps.fingerprint.outputs.fingerprint }}', 'lookup-only': true,
    });
    expect(changesSteps.find((step) => step.id === 'plan')?.env).toEqual({
      CODE: '${{ steps.paths.outputs.code }}',
      GREEN: '${{ steps.green.outputs.cache-hit }}',
      MERGED: '${{ steps.merged.outputs.tested }}',
    });

    const job = preflight.jobs['release-preflight'];
    expect(job.needs).toBe('changes');
    expect(job.if, 'a failed detection still runs the required job').toBe('${{ !cancelled() }}');
    expect(job.name).toBeUndefined();
    expect(job.strategy).toBeUndefined();
    expect(job.env, 'a skip counts only from a changes job that succeeded').toEqual({
      SKIP: "${{ needs.changes.result == 'success' && needs.changes.outputs.skip || '' }}",
    });
    const byName = (name: string) => preflightSteps.find((step) => step.name === name);
    expect(byName('Documentation-only change')?.if).toBe("env.SKIP == 'docs'");
    expect(byName('Already tested')?.if).toBe("env.SKIP == 'tested'");
    expect(byName('Run release preflight')?.run).toBe('npm run release:check');
    const notices = new Set(['Documentation-only change', 'Already tested']);
    for (const step of preflightSteps.filter((candidate) => !notices.has(candidate.name ?? ''))) {
      expect(step.if, `${step.name} runs only without a skip`).toMatch(/^env\.SKIP == ''/);
      expect(step.if, `${step.name} keeps the implicit success()`).not.toMatch(/always\(\)|failure\(\)/);
    }
    expect(preflightSteps.some((step) => /needs\.changes\.outputs\.skip/.test(step.if ?? '')),
      'steps read the skip only through env.SKIP').toBe(false);
    const recorded = "env.SKIP == '' && needs.changes.outputs.fingerprint != ''";
    expect(byName('Record this code as tested')?.if).toBe(recorded);
    const save = byName('Save the tested marker');
    expect(save?.if).toBe(recorded);
    expect(save?.uses).toBe('actions/cache/save@v4');
    expect(save?.with).toEqual({ path: '.ci-green', key: 'ci-green-v1-${{ needs.changes.outputs.fingerprint }}' });
    expect(preflightSteps.indexOf(save as Step), 'the marker is saved last').toBe(preflightSteps.length - 1);
  });

  it('skips release:check in npm publication only after the preflight ran or reused the gate on the commit on main', () => {
    expect(publish.permissions.actions).toBe('read');
    const steps = publish.jobs.publish.steps as Step[];
    const gate = steps.find((step) => step.name === 'Run release gate');
    expect(gate?.if).toBe("steps.ci.outputs.tested != 'true'");
    expect(steps.find((step) => step.name === 'Install dependencies')?.if).toBeUndefined();
    const check = steps.find((step) => step.id === 'ci');
    expect(check?.if, 'the lookup itself always runs').toBeUndefined();
    // The lookup names the preflight's gate and tested-skip steps, never its docs notice.
    const preflightNames = preflightSteps.map((step) => step.name);
    for (const name of ['Run release preflight', 'Already tested']) {
      expect(preflightNames).toContain(name);
      expect(check?.run).toContain(name);
    }
    expect(check?.run).not.toContain('Documentation-only change');
    const root = tempRoot('cats-publish-check-');
    const bin = join(root, 'bin');
    stubGh(bin);
    const sha = 'a'.repeat(40);
    const lookup = (run: string, passedSteps: string[]) => runStep(check?.run ?? '', root, {
      PATH: `${bin}${delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'cats-inc/cats-runtime', GITHUB_SHA: sha,
      STUB_PASSED: run, STUB_STEPS: passedSteps.join('\n'), STUB_LOG: join(root, 'gh.log'),
    });
    expect(lookup('4242', ['Set up job', 'Checkout', 'Install dependencies', 'Run release preflight']),
      'the preflight ran the gate').toBe('tested=true');
    const log = readFileSync(join(root, 'gh.log'), 'utf8');
    expect(log).toContain(
      `actions/workflows/release-preflight.yml/runs?head_sha=${sha}&event=push&branch=main&status=success`);
    expect(log).toContain('repos/cats-inc/cats-runtime/actions/runs/4242/jobs');
    expect(lookup('4242', ['Set up job', 'Already tested']), 'the same code already passed').toBe('tested=true');
    expect(lookup('4242', ['Set up job', 'Documentation-only change']),
      'a documentation-only skip proves nothing about the code').toBe('tested=false');
    expect(lookup('4242', ['Run release preflight checks']), 'step names match exactly').toBe('tested=false');
    expect(lookup('4242', []), 'a failed jobs lookup runs the gate').toBe('tested=false');
    expect(lookup('', ['Run release preflight']), 'without a passing main run the gate runs as before')
      .toBe('tested=false');
    expect(lookup('not-a-run', ['Run release preflight']), 'an unexpected run id runs the gate').toBe('tested=false');
  }, 30_000);
});
