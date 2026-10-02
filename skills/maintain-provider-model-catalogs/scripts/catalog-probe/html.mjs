// Renders report.json as one self-contained HTML page for the operator, laid out as a stocktake:
// a tally with one mark per catalog entry for every scope, then each scope's reconciliation sheet
// with the catalog on the left, what the CLI listed on the right and the result between them.
// The page is a view; the JSON files beside it are the record.

const WHO = { agent: 'Agent', operator: 'You' };
const FILTER_OF = { agent: 'agent', operator: 'operator', info: 'ok', none: 'ok' };

const STATUS = {
  confirmed: ['Confirmed', 'Listed, and every compared field matches'],
  new: ['New', 'Listed by the CLI, but no catalog entry executes it'],
  drift: ['Differs', 'Listed, but a compared field differs'],
  absent: ['Not listed', 'The CLI did not list an execution ID of this entry'],
  hidden: ['Hidden', 'The CLI lists it as hidden, not as a picker row'],
  acknowledged: ['Acknowledged', 'A known, investigated difference'],
  inconclusive: ['Inconclusive', 'The source answered without the account catalog'],
  unverified: ['Unverified', 'No read-only list exists for this CLI, or it could not be read'],
  'not-in-catalog': ['Not in catalog', 'Listed, outside this shortlist or beyond the picker'],
};

// Listed rows no entry executes that the sheet shows as rows; the rest stay in the folded list.
const SHOWN_UPSTREAM = new Set(['new', 'acknowledged', 'inconclusive']);

const SCOPE_FINDINGS = new Set([
  'version-changed', 'version-not-comparable', 'source-unavailable', 'source-degraded', 'source-note',
  'capture-needed', 'no-automatic-source', 'signal-unreadable', 'upstream-only', 'hidden-upstream', 'scope-missing',
]);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
const esc = escapeHtml;

function anchor(key) {
  return `scope-${key.replace(/[^a-z0-9]+/gi, '-')}`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function shownUpstream(comparison) {
  return comparison.upstream.map((row, index) => ({ row, index })).filter(({ row }) => SHOWN_UPSTREAM.has(row.status));
}

/** One tally mark; shape and colour both carry the status. */
function mark(status, { href = null, name = null } = {}) {
  const [text, meaning] = STATUS[status] ?? [status, ''];
  const label = name ? `${name}: ${text}` : text;
  const attrs = `class="mk m-${esc(status)}" title="${esc(`${label}. ${meaning}`)}" aria-label="${esc(label)}"`;
  return href ? `<a ${attrs} href="${esc(href)}"></a>` : `<span ${attrs} role="img"></span>`;
}

function versionText(scope) {
  const catalog = scope.catalog?.cliVersion ?? '?';
  const observed = scope.source.cliVersion;
  if (!observed || observed === catalog) return esc(catalog);
  if (scope.findings.some((finding) => finding.kind === 'version-not-comparable')) return `${esc(catalog)}, build ${esc(observed)}`;
  return `<span class="nw">${esc(catalog)} →</span> <b class="nw">${esc(observed)}</b>`;
}

function resultSummary(scope) {
  const { source, counts } = scope;
  if (source.status === 'unavailable' || source.status === 'error') return `${esc(source.reason ?? source.status)}: ${esc(source.message ?? '')}`;
  const entries = scope.catalog?.entries ?? 0;
  if (source.membership === 'none') {
    const capture = scope.findings.find((finding) => finding.kind === 'capture-needed' && finding.audience !== 'none');
    return capture ? `No list; ${esc(capture.message)}` : `No read-only list; ${entries} entries unverified`;
  }
  if (source.status === 'degraded') return `${counts.confirmed} of ${entries} confirmed; degraded (${esc(source.reason)}), the rest inconclusive`;
  const parts = [`${counts.confirmed} of ${entries} confirmed`];
  if (counts.newCandidates) parts.push(`${counts.newCandidates} new`);
  if (counts.drift) parts.push(`${counts.drift} differ`);
  if (counts.absent) parts.push(`${counts.absent} not listed`);
  if (counts.hidden) parts.push(`${counts.hidden} hidden`);
  if (counts.acknowledged) parts.push(`${counts.acknowledged} acknowledged`);
  return parts.join(', ');
}

function shortKey(key) {
  return key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
}

/** Value chips; `del` and `add` mark values only one side has, `def` the default. */
function chips(values, { def = null, del = new Set(), add = new Set(), defDiff = false } = {}) {
  if (!values || values.length === 0) return '<span class="quiet">none</span>';
  return values.map((value) => {
    const classes = ['chip'];
    if (del.has(value)) classes.push('del');
    if (add.has(value)) classes.push('add');
    if (value === def) classes.push(defDiff ? 'def def-diff' : 'def');
    const title = value === def ? ' title="default"' : '';
    return `<span class="${classes.join(' ')}"${title}>${esc(value)}</span>`;
  }).join('');
}

function evidenceValue(value) {
  if (Array.isArray(value)) return value.map(evidenceValue).join(', ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${evidenceValue(item)}`).join('; ');
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}

/** The extra public fields a CLI listed for a row; shown, never compared. */
function evidenceBlock(evidence, { open = false } = {}) {
  if (!evidence) return '';
  const items = Object.entries(evidence)
    .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(evidenceValue(value))}</dd></div>`)
    .join('');
  return `<details class="ev"${open ? ' open' : ''}><summary>More from the CLI</summary><dl>${items}</dl></details>`;
}

const BY = { agent: 'Agent', operator: 'You', info: 'Note', none: 'OK', ack: 'Acknowledged' };

function findingLine(finding) {
  const who = finding.acknowledged ? 'ack' : finding.inconclusive ? 'info' : finding.audience;
  let detail = '';
  if (Array.isArray(finding.observed) && finding.kind !== 'field-drift' && finding.kind !== 'new-candidate') {
    detail = `<ul class="observed">${finding.observed.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  }
  const next = finding.nextAction && !finding.acknowledged && finding.audience !== 'info' && finding.audience !== 'none'
    ? `<div class="next">Next: ${esc(finding.nextAction)}</div>`
    : '';
  const ack = finding.acknowledged
    ? `<div class="ackd">Acknowledged ${esc(finding.acknowledged.acknowledgedOn)}: ${esc(finding.acknowledged.reason)} <code>${esc(finding.acknowledged.evidence)}</code></div>`
    : '';
  return `<li class="finding f-${esc(who)}"><span class="by">${esc(BY[who] ?? who)}</span><div><div>${esc(finding.message)}</div>${detail}${next}${ack}</div></li>`;
}

function gutter(status) {
  const word = status === 'confirmed' ? '' : `<span class="st st-${esc(status)}">${esc(STATUS[status]?.[0] ?? status)}</span>`;
  return `${mark(status)}${word}`;
}

function wireLine(wire) {
  const [kind, sign, title] = wire.listed === null ? ['unk', '?', 'not checked']
    : !wire.listed ? ['no', '✗', 'not listed']
      : wire.hidden ? ['hid', '◐', 'listed as hidden'] : ['yes', '✓', 'listed'];
  const family = wire.matches ? ` <span class="quiet" title="${esc(wire.matches.join(', '))}">(${wire.matches.length} slugs)</span>` : '';
  return `<div class="wire"><span class="w w-${kind}" title="${title}">${sign}</span><code>${esc(wire.id)}</code>${family}</div>`;
}

function notesRow(findings) {
  return findings.length ? `<tr class="note-row"><td colspan="5"><ul class="findings">${findings.map(findingLine).join('')}</ul></td></tr>` : '';
}

function entryBody(scope, entry, rowId) {
  const { comparison } = scope;
  const compareKey = comparison.effortsCompared;
  const observed = entry.observed;
  const compared = entry.controls.find((control) => control.key === compareKey);
  const catalogValues = compared?.values ?? [];
  const observedValues = observed?.efforts ?? [];
  const comparing = Boolean(compareKey && observed && comparison.comparable);
  const del = comparing ? new Set(catalogValues.filter((value) => !observedValues.includes(value))) : new Set();
  const add = comparing ? new Set(observedValues.filter((value) => !catalogValues.includes(value))) : new Set();
  const defDiff = comparing && observed.effortDefault != null && (compared?.default ?? null) !== observed.effortDefault;

  const catalogOptions = entry.controls.length === 0
    ? '<span class="quiet">none</span>'
    : entry.controls.map((control) => `<div class="ctl"><span class="ctl-key">${esc(shortKey(control.key))}</span>${chips(control.values, {
      def: control.default,
      del: control.key === compareKey ? del : new Set(),
      defDiff: control.key === compareKey && defDiff,
    })}</div>`).join('');

  let listedOptions = '<span class="quiet">—</span>';
  if (observed && (observed.efforts || observed.effortDefault)) {
    const body = `<div class="ctl">${chips(observedValues, { def: observed.effortDefault, add, defDiff })}</div>`;
    listedOptions = compareKey ? body : `<div class="not-compared" title="Not compared for this CLI">${body}</div>`;
  } else if (observed && compareKey) {
    listedOptions = '<span class="quiet">none</span>';
  }

  const labelDiff = comparison.labelCompared && observed?.label != null && observed.label !== entry.label;
  let listedLabel = '';
  if (observed?.label != null) {
    listedLabel = comparison.labelCompared
      ? `<div class="lbl${labelDiff ? ' diff' : ''}">${esc(observed.label)}</div>`
      : `<div class="lbl not-compared" title="Not compared: this CLI's list labels are not picker labels">${esc(observed.label)}</div>`;
  }

  const search = [entry.id, entry.label, observed?.label, ...entry.wires.map((wire) => wire.id)].filter(Boolean).join(' ').toLowerCase();
  return `<tbody class="r-${esc(entry.status)}" data-search="${esc(search)}">
    <tr id="${rowId}">
      <td><div class="lbl${labelDiff ? ' diff' : ''}">${esc(entry.label)}</div><code class="id">${esc(entry.id)}</code></td>
      <td>${catalogOptions}</td>
      <td class="gut">${gutter(entry.status)}</td>
      <td>${listedLabel}${entry.wires.map(wireLine).join('')}${evidenceBlock(observed?.evidence)}</td>
      <td>${listedOptions}</td>
    </tr>${notesRow(entry.findings.map((index) => scope.findings[index]))}
  </tbody>`;
}

function upstreamBody(scope, row, rowId) {
  const search = [row.id, row.label].filter(Boolean).join(' ').toLowerCase();
  return `<tbody class="r-${esc(row.status)}" data-search="${esc(search)}">
    <tr id="${rowId}">
      <td colspan="2" class="quiet">Not in the catalog</td>
      <td class="gut">${gutter(row.status)}</td>
      <td>${row.label ? `<div class="lbl">${esc(row.label)}</div>` : ''}${wireLine({ id: row.id, listed: true })}${evidenceBlock(row.evidence, { open: row.status === 'new' })}</td>
      <td>${row.efforts ? `<div class="ctl">${chips(row.efforts)}</div>` : '<span class="quiet">—</span>'}</td>
    </tr>${notesRow([scope.findings[row.finding]])}
  </tbody>`;
}

/** Ledger side headings that name the CLI and the version each side comes from. */
function sideHeadings(scope) {
  const name = scope.provider;
  const captured = scope.catalog?.cliVersion;
  const installed = scope.source.cliVersion;
  const build = scope.findings.some((finding) => finding.kind === 'version-not-comparable');
  const cli = installed ? `${name} ${build ? 'build ' : ''}${installed} (installed)` : name;
  return {
    catalog: captured ? `In the catalog, captured with ${name} ${captured}` : 'In the catalog',
    listed: scope.source.membership === 'none' ? `${cli} has no read-only list` : `Listed by ${cli}`,
  };
}

function ledger(scope) {
  const id = anchor(scope.key);
  const { comparison } = scope;
  const heading = sideHeadings(scope);
  const bodies = [
    ...comparison.entries.map((entry, index) => entryBody(scope, entry, `${id}-e${index}`)),
    ...shownUpstream(comparison).map(({ row, index }) => upstreamBody(scope, row, `${id}-u${index}`)),
  ];
  return `<div class="table-wrap"><table class="ledger">
      <colgroup><col class="c-entry"><col class="c-opt"><col class="c-gut"><col class="c-listed"><col class="c-opt"></colgroup>
      <thead>
        <tr class="sides"><th colspan="2" scope="colgroup">${esc(heading.catalog)}</th><th class="gut" rowspan="2" scope="col"><span class="sr">Result</span></th><th colspan="2" scope="colgroup">${esc(heading.listed)}</th></tr>
        <tr><th scope="col">Entry</th><th scope="col">Options</th><th scope="col">Listed as</th><th scope="col">Options</th></tr>
      </thead>
      ${bodies.join('\n')}
    </table></div>${otherRows(scope)}`;
}

function otherRows(scope) {
  const others = scope.comparison.upstream.filter((row) => row.status === 'not-in-catalog' || row.status === 'hidden');
  if (others.length === 0) return '';
  const hidden = others.filter((row) => row.status === 'hidden').length;
  const why = scope.selectionMode === 'shortlist'
    ? 'This scope is a shortlist you chose; other listed models are shown for reference only.'
    : hidden === others.length
      ? 'Hidden rows are not picker rows.'
      : 'This source can list more than the picker offers.';
  const items = others.map((row) => {
    const search = [row.id, row.label].filter(Boolean).join(' ').toLowerCase();
    const label = row.label && row.label !== row.id ? ` <span class="quiet">${esc(row.label)}</span>` : '';
    return `<li data-search="${esc(search)}">${row.hidden ? '<span class="w w-hid" title="hidden">◐</span>' : ''}<code>${esc(row.id)}</code>${label}</li>`;
  }).join('');
  return `<details class="others"><summary>${plural(others.length, 'other listed model', 'other listed models')} not in the catalog</summary><p class="quiet">${esc(why)}</p><ul class="other-list">${items}</ul></details>`;
}

function scopeSheet(scope) {
  const verdict = scope.verdict;
  const who = WHO[verdict] ?? '';
  const scopeFindings = scope.findings.filter((finding) => SCOPE_FINDINGS.has(finding.kind));
  const source = scope.source;
  const facts = [
    `<div><dt>Read</dt><dd><code>${esc(source.command)}</code></dd></div>`,
    `<div><dt>Source</dt><dd>${esc(source.sourceClass)}, membership <b>${esc(source.membership)}</b>${source.rows ? `, ${source.rows} rows${source.hiddenRows ? ` and ${source.hiddenRows} hidden` : ''}` : ''}</dd></div>`,
    `<div><dt>Status</dt><dd>${esc(source.status)}${source.reason ? ` (${esc(source.reason)})` : ''}</dd></div>`,
    `<div><dt>Catalog</dt><dd>${esc(scope.selectionMode ?? '?')}, ${scope.catalog?.entries ?? 0} entries, CLI ${esc(scope.catalog?.cliVersion ?? '?')}, updated ${esc(scope.catalog?.lastUpdated ?? '?')}</dd></div>`,
    `<div><dt>Installed</dt><dd>${esc(source.cliVersion ?? 'unknown')}${source.versionSource ? ` <span class="quiet">from ${esc(source.versionSource)}</span>` : ''}</dd></div>`,
  ].join('');
  return `<details class="scope sheet v-${esc(verdict)}" id="${anchor(scope.key)}" data-filter="${FILTER_OF[verdict] ?? 'ok'}"${who ? ' open' : ''}>
    <summary><span class="who">${who}</span><span class="scope-key">${esc(scope.key)}</span><span class="scope-ver">${versionText(scope)}</span><span class="scope-result">${resultSummary(scope)}</span></summary>
    <div class="scope-body">
      <dl class="facts">${facts}</dl>
      ${scopeFindings.length ? `<ul class="findings">${scopeFindings.map(findingLine).join('')}</ul>` : ''}
      ${scope.comparison ? ledger(scope) : ''}
    </div>
  </details>`;
}

function tallyRow(scope) {
  const who = WHO[scope.verdict] ?? '';
  const id = anchor(scope.key);
  let marks = '<span class="quiet">No catalog scope</span>';
  if (scope.comparison) {
    const entries = scope.comparison.entries.map((entry, index) => mark(entry.status, { href: `#${id}-e${index}`, name: entry.label ?? entry.id })).join('');
    const extra = shownUpstream(scope.comparison).map(({ row, index }) => mark(row.status, { href: `#${id}-u${index}`, name: row.label ?? row.id })).join('');
    marks = `<span class="marks">${entries}</span>${extra ? `<span class="marks extra">${extra}</span>` : ''}`;
  }
  return `<tr class="v-${esc(scope.verdict)}${who ? ' act' : ''}">
      <td class="who">${who}</td>
      <th scope="row"><a href="#${id}">${esc(scope.key)}</a></th>
      <td class="tally-marks">${marks}</td>
      <td class="result">${resultSummary(scope)}</td>
      <td class="ver">${versionText(scope)}</td>
    </tr>`;
}

function headline(report) {
  const agents = report.scopes.filter((scope) => scope.verdict === 'agent').length;
  const you = report.scopes.filter((scope) => scope.verdict === 'operator').length;
  const parts = [];
  if (agents) parts.push(`${plural(agents, 'scope needs', 'scopes need')} an agent`);
  if (you) parts.push(agents ? `${you} need${you === 1 ? 's' : ''} you` : `${plural(you, 'scope needs', 'scopes need')} you`);
  return parts.length ? `${parts.join(', and ')}.` : 'Nothing to do.';
}

function totals(report) {
  const entries = report.scopes.flatMap((scope) => scope.comparison?.entries ?? []);
  const extra = report.scopes.flatMap((scope) => (scope.comparison ? shownUpstream(scope.comparison).map(({ row }) => row) : []));
  const count = (list, status) => list.filter((item) => item.status === status).length;
  const sentences = [`${count(entries, 'confirmed')} of ${plural(entries.length, 'catalog entry', 'catalog entries')} confirmed across ${plural(report.scopes.length, 'scope', 'scopes')}.`];
  const fresh = count(extra, 'new');
  if (fresh) sentences.push(`${plural(fresh, 'listed model is', 'listed models are')} not in the catalog.`);
  const unchecked = count(entries, 'unverified') + count(entries, 'inconclusive');
  if (unchecked) sentences.push(`${plural(unchecked, 'entry', 'entries')} could not be checked.`);
  return sentences.join(' ');
}

function todoSection(report, handoff) {
  const youItems = report.scopes.flatMap((scope) => scope.findings
    .filter((finding) => finding.audience === 'operator')
    .map((finding) => `<li><a href="#${anchor(scope.key)}">${esc(scope.key)}</a>: ${esc(finding.nextAction ?? finding.message)}</li>`));
  const agentItems = report.scopes.filter((scope) => scope.verdict === 'agent').map((scope) => {
    const open = scope.findings.filter((finding) => finding.audience === 'agent').length;
    return `<li><a href="#${anchor(scope.key)}">${esc(scope.key)}</a>: ${plural(open, 'item', 'items')} to investigate</li>`;
  });
  const notes = [
    ...report.general.map((finding) => `<li>${esc(finding.message)}</li>`),
    ...(report.unprobedScopes.length ? [`<li>No probe source for ${esc(report.unprobedScopes.join(', '))}.</li>`] : []),
  ];
  if (!youItems.length && !agentItems.length && !notes.length) return '';
  const actionable = youItems.length || agentItems.length;
  return `<section class="sheet todo" aria-labelledby="todo-h">
      <h2 id="todo-h">${actionable ? 'What to do' : 'Notes'}</h2>
      ${youItems.length ? `<h3>You</h3><ul>${youItems.join('')}</ul>` : ''}
      ${agentItems.length ? `<h3>An agent</h3><ul>${agentItems.join('')}</ul>` : ''}
      ${agentItems.length && handoff ? `<div class="handoff"><pre id="handoff">${esc(handoff)}</pre><button type="button" data-copy="handoff">Copy prompt</button></div>` : ''}
      ${notes.length ? `${actionable ? '<h3>Notes</h3>' : ''}<ul>${notes.join('')}</ul>` : ''}
    </section>`;
}

const STYLE = `
:root{color-scheme:light dark;
--desk:#e3eae5;--sheet:#fbfcfa;--band:#f0f5f1;--rule:#cdd7d0;--rule-2:#9fb0a5;--ink:#16221c;--ink-2:#53635a;
--ok:#2b6d4a;--new:#1d4ed8;--drift:#955800;--absent:#bd2419;--hidden:#6b42bb;--ack:#69786f;
--sans:Bahnschrift,"DIN Alternate","D-DIN",Barlow,"Segoe UI",system-ui,sans-serif;
--mono:"Cascadia Mono","Cascadia Code","SF Mono",ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{
--desk:#0f1512;--sheet:#17201b;--band:#1c2721;--rule:#2a3830;--rule-2:#46594d;--ink:#e1eae4;--ink-2:#98a99e;
--ok:#63c08e;--new:#87aaff;--drift:#e8ad4b;--absent:#ff8174;--hidden:#c0a2ff;--ack:#8f9d94}}
*{box-sizing:border-box}
html{scroll-padding-top:76px}
body{margin:0;background:var(--desk);color:var(--ink);font:15px/1.45 var(--sans)}
.wrap{max-width:1360px;margin:0 auto;padding:22px 32px 64px}
a{color:inherit;text-decoration-color:var(--rule-2);text-underline-offset:2px}
a:hover{text-decoration-color:currentColor}
code{font:12.5px/1.45 var(--mono);overflow-wrap:anywhere}
.quiet{color:var(--ink-2)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--new);outline-offset:2px}
[hidden]{display:none!important}
.sheet{background:var(--sheet);border:1px solid var(--rule);border-radius:3px}
table{border-collapse:collapse;width:100%}

.mast{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 24px;padding-bottom:6px;border-bottom:2px solid var(--ink);font-size:14px}
.mast-name{font-weight:700}
.mast dl{display:flex;flex-wrap:wrap;gap:0 20px;margin:0;color:var(--ink-2)}.mast dl div{display:flex;gap:6px}.mast dd{margin:0;color:var(--ink)}
.top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,560px);gap:20px 48px;align-items:start;margin:26px 0 20px}
.top.solo{grid-template-columns:minmax(0,1fr)}
h1{font-size:42px;line-height:1.08;font-weight:600;font-stretch:semi-condensed;letter-spacing:-.01em;margin:0 0 10px;max-width:22ch}
.totals{margin:0;font-size:17px;color:var(--ink-2);max-width:60ch}
.todo{padding:14px 18px 16px}
.todo h2{font-size:20px;font-weight:600;margin:0 0 6px}
.todo h3{font-size:14px;font-weight:700;margin:10px 0 2px}
.todo ul{margin:0;padding-left:18px}
.handoff{display:flex;gap:8px;align-items:flex-start;margin-top:8px}
.handoff pre{flex:1;margin:0;white-space:pre-wrap;font:12.5px/1.5 var(--mono);background:var(--band);border:1px solid var(--rule);border-radius:2px;padding:8px 10px}

.tally-sheet{padding:2px 0 0}
.tally th,.tally td{padding:6px 12px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--rule)}
.tally thead th{font-size:13px;font-weight:400;color:var(--ink-2);padding-top:9px;padding-bottom:5px;border-bottom:1px solid var(--rule-2)}
.tally tbody th{font-weight:400;white-space:nowrap}
.tally tbody th a{text-decoration:none}
.tally tbody th a:hover{text-decoration:underline}
.tally tr.act th{font-weight:700}
.tally .who{width:1%;white-space:nowrap}
.tally .tally-marks{width:42%}
.tally .result{min-width:230px;color:var(--ink-2);font-size:14px}
.tally .ver{font:12.5px var(--mono);color:var(--ink-2)}
.nw{white-space:nowrap}
.tally .ver b,.scope-ver b{color:var(--ink);font-weight:700}
.who{font-size:13px;font-weight:700}
.v-agent .who{color:var(--absent)}.v-operator .who{color:var(--drift)}
.marks{display:inline-flex;flex-wrap:wrap;gap:2px;vertical-align:middle}
.marks.extra{margin-left:14px}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:9px 12px 11px;font-size:13px;color:var(--ink-2)}
.legend>span{display:inline-flex;align-items:center;gap:6px}

.mk{display:inline-grid;place-items:center;flex:none;width:12px;height:18px;border-radius:1px;font:700 12px/1 var(--mono);color:var(--sheet);text-decoration:none}
.m-confirmed{background:color-mix(in srgb,var(--ok) 70%,var(--sheet))}
.m-new{background:var(--new)}.m-new::before{content:"+"}
.m-drift{background:var(--drift)}.m-drift::before{content:"~"}
.m-absent{background:var(--absent)}.m-absent::before{content:"×"}
.m-hidden{box-shadow:inset 0 0 0 1.5px var(--hidden);background:linear-gradient(var(--hidden),var(--hidden)) left/50% 100% no-repeat}
.m-acknowledged{box-shadow:inset 0 0 0 1.5px var(--ack)}
.m-inconclusive{box-shadow:inset 0 0 0 1.5px var(--ack);background:repeating-linear-gradient(135deg,var(--ack) 0 1.5px,transparent 1.5px 4.5px)}
.m-unverified{background:radial-gradient(circle,var(--ack) 0 1.7px,transparent 2.2px)}
.m-not-in-catalog{box-shadow:inset 0 0 0 1px var(--rule-2)}
a.mk:hover{outline:2px solid var(--ink);outline-offset:1px}

.toolbar{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:28px 0 0;padding:10px 0;background:var(--desk);border-bottom:1px solid var(--rule-2)}
button{font:inherit;font-size:14px;color:var(--ink);background:var(--sheet);border:1px solid var(--rule-2);border-radius:2px;padding:5px 12px;cursor:pointer}
button:hover{border-color:var(--ink)}
button[aria-pressed=true]{background:var(--ink);color:var(--sheet);border-color:var(--ink)}
.filters{display:flex}.filters button{border-radius:0;margin-left:-1px}
.filters button:first-child{margin-left:0;border-radius:2px 0 0 2px}.filters button:last-child{border-radius:0 2px 2px 0}
.n{font:12px var(--mono);margin-left:6px;opacity:.75}
.toolbar input[type=search]{flex:1;min-width:200px;font:inherit;font-size:14px;padding:5px 10px;border:1px solid var(--rule-2);border-radius:2px;background:var(--sheet);color:var(--ink)}
.chip-legend{padding:8px 0 12px}

details.scope{margin:0 0 10px}
details.scope>summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;padding:11px 16px;cursor:pointer;list-style:none}
details.scope>summary::-webkit-details-marker{display:none}
details.scope>summary::before{content:"";align-self:center;width:0;height:0;border-left:6px solid var(--ink-2);border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s}
details.scope[open]>summary::before{transform:rotate(90deg)}
summary .who{min-width:44px}
.scope-key{font-size:19px;font-weight:600;min-width:190px}
.scope-ver{font:12.5px var(--mono);color:var(--ink-2);min-width:280px}
.scope-result{color:var(--ink-2)}
.scope-body{padding:0 16px 16px;border-top:1px solid var(--rule)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:6px 28px;margin:12px 0 6px;font-size:14px}
.facts dt{font-size:12.5px;color:var(--ink-2)}.facts dd{margin:0}

ul.findings{list-style:none;margin:6px 0;padding:0}
.finding{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;padding:5px 0;border-top:1px dashed var(--rule);font-size:14px}
.finding:first-child{border-top:0}
.finding>div{max-width:84ch}
.by{font-size:13px;font-weight:700;color:var(--ink-2)}
.f-agent .by{color:var(--absent)}.f-operator .by{color:var(--drift)}
.next{margin-top:2px;font-weight:600}.ackd{margin-top:2px;color:var(--ink-2)}
ul.observed{margin:3px 0 0;padding-left:18px;color:var(--ink-2)}

.table-wrap{position:relative;overflow-x:auto;margin-top:10px}
.ledger{min-width:860px;table-layout:fixed;font-size:14px}
.c-entry{width:22%}.c-opt{width:24%}.c-gut{width:8%}.c-listed{width:22%}
.ledger th,.ledger td{padding:7px 10px;text-align:left;vertical-align:top}
.ledger thead th{font-size:13px;font-weight:400;color:var(--ink-2);padding-top:2px;border-bottom:1px solid var(--rule-2)}
.ledger thead .sides th{font-size:15px;font-weight:600;color:var(--ink);border-bottom:0;padding-top:6px;padding-bottom:0}
.ledger .gut{padding-left:4px;padding-right:4px;text-align:center;border-left:1px solid var(--rule-2);border-right:1px solid var(--rule-2)}
.ledger tbody{border-bottom:1px solid var(--rule)}
.ledger tbody:nth-of-type(even){background:var(--band)}
.ledger tbody.r-new{background:color-mix(in srgb,var(--new) 7%,var(--sheet))}
.ledger tbody.r-drift{background:color-mix(in srgb,var(--drift) 8%,var(--sheet))}
.ledger tbody.r-absent{background:color-mix(in srgb,var(--absent) 7%,var(--sheet))}
.ledger tbody.r-hidden{background:color-mix(in srgb,var(--hidden) 7%,var(--sheet))}
.ledger tr:target>td{box-shadow:inset 0 2px 0 var(--new),inset 0 -2px 0 var(--new)}
.ledger .mk{width:16px;height:22px;font-size:14px}
.st{display:block;margin-top:3px;font-size:12.5px;font-weight:700;white-space:nowrap}
.st-new{color:var(--new)}.st-drift{color:var(--drift)}.st-absent{color:var(--absent)}.st-hidden{color:var(--hidden)}
.st-acknowledged,.st-inconclusive,.st-unverified{color:var(--ink-2);font-weight:400}
.lbl{font-weight:600}
.id{display:block;margin-top:3px;color:var(--ink-2)}
.diff{text-decoration:underline wavy var(--drift);text-decoration-thickness:1.5px;text-underline-offset:3px}
.not-compared{opacity:.62}
.note-row td{padding-top:0}
.note-row ul.findings{margin:0 0 2px;padding-left:12px;border-left:2px solid var(--rule-2)}
.wire{white-space:nowrap}
.w{display:inline-block;width:16px;font-weight:700}
.w-yes{color:var(--ok)}.w-no{color:var(--absent)}.w-hid{color:var(--hidden)}.w-unk{color:var(--ink-2)}
.chip{display:inline-block;font:12.5px/1.5 var(--mono);border:1px solid var(--rule-2);border-radius:2px;padding:0 5px;margin:1px 4px 1px 0;background:var(--sheet)}
.chip.def{border-color:var(--ink);font-weight:700}.chip.def::after{content:" ★"}
.chip.def-diff{outline:2px solid var(--drift);outline-offset:1px}
.chip.del{text-decoration:line-through;color:var(--absent);border-color:var(--absent)}
.chip.add{color:var(--ok);border-color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--sheet))}
.ctl{margin:1px 0}.ctl-key{font-size:12.5px;color:var(--ink-2);margin-right:6px}
details.ev{margin-top:3px;font-size:13px}details.ev summary{cursor:pointer;color:var(--ink-2)}
details.ev dl{margin:4px 0 0}details.ev dl div{display:flex;gap:6px}details.ev dt{color:var(--ink-2);flex:none}details.ev dd{margin:0;max-width:60ch}
details.others{margin-top:10px}details.others summary{cursor:pointer;color:var(--ink-2)}
.other-list{columns:3 300px;list-style:none;padding:0;margin:6px 0 0;font-size:14px}.other-list li{break-inside:avoid;padding:1px 0}
footer{margin-top:28px;color:var(--ink-2);font-size:13px}

@media (prefers-reduced-motion:no-preference){
.ledger tr:target>td{animation:found 1.8s ease-out}
@keyframes found{from{background:color-mix(in srgb,var(--new) 22%,transparent)}to{background:transparent}}}
@media (max-width:1040px){.top{grid-template-columns:minmax(0,1fr)}}
@media (max-width:760px){
.wrap{padding:16px 16px 48px}
h1{font-size:32px}
.tally thead{display:none}
.tally tr{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;padding:9px 12px;border-bottom:1px solid var(--rule)}
.tally th,.tally td{padding:0;border:0}
.tally .tally-marks,.tally .result,.tally .ver{grid-column:1/-1}
.scope-key,.scope-ver{min-width:0}
.toolbar{position:static}}
`;

const SCRIPT = `
(() => {
  const cards = [...document.querySelectorAll('details.scope')];
  const search = document.getElementById('q');
  const buttons = [...document.querySelectorAll('button[data-filter]')];
  let filter = 'all';
  function apply() {
    const q = search.value.trim().toLowerCase();
    for (const card of cards) {
      let hits = 0;
      for (const item of card.querySelectorAll('[data-search]')) {
        const hit = !q || item.dataset.search.includes(q);
        item.hidden = !hit;
        if (hit) hits += 1;
      }
      if (q) for (const others of card.querySelectorAll('details.others')) others.open = others.querySelector('li:not([hidden])') !== null;
      const shown = (filter === 'all' || card.dataset.filter === filter) && (!q || hits > 0);
      card.hidden = !shown;
      if (q && shown) card.open = true;
    }
  }
  function setFilter(value) {
    filter = value;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.filter === value));
  }
  for (const button of buttons) button.addEventListener('click', () => { setFilter(button.dataset.filter); apply(); });
  search.addEventListener('input', apply);
  document.getElementById('expand').addEventListener('click', () => cards.forEach((card) => { card.open = true; }));
  document.getElementById('collapse').addEventListener('click', () => cards.forEach((card) => { card.open = false; }));

  // A tally mark or scope link points into a sheet that may be folded or filtered out.
  function reveal(target) {
    const card = target.closest('details.scope');
    if (!card) return;
    if (target.closest('[hidden]')) { setFilter('all'); search.value = ''; apply(); }
    card.open = true;
    const others = target.closest('details.others');
    if (others) others.open = true;
  }
  function targetOf(hash) {
    return hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    const target = link && targetOf(link.hash);
    if (target) reveal(target);
  });
  const initial = targetOf(location.hash);
  if (initial) { reveal(initial); initial.scrollIntoView(); }

  for (const button of document.querySelectorAll('button[data-copy]')) {
    const idle = button.textContent;
    button.addEventListener('click', async () => {
      const source = document.getElementById(button.dataset.copy);
      try { await navigator.clipboard.writeText(source.textContent); } catch {
        const range = document.createRange();
        range.selectNodeContents(source);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.execCommand('copy');
      }
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = idle; }, 1500);
    });
  }
  const format = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  for (const node of document.querySelectorAll('[data-time]')) {
    const date = new Date(node.dataset.time);
    if (!Number.isNaN(date.getTime())) node.textContent = format.format(date);
  }
})();
`;

export function renderHtml(report, { handoff = null, files = {} } = {}) {
  const count = (filter) => report.scopes.filter((scope) => (FILTER_OF[scope.verdict] ?? 'ok') === filter).length;
  const todo = todoSection(report, handoff);

  const present = new Set(report.scopes.flatMap((scope) => (scope.comparison
    ? [...scope.comparison.entries.map((entry) => entry.status), ...shownUpstream(scope.comparison).map(({ row }) => row.status)]
    : [])));
  const hasExtra = report.scopes.some((scope) => scope.comparison && shownUpstream(scope.comparison).length > 0);
  const legend = Object.keys(STATUS).filter((status) => present.has(status))
    .map((status) => `<span>${mark(status)}${esc(STATUS[status][0])}</span>`).join('')
    + (hasExtra ? '<span>Marks after a gap are listed models no catalog entry runs.</span>' : '');
  const fileLinks = Object.entries(files).map(([label, href]) => `<a href="${esc(href)}">${esc(label)}</a>`).join(', ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalog probe</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header class="mast">
  <span class="mast-name">Catalog probe</span>
  <dl>
    <div><dt>Probed</dt><dd data-time="${esc(report.snapshotCreatedAt ?? '')}">${esc(report.snapshotCreatedAt ?? 'unknown')}</dd></div>
    <div><dt>Validated</dt><dd data-time="${esc(report.createdAt)}">${esc(report.createdAt)}</dd></div>
    ${report.catalogSourceDigest ? `<div><dt>Factory</dt><dd><code>${esc(report.catalogSourceDigest.slice(0, 12))}</code></dd></div>` : ''}
  </dl>
</header>
<main>
<div class="top${todo ? '' : ' solo'}">
  <div>
    <h1>${esc(headline(report))}</h1>
    <p class="totals">${esc(totals(report))}</p>
  </div>
  ${todo}
</div>
<section class="sheet tally-sheet" aria-labelledby="tally-h">
  <h2 id="tally-h" class="sr">Tally</h2>
  <table class="tally">
    <thead><tr><th><span class="sr">Who acts</span></th><th scope="col">Scope</th><th scope="col">One mark per catalog entry</th><th scope="col">Result</th><th scope="col">CLI version</th></tr></thead>
    <tbody>${report.scopes.map(tallyRow).join('')}</tbody>
  </table>
  <div class="legend">${legend}</div>
</section>
<nav class="toolbar" aria-label="Filter scopes">
  <div class="filters">
    <button type="button" data-filter="all" aria-pressed="true">All<span class="n">${report.scopes.length}</span></button>
    <button type="button" data-filter="agent" aria-pressed="false">Needs an agent<span class="n">${count('agent')}</span></button>
    <button type="button" data-filter="operator" aria-pressed="false">Needs you<span class="n">${count('operator')}</span></button>
    <button type="button" data-filter="ok" aria-pressed="false">OK<span class="n">${count('ok')}</span></button>
  </div>
  <input type="search" id="q" placeholder="Find a model, label or ID" aria-label="Find a model">
  <button type="button" id="expand">Expand all</button>
  <button type="button" id="collapse">Collapse all</button>
</nav>
<div class="legend chip-legend"><span><span class="chip def">value</span> default</span><span><span class="chip del">value</span> only in the catalog</span><span><span class="chip add">value</span> only listed by the CLI</span><span><span class="lbl diff">Label</span> differs</span></div>
${report.scopes.map(scopeSheet).join('\n')}
</main>
<footer>This page is a view of report.json. The JSON files are the record${fileLinks ? `: ${fileLinks}` : ''}.</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
