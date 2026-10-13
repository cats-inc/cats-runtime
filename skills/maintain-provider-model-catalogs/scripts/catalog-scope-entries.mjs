#!/usr/bin/env node
// Builds the `models:` list of a full catalog scope from read-only evidence and, with --write,
// replaces that scope's list in the curated YAML. Starts no CLI.
//
//   node catalog-scope-entries.mjs --snapshot <probe snapshot.json> --provider opencode [--write <yaml>]
//   node catalog-scope-entries.mjs --snapshot <snapshot.json> --provider kilo --order <Capture-KiloPicker rows.json> [--alias '<picker label>=<listed name>']
//   node catalog-scope-entries.mjs --snapshot <snapshot.json> --provider cline --label <id>=<label>
//   node catalog-scope-entries.mjs --snapshot <snapshot.json> --provider devin [--effort-order ascending]
//   node catalog-scope-entries.mjs --cursor <parameterized-models.json> --provider cursor
//
// Values come from the evidence; the rules below only say how each CLI's picker shapes them.
// Entries that already exist keep their capabilityTags and source_names, and a changed label is
// added to source_names. Run `npm run catalog:generate` and the catalog tests afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';

// OpenCode and Kilo offer Default (no variant) before the model's variants.
const DEFAULT_VARIANT = { value: 'default', label: 'Default' };
// PowerShell 5.1 writes UTF-8 with a byte order mark.
const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xFEFF)}`);

/** OpenCode/Kilo: one entry per listed model, with its variants behind Default. */
export function variantEntries(rows, { key, order = 'picker' }) {
  const listed = rows.filter((row) => row.evidence?.status !== 'deprecated');
  const sorted = order === 'picker' ? sortLikePicker(listed) : listed;
  return sorted.map((row) => {
    const variants = row.evidence?.variants ?? [];
    return {
      id: row.id,
      label: (row.label ?? row.id).trim(),
      execution: { model: row.id },
      controls: variants.length === 0 ? [] : [{
        key, label: 'Variant', kind: 'enum', scope: 'both',
        values: [DEFAULT_VARIANT, ...variants.map((value) => ({ value, label: value }))],
      }],
    };
  });
}

// OpenCode's model dialog orders a provider section by release date (newest first), then title.
export function sortLikePicker(rows) {
  return [...rows].sort((a, b) => {
    const da = a.evidence?.releaseDate ?? ''; const db = b.evidence?.releaseDate ?? '';
    if (da !== db) return da < db ? 1 : -1;
    const ta = a.label ?? a.id; const tb = b.label ?? b.id;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

/**
 * Orders rows by captured picker rows; every listed row must appear exactly once. Labels compare
 * trimmed; `aliases` maps a picker label that differs from the listed name (a promotion suffix).
 */
export function orderByCapture(rows, captured, aliases = {}) {
  const byLabel = new Map();
  for (const row of rows) {
    const label = (row.label ?? row.id).trim();
    if (byLabel.has(label)) throw new Error(`Two listed models share the label "${label}"`);
    byLabel.set(label, row);
  }
  const ordered = captured.map((picked) => {
    const label = aliases[picked] ?? picked.trim();
    const row = byLabel.get(label);
    if (!row) throw new Error(`The picker row "${picked}" is not in the listed models`);
    byLabel.delete(label);
    return row;
  });
  if (byLabel.size) throw new Error(`Listed models missing from the picker: ${[...byLabel.keys()].join(', ')}`);
  return ordered;
}

export const CLINE_THINKING = {
  key: 'cline.reasoning_effort', label: 'Thinking Level', kind: 'enum', scope: 'both',
  values: [
    { value: 'none', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }, { value: 'xhigh', label: 'Extra High' },
  ],
  default: 'medium',
};

/** ClinePass: the subscribed `cline-pass/` models with the picker's five thinking levels. */
export function clineEntries(rows, { labels = {} } = {}) {
  return rows.filter((row) => row.id.startsWith('cline-pass/')).map((row) => ({
    id: row.id,
    label: labels[row.id] ?? row.label ?? row.id,
    execution: { model: row.id, provider: 'cline-pass' },
    controls: [structuredClone(CLINE_THINKING)],
  }));
}

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_WORDS = [
  ['No Thinking', 'none'], ['None', 'none'], ['Minimal', 'minimal'], ['Low', 'low'], ['Medium', 'medium'],
  ['High', 'high'], ['XHigh', 'xhigh'], ['X-High', 'xhigh'], ['Max', 'max'],
];
const SPEED = { fast: 'fast', priority: 'fast' };
const STRUCTURAL = { thinking: 'Thinking', '1m': '1M' };

function labelEffort(label, familyLabel) {
  const rest = label.startsWith(familyLabel) ? label.slice(familyLabel.length).trim() : label;
  for (const [word, effort] of EFFORT_WORDS) {
    if (rest === word || rest.startsWith(`${word} `)) return { effort, word };
  }
  return null;
}

function commonBase(ids) {
  const split = ids.map((id) => id.split('-'));
  const first = split[0];
  let n = 0;
  while (n < first.length && split.every((parts) => parts[n] === first[n])) n += 1;
  return first.slice(0, n).join('-');
}

/**
 * Devin: one entry per family and per 1M/Thinking form, with Reasoning Effort and Speed controls
 * whose every combination maps to the exact variant UID. Families and UIDs matching `exclude`
 * stay out.
 */
export function devinEntries(rows, { effortOrder = 'source', excludeFamilies = [], excludeIds = [] } = {}) {
  const families = new Map();
  for (const row of rows) {
    const family = row.evidence?.family;
    if (!family) throw new Error(`Devin row ${row.id} has no family`);
    if (excludeFamilies.includes(family) || excludeIds.some((pattern) => pattern.test(row.id))) continue;
    if (!families.has(family)) families.set(family, { label: row.evidence.familyLabel ?? family, rows: [] });
    families.get(family).rows.push(row);
  }
  const entries = [];
  for (const [family, { label: familyLabel, rows: members }] of families) {
    const base = members.length === 1 ? members[0].id : commonBase(members.map((row) => row.id));
    const parsed = members.map((row) => {
      const tokens = row.id === base ? [] : row.id.slice(base.length + 1).split('-');
      let effort = null; const speed = []; const structural = [];
      for (const token of tokens) {
        if (EFFORTS.includes(token)) effort = token;
        else if (SPEED[token]) speed.push(token);
        else if (STRUCTURAL[token]) structural.push(token);
        else throw new Error(`Devin ${row.id}: unknown variant token "${token}"`);
      }
      return { row, effort, speed: speed[0] ?? null, structural: structural.join('+') };
    });
    const hasEfforts = parsed.some((variant) => variant.effort);
    const words = new Map();
    for (const variant of parsed) {
      const found = labelEffort(variant.row.label ?? '', familyLabel);
      if (!variant.effort && hasEfforts) {
        if (!found) throw new Error(`Devin ${variant.row.id}: no effort in its UID or label`);
        variant.effort = found.effort;
      }
      if (variant.effort && found?.effort === variant.effort && !variant.speed && !words.has(variant.effort)) {
        words.set(variant.effort, found.word);
      }
    }
    const forms = [...new Set(parsed.map((variant) => variant.structural))];
    for (const form of forms) {
      const group = parsed.filter((variant) => variant.structural === form);
      let efforts = [...new Set(group.map((variant) => variant.effort).filter(Boolean))];
      if (effortOrder === 'ascending') efforts = EFFORTS.filter((effort) => efforts.includes(effort));
      const speedToken = group.find((variant) => variant.speed)?.speed ?? null;
      const controls = [];
      if (efforts.length > 1) {
        controls.push({
          key: 'devin.effort', label: 'Reasoning Effort', kind: 'enum', scope: 'both',
          values: efforts.map((effort) => ({ value: effort, label: words.get(effort) ?? effort })),
        });
      }
      if (speedToken) {
        controls.push({
          key: 'devin.speed', label: 'Speed', kind: 'enum', scope: 'both',
          values: [{ value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }],
        });
      }
      const pick = (effort, fast) => {
        const match = group.filter((variant) => (efforts.length <= 1 || variant.effort === effort)
          && Boolean(variant.speed) === fast);
        if (match.length !== 1) throw new Error(`Devin ${family}${form ? ` ${form}` : ''}: ${match.length} variants for ${effort ?? '-'}${fast ? ' fast' : ''}`);
        return match[0].row.id;
      };
      const combos = [];
      for (const effort of efforts.length > 1 ? efforts : [efforts[0] ?? null]) {
        for (const fast of speedToken ? [false, true] : [false]) combos.push({ effort, fast, model: pick(effort, fast) });
      }
      if (combos.length !== group.length) throw new Error(`Devin ${family}${form ? ` ${form}` : ''}: ${group.length} variants, ${combos.length} combinations`);
      const suffix = form ? form.split('+').map((token) => STRUCTURAL[token]).join(' ') : '';
      const entry = {
        id: combos[0].model,
        label: suffix ? `${familyLabel} ${suffix}` : familyLabel,
        execution: { model: combos[0].model },
        controls,
      };
      if (controls.length) {
        entry.execution.variants = combos.map((combo) => ({
          when: {
            ...(efforts.length > 1 ? { 'devin.effort': combo.effort } : {}),
            ...(speedToken ? { 'devin.speed': combo.fast ? 'fast' : 'standard' } : {}),
          },
          model: combo.model,
        }));
      }
      entries.push(entry);
    }
  }
  return entries;
}

// The picker shows an enum value by its displayName and a boolean as an on/off switch named after
// the parameter, so a boolean becomes Off/On here.
function cursorDefinition(definition) {
  const type = definition.parameterType ?? {};
  const raw = definition.values ?? type.enumParameter?.values ?? type.booleanParameter?.values ?? [];
  const toggle = Boolean(type.booleanParameter)
    || (raw.length > 0 && raw.every((value) => ['true', 'false'].includes(String(value.value))));
  return {
    id: definition.id, name: definition.name ?? definition.id, toggle,
    values: raw.map((value) => ({
      value: String(value.value),
      label: toggle ? (String(value.value) === 'true' ? 'On' : 'Off') : (value.displayName || String(value.value)),
    })),
  };
}

// The picker's row summary: an enum value's label, a true switch's name, and "No Thinking" for
// thinking off; other false switches and thinking on add nothing.
function cursorSummary(definition, value) {
  if (!definition.toggle) return value.label;
  if (definition.id === 'thinking') return value.value === 'true' ? '' : 'No Thinking';
  return value.value === 'true' ? definition.name : '';
}

function cursorParameter(variant, id) {
  const parameters = variant.parameters;
  const value = Array.isArray(parameters) ? parameters.find((parameter) => parameter.id === id)?.value : parameters?.[id];
  return value === undefined ? undefined : String(value);
}

// Keeps the values the variants use, in definition order; a parameter left with one value is fixed.
function cursorChoices(definitions, variants) {
  return definitions
    .map((definition) => ({ ...definition, values: definition.values.filter((value) => variants.some((variant) => variant.parameters[definition.id] === value.value)) }))
    .filter((definition) => definition.values.length > 1);
}

function isFullProduct(choices, variants) {
  const expected = choices.reduce((product, choice) => product * choice.values.length, 1);
  const combinations = new Set(variants.map((variant) => JSON.stringify(choices.map((choice) => variant.parameters[choice.id]))));
  return combinations.size === expected && variants.length === expected;
}

// Without a saved choice the picker preselects the family's isDefaultNonMaxConfig variant, so its
// values are the control defaults. A split part without that variant starts on its first values.
function cursorEntry(label, choices, variants) {
  const preset = variants.find((variant) => variant.isDefaultNonMaxConfig);
  const controls = choices.map((choice) => ({
    key: `cursor.${choice.id}`, label: choice.name, kind: 'enum', scope: 'both', values: choice.values.map(({ value, label: text }) => ({ value, label: text })),
    ...(preset ? { default: preset.parameters[choice.id] } : {}),
  }));
  const executable = variants.map((variant) => ({
    when: Object.fromEntries(choices.map((choice) => [`cursor.${choice.id}`, variant.parameters[choice.id]])),
    model: variant.model,
  }));
  const start = preset?.model
    ?? executable.find((variant) => controls.every((control) => variant.when[control.key] === control.values[0].value)).model;
  // The starting variant leads the list, so the list's first entry is what an untouched selection runs.
  const ordered = [...executable.filter((variant) => variant.model === start), ...executable.filter((variant) => variant.model !== start)];
  return {
    id: start,
    label,
    execution: controls.length ? { model: start, variants: ordered } : { model: start },
    controls,
  };
}

/**
 * Cursor: one entry per picker family, one control per parameter with more than one value, and the
 * server's exact variant strings. A family whose variants are not the full product of its values is
 * split on the first parameter that leaves each part a full product, and each part names its value;
 * no combination the server does not list is offered. Families the CLI excludes stay out.
 */
export function cursorEntries(families) {
  return families.filter((family) => !family.cliExcluded).flatMap((family) => {
    const label = family.pickerLabel ?? family.label ?? family.id;
    const definitions = (family.parameterDefinitions ?? []).map(cursorDefinition);
    const variants = (family.variants ?? []).map((variant) => ({
      model: variant.variantStringRepresentation,
      isDefaultNonMaxConfig: variant.isDefaultNonMaxConfig === true,
      parameters: Object.fromEntries(definitions.map((definition) => {
        const value = cursorParameter(variant, definition.id);
        if (value === undefined) throw new Error(`Cursor ${family.id}: ${variant.variantStringRepresentation} lacks ${definition.id}`);
        return [definition.id, value];
      })),
    }));
    if (variants.length === 0) throw new Error(`Cursor ${family.id} lists no variants`);
    const choices = cursorChoices(definitions, variants);
    if (isFullProduct(choices, variants)) return [cursorEntry(label, choices, variants)];
    for (const split of choices) {
      const rest = definitions.filter((definition) => definition.id !== split.id);
      const parts = split.values.map((value) => ({ value, variants: variants.filter((variant) => variant.parameters[split.id] === value.value) }));
      if (parts.every((part) => isFullProduct(cursorChoices(rest, part.variants), part.variants))) {
        return parts.map((part) => cursorEntry([label, cursorSummary(split, part.value)].filter(Boolean).join(' '),
          cursorChoices(rest, part.variants), part.variants));
      }
    }
    throw new Error(`Cursor ${family.id}: ${variants.length} variants form no full parameter product, even split on one parameter`);
  });
}

/** Keeps capabilityTags and source_names from existing entries; a changed label joins source_names. */
export function mergeExisting(entries, existing = []) {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  return entries.map((entry) => {
    const previous = byId.get(entry.id);
    if (!previous) return entry;
    const names = [...(previous.source_names ?? [])];
    if (previous.label && previous.label !== entry.label && !names.includes(previous.label)) names.push(previous.label);
    const { id, label, ...rest } = entry;
    return {
      id, label,
      ...(previous.capabilityTags?.length ? { capabilityTags: previous.capabilityTags } : {}),
      ...(names.length ? { source_names: names } : {}),
      ...rest,
    };
  });
}

function scopeMatches(scope, { provider, backend, transport }) {
  return scope.provider === provider && scope.backend === backend && (scope.transport ?? null) === (transport ?? null);
}

/** Replaces the `models:` list of one scope, leaving the rest of the file's text untouched. */
export function spliceScopeModels(text, target, entries) {
  const lines = text.split('\n');
  const starts = lines.flatMap((line, index) => (/^  - provider: /.test(line) ? [index] : []));
  for (const [n, start] of starts.entries()) {
    const end = starts[n + 1] ?? lines.findIndex((line, index) => index > start && /^\S/.test(line));
    const stop = end < 0 ? lines.length : end;
    const head = lines.slice(start, stop);
    const field = (name) => head.find((line) => line.startsWith(`    ${name}: `))?.slice(`    ${name}: `.length).trim()
      ?? (name === 'provider' ? lines[start].slice('  - provider: '.length).trim() : undefined);
    if (!scopeMatches({ provider: field('provider'), backend: field('backend'), transport: field('transport') }, target)) continue;
    const modelsAt = head.findIndex((line) => line === '    models:');
    if (modelsAt < 0) throw new Error('The scope has no models list');
    let listEnd = modelsAt + 1;
    while (listEnd < head.length && (head[listEnd].startsWith('      ') || head[listEnd] === '')) listEnd += 1;
    const body = stringify(entries, { indent: 2, lineWidth: 0, aliasDuplicateObjects: false }).trimEnd().split('\n').map((line) => `      ${line}`);
    const replaced = [...head.slice(0, modelsAt + 1), ...body, ...head.slice(listEnd)];
    return [...lines.slice(0, start), ...replaced, ...lines.slice(stop)].join('\n');
  }
  throw new Error(`No ${target.provider}/${target.backend} scope found`);
}

function argValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === name) values.push(argv[i + 1]);
  return values;
}

const TARGETS = {
  opencode: { provider: 'opencode', backend: 'cli' },
  kilo: { provider: 'kilo', backend: 'cli' },
  cline: { provider: 'cline', backend: 'cli' },
  devin: { provider: 'devin', backend: 'agent', transport: 'acp_stdio' },
  cursor: { provider: 'cursor', backend: 'cli' },
};

export function main(argv) {
  const provider = argValues(argv, '--provider')[0];
  const target = TARGETS[provider];
  if (!target) throw new Error(`--provider must be one of ${Object.keys(TARGETS).join(', ')}`);
  const yamlPath = argValues(argv, '--write')[0];
  let entries;
  if (provider === 'cursor') {
    const input = argValues(argv, '--cursor')[0];
    if (!input) throw new Error('--cursor <parameterized-models.json> is required');
    const document = JSON.parse(readFileSync(input, 'utf8'));
    entries = cursorEntries(document.families ?? document);
  } else {
    const snapshotPath = argValues(argv, '--snapshot')[0];
    if (!snapshotPath) throw new Error('--snapshot <snapshot.json> is required');
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    const source = (snapshot.sources ?? []).find((candidate) => scopeMatches(
      { provider: candidate.provider, backend: candidate.backend, transport: candidate.transport }, target));
    if (!source || source.status !== 'ok') throw new Error(`The snapshot has no conclusive ${provider} source`);
    const rows = source.models ?? [];
    if (provider === 'opencode') entries = variantEntries(rows, { key: 'opencode.variant' });
    if (provider === 'kilo') {
      // Kilo moves Recommended rows out of its provider section and keeps Recent rows in it.
      const orderPath = argValues(argv, '--order')[0];
      const sections = argValues(argv, '--section');
      const aliases = Object.fromEntries(argValues(argv, '--alias').map((pair) => {
        const at = pair.lastIndexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)];
      }));
      let ordered = rows;
      if (orderPath) {
        const captured = JSON.parse(readFileSync(orderPath, 'utf8').replace(BYTE_ORDER_MARK, ''));
        const picked = (sections.length ? sections : ['Recommended', 'Kilo Gateway'])
          .flatMap((section) => captured.filter((row) => row.Section === section).map((row) => row.Label));
        ordered = orderByCapture(rows, picked, aliases);
      }
      entries = variantEntries(ordered, { key: 'kilo.variant', order: orderPath ? 'source' : 'picker' });
    }
    if (provider === 'cline') {
      const labels = Object.fromEntries(argValues(argv, '--label').map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)];
      }));
      entries = clineEntries(rows, { labels });
    }
    if (provider === 'devin') {
      entries = devinEntries(rows, {
        effortOrder: argValues(argv, '--effort-order')[0] ?? 'source',
        excludeFamilies: argValues(argv, '--exclude-family'),
        excludeIds: argValues(argv, '--exclude-id').map((pattern) => new RegExp(pattern)),
      });
    }
  }
  if (!yamlPath) return stringify(entries, { indent: 2, lineWidth: 0, aliasDuplicateObjects: false });
  const text = readFileSync(yamlPath, 'utf8');
  const existing = (parse(text).catalogs ?? []).find((scope) => scopeMatches(scope, target))?.models ?? [];
  writeFileSync(yamlPath, spliceScopeModels(text, target, mergeExisting(entries, existing)));
  return `${entries.length} ${provider} entries written to ${yamlPath}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
