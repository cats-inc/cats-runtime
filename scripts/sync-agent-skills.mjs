#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_NAME = '.cats-runtime-managed-skills';
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function usage() {
  return [
    'Usage: sync-agent-skills.mjs [options]',
    '',
    'Options:',
    '  --agent <name>             claude, codex, antigravity, or grok (default: both paths)',
    '  --clean                    Recreate repository-managed mirrors only',
    '  --project-root <path>      Override the cats-runtime repository root',
    '  --source-root <path>       Override developer-skills/ (for isolated tests)',
    '  --destination-root <path>  Override the mirror parent root (for isolated tests)',
    '  -h, --help                 Show this help',
  ].join('\n');
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    agent: null,
    clean: false,
    projectRoot: null,
    sourceRoot: null,
    destinationRoot: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--agent': {
        const value = readOptionValue(argv, index, '--agent');
        if (!['claude', 'codex', 'antigravity', 'grok'].includes(value)) {
          throw new Error(
            `Unsupported agent '${value}'. Expected claude, codex, antigravity, or grok.`,
          );
        }
        options.agent = value;
        index += 1;
        break;
      }
      case '--clean':
        options.clean = true;
        break;
      case '--project-root':
        options.projectRoot = readOptionValue(argv, index, '--project-root');
        index += 1;
        break;
      case '--source-root':
        options.sourceRoot = readOptionValue(argv, index, '--source-root');
        index += 1;
        break;
      case '--destination-root':
        options.destinationRoot = readOptionValue(argv, index, '--destination-root');
        index += 1;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument '${argument}'.`);
    }
  }

  return options;
}

function validateSkillName(name, source) {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Unsafe skill name '${name}' in ${source}. Names must match ${SKILL_NAME_PATTERN}.`,
    );
  }
}

function assertStrictDescendant(parentPath, childPath, label) {
  const relativePath = relative(parentPath, childPath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} '${childPath}' must stay inside '${parentPath}'.`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function discoverCanonicalSkills(sourceRoot) {
  if (!await pathExists(sourceRoot)) {
    return [];
  }

  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Canonical skill entries may not be symbolic links: '${join(sourceRoot, entry.name)}'.`);
    }
    if (!entry.isDirectory()) {
      continue;
    }
    validateSkillName(entry.name, sourceRoot);
    const root = join(sourceRoot, entry.name);
    const entrypoint = join(root, 'SKILL.md');
    if (!await pathExists(entrypoint)) {
      continue;
    }
    const entrypointStat = await lstat(entrypoint);
    if (!entrypointStat.isFile() || entrypointStat.isSymbolicLink()) {
      throw new Error(`Skill entrypoint '${entrypoint}' must be a regular file.`);
    }
    // Validate the complete source tree before any target preflight can create or remove files.
    await treeDigest(root);
    skills.push({ name: entry.name, root });
  }
  return skills;
}

async function appendTreeDigest(hash, root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = join(current, entry.name);
    const relativePath = relative(root, path).replaceAll('\\', '/');
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Skill trees may not contain symbolic links: '${path}'.`);
    }
    if (stat.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      await appendTreeDigest(hash, root, path);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Skill trees may contain only files and directories: '${path}'.`);
    }
    hash.update(`file\0${relativePath}\0`);
    hash.update(await readFile(path));
    hash.update('\0');
  }
}

async function treeDigest(root) {
  const hash = createHash('sha256');
  await appendTreeDigest(hash, root);
  return hash.digest('hex');
}

async function treesEqual(left, right) {
  const [leftStat, rightStat] = await Promise.all([lstat(left), lstat(right)]);
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) {
    return false;
  }
  const [leftDigest, rightDigest] = await Promise.all([
    treeDigest(left),
    treeDigest(right),
  ]);
  return leftDigest === rightDigest;
}

async function readManagedManifest(targetRoot) {
  const manifestPath = join(targetRoot, MANIFEST_NAME);
  if (!await pathExists(manifestPath)) {
    return new Set();
  }

  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`Managed skill manifest '${manifestPath}' must be a regular file.`);
  }

  const manifest = await readFile(manifestPath, 'utf8');
  const names = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const name of names) {
    validateSkillName(name, manifestPath);
  }
  return new Set(names);
}

async function writeManagedManifest(targetRoot, skillNames) {
  const manifestPath = join(targetRoot, MANIFEST_NAME);
  const next = skillNames.length > 0 ? `${skillNames.join('\n')}\n` : '';
  const previous = await pathExists(manifestPath)
    ? await readFile(manifestPath, 'utf8')
    : null;
  if (previous === next) {
    return false;
  }
  await writeFile(manifestPath, next, 'utf8');
  return true;
}

async function ensureSafeTargetRoot(destinationRoot, targetRoot) {
  assertStrictDescendant(destinationRoot, targetRoot, 'Agent discovery path');
  const physicalDestinationRoot = await realpath(destinationRoot);
  const segments = relative(destinationRoot, targetRoot).split(/[\\/]+/).filter(Boolean);
  let current = destinationRoot;

  for (const segment of segments) {
    current = join(current, segment);
    if (await pathExists(current)) {
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new Error(`Agent discovery paths may not contain symbolic links: '${current}'.`);
      }
      if (!currentStat.isDirectory()) {
        throw new Error(`Agent discovery path '${current}' must be a directory.`);
      }
    } else {
      // Create one level at a time only after its parent has passed the physical-path checks.
      await mkdir(current);
    }

    const physicalCurrent = await realpath(current);
    assertStrictDescendant(
      physicalDestinationRoot,
      physicalCurrent,
      'Physical agent discovery path',
    );
  }
}

async function preflightTarget(destinationRoot, targetRoot, skills) {
  await ensureSafeTargetRoot(destinationRoot, targetRoot);
  const managed = await readManagedManifest(targetRoot);

  for (const skill of skills) {
    const target = join(targetRoot, skill.name);
    assertStrictDescendant(targetRoot, target, 'Skill mirror');
    if (!await pathExists(target) || managed.has(skill.name)) {
      continue;
    }
    if (await treesEqual(skill.root, target)) {
      continue;
    }
    throw new Error(
      `Refusing to overwrite unmanaged skill '${target}'. Rename it or make it identical before syncing.`,
    );
  }

  return managed;
}

async function syncTarget({ targetRoot, skills, managed, clean }) {
  const canonicalNames = skills.map((skill) => skill.name);
  const canonicalSet = new Set(canonicalNames);
  let copied = 0;
  let removed = 0;
  let unchanged = 0;

  const namesToRemove = clean
    ? [...managed]
    : [...managed].filter((name) => !canonicalSet.has(name));
  for (const name of namesToRemove.sort()) {
    const target = join(targetRoot, name);
    assertStrictDescendant(targetRoot, target, 'Managed skill mirror');
    if (await pathExists(target)) {
      await rm(target, { recursive: true, force: true });
      removed += 1;
    }
  }

  for (const skill of skills) {
    const target = join(targetRoot, skill.name);
    assertStrictDescendant(targetRoot, target, 'Skill mirror');
    if (await pathExists(target)) {
      if (await treesEqual(skill.root, target)) {
        unchanged += 1;
        continue;
      }
      await rm(target, { recursive: true, force: true });
    }
    await cp(skill.root, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    copied += 1;
  }

  const manifestChanged = await writeManagedManifest(targetRoot, canonicalNames);
  return { copied, removed, unchanged, manifestChanged };
}

export async function syncAgentSkills(rawOptions = {}) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(rawOptions.projectRoot || join(scriptDir, '..'));
  if (!existsSync(join(projectRoot, 'AGENTS.md'))) {
    throw new Error(`Could not find cats-runtime project root at '${projectRoot}'.`);
  }

  const sourceRoot = resolve(rawOptions.sourceRoot || join(projectRoot, 'developer-skills'));
  const destinationRoot = resolve(rawOptions.destinationRoot || projectRoot);
  await mkdir(destinationRoot, { recursive: true });
  const sharedAgentsTarget = resolve(destinationRoot, '.agents', 'skills');
  const targetMap = {
    claude: resolve(destinationRoot, '.claude', 'skills'),
    codex: sharedAgentsTarget,
    antigravity: sharedAgentsTarget,
    grok: sharedAgentsTarget,
  };
  for (const [agent, targetRoot] of Object.entries(targetMap)) {
    assertStrictDescendant(destinationRoot, targetRoot, `${agent} discovery path`);
  }

  const agents = rawOptions.agent ? [rawOptions.agent] : ['claude', 'codex'];
  const skills = await discoverCanonicalSkills(sourceRoot);
  const targetPlans = [];
  for (const agent of agents) {
    const targetRoot = targetMap[agent];
    if (!targetRoot) {
      throw new Error(
        `Unsupported agent '${agent}'. Expected claude, codex, antigravity, or grok.`,
      );
    }
    targetPlans.push({
      agent,
      targetRoot,
      managed: await preflightTarget(destinationRoot, targetRoot, skills),
    });
  }

  const results = [];
  for (const plan of targetPlans) {
    const result = await syncTarget({
      targetRoot: plan.targetRoot,
      skills,
      managed: plan.managed,
      clean: rawOptions.clean === true,
    });
    results.push({ ...plan, ...result });
  }

  return {
    projectRoot,
    sourceRoot,
    destinationRoot,
    skills: skills.map((skill) => skill.name),
    results,
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = await syncAgentSkills(options);
    process.stdout.write(
      `Found ${result.skills.length} repository-maintenance skill(s) in ${result.sourceRoot}.\n`,
    );
    for (const target of result.results) {
      process.stdout.write(
        `Synced ${target.agent}: copied=${target.copied}, removed=${target.removed}, `
        + `unchanged=${target.unchanged}, manifestChanged=${target.manifestChanged}.\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
