# Claude 2.1.282 eleven-row picker capture

## Result and scope

The operator reported that the Claude Code model picker now offers Default plus ten models, and
asked the agent to refresh the Claude catalog by operating the CLI menu itself. Mode: refresh.
Interaction policy: confirm uncertainty. The operator asked for the screenshot count, resolution
and token usage, and authorized a PR with auto squash merge and branch cleanup after verification.
The earlier projection that collapses the Default row to Opus still applies. There are no removals,
personal-override changes, execution/schema changes, version bumps or publication.

The picker was observed on 2026-09-26 (UTC+8) in a native Windows 11/RDP session. The agent drove
Windows Terminal and Claude Code 2.1.282 on the operator's subscription account. The installed
build is the same one that showed five rows on 2026-09-25, so the new list did not come with a CLI
update. The text is Windows UI Automation visible text, checked against a screenshot.

| Picker label | Execution value (`/status`) | Efforts (linear order) | Picker `(default)` |
| --- | --- | --- | --- |
| Opus 5.5 | `opus` (claude-opus-5-5) | Low, Medium, High, xHigh, Max, Ultracode | Medium |
| Fable 5.1 | `claude-fable-5-1` | Low, Medium, High, xHigh, Max, Ultracode | High |
| Sonnet 5 | `sonnet` (claude-sonnet-5) | Low, Medium, High, xHigh, Max, Ultracode | High |
| Haiku 4.5 | `haiku` (claude-haiku-4-5-20251001) | Effort not supported | None |
| Opus 5 | `claude-opus-5` | Low, Medium, High, xHigh, Max, Ultracode | High |
| Fable 5 | `claude-fable-5` | Low, Medium, High, xHigh, Max, Ultracode | High |
| Opus 4.8 | `claude-opus-4-8` | Low, Medium, High, xHigh, Max, Ultracode | High |
| Opus 4.7 | `claude-opus-4-7` | Low, Medium, High, xHigh, Max, Ultracode | xHigh |
| Opus 4.6 | `claude-opus-4-6` | Low, Medium, High, Max | High |
| Sonnet 4.6 | `claude-sonnet-4-6` | Low, Medium, High, Max | High |

The Default (recommended) row describes "Opus 5.5 · Best for everyday, complex tasks" and has the
same effort cycle and Medium default as Opus 5.5. `/status` shows it as Default, not as a model id.

## Changes from the 2026-09-25 capture

- Picker labels now carry the model version, so Cats uses them verbatim. The earlier
  version-bearing projection from descriptions is no longer needed.
- The Opus (1M context) row is gone. The Opus 5.5 row sets `opus`, which resolves to the
  standard-context claude-opus-5-5. `--model opus[1m]` still resolved to claude-opus-5-5[1m] on
  2026-09-26, but no picker row offers it.
- Fable 5.1 sets the full id `claude-fable-5-1` rather than the `fable` alias.
- Descriptions changed for Opus, Fable 5.1 and Sonnet 5. Haiku's is unchanged.
- Six rows are new: Opus 5, Fable 5, Opus 4.8, Opus 4.7, Opus 4.6 and Sonnet 4.6.

## Operator decisions

The `assess` step marked three changes as needing confirmation. The operator chose the
recommended option for each:

- Opus: follow the picker. The entry executes `opus`, is labelled `Opus 5.5`, and loses its 1M
  limit. The standard context value was not observed, so no limit is recorded. The other options
  were keeping `opus[1m]`, or listing both.
- Fable 5.1: execute `claude-fable-5-1`, the value the picker sets, rather than keep `fable`.
- The capture-helper changes below go in the same PR as the catalog data.

The other change groups were ready without a question: the six new rows, the label, description
and effort re-reads, and advancing `last_updated`. The Default-to-Opus collapse reused the earlier
authorization. Entry ids are unchanged, so saved selections and
bound sessions keep their ids. New rows use their execution value as the id.

## Evidence and interpretation

- [Picker capture](fixtures/claude-2.1.282/model-picker-11-rows.agent-capture.redacted.txt)
  keeps the first-opened list, the scrolled list at rows 9 and 11, and each row's effort line
  after every Right press. No account identifiers appeared.
- [Row values](fixtures/claude-2.1.282/model-row-status.redacted.txt) come from choosing each
  row for the session only (`s`) and reading the local `/status` Model line. `alias (id)` means
  the row sets the alias; a bare id means the row sets that id. No prompt was submitted, and
  `settings.json` kept its prelaunch SHA-256 after every row, at exit and after the separate
  `opus[1m]` launch.
- The picker shows eight rows at a time. Edge rows carry `↑`/`↓` in the highlight column, and one
  `… +3 models` line counts every row out of view, above or below. Visible rows plus that count
  gave 11, and the helper then highlighted each index from 1 to 11.
- Effort is a single picker-wide selection. Rows lacking the current level show another level:
  Opus 4.6 and Sonnet 4.6 show High when the selection is xHigh. After a Right press on those rows
  the selection stays at the level they left. Only the `(default)` suffix is default evidence. The
  starting level and the check mark are not.
- The saved settings (`opus`, effort `xhigh`) put the check mark on Opus 5.5 and started each
  row at xHigh, or at High where xHigh is missing.
- The static artifact's xHigh description names "Fable 5, Opus 4.7+, Sonnet 5", which agrees with
  the observed absence of xHigh on Opus 4.6 and Sonnet 4.6.
- The observation tree has 78 observed paths and no expected-path gaps.

## Capture helper changes

The first live run exposed two gaps in `Capture-ClaudePicker.ps1`, both fixed in this PR:

- **Scrolled list.** The helper expected every row to be visible at once. It now accepts the
  `↑`/`↓` edge markers and treats the `… +N models` line as a count, not as effort text. It
  checks that visible plus out-of-view rows match `-ExpectedModelCount`, and reads each row while
  that row is highlighted.
- **Shared effort.** The first run finished every row and then failed its final check, because
  the Opus 4.6 and Sonnet 4.6 cycles left the shared selection at High. The helper now cycles the
  starting row back to its starting level. No setting was written in either run.

Two offline fixture cases cover these gaps: a scrolled window with out-of-view counting, and a
shared-effort mock where one row lacks the starting level. All nine cases pass. The second native
run then passed with `-ExpectedModelCount 11` in 25 s, using 70 text captures and 12 images.

## Cost

- Saved images: 27 window captures, all 1129 x 635; the desktop is 2560 x 1306. They break down
  as 2 at launch, 13 in the first helper run (including its stopped state) and 12 in the second.
- Images sent to the agent: 1 (the first picker screen). At about width x height / 750, that is
  roughly 960 input tokens. All other checks used UI Automation text.
- API usage comes from this session's transcript, counting each message once by id:

| Phase | Calls | Uncached input | Cache write | Cache read | Output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Preparation (skill and repository reading) | 15 | 30 | 60,117 | 1,053,618 | 7,642 |
| Capture (launch to exit, helper fix and tests, row values) | 33 | 66 | 86,598 | 4,502,256 | 50,787 |
| Catalog update to this note (question, YAML, tests, evidence) | 42 | 84 | 62,397 | 8,903,801 | 37,785 |

- Cache reads come from re-reading the growing session context on every call, not from the one
  image. They do not convert to a subscription allowance percentage. The commit, PR and merge
  steps come after this note and are reported with the PR.

## Validation

- Offline helper fixture: 9 cases passed.
- `catalog:generate` and `catalog:check` passed, including the code/data boundary checks.
- Focused Vitest: 4 files and 133 tests passed (catalog data/runtime, runtime server, UI shared).
  Two runtime-server tests had copied the factory's Claude model list and count. They now read
  the factory through `readCatalogFactory`. The schema-1 upgrade test keeps its frozen
  four-row input. `npm run typecheck` passed.
- The exact old-label search found only the frozen schema-1 migration evidence and this catalog's
  own provenance notes. Platform's isolated catalog fixtures are historical and were not refreshed.

## Picker list variability (open question)

After the merge, the operator reported two further observations on 2026-09-26. Their Max
subscription had not changed.

- On another Windows machine, the same Claude Code 2.1.282 build showed a twelfth row. The operator
  described it as Opus 5.5 (1M), which is the Opus 1M row this catalog stopped using.
- On the capture machine, the picker briefly showed the earlier layout of four or five rows.

The agent did not observe either list. Neither has a screenshot or row values, so neither is
catalog evidence. Two read-only checks by the agent are consistent with a remotely controlled list:

- The 2.1.282 binary already contains the new rows' ids and descriptions (for example
  `claude-opus-4-8` and "Most capable for ambitious work") and the string "Opus (1M context)".
  The build therefore ships definitions for every row the picker has shown. Something outside the
  binary decides which rows appear.
- `~/.claude.json` caches remote feature flags (`cachedGrowthBookFeatures`, 720 entries, with a
  `cachedGrowthBookFeaturesAt` timestamp) and experiment assignments. Each machine refreshes its own
  cache, so two machines, or one machine at different times, can show different lists. The flag
  that controls the picker was not identified; only key names were read, not values.

Working interpretation, unverified: Anthropic can change the picker list at any time, per account
or rollout and per cached machine state, without a CLI update. The operator decided that the
catalog keeps the ten explicit rows captured here.

Consequences for maintenance:

- A capture is a snapshot of one machine at one time. Record both. Its `complete` means complete
  for that observation, not stable for the account.
- A later list with fewer rows is not removal evidence. A list with more rows, such as the reported
  Opus 5.5 (1M) row, needs its own capture, including the row value from `/status`, before the
  catalog changes. The operator chooses which observation the catalog follows.
- Open questions: which flag or experiment selects the list; whether the 1M row returns on this
  account; and whether print mode (`-p`) accepts the same models when the picker hides them.
  `--model opus[1m]` still resolved in interactive mode while the picker offered no 1M row.

## Limitations

- Print mode (`-p`, which Cats uses) and other accounts were not probed. The picker list changes
  without a CLI update; see the variability section above.
- Context limits for the new rows and for standard-context Opus 5.5 were not observed.
- The launch inherited `CLAUDE_CODE_CHILD_SESSION` from this agent session, which turned off
  transcript saving in the capture windows.
