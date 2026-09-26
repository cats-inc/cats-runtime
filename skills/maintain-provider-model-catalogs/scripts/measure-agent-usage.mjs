#!/usr/bin/env node

// Summarizes the model usage an agent host recorded for its own session, for a capture's cost
// section. Reads local session files only and prints counts, numbers and model names, never
// message content.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const HOSTS = ['claude', 'codex', 'junie', 'kiro'];
const TOKEN_FIELDS = ['uncachedInput', 'cacheWrite', 'cacheRead', 'output', 'reasoningOutput'];
const MARKER_SUPPORT = {
  at: ['claude', 'codex', 'junie'],
  text: ['claude', 'codex', 'kiro'],
  turn: ['junie', 'kiro'],
};

const HOST_NOTES = {
  claude: [
    'Each API message is counted once by message.id, with its last recorded usage.',
    "Transcripts in the session's subagents folder are included.",
  ],
  codex: [
    'Per-call usage is the change in total_token_usage; repeated counts are skipped.',
    'uncachedInput excludes the cached and cache-write tokens that Codex counts inside input_tokens; reasoningOutput is part of output.',
  ],
  junie: [
    'Usage comes from LlmResponseMetadataEvent entries; costUsd is as Junie reported it.',
  ],
  kiro: [
    'Kiro 2.24.1 records one metering_usage credit entry per request and leaves token fields at 0.',
    "A call's credits are known only when its turn's metering entries pair with its assistant messages.",
    'The turn in progress has no metadata until it ends.',
  ],
};

function readJsonLines(path, counters) {
  const entries = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push({ line, value: JSON.parse(line) });
    } catch {
      counters.skippedLines += 1;
    }
  }
  return entries;
}

// The string leaves of a message or tool call, so text markers never match metadata or JSON escapes.
function collectText(value) {
  if (typeof value === 'string') {
    return `${value}\n`;
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map(collectText).join('');
  }
  return '';
}

function toTime(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function readClaude(path, counters) {
  const files = [path];
  const subagents = join(dirname(path), basename(path, '.jsonl'), 'subagents');
  if (existsSync(subagents)) {
    files.push(...readdirSync(subagents).filter((name) => name.endsWith('.jsonl')).sort()
      .map((name) => join(subagents, name)));
  }
  const byId = new Map();
  for (const file of files) {
    for (const { value } of readJsonLines(file, counters)) {
      const message = value.message;
      if (value.type !== 'assistant' || !message?.id || !message.usage || message.model === '<synthetic>') {
        continue;
      }
      const record = byId.get(message.id) ?? {
        order: byId.size, time: toTime(value.timestamp), model: message.model ?? null, text: '',
      };
      // A streamed message repeats its usage on every content line; keep the last one.
      const usage = message.usage;
      record.tokens = {
        uncachedInput: usage.input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
      };
      record.text += collectText(message.content);
      byId.set(message.id, record);
    }
  }
  const records = [...byId.values()].sort((a, b) => (a.time ?? 0) - (b.time ?? 0) || a.order - b.order);
  return { sources: files.map((file) => basename(file)), records };
}

function isCodexAgentItem(payload) {
  if (typeof payload?.type !== 'string' || payload.type.endsWith('_output')) {
    return false;
  }
  return payload.type !== 'message' || payload.role === 'assistant';
}

function readCodex(path, counters) {
  const records = [];
  let model = null;
  let previous = null;
  let text = '';
  for (const { value } of readJsonLines(path, counters)) {
    const payload = value.payload ?? {};
    if (value.type === 'turn_context') {
      model = payload.model ?? model;
      continue;
    }
    if (value.type === 'response_item' && isCodexAgentItem(payload)) {
      text += collectText(payload);
      continue;
    }
    const info = value.type === 'event_msg' && payload.type === 'token_count' ? payload.info : null;
    if (!info?.total_token_usage) {
      continue;
    }
    const total = info.total_token_usage;
    let usage = total;
    if (previous) {
      usage = Object.fromEntries(Object.keys(total).map((key) => [key, total[key] - (previous[key] ?? 0)]));
      if (Object.values(usage).every((amount) => amount === 0)) {
        continue;
      }
    }
    // The first count of a resumed file, or a count after a reset, is read from the call itself.
    if (!previous || Object.values(usage).some((amount) => amount < 0)) {
      usage = info.last_token_usage ?? usage;
    }
    previous = total;
    const cacheRead = usage.cached_input_tokens ?? 0;
    const cacheWrite = usage.cache_write_input_tokens ?? 0;
    records.push({
      time: toTime(value.timestamp),
      model,
      tokens: {
        uncachedInput: Math.max(0, (usage.input_tokens ?? 0) - cacheRead - cacheWrite),
        cacheWrite,
        cacheRead,
        output: usage.output_tokens ?? 0,
        reasoningOutput: usage.reasoning_output_tokens ?? 0,
      },
      text,
    });
    text = '';
  }
  return { sources: [basename(path)], records };
}

function readJunie(path, counters) {
  const eventsPath = existsSync(path) && statSync(path).isDirectory() ? join(path, 'events.jsonl') : path;
  if (!existsSync(eventsPath)) {
    throw new Error(`${eventsPath} does not exist. Junie keeps per-call usage only in the session's `
      + 'events.jsonl; summary.json holds a partial total.');
  }
  const records = [];
  let turn = 0;
  for (const { value } of readJsonLines(eventsPath, counters)) {
    if (value.kind === 'UserPromptEvent') {
      turn += 1;
      continue;
    }
    const event = value.event?.agentEvent;
    if (event?.kind !== 'LlmResponseMetadataEvent') {
      continue;
    }
    for (const usage of event.modelUsage ?? []) {
      records.push({
        time: toTime(value.timestampMs),
        turn,
        model: usage.model ?? null,
        tokens: {
          uncachedInput: usage.inputTokens ?? 0,
          cacheWrite: usage.cacheCreateTokens ?? 0,
          cacheRead: usage.cacheInputTokens ?? 0,
          output: usage.outputTokens ?? 0,
        },
        costUsd: usage.cost ?? null,
      });
    }
  }
  return { sources: [basename(eventsPath)], records };
}

function readKiro(path, counters) {
  const base = path.replace(/\.jsonl?$/, '');
  const session = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const metadata = session.session_state?.conversation_metadata?.user_turn_metadatas ?? [];
  const turnMessages = [];
  for (const { value } of readJsonLines(`${base}.jsonl`, counters)) {
    if (value.kind === 'Prompt') {
      turnMessages.push([]);
    } else if (value.kind === 'AssistantMessage') {
      if (turnMessages.length === 0) {
        throw new Error('The transcript has an assistant message before any prompt.');
      }
      turnMessages.at(-1).push(collectText(value.data?.content));
    }
  }
  const records = [];
  const turns = [];
  for (let index = 0; index < Math.max(turnMessages.length, metadata.length); index += 1) {
    const meta = metadata[index];
    const messages = turnMessages[index] ?? [];
    const metering = (meta?.metering_usage ?? []).filter(Boolean);
    for (const entry of metering) {
      if (entry.unit !== 'credit') {
        throw new Error(`Unexpected metering unit '${entry.unit}'.`);
      }
    }
    const paired = Boolean(meta) && metering.length === messages.length;
    messages.forEach((text, position) => records.push({
      time: null,
      turn: index + 1,
      model: meta?.model ?? null,
      credits: paired ? Number(metering[position].value) : null,
      text,
    }));
    if (!meta) {
      turns.push({ turn: index + 1, recorded: false, assistantMessages: messages.length });
      continue;
    }
    const tokens = {
      input: meta.input_token_count ?? 0,
      output: meta.output_token_count ?? 0,
      cacheRead: meta.cache_read_input_token_count ?? 0,
      cacheWrite: meta.cache_write_input_token_count ?? 0,
    };
    turns.push({
      turn: index + 1,
      recorded: true,
      model: meta.model ?? null,
      requests: meta.total_request_count ?? null,
      assistantMessages: messages.length,
      meteringEntries: metering.length,
      credits: round(metering.reduce((sum, entry) => sum + Number(entry.value), 0)),
      durationSeconds: meta.turn_duration?.secs ?? null,
      contextUsagePercent: meta.context_usage_percentage ?? null,
      tokensRecorded: Object.values(tokens).some((amount) => amount !== 0),
      tokens,
    });
  }
  return { sources: [`${basename(base)}.json`, `${basename(base)}.jsonl`], records, turns };
}

const READERS = { claude: readClaude, codex: readCodex, junie: readJunie, kiro: readKiro };

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function isoTime(time) {
  return time === null || time === undefined ? null : new Date(time).toISOString();
}

function summarize(records) {
  const summary = { calls: records.length };
  const withTokens = records.filter((record) => record.tokens);
  if (withTokens.length > 0) {
    for (const field of TOKEN_FIELDS) {
      if (withTokens.some((record) => field in record.tokens)) {
        summary[field] = withTokens.reduce((sum, record) => sum + (record.tokens[field] ?? 0), 0);
      }
    }
  }
  for (const [field, missing] of [['costUsd', 'callsWithoutCost'], ['credits', 'callsWithoutCredits']]) {
    if (records.some((record) => field in record)) {
      const known = records.filter((record) => typeof record[field] === 'number');
      summary[field] = round(known.reduce((sum, record) => sum + record[field], 0));
      if (known.length < records.length) {
        summary[missing] = records.length - known.length;
      }
    }
  }
  const times = records.map((record) => record.time).filter((time) => time !== null && time !== undefined);
  if (times.length > 0) {
    summary.from = isoTime(Math.min(...times));
    summary.to = isoTime(Math.max(...times));
  }
  return summary;
}

export function parseMarker(raw) {
  const match = /^(at|text|turn):(.+)$/s.exec(raw ?? '');
  if (!match) {
    throw new Error(`Phase start '${raw}' must be at:<time>, text:<literal> or turn:<n>.`);
  }
  const [, kind, value] = match;
  if (kind === 'at') {
    const time = Date.parse(value);
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value) || !Number.isFinite(time)) {
      throw new Error(`Phase start '${raw}' needs an ISO time with a zone, such as 2026-09-26T16:50+08:00.`);
    }
    return { kind, raw, time };
  }
  if (kind === 'turn') {
    const turn = Number(value);
    if (!Number.isInteger(turn) || turn < 1) {
      throw new Error(`Phase start '${raw}' needs a 1-based turn number.`);
    }
    return { kind, raw, turn };
  }
  return { kind, raw, text: value };
}

function markerMatches(record, marker) {
  if (marker.kind === 'at') {
    return record.time !== null && record.time >= marker.time;
  }
  if (marker.kind === 'turn') {
    return record.turn >= marker.turn;
  }
  return record.text.includes(marker.text);
}

function splitPhases(records, markers, names) {
  if (names.length > 0 && names.length !== markers.length + 1) {
    throw new Error('Pass exactly one more --phase-name than --phase-start.');
  }
  const starts = [0];
  let from = 0;
  markers.forEach((marker, index) => {
    const offset = index === 0 ? 0 : from + 1;
    const found = records.slice(offset).findIndex((record) => markerMatches(record, marker));
    if (found < 0) {
      throw new Error(`Phase start '${marker.raw}' was not found${offset > 0 ? ` after call ${offset}` : ''}.`);
    }
    from = offset + found;
    starts.push(from);
  });
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : records.length;
    return {
      phase: names[index] ?? `phase-${index + 1}`,
      firstCall: end > start ? start + 1 : null,
      lastCall: end > start ? end : null,
      ...summarize(records.slice(start, end)),
    };
  });
}

function byModel(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.model ?? 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return Object.fromEntries([...groups].map(([model, group]) => {
    const { from, to, ...summary } = summarize(group);
    return [model, summary];
  }));
}

export function measureAgentUsage({ host, path, phaseStarts = [], phaseNames = [] }) {
  if (!HOSTS.includes(host)) {
    throw new Error(`Unknown host '${host}'. Use one of: ${HOSTS.join(', ')}.`);
  }
  const markers = phaseStarts.map(parseMarker);
  for (const marker of markers) {
    if (!MARKER_SUPPORT[marker.kind].includes(host)) {
      throw new Error(`${host} does not support ${marker.kind}: phase starts. `
        + `Use ${Object.keys(MARKER_SUPPORT).filter((kind) => MARKER_SUPPORT[kind].includes(host)).join(' or ')}.`);
    }
  }
  const counters = { skippedLines: 0 };
  const { sources, records, turns } = READERS[host](resolve(path), counters);
  const result = {
    host,
    sources,
    totals: summarize(records),
    byModel: byModel(records),
  };
  if (markers.length > 0 || phaseNames.length > 0) {
    result.phases = splitPhases(records, markers, phaseNames);
  }
  if (turns) {
    const recorded = turns.filter((turn) => turn.recorded);
    result.turns = turns;
    result.recordedTurnTotals = {
      turns: recorded.length,
      requests: recorded.reduce((sum, turn) => sum + (turn.requests ?? 0), 0),
      credits: round(recorded.reduce((sum, turn) => sum + turn.credits, 0)),
    };
  }
  if (counters.skippedLines > 0) {
    result.skippedLines = counters.skippedLines;
  }
  result.notes = HOST_NOTES[host];
  return result;
}

function defaultKiroPath() {
  const sessionId = process.env.KIRO_SESSION_ID;
  if (!sessionId) {
    return null;
  }
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) {
    throw new Error('KIRO_SESSION_ID contains unexpected characters.');
  }
  return join(homedir(), '.kiro', 'sessions', 'cli', `${sessionId}.json`);
}

function cliUsage() {
  return [
    'Usage:',
    '  measure-agent-usage.mjs <host> [session-file] [--phase-start <marker>]... [--phase-name <name>]...',
    '',
    'Hosts and session files:',
    '  claude  ~/.claude/projects/<project>/<session-id>.jsonl (its subagents folder is included)',
    '  codex   ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl',
    '  junie   ~/.junie/sessions/<session>/events.jsonl, or the session folder',
    '  kiro    ~/.kiro/sessions/cli/<session-id>.json; defaults to KIRO_SESSION_ID',
    '',
    'Phase starts, in order; the call that matches starts the next phase:',
    '  at:<ISO time with zone>  claude, codex, junie',
    "  text:<literal>           claude, codex, kiro (the agent's own messages and tool calls only)",
    '  turn:<n>                 junie, kiro',
  ].join('\n');
}

function main() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        'phase-start': { type: 'string', multiple: true },
        'phase-name': { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
      },
    });
    const [host, sessionPath] = positionals;
    if (values.help || !host) {
      process.stdout.write(`${cliUsage()}\n`);
      return;
    }
    const path = sessionPath ?? (host === 'kiro' ? defaultKiroPath() : null);
    if (!path) {
      throw new Error(`Pass the ${host} session file.\n${cliUsage()}`);
    }
    const result = measureAgentUsage({
      host,
      path,
      phaseStarts: values['phase-start'] ?? [],
      phaseNames: values['phase-name'] ?? [],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
