#!/usr/bin/env node

// Maps Junie's picker names to the IDs its `--model` option accepts. `--model` resolves only
// aliases and setting IDs (such as `gemini-3.7-flash`), never picker names such as
// `Gemini 3.7 Flash`. This reads the enum from the installed JAR with the JVM bundled beside it,
// using Java's single-file source launch. It starts neither the Junie CLI nor an agent.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const JAVA_SOURCE = String.raw`
import java.lang.reflect.Method;

public class JunieModelIds {
  public static void main(String[] args) throws Exception {
    Class<?> specific = Class.forName("com.intellij.ml.llm.matterhorn.llm.ModelOption$Specific");
    Class<?> option = Class.forName("com.intellij.ml.llm.matterhorn.llm.ModelOption");
    Method settingId = Class.forName("com.intellij.ml.llm.matterhorn.llm.ModelParametersKt")
        .getMethod("getSettingId", option);
    Method displayName = null;
    for (String name : new String[] {"getExactDisplayName", "getDisplayName"}) {
      try { displayName = specific.getMethod(name); break; } catch (NoSuchMethodException ignored) {}
    }
    for (Object entry : specific.getEnumConstants()) {
      System.out.println("model\t" + ((Enum<?>) entry).name() + "\t" + settingId.invoke(null, entry)
          + "\t" + (displayName == null ? "" : displayName.invoke(entry)));
    }
    Class<?> alias = Class.forName("com.intellij.ml.llm.matterhorn.llm.ModelAlias");
    Method getAlias = alias.getMethod("getAlias");
    for (Object entry : alias.getEnumConstants()) System.out.println("alias\t" + getAlias.invoke(entry));
  }
}
`;

/** Parses the probe's tab-separated `model` and `alias` lines. */
export function parseJunieModelIds(text) {
  const models = [];
  const aliases = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const [kind, ...fields] = line.split('\t');
    if (kind === 'model' && fields.length === 3 && fields[1]) {
      models.push({ enumName: fields[0], settingId: fields[1], displayName: fields[2] || null });
    } else if (kind === 'alias' && fields.length === 1 && fields[0]) {
      aliases.push(fields[0]);
    } else {
      throw new Error(`Unexpected probe line: ${line}`);
    }
  }
  if (models.length === 0) throw new Error('The probe printed no models.');
  return { models, aliases };
}

/** Finds the first file matching `test` under `root`, at most `depth` directories down. */
function findFile(root, test, depth) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && test(join(root, entry.name))) return join(root, entry.name);
  }
  if (depth === 0) return null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findFile(join(root, entry.name), test, depth - 1);
    if (found) return found;
  }
  return null;
}

/** The installed version's directory, as the managed shim resolves it from `current`. */
export function resolveJunieHome(dataDir) {
  const version = readFileSync(join(dataDir, 'current'), 'utf8').split(/\r?\n/u)[0].trim();
  if (!version || /[\\/]|\.\./u.test(version)) throw new Error(`Unusable Junie version '${version}'.`);
  return join(dataDir, 'versions', version, 'junie');
}

export function locateJunieJvm(junieHome) {
  const jar = findFile(junieHome, (file) => /[\\/]junie-[^\\/]*\.jar$/u.test(file), 4);
  const java = findFile(junieHome, (file) => /[\\/]bin[\\/]java(\.exe)?$/u.test(file), 6);
  if (!jar) throw new Error(`No junie-*.jar under ${junieHome}.`);
  if (!java) throw new Error(`No bundled bin/java under ${junieHome}.`);
  return { jar, java };
}

function runProbe({ jar, java }) {
  const dir = mkdtempSync(join(tmpdir(), 'junie-model-ids-'));
  try {
    const source = join(dir, 'JunieModelIds.java');
    writeFileSync(source, JAVA_SOURCE);
    const result = spawnSync(java, ['-Dstdout.encoding=UTF-8', '-cp', jar, source], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`The probe exited with ${result.status}: ${result.stderr.trim()}`);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      'junie-home': { type: 'string' },
      'data-dir': { type: 'string' },
      jar: { type: 'string' },
      java: { type: 'string' },
      input: { type: 'string' },
    },
  });
  let text;
  if (values.input) {
    text = readFileSync(values.input, 'utf8');
  } else {
    const dataDir = values['data-dir'] ?? process.env.JUNIE_DATA_DIR ?? join(homedir(), '.local', 'share', 'junie');
    const junieHome = values['junie-home'] ?? resolveJunieHome(dataDir);
    const located = values.jar && values.java ? { jar: values.jar, java: values.java } : locateJunieJvm(junieHome);
    if (!existsSync(located.jar) || !existsSync(located.java)) throw new Error('The JAR or java path does not exist.');
    text = runProbe(located);
  }
  process.stdout.write(`${JSON.stringify(parseJunieModelIds(text), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
