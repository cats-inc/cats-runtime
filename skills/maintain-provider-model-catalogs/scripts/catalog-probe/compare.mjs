// Compares a probe snapshot with the factory catalog and classifies every difference by who has
// to act: nobody, the operator (install, sign in, rerun) or an agent (investigate and edit).
// Absence from a source is never treated as removal, and only fields a source is authoritative
// for are compared.

import { isDeepStrictEqual } from 'node:util';

const AUDIENCE_RANK = { none: 0, info: 1, operator: 2, agent: 3 };
const OPERATOR_REASONS = new Set(['not-installed', 'not-authenticated', 'timeout', 'non-account-source']);
const SAMPLE_LIMIT = 12;

export function scopeKey({ provider, backend, transport }) {
  return `${provider}/${backend}${transport ? `/${transport}` : ''}`;
}

function sameScope(left, right) {
  return left.provider === right.provider
    && left.backend === right.backend
    && (left.transport ?? null) === (right.transport ?? null);
}

function maxAudience(findings) {
  return findings.reduce((max, finding) => (AUDIENCE_RANK[finding.audience] > AUDIENCE_RANK[max] ? finding.audience : max), 'none');
}

function wireIds(model) {
  const ids = [model.execution?.model, ...(model.execution?.variants ?? []).map((variant) => variant.model)];
  return [...new Set(ids.filter((id) => typeof id === 'string'))];
}

function controlsOf(model, scope) {
  return Array.isArray(model.controls) ? model.controls : (scope.shared_controls ?? []);
}

function sourceUnavailableAction(source) {
  switch (source.reason) {
    case 'not-installed':
      return `Install the ${source.provider} CLI on this machine, or ignore this scope here.`;
    case 'not-authenticated':
      return `Sign in to the ${source.provider} CLI, then rerun the probe.`;
    case 'non-account-source':
      return `Make sure the ${source.provider} CLI is signed in and online, then rerun the probe.`;
    case 'timeout':
      return 'Rerun the probe; if it times out again, raise --timeout.';
    default:
      return `\`${source.command}\` changed its output or behavior. Ask an agent to update this probe source.`;
  }
}

/**
 * A family-only source (Cursor's legacy slugs) lists `gpt-5.6-sol-high-fast` or
 * `cursor-grok-4.6-low` for the parameterized `gpt-5.6-sol[...]` and `grok-4.6[...]`. A slug
 * belongs to the family when the family name appears between dashes and is not followed by a
 * further version number, so `claude-opus-5-5-low` is not Opus 5. This proves the family is still
 * listed, not that the exact parameter combination still exists.
 */
export function familyPattern(wire) {
  const family = wire.split('[')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|-)${family}(?:$|-(?!\\d))`);
}

function sample(ids) {
  return ids.length > SAMPLE_LIMIT ? [...ids.slice(0, SAMPLE_LIMIT), `… +${ids.length - SAMPLE_LIMIT} more`] : ids;
}

/** Compares one source entry with its factory scope. */
export function compareScope(source, scope) {
  const findings = [];
  const add = (finding) => findings.push(finding);
  const provider = source.provider;
  const conclusive = source.status === 'ok';
  const membership = source.coverage?.membership ?? 'none';
  const summary = {
    key: scopeKey(source),
    provider,
    backend: source.backend,
    transport: source.transport ?? null,
    selectionMode: scope?.selection_mode ?? null,
    catalog: scope ? { cliVersion: scope.cli_version ?? null, lastUpdated: scope.last_updated ?? null, entries: scope.models?.length ?? 0 } : null,
    source: {
      status: source.status,
      ...(source.reason ? { reason: source.reason } : {}),
      ...(source.message ? { message: source.message } : {}),
      cliVersion: source.cliVersion ?? null,
      versionSource: source.versionSource ?? null,
      sourceClass: source.sourceClass,
      command: source.command,
      membership,
      rows: source.models?.filter((row) => !row.hidden).length ?? 0,
      hiddenRows: source.models?.filter((row) => row.hidden).length ?? 0,
    },
    confirmedEntries: [],
    findings,
  };

  if (!scope) {
    add({ kind: 'scope-missing', audience: 'agent', subject: summary.key, message: `The factory has no ${summary.key} scope for this source.`, nextAction: 'Ask an agent to align the probe sources with the factory scopes.' });
    return finalize(summary);
  }

  // Side-by-side rows for the HTML view: every catalog entry with what the source listed for it,
  // plus the listed rows no entry executes. Statuses are derived from the findings in finalize.
  const coverage = source.coverage ?? {};
  summary.comparison = {
    comparable: false,
    labelCompared: Boolean(coverage.label),
    effortsCompared: coverage.efforts ?? null,
    entries: (scope.models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
      controls: controlsOf(model, scope).map((control) => ({
        key: control.key,
        values: (control.values ?? []).map((value) => value.value),
        default: control.default ?? null,
      })),
      wires: wireIds(model).map((id) => ({ id, listed: null })),
      observed: null,
      findings: [],
      status: 'unverified',
    })),
    upstream: [],
  };

  if (source.cliVersion && scope.cli_version && source.cliVersion !== scope.cli_version) {
    add(source.versionKind === 'build'
      ? { kind: 'version-not-comparable', audience: 'info', subject: 'cli_version', catalog: scope.cli_version, observed: source.cliVersion, message: `Installed build ${source.cliVersion}; the catalog records release ${scope.cli_version}.` }
      : { kind: 'version-changed', audience: 'info', subject: 'cli_version', catalog: scope.cli_version, observed: source.cliVersion, message: `Installed ${source.cliVersion}; the catalog was captured with ${scope.cli_version}.` });
  }

  if (source.status === 'unavailable' || source.status === 'error') {
    add({
      kind: 'source-unavailable',
      audience: OPERATOR_REASONS.has(source.reason) ? 'operator' : 'agent',
      subject: source.reason ?? 'unknown',
      message: source.message ?? 'The source failed.',
      nextAction: sourceUnavailableAction(source),
    });
    return finalize(summary);
  }
  if (source.status === 'degraded') {
    add({ kind: 'source-degraded', audience: 'operator', subject: source.reason ?? 'unknown', message: source.message ?? 'The source answered, but not conclusively.', nextAction: sourceUnavailableAction(source) });
  }

  for (const note of source.notes ?? []) add({ kind: 'source-note', audience: 'info', subject: 'source', message: note });

  if (membership === 'none') {
    compareWithoutEnumeration(source, scope, add);
    return finalize(summary);
  }

  const inconclusive = (finding) => (conclusive || finding.audience !== 'agent'
    ? finding
    : { ...finding, audience: 'info', inconclusive: true });
  const rows = new Map((source.models ?? []).map((row) => [row.id, row]));
  const lookup = (wire) => {
    if (membership !== 'family') return rows.has(wire) ? [rows.get(wire)] : [];
    const family = familyPattern(wire);
    return (source.models ?? []).filter((row) => family.test(row.id));
  };
  const matched = new Set();
  summary.comparison.comparable = true;

  for (const [index, model] of (scope.models ?? []).entries()) {
    const before = findings.length;
    const entry = summary.comparison.entries[index];
    for (const wireRow of entry.wires) {
      const wire = wireRow.id;
      const found = lookup(wire);
      wireRow.listed = found.length > 0;
      if (membership === 'family') wireRow.matches = found.map((row) => row.id);
      if (found.length === 0) {
        add(inconclusive({
          kind: 'absent-from-source',
          audience: 'agent',
          subject: wire,
          entry: model.id,
          message: `Entry "${model.id}" executes ${wire}, which \`${source.command}\` did not list${membership === 'partial' ? ' (this source is known to omit some picker rows)' : ''}${membership === 'family' ? ' as a model family' : ''}.`,
          nextAction: `Check the ${provider} picker for "${model.label}". Remove the entry only after the operator confirms it is gone; otherwise acknowledge the source gap.`,
        }));
        continue;
      }
      for (const row of found) matched.add(row.id);
      wireRow.hidden = found.every((row) => row.hidden);
      if (wireRow.hidden) {
        add(inconclusive({ kind: 'hidden-in-source', audience: 'agent', subject: wire, entry: model.id, message: `${wire} is listed as hidden.`, nextAction: `Confirm whether the ${provider} picker still offers "${model.label}".` }));
      }
    }
    const primary = membership === 'family' ? null : rows.get(model.execution?.model ?? '');
    if (primary) {
      entry.observed = {
        id: primary.id,
        label: primary.label ?? null,
        efforts: primary.efforts ?? null,
        effortDefault: primary.effortDefault ?? null,
        ...(primary.evidence ? { evidence: primary.evidence } : {}),
      };
    }
    if (primary && !primary.hidden) compareFields(model, primary, scope, coverage, provider, (finding) => add(inconclusive(finding)));
    entry.findings = findings.slice(before).map((_, offset) => before + offset);
    if (findings.length === before) summary.confirmedEntries.push(model.id);
  }

  const extra = (source.models ?? []).filter((row) => !matched.has(row.id));
  const extraVisible = extra.filter((row) => !row.hidden);
  const extraHidden = extra.filter((row) => row.hidden);
  const upstreamRow = (row, finding) => ({
    id: row.id,
    label: row.label ?? null,
    ...(row.efforts ? { efforts: row.efforts } : {}),
    ...(row.hidden ? { hidden: true } : {}),
    ...(row.evidence ? { evidence: row.evidence } : {}),
    finding,
  });
  if (extraVisible.length > 0) {
    if (scope.selection_mode === 'full' && (membership === 'complete' || membership === 'partial')) {
      for (const row of extraVisible) {
        summary.comparison.upstream.push(upstreamRow(row, findings.length));
        add(inconclusive({
          kind: 'new-candidate',
          audience: 'agent',
          subject: row.id,
          ...(row.label ? { observed: { label: row.label } } : {}),
          message: `\`${source.command}\` lists ${row.id}${row.label ? ` (${row.label})` : ''}, which no catalog entry executes.`,
          nextAction: `Capture the ${provider} picker row for ${row.label ?? row.id} with its options, then add it or acknowledge why it stays out.`,
        }));
      }
    } else {
      const why = scope.selection_mode === 'shortlist'
        ? 'This scope is an operator shortlist, so other upstream models are informational.'
        : 'This source can list more than the picker offers.';
      for (const row of extraVisible) summary.comparison.upstream.push(upstreamRow(row, findings.length));
      add({ kind: 'upstream-only', audience: 'info', subject: `${extraVisible.length} rows`, observed: sample(extraVisible.map((row) => row.id)), message: `${extraVisible.length} listed models are not in the catalog. ${why}` });
    }
  }
  if (extraHidden.length > 0) {
    for (const row of extraHidden) summary.comparison.upstream.push(upstreamRow(row, findings.length));
    add({ kind: 'hidden-upstream', audience: 'info', subject: `${extraHidden.length} rows`, observed: sample(extraHidden.map((row) => row.id)), message: `${extraHidden.length} hidden rows are not picker rows.` });
  }
  summary.listConfirmed = conclusive
    && membership === 'complete'
    && !findings.some((finding) => ['absent-from-source', 'new-candidate', 'hidden-in-source'].includes(finding.kind));
  return finalize(summary);
}

function compareFields(model, row, scope, coverage, provider, add) {
  if (coverage.label && typeof row.label === 'string' && row.label !== model.label) {
    add({
      kind: 'field-drift', audience: 'agent', subject: model.id, field: 'label', catalog: model.label, observed: row.label,
      message: `Entry "${model.id}" is labelled "${model.label}"; the source shows "${row.label}".`,
      nextAction: `Re-read the ${provider} picker label for "${model.id}".`,
    });
  }
  if (!coverage.efforts) return;
  const control = controlsOf(model, scope).find((candidate) => candidate.key === coverage.efforts);
  const catalogValues = control?.values?.map((value) => value.value) ?? [];
  const observedValues = row.efforts ?? [];
  if (!isDeepStrictEqual(catalogValues, observedValues)) {
    add({
      kind: 'field-drift', audience: 'agent', subject: model.id, field: 'efforts', catalog: catalogValues, observed: observedValues,
      message: `Entry "${model.id}" offers [${catalogValues.join(', ')}]; the source lists [${observedValues.join(', ')}].`,
      nextAction: `Re-read the ${provider} effort menu for "${model.label}".`,
    });
    return;
  }
  if (coverage.effortDefault && control && observedValues.length > 0) {
    const catalogDefault = control.default ?? null;
    const observedDefault = row.effortDefault ?? null;
    if (catalogDefault !== observedDefault) {
      add({
        kind: 'field-drift', audience: 'agent', subject: model.id, field: 'effortDefault', catalog: catalogDefault, observed: observedDefault,
        message: `Entry "${model.id}" defaults to ${catalogDefault ?? 'nothing'}; the source defaults to ${observedDefault ?? 'nothing'}.`,
        nextAction: `Check the ${provider} picker's (default) effort marker for "${model.label}".`,
      });
    }
  }
}

function compareWithoutEnumeration(source, scope, add) {
  const changed = Boolean(source.cliVersion && scope.cli_version && source.cliVersion !== scope.cli_version);
  const changelog = (source.signals ?? []).find((signal) => signal.kind === 'changelog');
  const entries = changelog?.sections?.flatMap((section) => section.entries.map((entry) => `${section.version}: ${entry}`)) ?? [];
  if (changed && entries.length > 0) {
    add({
      kind: 'capture-needed',
      audience: 'agent',
      subject: 'picker',
      observed: entries,
      message: `${entries.length} release-note entries since ${scope.cli_version} mention models, aliases or effort.`,
      nextAction: `Run an agent-operated ${source.provider} /model capture and compare it with the catalog.`,
    });
  }
  const unreadable = (source.signals ?? []).find((signal) => signal.kind === 'changelog-unreadable');
  if (unreadable) add({ kind: 'signal-unreadable', audience: 'info', subject: 'changelog', message: unreadable.message });
  add({
    kind: 'no-automatic-source',
    audience: 'info',
    subject: 'picker',
    message: `${source.provider} has no read-only model enumeration; its ${scope.models?.length ?? 0} entries are unverified. The picker can also change without a version change.`,
  });
}

const ENTRY_STATUS_BY_KIND = [
  ['absent-from-source', 'absent'],
  ['hidden-in-source', 'hidden'],
  ['field-drift', 'drift'],
];

function entryStatus(summary, entry) {
  if (!summary.comparison.comparable) return 'unverified';
  const related = entry.findings.map((index) => summary.findings[index]);
  if (related.length === 0) return 'confirmed';
  const open = related.filter((finding) => !finding.acknowledged);
  if (open.length === 0) return 'acknowledged';
  if (open.every((finding) => finding.inconclusive)) return 'inconclusive';
  return ENTRY_STATUS_BY_KIND.find(([kind]) => open.some((finding) => finding.kind === kind))?.[1] ?? 'drift';
}

function upstreamStatus(finding) {
  if (finding.kind === 'hidden-upstream') return 'hidden';
  if (finding.kind !== 'new-candidate') return 'not-in-catalog';
  if (finding.acknowledged) return 'acknowledged';
  return finding.inconclusive ? 'inconclusive' : 'new';
}

// Counts open findings only; acknowledged ones are counted separately.
function finalize(summary) {
  if (summary.comparison) {
    for (const entry of summary.comparison.entries) entry.status = entryStatus(summary, entry);
    for (const row of summary.comparison.upstream) row.status = upstreamStatus(summary.findings[row.finding]);
  }
  const open = (kind) => summary.findings.filter((finding) => finding.kind === kind && !finding.acknowledged && finding.audience !== 'info').length;
  summary.counts = {
    confirmed: summary.confirmedEntries.length,
    newCandidates: open('new-candidate'),
    drift: open('field-drift'),
    absent: open('absent-from-source'),
    hidden: open('hidden-in-source'),
    acknowledged: summary.findings.filter((finding) => finding.acknowledged).length,
  };
  summary.verdict = maxAudience(summary.findings);
  return summary;
}

export function validateAcknowledgements(document) {
  if (!document) return [];
  if (document.schemaVersion !== 1 || !Array.isArray(document.acknowledgements)) {
    throw new Error('The acknowledgements file needs schemaVersion 1 and an acknowledgements array.');
  }
  return document.acknowledgements.map((ack, index) => {
    for (const field of ['provider', 'kind', 'subject', 'reason', 'evidence', 'acknowledgedOn']) {
      if (typeof ack[field] !== 'string' || !ack[field].trim()) {
        throw new Error(`Acknowledgement ${index + 1} needs a non-empty "${field}".`);
      }
    }
    return { backend: 'cli', transport: null, ...ack, index };
  });
}

function ackMatches(ack, scopeSummary, finding) {
  return sameScope(ack, scopeSummary)
    && ack.kind === finding.kind
    && ack.subject === finding.subject
    && (ack.field === undefined || ack.field === finding.field)
    && (ack.observed === undefined || isDeepStrictEqual(ack.observed, finding.observed));
}

/** Validates a whole snapshot. Returns the report object the renderers and agents consume. */
export function validateSnapshot({ snapshot, catalogDocument, acknowledgements = [], environment = {} }) {
  const catalogs = catalogDocument?.catalogs ?? [];
  const used = new Set();
  const scopes = (snapshot.sources ?? []).map((source) => {
    const scope = catalogs.find((candidate) => sameScope(candidate, source)) ?? null;
    const summary = compareScope(source, scope);
    for (const finding of summary.findings) {
      const ack = acknowledgements.find((candidate) => ackMatches(candidate, summary, finding));
      if (!ack) continue;
      used.add(ack.index);
      finding.acknowledged = { reason: ack.reason, evidence: ack.evidence, acknowledgedOn: ack.acknowledgedOn };
      finding.audienceBeforeAcknowledgement = finding.audience;
      finding.audience = 'none';
    }
    return finalize(summary);
  });

  // Only a run over every source can say that a curated scope has no source at all.
  const probed = new Set(scopes.map((scope) => scope.key));
  const unprobedScopes = snapshot.selection === 'all'
    ? catalogs
      .filter((scope) => scope.selection_mode !== 'discovery' && !probed.has(scopeKey(scope)))
      .map((scope) => scopeKey(scope))
    : [];
  const probedProviders = new Set(scopes.map((scope) => scope.provider));
  const staleAcknowledgements = acknowledgements
    .filter((ack) => !used.has(ack.index) && probedProviders.has(ack.provider))
    .map(({ index, ...ack }) => ack);

  const general = [];
  if (environment.personalOverride) {
    general.push({ kind: 'personal-override', audience: 'info', subject: environment.personalOverride, message: `A personal catalog override exists at ${environment.personalOverride}; this machine's menus can differ from the factory checked here.` });
  }
  for (const ack of staleAcknowledgements) {
    general.push({ kind: 'stale-acknowledgement', audience: 'info', subject: `${ack.provider}:${ack.kind}:${ack.subject}`, message: `No current finding matches this acknowledgement (${ack.reason}). Remove it once the change is understood.` });
  }

  const verdict = maxAudience([...scopes.map((scope) => ({ audience: scope.verdict })), ...general]);
  return {
    schemaVersion: 1,
    kind: 'cats-catalog-probe-report',
    createdAt: new Date().toISOString(),
    snapshotCreatedAt: snapshot.createdAt ?? null,
    catalogSourceDigest: environment.catalogSourceDigest ?? null,
    verdict,
    needsAgent: scopes.filter((scope) => scope.verdict === 'agent').map((scope) => scope.key),
    needsOperator: scopes.filter((scope) => scope.verdict === 'operator').map((scope) => scope.key),
    general,
    unprobedScopes,
    scopes,
  };
}

export function exitCodeFor(report) {
  return report.verdict === 'agent' || report.verdict === 'operator' ? 2 : 0;
}
