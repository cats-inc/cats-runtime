#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const NODE_KINDS = new Set(['model', 'option', 'value', 'control', 'unknown']);
const COMPLETENESS_VALUES = new Set(['complete', 'partial', 'unknown']);
const SELECTION_VALUES = new Set(['selected', 'not-selected', 'unknown']);
const DEFAULT_VALUES = new Set(['default', 'not-default', 'unknown']);
const INTERACTION_POLICIES = new Set([
  'capture-preview',
  'confirm-all',
  'confirm-uncertainty',
  'apply-authorized',
]);
const CHANGE_KINDS = new Set([
  'add',
  'update',
  'remove',
  'record-default',
  'advance-last-updated',
  'other',
]);
const CONFIDENCE_VALUES = new Set(['high', 'low']);

function replaceAndRecord(text, pattern, replacement, kind, redactions) {
  return text.replace(pattern, (...args) => {
    redactions.add(kind);
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
}

export function redactVisibleText(input) {
  const redactions = new Set();
  let text = String(input);
  text = replaceAndRecord(
    text,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '<redacted-email>',
    'email',
    redactions,
  );
  text = replaceAndRecord(
    text,
    /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|session[-_ ]?(?:token|id)|authorization|cookie)(\s*[:=]\s*)(Bearer\s+[A-Za-z0-9._~+/=-]+|"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    (_match, key, separator) => `${key}${separator}<redacted-secret>`,
    'secret-field',
    redactions,
  );
  text = replaceAndRecord(
    text,
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    'Bearer <redacted-token>',
    'bearer-token',
    redactions,
  );
  text = replaceAndRecord(
    text,
    /\b((?:account|organization|org|tenant|user|workspace)[-_ ]?id)(\s*[:=]\s*)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    (_match, key, separator) => `${key}${separator}<redacted-identifier>`,
    'context-uuid',
    redactions,
  );
  return {
    text,
    redactions: [...redactions].sort(),
  };
}

export function stripTerminalPresentation(input) {
  const normalizedNewlines = String(input)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return stripVTControlCharacters(normalizedNewlines)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function normalizePickerPaste(input, options = {}) {
  const visible = stripTerminalPresentation(input);
  const redactionTypes = new Set();
  const lines = visible.split('\n').map((line, index) => {
    const redacted = redactVisibleText(line);
    for (const kind of redacted.redactions) {
      redactionTypes.add(kind);
    }
    return {
      line: index + 1,
      text: redacted.text,
      semanticStatus: 'unparsed',
    };
  });

  return {
    schemaVersion: 1,
    kind: 'normalized-picker-paste',
    source: options.source ? basename(String(options.source)) : 'stdin',
    lineCount: lines.length,
    redactionTypes: [...redactionTypes].sort(),
    manualRedactionRequired: true,
    lines,
  };
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function readOptionalString(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null.`);
  }
  return value;
}

function validatePath(path, label) {
  if (!Array.isArray(path)) {
    throw new Error(`${label} must be an array.`);
  }
  for (const [index, segment] of path.entries()) {
    assertString(segment, `${label}[${index}]`);
  }
  return path;
}

function pathKey(path) {
  return JSON.stringify(path);
}

function pathsEqual(left, right) {
  return pathKey(left) === pathKey(right);
}

function readEnum(value, allowed, fallback, label) {
  const normalized = value ?? fallback;
  if (!allowed.has(normalized)) {
    throw new Error(`${label} must be one of ${[...allowed].join(', ')}.`);
  }
  return normalized;
}

function readBoolean(value, fallback, label) {
  const normalized = value ?? fallback;
  if (typeof normalized !== 'boolean') {
    throw new Error(`${label} must be true or false.`);
  }
  return normalized;
}

function flattenNodes(nodes, parentPath, observationId, rows, observedPaths, observationPaths) {
  if (!Array.isArray(nodes)) {
    throw new Error(`Observation '${observationId}' nodes must be an array.`);
  }

  for (const [index, node] of nodes.entries()) {
    const label = `Observation '${observationId}' node ${index + 1}`;
    assertRecord(node, label);
    assertString(node.id, `${label}.id`);
    if (!NODE_KINDS.has(node.kind)) {
      throw new Error(`${label}.kind must be one of ${[...NODE_KINDS].join(', ')}.`);
    }
    const declaredParent = validatePath(node.parentPath, `${label}.parentPath`);
    if (!pathsEqual(declaredParent, parentPath)) {
      throw new Error(
        `${label}.parentPath does not match its ordered tree position. `
        + `Expected ${pathKey(parentPath)}, received ${pathKey(declaredParent)}.`,
      );
    }

    const path = [...parentPath, node.id];
    const key = pathKey(path);
    if (observationPaths.has(key)) {
      throw new Error(
        `Observation '${observationId}' contains duplicate node path ${key}.`,
      );
    }
    observationPaths.add(key);
    const completeness = readEnum(
      node.completeness,
      COMPLETENESS_VALUES,
      'unknown',
      `${label}.completeness`,
    );
    const selection = readEnum(
      node.selection,
      SELECTION_VALUES,
      'unknown',
      `${label}.selection`,
    );
    const defaultClaim = readEnum(
      node.defaultClaim,
      DEFAULT_VALUES,
      'unknown',
      `${label}.defaultClaim`,
    );
    rows.push({
      observationId,
      path,
      kind: node.kind,
      rawText: readOptionalString(node.rawText, `${label}.rawText`),
      rawId: readOptionalString(node.rawId, `${label}.rawId`),
      label: readOptionalString(node.label, `${label}.label`),
      selection,
      defaultClaim,
      completeness,
      sourceFragment: readOptionalString(node.sourceFragment, `${label}.sourceFragment`),
    });
    observedPaths.add(key);
    flattenNodes(
      node.children ?? [],
      path,
      observationId,
      rows,
      observedPaths,
      observationPaths,
    );
  }
}

export function inspectObservationDocument(document) {
  assertRecord(document, 'Observation document');
  if (document.schemaVersion !== 1) {
    throw new Error('Observation document schemaVersion must be 1.');
  }
  assertString(document.provider, 'Observation document.provider');
  assertString(document.interactionPolicy, 'Observation document.interactionPolicy');
  if (!INTERACTION_POLICIES.has(document.interactionPolicy)) {
    throw new Error(
      `Observation document.interactionPolicy must be one of ${[
        ...INTERACTION_POLICIES,
      ].join(', ')}.`,
    );
  }
  if (!Array.isArray(document.observations)) {
    throw new Error('Observation document.observations must be an array.');
  }

  const rows = [];
  const observedPaths = new Set();
  const observationIds = new Set();
  const observations = [];
  for (const [index, observation] of document.observations.entries()) {
    const label = `Observation ${index + 1}`;
    assertRecord(observation, label);
    assertString(observation.id, `${label}.id`);
    if (observationIds.has(observation.id)) {
      throw new Error(`Observation document contains duplicate observation id '${observation.id}'.`);
    }
    observationIds.add(observation.id);
    const path = validatePath(observation.path, `${label}.path`);
    const completeness = readEnum(
      observation.completeness,
      COMPLETENESS_VALUES,
      'unknown',
      `${label}.completeness`,
    );
    observations.push({ id: observation.id, path, completeness });
    flattenNodes(
      observation.nodes,
      path,
      observation.id,
      rows,
      observedPaths,
      new Set(),
    );
  }

  const expectedPaths = document.expectedPaths ?? [];
  if (!Array.isArray(expectedPaths)) {
    throw new Error('Observation document.expectedPaths must be an array when present.');
  }
  const gaps = [];
  for (const [index, expected] of expectedPaths.entries()) {
    const label = `Expected path ${index + 1}`;
    assertRecord(expected, label);
    const path = validatePath(expected.path, `${label}.path`);
    assertString(expected.captureAction, `${label}.captureAction`);
    const selectFirst = validatePath(expected.selectFirst ?? [], `${label}.selectFirst`);
    if (!observedPaths.has(pathKey(path))) {
      gaps.push({ path, captureAction: expected.captureAction, selectFirst });
    }
  }

  return { observations, rows, observedPaths, gaps };
}

function redactCell(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return redactVisibleText(String(value)).text
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, ' ↩ ');
}

export function summarizeObservationDocument(document) {
  const inspection = inspectObservationDocument(document);
  const output = [
    `Provider: ${redactCell(document.provider)}`,
    `Interaction policy: ${redactCell(document.interactionPolicy)}`,
    '',
    'Observations:',
    '| Observation | Context | Completeness |',
    '|---|---|---|',
  ];

  for (const observation of inspection.observations) {
    output.push([
      redactCell(observation.id),
      redactCell(observation.path.join(' > ')),
      redactCell(observation.completeness),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  output.push(
    '',
    'Parsed nodes:',
    '| Path | Kind | Raw id | Label | Selected | Default claim | Completeness | Source |',
    '|---|---|---|---|---|---|---|---|',
  );

  for (const row of inspection.rows) {
    output.push([
      redactCell(row.path.join(' > ')),
      redactCell(row.kind),
      redactCell(row.rawId),
      redactCell(row.label),
      redactCell(row.selection),
      redactCell(row.defaultClaim),
      redactCell(row.completeness),
      redactCell(row.sourceFragment),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  output.push('', 'Unobserved capture gaps:');
  if (inspection.gaps.length === 0) {
    output.push('- None declared.');
  } else {
    for (const gap of inspection.gaps) {
      const prerequisite = gap.selectFirst.length > 0
        ? ` Select first: ${redactCell(gap.selectFirst.join(' > '))}.`
        : '';
      output.push(
        `- ${redactCell(gap.path.join(' > '))}: ${redactCell(gap.captureAction)}.${prerequisite}`,
      );
    }
  }
  return `${output.join('\n')}\n`;
}

export function computeObservationGaps(document) {
  const inspection = inspectObservationDocument(document);
  return {
    schemaVersion: 1,
    provider: document.provider,
    observedPathCount: inspection.observedPaths.size,
    gaps: inspection.gaps,
  };
}

function addGate(gates, code) {
  if (!gates.includes(code)) {
    gates.push(code);
  }
}

export function assessIntakeDecision(document) {
  assertRecord(document, 'Intake decision document');
  if (document.schemaVersion !== 1) {
    throw new Error('Intake decision document schemaVersion must be 1.');
  }

  const catalogIntent = readBoolean(
    document.catalogIntent,
    false,
    'Intake decision document.catalogIntent',
  );
  const editRequested = readBoolean(
    document.editRequested,
    false,
    'Intake decision document.editRequested',
  );
  const requestedPolicy = document.requestedPolicy ?? null;
  if (requestedPolicy !== null && !INTERACTION_POLICIES.has(requestedPolicy)) {
    throw new Error(
      `Intake decision document.requestedPolicy must be one of ${[
        ...INTERACTION_POLICIES,
      ].join(', ')}, or null.`,
    );
  }
  const modelListCompleteness = readEnum(
    document.modelListCompleteness,
    COMPLETENESS_VALUES,
    'unknown',
    'Intake decision document.modelListCompleteness',
  );

  let selectedPolicy = requestedPolicy ?? (editRequested
    ? 'confirm-uncertainty'
    : 'capture-preview');
  if (!catalogIntent) {
    selectedPolicy = 'not-applicable';
  } else if (!editRequested) {
    selectedPolicy = 'capture-preview';
  }

  if (!Array.isArray(document.changes)) {
    throw new Error('Intake decision document.changes must be an array.');
  }

  const changeIds = new Set();
  const decisions = document.changes.map((change, index) => {
    const label = `Intake decision change ${index + 1}`;
    assertRecord(change, label);
    assertString(change.id, `${label}.id`);
    if (changeIds.has(change.id)) {
      throw new Error(`Intake decision document contains duplicate change id '${change.id}'.`);
    }
    changeIds.add(change.id);
    const kind = readEnum(change.kind, CHANGE_KINDS, 'other', `${label}.kind`);
    const confidence = readEnum(
      change.confidence,
      CONFIDENCE_VALUES,
      'low',
      `${label}.confidence`,
    );
    const inScope = readBoolean(change.inScope, false, `${label}.inScope`);
    const confirmed = readBoolean(change.confirmed, false, `${label}.confirmed`);
    const deletionConfirmed = readBoolean(
      change.deletionConfirmed,
      false,
      `${label}.deletionConfirmed`,
    );
    const dependsOnSelectionMarkerAsDefault = readBoolean(
      change.dependsOnSelectionMarkerAsDefault,
      false,
      `${label}.dependsOnSelectionMarkerAsDefault`,
    );
    const selectionMarkerMeaningConfirmed = readBoolean(
      change.selectionMarkerMeaningConfirmed,
      false,
      `${label}.selectionMarkerMeaningConfirmed`,
    );
    const rawMappingRequired = readBoolean(
      change.rawMappingRequired,
      false,
      `${label}.rawMappingRequired`,
    );
    const rawMappingObserved = readBoolean(
      change.rawMappingObserved,
      false,
      `${label}.rawMappingObserved`,
    );
    const conflictingEvidence = readBoolean(
      change.conflictingEvidence,
      false,
      `${label}.conflictingEvidence`,
    );
    const projectionLoss = readBoolean(
      change.projectionLoss,
      false,
      `${label}.projectionLoss`,
    );

    const hardGates = [];
    if (dependsOnSelectionMarkerAsDefault && !selectionMarkerMeaningConfirmed) {
      addGate(hardGates, 'selection-marker-default');
    }
    if (
      (kind === 'remove' || kind === 'advance-last-updated')
      && modelListCompleteness !== 'complete'
    ) {
      addGate(hardGates, 'list-completeness');
    }
    if (rawMappingRequired && !rawMappingObserved) {
      addGate(hardGates, 'raw-token-mapping');
    }
    if (conflictingEvidence) {
      addGate(hardGates, 'evidence-conflict');
    }
    if (kind === 'remove' && !deletionConfirmed) {
      addGate(hardGates, 'deletion');
    }
    if (!inScope) {
      addGate(hardGates, 'scope-expansion');
    }
    if (projectionLoss) {
      addGate(hardGates, 'projection-loss');
    }

    let status;
    const reasons = [...hardGates];
    if (selectedPolicy === 'not-applicable') {
      status = 'not-applicable';
    } else if (selectedPolicy === 'capture-preview') {
      status = 'preview-only';
    } else if (hardGates.length > 0) {
      status = 'confirmation-required';
    } else if (selectedPolicy === 'confirm-all' && !confirmed) {
      status = 'confirmation-required';
      reasons.push('confirm-all');
    } else if (
      selectedPolicy === 'confirm-uncertainty'
      && confidence === 'low'
      && !confirmed
    ) {
      status = 'confirmation-required';
      reasons.push('low-confidence');
    } else if (selectedPolicy === 'apply-authorized' && confidence === 'low' && !confirmed) {
      status = 'omitted-low-confidence';
      reasons.push('low-confidence');
    } else {
      status = 'ready';
    }

    return {
      id: change.id,
      kind,
      confidence,
      status,
      hardGates,
      reasons,
    };
  });

  const idsForStatus = (status) => decisions
    .filter((decision) => decision.status === status)
    .map((decision) => decision.id);
  const readyChangeIds = idsForStatus('ready');
  const confirmationRequiredChangeIds = idsForStatus('confirmation-required');
  return {
    schemaVersion: 1,
    catalogIntent,
    editRequested,
    selectedPolicy,
    modelListCompleteness,
    previewScope: selectedPolicy === 'not-applicable'
      ? 'not-applicable'
      : selectedPolicy === 'capture-preview'
        ? 'capture-summary'
        : selectedPolicy === 'confirm-all'
          ? 'all-readings'
          : selectedPolicy === 'confirm-uncertainty'
            ? 'proposed-delta'
            : 'none',
    repositoryMutationAllowed: readyChangeIds.length > 0 && (
      selectedPolicy === 'apply-authorized'
      || confirmationRequiredChangeIds.length === 0
    ),
    readyChangeIds,
    confirmationRequiredChangeIds,
    omittedChangeIds: idsForStatus('omitted-low-confidence'),
    deferredHardGates: decisions
      .filter((decision) => decision.status === 'preview-only' && decision.hardGates.length > 0)
      .map((decision) => ({ id: decision.id, hardGates: decision.hardGates })),
    decisions,
  };
}

function parseCommandArgs(argv) {
  const command = argv[0];
  const positionals = [];
  let output = null;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--output requires a path.');
      }
      output = value;
      index += 1;
      continue;
    }
    positionals.push(argv[index]);
  }
  return { command, input: positionals[0] ?? null, output };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function emit(content, output) {
  if (output) {
    await writeFile(output, content, 'utf8');
    return;
  }
  process.stdout.write(content);
}

function cliUsage() {
  return [
    'Usage:',
    '  normalize-picker-paste.mjs normalize [raw-file|-] [--output normalized.json]',
    '  normalize-picker-paste.mjs summary <observation.json> [--output summary.md]',
    '  normalize-picker-paste.mjs gaps <observation.json> [--output gaps.json]',
    '  normalize-picker-paste.mjs assess <decision.json> [--output decision-result.json]',
  ].join('\n');
}

async function main() {
  try {
    const options = parseCommandArgs(process.argv.slice(2));
    if (!options.command || options.command === '-h' || options.command === '--help') {
      process.stdout.write(`${cliUsage()}\n`);
      return;
    }

    if (options.command === 'normalize') {
      const inputPath = options.input ?? '-';
      const raw = inputPath === '-' ? await readStdin() : await readFile(inputPath, 'utf8');
      const result = normalizePickerPaste(raw, { source: inputPath });
      await emit(`${JSON.stringify(result, null, 2)}\n`, options.output);
      return;
    }

    if (!['summary', 'gaps', 'assess'].includes(options.command)) {
      throw new Error(`Unknown command '${options.command}'.\n${cliUsage()}`);
    }
    if (!options.input) {
      throw new Error(`${options.command} requires an observation JSON path.`);
    }
    const document = JSON.parse(await readFile(options.input, 'utf8'));
    if (options.command === 'summary') {
      await emit(summarizeObservationDocument(document), options.output);
      return;
    }
    const result = options.command === 'gaps'
      ? computeObservationGaps(document)
      : assessIntakeDecision(document);
    await emit(`${JSON.stringify(result, null, 2)}\n`, options.output);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
