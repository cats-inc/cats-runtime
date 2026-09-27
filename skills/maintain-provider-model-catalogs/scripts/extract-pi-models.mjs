#!/usr/bin/env node

// Reads one Pi provider channel's models from an installed @earendil-works/pi-coding-agent package:
// ids, names, input types, limits, and each model's thinking levels computed by Pi's own
// getSupportedThinkingLevels, plus Pi's built-in default thinking level and SHA-256 hashes of the
// files read. It never launches Pi and never reads auth.json or settings. An optional
// models-store.json path is compared by model id only.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function findPiAi(packageDir) {
  for (const candidate of [
    join(packageDir, 'node_modules', '@earendil-works', 'pi-ai'),
    join(dirname(packageDir), 'pi-ai'),
  ]) {
    if (existsSync(join(candidate, 'dist', 'models.generated.js'))) return candidate;
  }
  throw new Error(`No @earendil-works/pi-ai with dist/models.generated.js next to ${packageDir}.`);
}

export async function extractPiModels({ packageDir, provider = 'openai-codex', storePath }) {
  const piPackage = resolve(packageDir);
  const piAi = findPiAi(piPackage);
  const files = {
    'pi-coding-agent/package.json': join(piPackage, 'package.json'),
    'pi-coding-agent/dist/core/defaults.js': join(piPackage, 'dist', 'core', 'defaults.js'),
    'pi-ai/package.json': join(piAi, 'package.json'),
    'pi-ai/dist/models.generated.js': join(piAi, 'dist', 'models.generated.js'),
    'pi-ai/dist/models.js': join(piAi, 'dist', 'models.js'),
  };
  for (const [name, path] of Object.entries(files)) {
    if (!existsSync(path)) throw new Error(`Missing ${name} at ${path}.`);
  }
  const { MODELS } = await import(pathToFileURL(files['pi-ai/dist/models.generated.js']).href);
  const { getSupportedThinkingLevels } = await import(pathToFileURL(files['pi-ai/dist/models.js']).href);
  const { DEFAULT_THINKING_LEVEL } = await import(pathToFileURL(files['pi-coding-agent/dist/core/defaults.js']).href);
  const channel = MODELS?.[provider];
  if (!channel) {
    throw new Error(`Provider '${provider}' is not in the Pi registry. Known: ${Object.keys(MODELS ?? {}).join(', ')}.`);
  }
  const models = Object.entries(channel).map(([id, model]) => ({
    id,
    name: model.name ?? null,
    input: model.input ?? [],
    reasoning: Boolean(model.reasoning),
    thinkingLevels: getSupportedThinkingLevels(model),
    thinkingLevelMap: model.thinkingLevelMap ?? null,
    contextWindow: model.contextWindow ?? null,
    maxTokens: model.maxTokens ?? null,
  }));
  const result = {
    piVersion: JSON.parse(readFileSync(files['pi-coding-agent/package.json'], 'utf8')).version,
    piAiVersion: JSON.parse(readFileSync(files['pi-ai/package.json'], 'utf8')).version,
    provider,
    defaultThinkingLevel: DEFAULT_THINKING_LEVEL ?? null,
    count: models.length,
    models,
  };
  if (storePath) {
    const store = JSON.parse(readFileSync(resolve(storePath), 'utf8'))[provider];
    const storeModels = Array.isArray(store?.models) ? store.models : Object.values(store?.models ?? {});
    const storeIds = storeModels.map((model) => model.id);
    const registryIds = models.map((model) => model.id);
    result.store = {
      checkedAt: typeof store?.checkedAt === 'number' ? new Date(store.checkedAt).toISOString() : null,
      count: storeIds.length,
      sameIdsAndOrder: JSON.stringify(storeIds) === JSON.stringify(registryIds),
      onlyInStore: storeIds.filter((id) => !registryIds.includes(id)),
      onlyInRegistry: registryIds.filter((id) => !storeIds.includes(id)),
    };
  }
  result.sources = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, sha256(path)]));
  return result;
}

function cliUsage() {
  return [
    'Usage:',
    '  extract-pi-models.mjs --package <pi-coding-agent dir> [--provider <id>] [--store <models-store.json>]',
    '',
    'The package is <npm root -g>/@earendil-works/pi-coding-agent for an npm install; the provider',
    'defaults to openai-codex. --store compares ~/.pi/agent/models-store.json by model id.',
  ].join('\n');
}

async function main() {
  try {
    const { values } = parseArgs({ options: {
      package: { type: 'string' },
      provider: { type: 'string' },
      store: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    } });
    if (values.help || !values.package) {
      process.stdout.write(`${cliUsage()}\n`);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const result = await extractPiModels({ packageDir: values.package, provider: values.provider, storePath: values.store });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
