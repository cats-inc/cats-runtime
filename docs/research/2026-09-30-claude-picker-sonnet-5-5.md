# Claude 2.1.285 picker capture: Sonnet 5.5

## Result and scope

The operator reported that Opus 5.5 had stopped working in Cats Desktop on another machine, where
the Claude CLI had updated. They asked the agent to refresh the Claude catalog with this skill
and the desktop UI automation skill. Mode: refresh. Interaction policy: confirm uncertainty.
During the work the operator tested the installed Desktop 0.7.1: Opus 5.5 worked there. They
then narrowed the task to updating the model list, which grows from ten to eleven explicit rows
with Sonnet 5.5.

The change covers the Claude CLI scope of the factory catalog, its evidence and the capture
helpers. There are no personal-override, execution, schema or version changes, and nothing was
published.

The picker was observed on 2026-09-30 from 21:34 to about 22:00 (UTC+8) in a native Windows 11 RDP
session. The agent drove Windows Terminal and Claude Code 2.1.285 on the operator's subscription
account (startup banner: Claude Max). The catalog was last captured on 2.1.282; this machine had
since installed 2.1.283, 2.1.284 and 2.1.285. The text is Windows UI Automation visible text,
checked against a screenshot.

| Picker label | Execution value (`/status`) | Efforts (linear order) | Picker `(default)` |
| --- | --- | --- | --- |
| Opus 5.5 | `opus` (claude-opus-5-5) | Low, Medium, High, xHigh, Max | Medium |
| Fable 5.1 | `claude-fable-5-1` (2.1.282 read) | Low, Medium, High, xHigh, Max | High |
| Sonnet 5.5 | `sonnet` (claude-sonnet-5-5) | Low, Medium, High, xHigh, Max | Medium |
| Haiku 4.5 | `haiku` (2.1.282 read) | Effort not supported | None |
| Sonnet 5 | `claude-sonnet-5` | Low, Medium, High, xHigh, Max | High |
| Opus 5 | `claude-opus-5` (2.1.282 read) | Low, Medium, High, xHigh, Max | High |
| Fable 5 | `claude-fable-5` (2.1.282 read) | Low, Medium, High, xHigh, Max | High |
| Opus 4.8 | `claude-opus-4-8` (2.1.282 read) | Low, Medium, High, xHigh, Max | High |
| Opus 4.7 | `claude-opus-4-7` (2.1.282 read) | Low, Medium, High, xHigh, Max | xHigh |
| Opus 4.6 | `claude-opus-4-6` (2.1.282 read) | Low, Medium, High, Max | High |
| Sonnet 4.6 | `claude-sonnet-4-6` (2.1.282 read) | Low, Medium, High, Max | High |

The Default (recommended) row still describes "Opus 5.5 · Best for everyday, complex tasks", with
the same effort cycle and Medium default as Opus 5.5.

## Changes from the 2026-09-26 capture

- **Sonnet 5.5 is new**, as row 4. It sets `sonnet`, which now resolves to claude-sonnet-5-5.
- **The Sonnet 5 row sets the full id `claude-sonnet-5`.** On 2.1.282 the same model was reached
  through `sonnet`, so the catalog's `sonnet` entry, labelled Sonnet 5, was already running
  Sonnet 5.5 after the update.
- **Ultracode is gone from every row's effort cycle.** The 2.1.284 notes turned it into its own
  `/effort` toggle that no longer forces xhigh.
- **Descriptions changed.** Opus 5.5 now reads "For complex work and everyday tasks" and Sonnet 5
  "Efficient for routine tasks". Other rows are unchanged.
- **The row count changed meaning.** The `… +N models` line now counts only the rows below the
  window and disappears at the last row. It used to count every row out of view.

## Operator decisions

- **Capture method.** The Windows session was disconnected and locked at first, so no window
  could take focus. The operator reconnected over RDP. A headless pseudo-console capture was not
  needed.
- **Scope.** After their Desktop 0.7.1 test, the operator asked for the list update only:
  Default excluded, ten rows become eleven.
- **Row values.** The operator let the agent choose rows 4 and 6 for the session and read
  `/status`. Row 2 had already been read. The other rows were not re-read.
- **Ultracode.** The operator chose the recommended option, following the picker and removing
  Ultracode from every row.

The `assess` step marked all eight changes ready, so no further question was needed.

One mapping decision follows the 2026-09-26 precedent and the rule that a label must hold for the
model its execution resolves to:

- Entry `sonnet` keeps its id and its `sonnet` execution. A saved selection keeps executing what
  it already did, and the entry is relabelled Sonnet 5.5 with the Medium default.
- Sonnet 5 is a new entry, `claude-sonnet-5`, with the High default.

## Evidence and interpretation

- [Picker capture](fixtures/claude-2.1.285/model-picker-12-rows.agent-capture.redacted.txt)
  keeps the first-opened list, the list scrolled to rows 9 and 12, and each row's effort line after
  every Right press. No account identifiers appeared.
- [Row values](fixtures/claude-2.1.285/model-row-status.redacted.txt) come from choosing rows 2,
  4 and 6 for this session only (`s`) and reading the `/status` Model line. No prompt was
  submitted, and `settings.json` kept its prelaunch SHA-256 throughout and after exit.
- The observation tree has 66 observed paths and no expected-path gaps.
- `claude-changelog.mjs` read the release notes that the 2.1.285 binary embeds, which cover
  2.1.278 to 2.1.284. It is static-artifact evidence. The relevant entries are:
  - 2.1.284 added Sonnet 5.5 as the default Sonnet model;
  - 2.1.284 changed the picker's row count and made Ultracode a toggle;
  - 2.1.283 dropped "(1M context)" from the Opus row, "where Opus already has a 1M context
    window". The catalog still records no Opus limit, because none was observed.
- The 2.1.285 parser still accepts `--effort ultracode` without a warning and maps it to
  `xhigh`. A session bound before this change keeps a valid argument.
- The 2.1.285 artifact describes xHigh as "Deeper reasoning than high, just below maximum (on
  supported models)". It no longer names models, and the catalog uses this text.

## The reported Opus 5.5 failure

The failure was not reproduced or diagnosed. The operator saw it on another machine; its error
text and CLI version were not captured. On this machine the Opus 5.5 row still sets `opus`
(claude-opus-5-5), matching the catalog. Every flag the Claude adapter sends is still in
`claude --help` on 2.1.285. The operator later found Opus 5.5 working in the installed Desktop
0.7.1. The catalog change is not a fix for that report.

## Capture helper changes

- **Row count.** `Capture-ClaudePicker.ps1` stopped at row 9 with "Model count changed while
  scrolling", because it expected the 2.1.283 counting. It now accepts either total at every row.
  A new offline case covers a count of the rows below the window. All ten cases pass.
- **Row-status reader.** `Read-ClaudePickerRowStatus.ps1` automates the `s` and `/status` reads
  that the 2026-09-26 run did by hand. Its scratch predecessor read the Sonnet 5 row natively. For
  Sonnet 5.5, one guard read landed during a redraw and stopped the run before any key was sent;
  that row was finished by hand. The committed script adds a wait for the highlight and footer to
  render together before `s`. It has passed its four offline cases but has not yet run natively.
- **Launch.** The launch cleared the `CLAUDE_CODE_*`, `CLAUDECODE` and `CLAUDE_PID` variables,
  so this capture's transcript was saved, unlike in 2026-09-26. The Claude reference now lists
  those variables.

## Scripts

Kept in this change, each with an offline test:

- `scripts/Capture-ClaudePicker.ps1`: the row-count change above.
- `scripts/Read-ClaudePickerRowStatus.ps1`: the value each row sets. It reruns unchanged while
  the picker footer and `/status` layout hold.
- `scripts/claude-changelog.mjs`: the release notes a Claude Code binary embeds. It reruns
  unchanged while the notes stay one single-quoted literal.
- `scripts/claude-picker-observation.mjs`: capture and row-status JSON to an observation tree. It
  reruns unchanged while the capture helper's JSON keeps its shape. On this run's data it matched
  the hand-built tree exactly.

Left out:

- A scoped key and text driver: a thin wrapper over the platform `WindowsUi.ps1` functions.
- A launch script (environment clearing, prelaunch hash, idle check): the capture helpers
  deliberately do not launch the CLI. The steps are in the Claude reference.
- A binary context grep: equivalent to `grep -a` with a byte window.
- A fixture assembler: its header and choice of screens are per-run editorial decisions.

## Cost

- **Saved images:** 25 window captures, all 1129 x 635.
  - 2 at launch and the end;
  - 10 in the first helper run, including its stopped state;
  - 13 in the second run.
- **Sent to the agent:** 1 image, the first picker screen, about 960 input tokens. All other
  checks used UI Automation text.
- **API usage** from this session's transcript, measured with `measure-agent-usage.mjs`:

| Phase | Calls | Uncached input | Cache write | Cache read | Output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Preparation (skills, repository, logs, CLI flags) | 33 | 68 | 118,748 | 3,710,458 | 10,258 |
| Capture (launch to exit, static notes, helper fix) | 75 | 152 | 267,776 | 15,252,827 | 56,648 |
| Catalog update to the kept scripts | 43 | 86 | 77,988 | 13,179,658 | 55,673 |

The capture phase also includes about six and a half hours of waiting while the session was
disconnected. Cache reads come from re-reading the growing context on every call. Calls after
this measurement, including this note, are not counted.

## Validation

- `catalog:generate` and `catalog:check` passed, including the code/data boundary checks.
- Focused Vitest passed 3 files and 132 tests: catalog data, catalog runtime and the runtime
  server. `agent-skill-sync` passed 15 tests, including the two new Node suites.
- Offline PowerShell suites: 10 capture cases and 4 row-status cases passed.
- The search for old labels and `ultracode` in Runtime and Platform found only:
  - frozen schema-1 migration evidence;
  - the adapter's pass-through test;
  - a factory-driven effort loop that still holds;
  - the boundary scripts' effort-token pattern.

## Limitations

- **Rows not re-read.** Only rows 2, 4 and 6 had their values re-read on 2.1.285. The others keep
  their 2.1.282 values, but their labels, descriptions and effort cycles were re-read.
- **Not probed.** Print mode (`-p`, which Cats uses) and other accounts were not probed.
- **Other scopes.** The Claude API and Agent SDK bridge scopes still label `sonnet` as Sonnet 5.
  They are outside this CLI refresh and remain unchanged.
- **Saved Ultracode choices.** Existing sessions keep their bound arguments. A new structured
  selection that still carries `claude.reasoning_effort: ultracode` is rejected by Runtime
  selection resolution ("must be one of: low, medium, high, xhigh, max"). Whether Desktop
  clears a saved Ultracode choice before it sends was not verified.
- **Delivery.** Installed Desktop 0.7.1 bundles Runtime 0.4.0 and its factory. It receives this
  change only through a Desktop build that includes it, or a separately authorized local patch.
- **Side effects.**
  - The trust prompt for the empty capture folder added a project entry to `~/.claude.json`.
  - The capture session saved an ordinary transcript.
