# Claude 2.1.273 picker refresh

Observed: 2026-09-16. Mode: refresh. Interaction policy: confirm uncertainty.
Scope: Claude curated data, Runtime/Playground/Desktop fallbacks, and the shared
Cats default-marker presentation. No other provider's catalog data was refreshed.

## Evidence and authorized projection

The operator supplied Claude Code 2.1.273's `/model` list and the complete effort
choices under each of its five visible rows.
[Redacted capture](./fixtures/claude-2.1.273/model-picker.success.redacted.txt).
Account identity and capture platform were not supplied. No identifiers needed
redaction. No CLI launch, authentication, paid probe, or model turn was needed.

The operator explicitly requested exactly four version-bearing Cats labels,
collapsing the duplicate Default/Opus presentation and making Opus the Cats default.
The original provider-default sentinel and its separate effort screen remain in
the capture; no invented `default` model id is passed to the CLI. This projection
does not claim the upstream default will always resolve to Opus.

| Cats model label | Execution alias | Model default | Effort default | Effort values |
|---|---|---|---|---|
| Opus 5 with 1M context | `opus` | Yes | High | Low, Medium, High, xHigh, Max, Ultracode |
| Fable 5.1 | `fable` | No | High | Low, Medium, High, xHigh, Max, Ultracode |
| Sonnet 5 | `sonnet` | No | High | Low, Medium, High, xHigh, Max, Ultracode |
| Haiku 4.5 | `haiku` | No | Unsupported | None |

The operator separately authorized standardizing the parenthesized default marker
across models, efforts, and backends. Cats uses lowercase ` (default)` consistently,
including `Opus 5 with 1M context (default)` and `High (default)`. Model names and
effort labels retain their spelling and case; the status suffix is presentation
metadata. The shared Desktop and Playground formatters also normalize a marker
when no separate default flag is supplied. Playground's basic catalog fallback uses
the same formatter to avoid appending a second marker when a source label says
`(Default)`.

The ordered observation tree preserves all five model rows and all five effort
branches. The maintenance helper reported no missing paths and all proposed changes
ready. No fresh raw token was guessed: the existing Claude model/effort normalizers
and earlier 2.1.246/2.1.258 alias evidence remain the mapping provenance. The fresh
paste establishes visibility and option/default availability for this account.

Opus's 1M context was re-observed. Sonnet's 1M and Haiku's 200K values remain from the
older 2.1.246 evidence; Fable context is still unknown. Older effort descriptions,
including the 2.1.258 Ultracode explanation, retain their older provenance. Max's
warning appears separately in every supported model's fresh capture. No schema,
execution adapter, or advanced-control contract change is needed.

## Changes and local configuration

- Refresh only Claude's version, freshness, provenance, and Opus display label in
  the bundled curated example.
- Align the Runtime fallback label and add the missing Fable row to the
  Playground and Desktop fallback lists.
- Reuse existing per-model defaults and Haiku's explicit empty option list.
- Keep independent historical test fixtures and the earlier verified execution
  manifest evidence unchanged.

The effective local curated override was inspected before validation. The operator
separately approved syncing only its Claude block. After the bundled catalog passed
isolated Runtime/Playground checks, the original file was verified against its preview
hash and backup, then replaced atomically. Read-back confirmed version 2.1.273 and
unchanged data for every other provider, including Codex. The backup remains in the
task's system-temporary directory as `local-original.yaml`; no private config is tracked.

## Validation

- Runtime focused catalog, normalization, advanced knowledge, selection, and UI
  suites: 7 files / 95 tests passed (Vitest 5.10s; command 15.2s).
- After completing the shared marker case handling, the two affected Runtime UI
  suites passed again: 20 tests. Final `npm run typecheck` passed.
- Desktop `npm run typecheck` (including mobile), `build:server`, and `build:test-ui`
  passed. Six focused catalog/selection/label/selector files passed: 68 tests.
  Combined Desktop build/typecheck/test command: 266.6s; tests: 11.4s.
- An isolated Runtime config loaded the actual bundled YAML with zero loader or
  normalization warnings. Its public advanced catalog was passed into Playground
  and Desktop's real formatting/default functions: exact four labels, Opus default,
  six efforts and High defaults for Opus/Fable/Sonnet, and no Haiku effort.
- Both fallback lists matched that public catalog. Generated Playground HTML matched
  its source. The generated-output Git staging gate is deferred until a commit is
  authorized; it requires staging the reviewed generated file.
- Other bundled provider sections matched `HEAD`; local read-back matched the
  approved candidate and retained every other provider. Both diffs passed whitespace
  checks.

Logs, intake artifacts, isolated catalog snapshots, and the local backup are under
the system temporary directory `cats-claude-2-1-273-pcqRQl`. Initial sandbox Node
child-process denials (`EPERM`) were resolved by the approved validation execution
path; no product test failure remains. UI verification used the source build and
isolated tests, not the installed Desktop application.

The operator subsequently authorized auto-merge PRs, npm/Desktop version bumps,
unsigned GitHub preview publication, and cleanup back to updated `main` after all
merges. Release preparation uses Runtime 0.1.23 and Desktop/Platform 0.2.8, rebased
onto the newly merged selected-provider bootstrap changes. Full precommit gates
are required for this follow-up; the earlier focused results describe the catalog
refresh before that main integration.

On the integrated 0.1.23 release tree, `npm test -- --reporter=verbose` passed:
216 files / 2,166 tests, with 2 files / 10 tests skipped. Total command time was
423.8s (Vitest 375.7s). This includes the staged generated-HTML gate and packaged
runtime contract checks. The shipped skill verifier accepted all 33 runtime-owned
packages, and a separate `npm pack --dry-run --ignore-scripts --json` inspected the
already-built 0.1.23 package without repeating the build/test gate.

## Delivery retrospective

The catalog refresh and the later authorized release are distinct phases. The local logs and
GitHub job timestamps establish the following costs; concurrent rows must not be added together
as elapsed delivery time. They do not provide a complete accounting of reading, edits, user
interaction, or tool overhead.

| Phase | Measured time | Result / interpretation |
|---|---|---|
| Runtime focused tests | 5.1s test runner | 95 passed; catalog checks themselves were cheap |
| Desktop focused typecheck/build/tests | 266.6s | 68 passed; only 11.4s was test execution |
| Runtime final local gate | 423.8s | 2,166 passed; required release preparation |
| Desktop first local gate | 864.5s | 4,566 passed, 5 skipped, 5 stale label assertions failed |
| Desktop full test retry | 568.3s | 4,571 passed, 5 skipped; avoidable after a complete consumer search |
| Desktop PR CI | 7m 41s | [Run 35063467440](https://github.com/cats-inc/cats-platform/actions/runs/35063467440), 06:23:10–06:30:51 UTC |
| Desktop npm workflow | 8m 08s | [Run 35064162064](https://github.com/cats-inc/cats-platform/actions/runs/35064162064), 06:32:17–06:40:25 UTC |
| Desktop preview workflow | 4m 46s | [Run 35064175632](https://github.com/cats-inc/cats-platform/actions/runs/35064175632), overlapped npm publication |

The clearest agent-caused waste was incomplete impact discovery. Updating the shared Opus fallback
also changed execution chips and audience participants, but the focused selection checks missed
their two assertion files. A pre-gate exact-old-label search in both repositories would have found
them and avoided the 568.3s full retry plus its diagnosis/rebundling. Independent runtime-response
fixtures correctly retained their supplied historical labels; a blanket replacement is not the fix.

The Claude reference still described evidence collection without the supplied-paste fast path
already available for Codex. It now starts with the supplied model/effort screens, approved label
projection and duplicate-row collapse, existing alias/default/empty-control support, and the local
override. Common consumer searches and Desktop test commands now live in the shared surface guide.
Current versions and option sets remain in evidence/catalog data rather than procedural instructions.

Release work also integrated independently merged provider-bootstrap changes. Final gates needed
that integrated tree, but earlier focused results remain valid only for their original scope. The
skill now calls for identifying the intended base and expanded build/test scripts before the final
gate, retaining valid phase results, and overlapping independent remote jobs with local work.

Runtime npm publication succeeded before registry reads exposed the new version; eventual metadata
and the downloaded tarball verified 0.1.23. This propagation delay was observed during Desktop work,
not an extra sequential delivery phase. A separate inspection assumed npm pack JSON was an array;
the saved package-keyed output was sufficient to recover without another build. Both cases are now
documented as read/inspection retries rather than reasons to republish or rebuild.

Repeated status messages and overlarge instruction/search output also added interaction overhead.
No reliable duration is assigned to those costs. The procedural update favors relevant references,
existing evidence, and phase-transition reporting. It does not bypass current commit/CI gates or
change CI workflows; deduplicating CI versus publication tests would require a separate change.
