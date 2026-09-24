# Claude 2.1.282 agent-operated picker capture

## Result and scope

The operator asked the agent to refresh Claude by operating the live `/model` picker itself and,
if possible, to leave a Claude-specific capture helper. Mode: refresh. Interaction policy: confirm
uncertainty. The operator's earlier four-row projection (the Default row collapsed to Opus) and the
version-bearing display names still apply. The operator also approved updating the Opus label in
the Claude API and agent discovery scopes. No removals, personal override changes,
execution/schema changes, version bumps or publication are part of this refresh.

All five rows and every row's effort line were observed on 2026-09-25 in a native Windows 11/RDP
session. The agent drove Windows Terminal and Claude Code 2.1.282 on the operator's subscription
account. The text is Windows UI Automation visible text, checked against screenshots.

| Cats label | Execution alias | Efforts (cycle order) | Picker `(default)` |
| --- | --- | --- | --- |
| Opus 5.5 with 1M context | `opus[1m]` (see context aliases) | Low, Medium, High, xHigh, Max, Ultracode | Medium |
| Fable 5.1 | `fable` | Low, Medium, High, xHigh, Max, Ultracode | High |
| Sonnet 5 | `sonnet` | Low, Medium, High, xHigh, Max, Ultracode | High |
| Haiku 4.5 | `haiku` | Effort not supported | None |

The Default (recommended) row mirrors Opus: it has the same description, the same effort cycle and
the same Medium default. Compared with 2.1.273, only two things changed: the Opus picker
description (and therefore its projected label) now says Opus 5.5, and Opus now marks Medium,
not High, as its default effort. Aliases, effort tokens, context values and all other rows are
unchanged. The factory CLI scope and its generated JSON now carry these values. The API and agent
discovery scopes first took the new Opus label; the context-alias follow-up below changed it to
`Opus 5.5`. The CLI picker does not show how those backends resolve `opus`.

## Evidence and interpretation

- [Picker capture](fixtures/claude-2.1.282/model-picker.agent-capture.redacted.txt) keeps the
  complete model list and each row's effort line after every Right press, in the observed order.
  The startup banner is omitted. No account identifiers appeared.
- The saved settings (`opus[1m]`, effort `xhigh`) put the check mark on Opus and started every
  adjustable row at xHigh. `(default)` appears only on the level the picker marks as default, so the
  current selection did not mask it once the level was cycled. The initial effort line is not
  default evidence.
- Right cycles Low, Medium, High, xHigh, Max, Ultracode and then wraps. Linear order follows that
  wrap point and matches the 2.1.273 capture. Max keeps its usage warning on every supported row.
- The observation tree has 30 observed paths and no expected-path gaps. Five change groups were
  ready. The discovery-label change needed scope confirmation, which the operator gave.

## Context aliases (follow-up)

The operator asked whether Cats' `opus` execution is really 1M, then approved a data-only fix.
The agent launched six aliases (`opus`, `sonnet` and `fable`, each with and without `[1m]`) in
dedicated windows. For each launch it read the startup banner and the local `/status` Model line
([evidence](fixtures/claude-2.1.282/model-alias-status.redacted.txt)).

- Plain aliases resolve to standard-context models: `opus` resolves to claude-opus-5-5 and
  `sonnet` to claude-sonnet-5. Only `opus[1m]` and `sonnet[1m]` add the `[1m]` suffix.
- `fable[1m]` is accepted but resolves to plain claude-fable-5-1.
- The banner alone is not evidence: it shows `(1M context)` for `opus[1m]` but not for
  `sonnet[1m]`.
- The picker's Opus (1M context) row saves `opus[1m]`.
- The picker's Default row is `value: null`. The CLI resolves `--model default` to the account's
  current default rather than to a model named `default`, so Cats keeps its explicit four rows.
  That is the 2026-04-08 decision in Platform `a053ca45`.

Resulting data change:

- The CLI Opus row now executes `opus[1m]`, so its 1M label and limit are true.
- Sonnet keeps `sonnet` and loses the 1M limit from the 2.1.246 static extraction. Its
  standard-context value was not observed, so none is recorded.
- Fable and Haiku are unchanged.
- The Claude API and agent discovery scopes still execute `opus`, whose context this CLI evidence
  cannot establish, so their label is now `Opus 5.5`.
- Entry ids are unchanged, so saved selections and bound sessions keep their ids.

Print mode (`-p`, which Cats uses) and non-Max accounts were not probed. Both would need a real
request or another account. The `fable[1m]` result suggests the CLI drops an unsupported suffix
rather than failing, but entitlement fallback for `opus[1m]` is unverified.

## Native capture lessons

- Launch with `--safe-mode` (customizations off, OAuth and model selection intact). `--bare` never
  reads OAuth, so its picker would describe API-key access rather than this account.
- The picker footer says Enter sets a new-session default and `s` applies the session. Only arrow
  keys may traverse it; Escape cancels and prints `Kept model as ...`. The settings hash matched
  before launch, after each row and after exit.
- The prompt and highlight glyph U+276F is followed by U+00A0. A literal-space pattern did not
  match, and its guard stopped before Enter.
- Launching from inside a Claude Code session passed `CLAUDE_CODE_CHILD_SESSION` to the new window,
  which disabled transcript saving there. This reduced profile writes. No claim is made that the
  whole profile stayed untouched.
- Cats Desktop auto-updated and relaunched mid-capture, taking the foreground. Foreground lock then
  refused `SetForegroundWindow`; UI Automation `SetFocus` on the owned window succeeded. Input
  stopped again while system idle time showed the operator active, and resumed only after they
  released the desktop.

## Cost

- The helper traversal took 14.5 s: 32 text captures and 6 key-screen images.
- Exploration saved 2 more images. All 8 are 1129 x 635 window captures, not the 2560 x 1306
  desktop.
- Three images were sent to the agent: startup, the first picker and one default-marked effort
  screen. At about width x height / 750, that is roughly 1,000 input tokens each.
- API usage came from this session's transcript, counting each message once. The capture phase,
  from window launch through exit and including helper authoring and its offline tests, made 36
  model calls: 72 uncached input, 56,173 cache-write, 8,283,877 cache-read and 40,057 output
  tokens.
- Cache reads were dominated by the long session context re-read on every call, not by the
  images. Fewer, larger steps save more than dropping screenshots. These figures do not convert to
  a subscription allowance percentage.

## Reusable workflow and validation

Runtime owns the [capture procedure](../../skills/maintain-provider-model-catalogs/references/interactive-capture.md)
and the new `Capture-ClaudePicker.ps1` traversal helper. Platform owns the native window, focus
and input helper.

- Claude helper offline fixture: six cases passed. They covered key/all/no screenshot policies,
  arrow-only traversal with starting-level cycles, the current marker, effort detail lines,
  unsupported effort, rejection of a final config change, protection of existing evidence and a
  row-count mismatch.
- `catalog:generate` and `catalog:check` passed, including the code/data boundary checks.
- Focused Vitest passed 4 files and 139 tests: catalog data/runtime, runtime server and Playground
  shared UI. The factory advanced-catalog assertion now expects Opus `medium`. The schema-1 upgrade
  test still expects the historical `high` from its frozen input.
- Exact old-label search found only the frozen schema-1 migration evidence, the regenerated JSON
  and two formatter tests. The formatter tests use the old label as an input string and remain
  unchanged. Platform's isolated catalog fixtures are historical and were not refreshed.
