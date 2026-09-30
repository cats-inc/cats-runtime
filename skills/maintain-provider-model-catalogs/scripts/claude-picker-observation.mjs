#!/usr/bin/env node

// Builds the normalize-picker-paste observation tree from the JSON that Capture-ClaudePicker.ps1
// prints, optionally joined with Read-ClaudePickerRowStatus.ps1 results. A row's rawId is the
// value its /status Model line shows (the alias before "(resolved id)", or a bare id), and stays
// null for rows without such a read. The result feeds `normalize-picker-paste.mjs gaps|summary`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CHECK_MARK = String.fromCharCode(0x2714);

function readJson(path) {
  // Windows PowerShell writes UTF-8 with a byte order mark.
  const text = readFileSync(resolve(path), 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function list(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function buildClaudePickerObservation({ capture, rowStatus = [], artifact = null, policy = 'confirm-uncertainty' }) {
  const models = list(capture?.CapturedModels);
  if (models.length === 0) throw new Error('The capture result has no CapturedModels.');
  const values = new Map(list(rowStatus).map((row) => [Number(row.Row), String(row.StatusModel ?? '').trim()]));
  const key = (model) => `model:row-${model.Index}`;
  const modelNodes = models.map((model) => {
    const status = values.get(Number(model.Index));
    return {
      id: key(model),
      kind: 'model',
      parentPath: [],
      rawText: `${model.Index}. ${model.Label}${model.Current ? ` ${CHECK_MARK}` : ''}  ${model.Description ?? ''}`.trim(),
      rawId: status ? status.split(/\s+/)[0] : null,
      label: model.Label,
      selection: model.Current ? 'selected' : 'not-selected',
      defaultClaim: 'unknown',
      completeness: 'complete',
      sourceFragment: `model-list:row-${model.Index}`,
      children: [],
    };
  });
  const effortObservations = models.map((model) => ({
    id: `effort-row-${model.Index}`,
    path: [key(model)],
    completeness: model.CycleComplete ? 'complete' : 'partial',
    nodes: list(model.EffortCycle).map((step, index) => ({
      id: `${key(model)}:effort-${index + 1}`,
      kind: model.Unsupported ? 'unknown' : 'value',
      parentPath: [key(model)],
      rawText: String(step.Line ?? '').trim(),
      rawId: null,
      label: model.Unsupported ? String(step.Line ?? '').trim() : step.Level,
      selection: index === 0 ? 'selected' : 'not-selected',
      defaultClaim: model.Unsupported ? 'unknown' : (step.Default ? 'default' : 'not-default'),
      completeness: 'complete',
      sourceFragment: `effort-row-${model.Index}:${index + 1}`,
      children: [],
    })),
  }));
  return {
    schemaVersion: 1,
    provider: 'claude',
    interactionPolicy: policy,
    source: { kind: 'interactive-picker', command: '/model', artifact },
    observations: [
      { id: 'model-list', path: [], completeness: 'complete', nodes: modelNodes },
      ...effortObservations,
    ],
    expectedPaths: models.map((model) => ({
      path: [key(model)],
      captureAction: `Highlight row ${model.Index}, then cycle its effort line with Right`,
      selectFirst: [key(model)],
    })),
  };
}

function cliUsage() {
  return [
    'Usage:',
    '  claude-picker-observation.mjs --capture <capture result.json> [--row-status <row-status.json>]',
    '    [--artifact <fixture path>] [--policy <interaction policy>]',
    '',
    'The model list is marked complete because the capture helper checks the expected row count;',
    'review that claim before running assess. Prints the observation tree as JSON.',
  ].join('\n');
}

function main() {
  try {
    const { values } = parseArgs({ options: {
      capture: { type: 'string' },
      'row-status': { type: 'string' },
      artifact: { type: 'string' },
      policy: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    } });
    if (values.help || !values.capture) {
      process.stdout.write(`${cliUsage()}\n`);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const observation = buildClaudePickerObservation({
      capture: readJson(values.capture),
      rowStatus: values['row-status'] ? readJson(values['row-status']) : [],
      artifact: values.artifact ?? null,
      policy: values.policy ?? 'confirm-uncertainty',
    });
    process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
