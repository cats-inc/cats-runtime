// Renders a validation report for the terminal and as Markdown. Both are views of report.json,
// A compact agent-handoff.json beside it contains just the actionable evidence.
import { dirname, join } from 'node:path';

const VERDICT_TEXT = {
  none: 'clean',
  info: 'clean (notes only)',
  operator: 'needs you',
  agent: 'needs an agent',
};
const TAG = { none: 'ok', info: 'ok', operator: 'you', agent: 'agent' };

function versionText(scope) {
  const catalog = scope.catalog?.cliVersion ?? '?';
  const observed = scope.source.cliVersion;
  if (!observed || observed === catalog) return catalog;
  if (scope.findings.some((finding) => finding.kind === 'version-not-comparable')) return `${catalog} (build ${observed})`;
  return `${catalog} -> ${observed}`;
}

function resultText(scope) {
  const { counts, source } = scope;
  if (source.status === 'unavailable' || source.status === 'error') {
    return `${source.reason ?? source.status}: ${source.message ?? ''}`.trim();
  }
  if (source.membership === 'none') {
    const capture = scope.findings.find((finding) => finding.kind === 'capture-needed' && finding.audience !== 'none');
    return capture ? `no enumeration; ${capture.message}` : `no enumeration; ${scope.catalog?.entries ?? 0} entries unverified`;
  }
  if (source.status === 'degraded') {
    return `${counts.confirmed}/${scope.catalog?.entries ?? 0} confirmed; degraded (${source.reason}), other results inconclusive`;
  }
  const parts = [`${counts.confirmed}/${scope.catalog?.entries ?? 0} confirmed`];
  const open = (kind) => scope.findings.filter((finding) => finding.kind === kind && finding.audience !== 'none').length;
  if (open('new-candidate')) parts.push(`${open('new-candidate')} new`);
  if (open('field-drift')) parts.push(`${open('field-drift')} drift`);
  if (open('absent-from-source')) parts.push(`${open('absent-from-source')} absent`);
  if (open('hidden-in-source')) parts.push(`${open('hidden-in-source')} hidden`);
  const acknowledged = scope.findings.filter((finding) => finding.acknowledged).length;
  if (acknowledged) parts.push(`${acknowledged} acknowledged`);
  return parts.join(', ');
}

export function handoffPrompt(report, reportPath) {
  const scopes = report.needsAgent.join(', ');
  return `Use the maintain-provider-model-catalogs skill. Read ${join(dirname(reportPath), 'agent-handoff.json')} first (scopes: ${scopes}); it contains the actionable findings, relevant rows and evidence/validation commands. Reuse the saved snapshot and capture only missing evidence. Full report: ${reportPath}. Policy: confirm uncertainty.`;
}

export function renderTerminal(report, { reportDir, reportPath } = {}) {
  const lines = [];
  lines.push(`Catalog probe: ${VERDICT_TEXT[report.verdict]}`);
  lines.push('');
  const width = Math.max(...report.scopes.map((scope) => scope.key.length), 8);
  const versionWidth = Math.max(...report.scopes.map((scope) => versionText(scope).length), 8);
  for (const scope of report.scopes) {
    lines.push(`  [${TAG[scope.verdict].padEnd(5)}] ${scope.key.padEnd(width)}  ${versionText(scope).padEnd(versionWidth)}  ${resultText(scope)}`);
  }
  for (const finding of report.general) lines.push(`  note: ${finding.message}`);
  if (report.unprobedScopes.length) lines.push(`  note: no probe source for ${report.unprobedScopes.join(', ')}`);
  lines.push('');
  for (const scope of report.scopes.filter((candidate) => candidate.verdict === 'operator')) {
    for (const finding of scope.findings.filter((candidate) => candidate.audience === 'operator')) {
      lines.push(`  you, ${scope.provider}: ${finding.nextAction}`);
    }
  }
  if (reportDir) lines.push(`Report: ${reportDir}`);
  if (report.needsAgent.length && reportPath) {
    lines.push('');
    lines.push('Hand this to an agent:');
    lines.push(`  ${handoffPrompt(report, reportPath)}`);
  }
  return `${lines.join('\n')}\n`;
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|');
}

function findingLine(finding) {
  const status = finding.acknowledged
    ? `acknowledged (${finding.acknowledged.reason}; ${finding.acknowledged.evidence})`
    : finding.inconclusive ? 'inconclusive while the source is degraded' : finding.audience;
  const action = finding.nextAction && !finding.acknowledged && finding.audience !== 'info' ? ` Next: ${finding.nextAction}` : '';
  const observed = Array.isArray(finding.observed) && finding.kind !== 'field-drift' ? ` (${finding.observed.join('; ')})` : '';
  return `- **${finding.kind}** \`${finding.subject}\` [${status}]: ${finding.message}${observed}${action}`;
}

export function renderMarkdown(report, { reportPath } = {}) {
  const lines = [];
  lines.push('# Catalog probe report');
  lines.push('');
  lines.push(`- Verdict: **${VERDICT_TEXT[report.verdict]}**`);
  lines.push(`- Probed: ${report.snapshotCreatedAt ?? 'unknown'}; validated: ${report.createdAt}`);
  if (report.catalogSourceDigest) lines.push(`- Factory digest: \`${report.catalogSourceDigest}\``);
  if (report.needsAgent.length) lines.push(`- Needs an agent: ${report.needsAgent.join(', ')}`);
  if (report.needsOperator.length) lines.push(`- Needs you: ${report.needsOperator.join(', ')}`);
  lines.push('');
  lines.push('| Scope | Catalog -> installed | Source | Result | Who |');
  lines.push('|---|---|---|---|---|');
  for (const scope of report.scopes) {
    lines.push(`| ${cell(scope.key)} | ${cell(versionText(scope))} | ${cell(scope.source.sourceClass)} | ${cell(resultText(scope))} | ${TAG[scope.verdict]} |`);
  }
  if (report.general.length || report.unprobedScopes.length) {
    lines.push('');
    for (const finding of report.general) lines.push(`- ${finding.message}`);
    if (report.unprobedScopes.length) lines.push(`- No probe source for ${report.unprobedScopes.join(', ')}.`);
  }
  for (const scope of report.scopes) {
    if (scope.findings.length === 0) continue;
    lines.push('');
    lines.push(`## ${scope.key} (${TAG[scope.verdict]})`);
    lines.push('');
    lines.push(`Source: \`${scope.source.command}\`, ${scope.source.sourceClass}, membership ${scope.source.membership}; ${scope.source.rows} rows${scope.source.hiddenRows ? ` plus ${scope.source.hiddenRows} hidden` : ''}.`);
    lines.push('');
    for (const finding of scope.findings) lines.push(findingLine(finding));
  }
  if (report.needsAgent.length && reportPath) {
    lines.push('');
    lines.push('## Agent handoff');
    lines.push('');
    lines.push(handoffPrompt(report, reportPath));
  }
  return `${lines.join('\n')}\n`;
}
