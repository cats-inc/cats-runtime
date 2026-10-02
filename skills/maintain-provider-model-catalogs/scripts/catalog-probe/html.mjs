// Renders report.json as one self-contained HTML page for the operator: an overview, then every
// scope's catalog entries side by side with what the CLI listed. The page is a view; the JSON
// files beside it are the record.

const VERDICT = {
  agent: { tag: 'agent', text: 'Needs an agent' },
  operator: { tag: 'you', text: 'Needs you' },
  info: { tag: 'ok', text: 'OK' },
  none: { tag: 'ok', text: 'OK' },
};
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

function versionCell(scope) {
  const catalog = scope.catalog?.cliVersion ?? '?';
  const observed = scope.source.cliVersion;
  if (!observed || observed === catalog) return `<span class="ver">${esc(catalog)}</span>`;
  const build = scope.findings.some((finding) => finding.kind === 'version-not-comparable');
  return build
    ? `<span class="ver">${esc(catalog)}</span> <span class="muted">build ${esc(observed)}</span>`
    : `<span class="ver">${esc(catalog)}</span> <span class="arrow">→</span> <span class="ver new-ver">${esc(observed)}</span>`;
}

function resultSummary(scope) {
  const { source, counts } = scope;
  if (source.status === 'unavailable' || source.status === 'error') return `${esc(source.reason ?? source.status)}: ${esc(source.message ?? '')}`;
  const entries = scope.catalog?.entries ?? 0;
  if (source.membership === 'none') {
    const capture = scope.findings.find((finding) => finding.kind === 'capture-needed' && finding.audience !== 'none');
    return capture ? `No list; ${esc(capture.message)}` : `No read-only list; ${entries} entries unverified`;
  }
  if (source.status === 'degraded') return `${counts.confirmed}/${entries} confirmed; degraded (${esc(source.reason)}), the rest inconclusive`;
  const parts = [`${counts.confirmed}/${entries} confirmed`];
  if (counts.newCandidates) parts.push(`${counts.newCandidates} new`);
  if (counts.drift) parts.push(`${counts.drift} differ`);
  if (counts.absent) parts.push(`${counts.absent} not listed`);
  if (counts.hidden) parts.push(`${counts.hidden} hidden`);
  if (counts.acknowledged) parts.push(`${counts.acknowledged} acknowledged`);
  return parts.join(' · ');
}

function pill(status) {
  const [text, title] = STATUS[status] ?? [status, ''];
  return `<span class="pill s-${esc(status)}" title="${esc(title)}">${esc(text)}</span>`;
}

function tag(verdict) {
  const { tag: label } = VERDICT[verdict] ?? VERDICT.none;
  return `<span class="tag t-${label}">${label}</span>`;
}

function shortKey(key) {
  return key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
}

/** Value chips; `del` and `add` mark values only one side has, `def` the default. */
function chips(values, { def = null, del = new Set(), add = new Set(), defDiff = false } = {}) {
  if (!values || values.length === 0) return '<span class="muted">none</span>';
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

function findingLine(finding) {
  const who = finding.acknowledged ? 'ack' : finding.inconclusive ? 'info' : finding.audience;
  const label = { agent: 'agent', operator: 'you', info: 'note', none: 'ok', ack: 'acknowledged' }[who] ?? who;
  let detail = '';
  if (Array.isArray(finding.observed) && !['field-drift'].includes(finding.kind) && finding.kind !== 'new-candidate') {
    detail = `<ul class="observed">${finding.observed.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  }
  const next = finding.nextAction && !finding.acknowledged && finding.audience !== 'info' && finding.audience !== 'none'
    ? `<div class="next">Next: ${esc(finding.nextAction)}</div>`
    : '';
  const ack = finding.acknowledged
    ? `<div class="ack">Acknowledged ${esc(finding.acknowledged.acknowledgedOn)}: ${esc(finding.acknowledged.reason)} <code>${esc(finding.acknowledged.evidence)}</code></div>`
    : '';
  return `<li class="finding w-${esc(who)}"><span class="who">${esc(label)}</span><div><div>${esc(finding.message)}</div>${detail}${next}${ack}</div></li>`;
}

function entryRows(scope) {
  const { comparison } = scope;
  const compareKey = comparison.effortsCompared;
  const rows = [];
  for (const entry of comparison.entries) {
    const observed = entry.observed;
    const compared = entry.controls.find((control) => control.key === compareKey);
    const catalogValues = compared?.values ?? [];
    const observedValues = observed?.efforts ?? [];
    const comparing = Boolean(compareKey && observed && comparison.comparable);
    const del = comparing ? new Set(catalogValues.filter((value) => !observedValues.includes(value))) : new Set();
    const add = comparing ? new Set(observedValues.filter((value) => !catalogValues.includes(value))) : new Set();
    const defDiff = comparing && observed.effortDefault != null && (compared?.default ?? null) !== observed.effortDefault;

    const catalogOptions = entry.controls.length === 0
      ? '<span class="muted">none</span>'
      : entry.controls.map((control) => `<div class="ctl"><span class="ctl-key">${esc(shortKey(control.key))}</span>${chips(control.values, {
        def: control.default,
        del: control.key === compareKey ? del : new Set(),
        defDiff: control.key === compareKey && defDiff,
      })}</div>`).join('');

    let listedOptions = '<span class="muted">—</span>';
    if (observed && (observed.efforts || observed.effortDefault)) {
      const body = `<div class="ctl">${chips(observedValues, { def: observed.effortDefault, add, defDiff })}</div>`;
      listedOptions = compareKey ? body : `<div class="not-compared" title="Not compared for this CLI">${body}</div>`;
    } else if (observed && compareKey) {
      listedOptions = '<span class="muted">none</span>';
    }

    const labelDiff = comparison.labelCompared && observed?.label != null && observed.label !== entry.label;
    let listedLabel = '<span class="muted">—</span>';
    if (observed?.label != null) {
      listedLabel = comparison.labelCompared
        ? `<span class="${labelDiff ? 'diff' : ''}">${esc(observed.label)}</span>`
        : `<span class="not-compared" title="Not compared: this CLI's list labels are not picker labels">${esc(observed.label)}</span>`;
    }

    const executes = entry.wires.map((wire) => {
      const mark = wire.listed === null ? '<span class="muted">?</span>'
        : wire.listed ? (wire.hidden ? '<span class="mark hid" title="hidden">◐</span>' : '<span class="mark yes" title="listed">✓</span>')
          : '<span class="mark no" title="not listed">✗</span>';
      const family = wire.matches ? ` <span class="muted" title="${esc(wire.matches.join(', '))}">(${wire.matches.length} slugs)</span>` : '';
      return `<div class="wire">${mark}<code>${esc(wire.id)}</code>${family}</div>`;
    }).join('');

    const search = [entry.id, entry.label, observed?.label, ...entry.wires.map((wire) => wire.id)].filter(Boolean).join(' ').toLowerCase();
    rows.push(`<tr class="row-${esc(entry.status)}" data-search="${esc(search)}">
      <td>${pill(entry.status)}</td>
      <td><code>${esc(entry.id)}</code></td>
      <td><span class="${labelDiff ? 'diff' : ''}">${esc(entry.label)}</span></td>
      <td>${listedLabel}${evidenceBlock(observed?.evidence)}</td>
      <td>${catalogOptions}</td>
      <td>${listedOptions}</td>
      <td>${executes}</td>
    </tr>`);
    const related = entry.findings.map((index) => scope.findings[index]);
    if (related.length > 0) {
      rows.push(`<tr class="note-row" data-search="${esc(search)}"><td></td><td colspan="6"><ul class="findings">${related.map(findingLine).join('')}</ul></td></tr>`);
    }
  }
  for (const row of comparison.upstream.filter((candidate) => candidate.status === 'new' || candidate.status === 'acknowledged' || candidate.status === 'inconclusive')) {
    const finding = scope.findings[row.finding];
    const search = [row.id, row.label].filter(Boolean).join(' ').toLowerCase();
    rows.push(`<tr class="row-${esc(row.status)}" data-search="${esc(search)}">
      <td>${pill(row.status)}</td>
      <td><code>${esc(row.id)}</code></td>
      <td><span class="muted">not in catalog</span></td>
      <td>${row.label ? esc(row.label) : '<span class="muted">—</span>'}${evidenceBlock(row.evidence, { open: row.status === 'new' })}</td>
      <td><span class="muted">—</span></td>
      <td>${row.efforts ? `<div class="ctl">${chips(row.efforts)}</div>` : '<span class="muted">—</span>'}</td>
      <td><div class="wire"><span class="mark yes">✓</span><code>${esc(row.id)}</code></div></td>
    </tr>`);
    rows.push(`<tr class="note-row" data-search="${esc(search)}"><td></td><td colspan="6"><ul class="findings">${findingLine(finding)}</ul></td></tr>`);
  }
  return rows.join('\n');
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
    const label = row.label && row.label !== row.id ? ` <span class="muted">${esc(row.label)}</span>` : '';
    return `<li data-search="${esc(search)}">${row.hidden ? '<span class="mark hid" title="hidden">◐</span>' : ''}<code>${esc(row.id)}</code>${label}</li>`;
  }).join('');
  return `<details class="others"><summary>${others.length} other listed models not in the catalog</summary><p class="muted">${esc(why)}</p><ul class="other-list">${items}</ul></details>`;
}

function scopeCard(scope) {
  const verdict = scope.verdict;
  const filter = FILTER_OF[verdict] ?? 'ok';
  const scopeFindings = scope.findings.filter((finding) => SCOPE_FINDINGS.has(finding.kind));
  const source = scope.source;
  const facts = [
    `<div><dt>Read</dt><dd><code>${esc(source.command)}</code></dd></div>`,
    `<div><dt>Source</dt><dd>${esc(source.sourceClass)}, membership <b>${esc(source.membership)}</b>${source.rows ? `, ${source.rows} rows${source.hiddenRows ? ` + ${source.hiddenRows} hidden` : ''}` : ''}</dd></div>`,
    `<div><dt>Status</dt><dd>${esc(source.status)}${source.reason ? ` (${esc(source.reason)})` : ''}</dd></div>`,
    `<div><dt>Catalog</dt><dd>${esc(scope.selectionMode ?? '?')}, ${scope.catalog?.entries ?? 0} entries, CLI ${esc(scope.catalog?.cliVersion ?? '?')}, updated ${esc(scope.catalog?.lastUpdated ?? '?')}</dd></div>`,
    `<div><dt>Installed</dt><dd>${esc(source.cliVersion ?? 'unknown')}${source.versionSource ? ` <span class="muted">from ${esc(source.versionSource)}</span>` : ''}</dd></div>`,
  ].join('');
  const table = scope.comparison
    ? `<div class="table-wrap"><table class="compare">
        <thead><tr><th>Status</th><th>Entry</th><th>Label in catalog</th><th>Label listed by CLI</th><th>Options in catalog</th><th>Options listed by CLI</th><th>Executes</th></tr></thead>
        <tbody>${entryRows(scope)}</tbody>
      </table></div>${otherRows(scope)}`
    : '';
  return `<details class="scope" id="${anchor(scope.key)}" data-filter="${filter}"${verdict === 'agent' || verdict === 'operator' ? ' open' : ''}>
    <summary>${tag(verdict)}<span class="scope-key">${esc(scope.key)}</span><span class="scope-ver">${versionCell(scope)}</span><span class="scope-result">${resultSummary(scope)}</span></summary>
    <div class="scope-body">
      <dl class="facts">${facts}</dl>
      ${scopeFindings.length ? `<ul class="findings">${scopeFindings.map(findingLine).join('')}</ul>` : ''}
      ${table}
    </div>
  </details>`;
}

const STYLE = `
:root{--bg:#f7f7f5;--panel:#fff;--text:#1d1f23;--muted:#6b7078;--line:#e3e4e1;--code:#f0f1ee;
--ok:#1f7a45;--ok-bg:#e3f4ea;--new:#1d5fbf;--new-bg:#e2ecfb;--warn:#9a5b00;--warn-bg:#fdf0d7;--bad:#b42318;--bad-bg:#fde6e3;
--hid:#6d3fb5;--hid-bg:#efe7fb;--ack:#4b5563;--ack-bg:#eceef1;--you:#9a5b00;--agent:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--panel:#1d2024;--text:#e7e8ea;--muted:#9aa0a8;--line:#30343a;--code:#262a2f;
--ok:#5cc98a;--ok-bg:#183527;--new:#7fb0ff;--new-bg:#1a2b47;--warn:#f0b357;--warn-bg:#3a2c12;--bad:#ff8a7e;--bad-bg:#45201c;
--hid:#c3a2ff;--hid-bg:#2f2344;--ack:#b5bcc6;--ack-bg:#2a2e34;--you:#f0b357;--agent:#ff8a7e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 8px}
code{font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--code);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
.muted{color:var(--muted)}
header.top{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;margin-bottom:16px}
.verdict{font-weight:600;padding:4px 12px;border-radius:999px}
.v-agent{background:var(--bad-bg);color:var(--agent)}.v-operator{background:var(--warn-bg);color:var(--you)}.v-ok{background:var(--ok-bg);color:var(--ok)}
.meta{display:flex;flex-wrap:wrap;gap:4px 18px;margin:0;color:var(--muted)}.meta div{display:flex;gap:6px}.meta dt{font-weight:600}.meta dd{margin:0}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}
.todo ul{margin:0 0 8px;padding-left:20px}
.handoff{display:flex;gap:8px;align-items:flex-start}.handoff pre{flex:1;margin:0;white-space:pre-wrap;background:var(--code);padding:8px 10px;border-radius:6px;font:12.5px ui-monospace,Consolas,monospace}
button{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:6px;padding:5px 10px;cursor:pointer}
button[aria-pressed=true]{background:var(--text);color:var(--panel)}
.toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--bg);padding:8px 0;margin-bottom:6px;border-bottom:1px solid var(--line)}
.toolbar input[type=search]{flex:1;min-width:200px;font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px;color:var(--muted);font-size:12.5px}
table{border-collapse:collapse;width:100%}
.overview td,.overview th{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.overview tr:hover td{background:var(--code)}.overview a{color:inherit}
.tag{display:inline-block;min-width:46px;text-align:center;font-size:12px;font-weight:600;border-radius:5px;padding:1px 6px}
.t-ok{background:var(--ok-bg);color:var(--ok)}.t-you{background:var(--warn-bg);color:var(--you)}.t-agent{background:var(--bad-bg);color:var(--agent)}
details.scope{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:10px}
details.scope>summary{cursor:pointer;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:10px 14px;list-style:none}
details.scope>summary::-webkit-details-marker{display:none}
details.scope>summary::before{content:"▸";color:var(--muted)}details.scope[open]>summary::before{content:"▾"}
.scope-key{font-weight:600;min-width:170px}.scope-ver{min-width:230px}.scope-result{color:var(--muted)}
.arrow{color:var(--muted)}.new-ver{font-weight:600}
.scope-body{padding:0 14px 14px;border-top:1px solid var(--line)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 18px;margin:12px 0}.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:0}
ul.findings{list-style:none;margin:8px 0;padding:0}
.finding{display:flex;gap:10px;padding:6px 0;border-top:1px dashed var(--line)}.finding:first-child{border-top:0}
.who{flex:none;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;min-width:92px;color:var(--muted)}
.w-agent .who{color:var(--agent)}.w-operator .who{color:var(--you)}.w-ack .who{color:var(--ack)}
.next{margin-top:2px;font-weight:500}.ack{margin-top:2px;color:var(--muted)}
ul.observed{margin:4px 0 0;padding-left:18px;color:var(--muted)}
.table-wrap{overflow-x:auto;margin-top:8px}
table.compare th{position:sticky;top:0;font-size:12px;font-weight:600;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);background:var(--panel)}
table.compare td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
table.compare tr.note-row td{border-bottom:1px solid var(--line);padding-top:0;background:var(--code)}
.row-new td{background:var(--new-bg)}.row-absent td{background:var(--bad-bg)}.row-drift td{background:var(--warn-bg)}.row-hidden td{background:var(--hid-bg)}
.pill{display:inline-block;white-space:nowrap;font-size:12px;font-weight:600;border-radius:999px;padding:1px 8px}
.s-confirmed{background:var(--ok-bg);color:var(--ok)}.s-new{background:var(--new);color:#fff}.s-drift{background:var(--warn);color:#fff}
.s-absent{background:var(--bad);color:#fff}.s-hidden{background:var(--hid);color:#fff}.s-acknowledged{background:var(--ack-bg);color:var(--ack)}
.s-inconclusive{border:1px dashed var(--muted);color:var(--muted)}.s-unverified{background:var(--ack-bg);color:var(--muted)}.s-not-in-catalog{background:var(--ack-bg);color:var(--muted)}
.chip{display:inline-block;font:12px ui-monospace,Consolas,monospace;border:1px solid var(--line);border-radius:4px;padding:0 5px;margin:1px 3px 1px 0}
.chip.def{border-color:var(--text);font-weight:700}.chip.def::after{content:" ★"}
.chip.def-diff{outline:2px solid var(--warn)}
.chip.del{text-decoration:line-through;color:var(--bad);border-color:var(--bad)}
.chip.add{color:var(--ok);border-color:var(--ok);background:var(--ok-bg)}
details.ev{margin-top:3px;font-size:12px}details.ev summary{cursor:pointer;color:var(--muted)}details.ev dl{margin:4px 0 0}details.ev dl div{display:flex;gap:6px}details.ev dt{color:var(--muted);flex:none}details.ev dd{margin:0}
.ctl{margin:1px 0}.ctl-key{font-size:11.5px;color:var(--muted);margin-right:4px}
.diff{background:var(--warn-bg);color:var(--warn);font-weight:600;padding:0 3px;border-radius:3px}
.not-compared{opacity:.6}
.wire{white-space:nowrap}.mark{display:inline-block;width:16px;font-weight:700}.mark.yes{color:var(--ok)}.mark.no{color:var(--bad)}.mark.hid{color:var(--hid)}
details.others{margin-top:10px}details.others summary{cursor:pointer;color:var(--muted)}
.other-list{columns:3 300px;list-style:none;padding:0;margin:6px 0 0}.other-list li{break-inside:avoid;padding:1px 0}
footer{margin-top:24px;color:var(--muted);font-size:12.5px}footer a{color:inherit}
[hidden]{display:none!important}
`;

const SCRIPT = `
(() => {
  const cards = [...document.querySelectorAll('details.scope')];
  const overviewRows = [...document.querySelectorAll('tr[data-scope]')];
  const search = document.getElementById('q');
  const buttons = [...document.querySelectorAll('button[data-filter]')];
  let filter = 'all';
  function apply() {
    const q = search.value.trim().toLowerCase();
    for (const card of cards) {
      let hits = 0;
      for (const row of card.querySelectorAll('[data-search]')) {
        const hit = !q || row.dataset.search.includes(q);
        row.hidden = !hit;
        if (hit && row.tagName === 'TR' && !row.classList.contains('note-row')) hits += 1;
        if (hit && row.tagName === 'LI') hits += 1;
      }
      if (q) for (const others of card.querySelectorAll('details.others')) others.open = others.querySelector('li:not([hidden])') !== null;
      const shown = (filter === 'all' || card.dataset.filter === filter) && (!q || hits > 0);
      card.hidden = !shown;
      if (q && shown) card.open = true;
    }
    for (const row of overviewRows) row.hidden = !(filter === 'all' || row.dataset.filter === filter);
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      apply();
    });
  }
  search.addEventListener('input', apply);
  document.getElementById('expand').addEventListener('click', () => cards.forEach((card) => { card.open = true; }));
  document.getElementById('collapse').addEventListener('click', () => cards.forEach((card) => { card.open = false; }));
  for (const button of document.querySelectorAll('button[data-copy]')) {
    button.addEventListener('click', async () => {
      const text = document.getElementById(button.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById(button.dataset.copy));
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.execCommand('copy');
      }
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    });
  }
  for (const node of document.querySelectorAll('[data-time]')) {
    const date = new Date(node.dataset.time);
    if (!Number.isNaN(date.getTime())) node.textContent = date.toLocaleString();
  }
})();
`;

export function renderHtml(report, { handoff = null, files = {} } = {}) {
  const verdictClass = report.verdict === 'agent' ? 'v-agent' : report.verdict === 'operator' ? 'v-operator' : 'v-ok';
  const verdictText = report.verdict === 'agent' ? 'Needs an agent' : report.verdict === 'operator' ? 'Needs you' : 'Nothing to do';
  const count = (filter) => report.scopes.filter((scope) => (FILTER_OF[scope.verdict] ?? 'ok') === filter).length;

  const operatorItems = report.scopes.flatMap((scope) => scope.findings
    .filter((finding) => finding.audience === 'operator')
    .map((finding) => `<li><b>${esc(scope.key)}</b>: ${esc(finding.nextAction ?? finding.message)}</li>`));
  const agentItems = report.scopes.filter((scope) => scope.verdict === 'agent').map((scope) => {
    const open = scope.findings.filter((finding) => finding.audience === 'agent').length;
    return `<li><a href="#${anchor(scope.key)}"><b>${esc(scope.key)}</b></a>: ${open} item${open === 1 ? '' : 's'} to investigate</li>`;
  });
  const generalItems = [
    ...report.general.map((finding) => `<li>${esc(finding.message)}</li>`),
    ...(report.unprobedScopes.length ? [`<li>No probe source for ${esc(report.unprobedScopes.join(', '))}.</li>`] : []),
  ];
  const todo = operatorItems.length || agentItems.length || generalItems.length
    ? `<section class="panel todo"><h2>What to do</h2>
      ${operatorItems.length ? `<p><b>You</b></p><ul>${operatorItems.join('')}</ul>` : ''}
      ${agentItems.length ? `<p><b>An agent</b></p><ul>${agentItems.join('')}</ul>` : ''}
      ${agentItems.length && handoff ? `<div class="handoff"><pre id="handoff">${esc(handoff)}</pre><button type="button" data-copy="handoff">Copy</button></div>` : ''}
      ${generalItems.length ? `<p><b>Notes</b></p><ul>${generalItems.join('')}</ul>` : ''}
    </section>`
    : '<section class="panel todo"><h2>What to do</h2><p>Nothing. Every comparable entry is confirmed.</p></section>';

  const overview = report.scopes.map((scope) => {
    const filter = FILTER_OF[scope.verdict] ?? 'ok';
    return `<tr data-scope="${esc(scope.key)}" data-filter="${filter}"><td>${tag(scope.verdict)}</td><td><a href="#${anchor(scope.key)}">${esc(scope.key)}</a></td><td>${versionCell(scope)}</td><td>${esc(scope.source.sourceClass)}</td><td>${resultSummary(scope)}</td></tr>`;
  }).join('');

  const legend = Object.entries(STATUS).map(([status, [, title]]) => `<span>${pill(status)} ${esc(title)}</span>`).join('');
  const fileLinks = Object.entries(files).map(([label, href]) => `<a href="${esc(href)}">${esc(label)}</a>`).join(' · ');

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
<header class="top">
  <h1>Catalog probe</h1>
  <span class="verdict ${verdictClass}">${verdictText}</span>
  <dl class="meta">
    <div><dt>Probed</dt><dd data-time="${esc(report.snapshotCreatedAt ?? '')}">${esc(report.snapshotCreatedAt ?? 'unknown')}</dd></div>
    <div><dt>Validated</dt><dd data-time="${esc(report.createdAt)}">${esc(report.createdAt)}</dd></div>
    ${report.catalogSourceDigest ? `<div><dt>Factory</dt><dd><code>${esc(report.catalogSourceDigest.slice(0, 12))}</code></dd></div>` : ''}
  </dl>
</header>
${todo}
<section class="panel"><h2>Scopes</h2><div class="table-wrap"><table class="overview"><tbody>${overview}</tbody></table></div></section>
<nav class="toolbar">
  <button type="button" data-filter="all" aria-pressed="true">All ${report.scopes.length}</button>
  <button type="button" data-filter="agent" aria-pressed="false">Needs an agent ${count('agent')}</button>
  <button type="button" data-filter="operator" aria-pressed="false">Needs you ${count('operator')}</button>
  <button type="button" data-filter="ok" aria-pressed="false">OK ${count('ok')}</button>
  <input type="search" id="q" placeholder="Find a model, label or ID" aria-label="Find a model">
  <button type="button" id="expand">Expand all</button>
  <button type="button" id="collapse">Collapse all</button>
</nav>
<div class="legend">${legend}<span><span class="chip def">value</span> default</span><span><span class="chip del">value</span> only in catalog</span><span><span class="chip add">value</span> only listed by the CLI</span></div>
<main>
${report.scopes.map(scopeCard).join('\n')}
</main>
<footer>This page is a view of report.json. The JSON files are the record${fileLinks ? `: ${fileLinks}` : ''}.</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
