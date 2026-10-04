# Catalog probe refresh and compact agent handoff

Observed 2026-10-04, native Windows 11. Mode: probe-driven refresh and workflow repair.
Policy: confirm uncertainty. Scope: the report's Antigravity CLI findings, probe scripts,
maintenance guidance and their direct tests. No publication or installed personal-catalog
patch was requested.

## Evidence and catalog decision

The first all-source run hit host sandbox `EPERM` on twelve CLIs/helpers. A host-approved
read-only run completed all sixteen sources. Its only agent scope was `antigravity/cli`;
Cursor required sign-in. Claude and Goose remain explicitly unverified by enumeration.
Other scopes were confirmed within each source's stated coverage or retained investigated
source-gap acknowledgements. A clean comparison does not prove execution or picker-only fields.

Antigravity 1.2.16 returned eighteen executable IDs. The authenticated Google AI Pro picker
showed seven families, in order: four existing Gemini rows, Claude Opus 5.5, Claude Sonnet 5.5,
and GPT-OSS 120B (Medium). Each highlighted Claude row displayed `low`, `medium`, `high`.
Neither a model nor an effort had a default marker. Exact IDs and labels are retained in:

- [Probe enumeration](./fixtures/antigravity-1.2.16/model-list.probe.redacted.json), complete,
  account-resolved executable IDs; its variant labels are not family-picker labels.
- [Picker capture](./fixtures/antigravity-1.2.16/model-picker.agent-capture.redacted.txt), complete
  visible list and per-row sliders. UI Automation text was checked against a window screenshot.

The temporary capture wrapper used the Windows code page for text files, replacing some slider
glyphs with `?`; labels, effort words and footers survived. No selection/default claim relies
on those glyphs. The retained fixture flags this limitation; the reusable helper uses UTF-8.

The operator explicitly answered **「刪除這兩個舊項目」** to the proposed removal of Claude
Sonnet 4.6 (Thinking) and Claude Opus 4.6 (Thinking), absent from both surfaces. The catalog now
has seven families and exhaustive mappings to all eighteen current execution IDs. It uses
existing `antigravity.effort` bindings; no schema or adapter change was needed. New rows claim
no unobserved limits/capabilities/defaults. Existing metadata retains its older provenance.
`cli_version` and `last_updated` record this complete 1.2.16 observation.

The API discovery scope and frozen schema-1 migration fixtures describe separate contracts and
were retained. An HTTP test's hardcoded old CLI model was replaced with the shared factory
fixture. Platform's old strings occur only in isolated historical UI fixtures, not authored
production model tables.

## Workflow defects and corrections

- Native and nested-helper `EPERM`/`EACCES` now mean host permission denied, including during
  revalidation of older snapshots. The action uses host approval or an authorized terminal;
  it does not claim the provider parser changed or invite catalog edits.
- Failed/degraded reads, unreadable changelogs and a different transport cannot make acknowledgements stale.
  Degraded matching rows are inconclusive rather than confirmed.
- Every probe/validation writes `agent-handoff.json`: actionable scopes/findings, affected
  entries with inherited controls resolved, relevant source rows, authority and exact command
  arguments. It retains the original snapshot path when reports use another output directory,
  and overwrites an old actionable handoff with empty scopes after resolution.
- Field-drift instructions reuse authoritative snapshot fields. Picker work is reserved for
  missing labels/hierarchy/order/defaults or conflicting evidence. New-candidate rollout
  rechecks remain targeted. Evidence fixtures, confirmation and validation gates remain.
- The copyable terminal/HTML prompt starts with the compact handoff. The terminal prints both
  input sizes, making future savings observable without a separate measurement script.
- Antigravity capture uses each row's fully visible slider and guarded Up/Down keys. Its new
  reusable helper retains UTF-8 picker regions, excludes the account banner, checks settings
  and focus, and returns to the first row. It does not cycle effort or confirm selections.

With the **same pre-edit factory and live snapshot**, the full report was **678,282 bytes**;
the compact handoff was **9,056 bytes**, **98.66% smaller**, holding one scope and eight
findings. The snapshot itself was 445,543 bytes. This measures artifact bytes, not tokens or
end-to-end latency. An agent no longer needs to consume healthy scopes or unrelated upstream
rows before acting. The probe's source concurrency/timeout were unchanged.

## Native capture and cost limits

The dedicated Windows Terminal ran agy 1.2.16 in an empty task directory. Workspace trust was
confirmed only for that directory. One guarded `/model` command opened the list; Down keys
read each row, Escape cancelled, and `/exit` closed the owned window. No inference prompt or
model selection was submitted. Three 1129 x 635 screenshots were saved and inspected (initial
blank window, trust dialog, picker); text sufficed for the remaining row observations.

The prelaunch `~/.gemini/settings.json` digest remained unchanged. The separate
`~/.gemini/antigravity-cli/settings.json` digest changed after the startup/trust flow; no
prelaunch contents backup was taken, so its exact delta is not proven and no restoration was
attempted. Do not claim full settings preservation. The reusable helper's digest covers its
traversal, while guidance now distinguishes startup writes. No capture window remained.

The usage reader's subtotal through 2026-10-04 11:43:22 UTC recorded 53 assistant calls,
172,428 uncached input tokens, 6,051,712 cache-read tokens and 23,799 output tokens (4,344
reasoning output included). The interval from launch preparation to catalog projection had
23 calls, 31,960 uncached input, 2,950,784 cache-read and 12,344 output tokens. That interval
also interleaved workflow coding; it is not an isolated capture benchmark. Later validation
and review are outside these subtotals. The target agy session received no inference request.

## Scripts retained and omitted

- Retained `Capture-AntigravityPicker.ps1` plus its synthetic guard test: parameterized from
  the successful guarded row traversal; reusable while the fully visible picker layout holds.
  Native evidence here used the small run wrappers, not a second traversal of the final helper.
- Retained handoff generation and size reporting in the existing probe command, with offline
  regression tests; no separate measurement command is required.
- Private `agy-launch.ps1` and `agy-step.ps1`: run-specific title/paths and interactive trust/exit
  steps around the existing Platform helper; omitted because they are not a generic safe launcher.
- Private `agy-rows.ps1`: this run's observed labels; generalized into the retained helper.
- Private `retain-agy-picker.ps1`, `retain-agy-evidence.mjs`, `update-agy.mjs`: capture-specific
  fixture/observation/decision projection and the operator's exact approved delta. Their
  model values and paths must not become future maintenance logic; shared normalization,
  assessment and evidence tools remain the reusable implementation.
- Private `benchmark-handoff.mjs`: comparison against this run's original factory/snapshot.
  Omitted because normal probe output now reports artifact sizes. Usage counting reused
  `measure-agent-usage.mjs` unchanged.

## Validation

- Catalog generation/check and model-data code boundary guard passed.
- Focused catalog data/runtime and Antigravity adapter/fixture tests: 76 passed.
- Antigravity HTTP factory-consumer test: 1 passed (73 unrelated tests excluded).
- Release preflight exposed a stale Playground expectation that Claude rows have no effort
  choices. Updated it for the observed three choices; all 21 Playground tests passed locally.
- Final probe offline suite: 39 passed, also passed through the existing Vitest CI hook.
- `npm run typecheck` passed. `git diff --check` passed.
- New Antigravity helper: synthetic normal traversal, changed-settings and truncated-footer
  tests passed, without starting a CLI or sending native input.
- Saved live snapshot revalidation: Antigravity `listConfirmed: true`, 7/7, no agent scopes;
  Cursor was still an operator sign-in action in that original snapshot. No full second live
  probe or paid execution check.
- Saved permission-failure snapshot revalidation: zero agent scopes and zero false stale
  acknowledgements; twelve host-access actions, without running a CLI.
- Independent review found a Claude changelog permission-error branch that bypassed classification;
  it was corrected, regression-tested, and reviewed again with no remaining findings.
- Runtime worktree skill mirrors were synchronized to both agents. Parent workspace sync/check
  passed against the unchanged main checkouts; it will pick up these new skill sources when
  this branch is integrated. Main remained clean during the initial probe work.

The source changes are additive developer-tool output and corrections within the current
compatibility line; there is no persisted user-data migration. The subsequent owner request
authorizes the 0.4.1 bump, commit and auto-merge PR, then Desktop 0.7.10 standard preview;
see the [release preparation](../release-guide.md#release-notes--041-prepared-2026-10-04).

## Cursor follow-up after operator sign-in

The operator signed in and requested follow-up. A Cursor-only live probe on 2026-10-04 at
11:55:41 UTC, CLI `2026.10.01-e373342`, completed successfully: all six curated families were
listed, with zero absent rows, drift or new candidates. Both `needsAgent` and `needsOperator`
are empty, and the regenerated handoff contains no scopes. Other upstream rows remain
informational because Cursor is an operator-selected shortlist.

The private result is `tmp/catalog-probe/20261004-195534/`. It supersedes the original run's
Cursor authentication failure; the historical all-source snapshot remains intact. This source
proves family membership only, not each fixed parameter combination or execution. No Cursor
catalog edit, freshness advance, picker traversal or further test run was needed.
