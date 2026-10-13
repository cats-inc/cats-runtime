# Kiro 2.30.0 catalog from the V3 engine's config

Date: 2026-10-13 (UTC+8). Mode: refresh. Interaction policy: the operator asked for best
practice to be applied without further questions.
Scope: the `kiro` / `cli` catalog scope and the Kiro parts of the
`maintain-provider-model-catalogs` skill. Companion to
[the V3 headless contract](./2026-10-13-kiro-v3-headless-contract.md) and
[ADR-045](../decisions/045-drive-kiro-through-the-v3-headless-engine.md).

## Request and decisions

With Cats moving Kiro to the V3 engine, the catalog's evidence path had to move too: the 2.24.1
and 2.27.1 rows were captured by operating the interactive `/model` picker and its settings
panel ([2026-09-27](./2026-09-27-kiro-picker-full-catalog.md)). The V3 engine reports the same
data machine-readably, so the capture helpers are retired and the probe reads Kiro directly.

Decisions taken under the operator's "best practice" instruction:

- **Adopt Kiro's per-model effort defaults.** Kiro states a `defaultEffortLevel` for every
  effort row. The picker had shown no default marker, so the catalog had started at each row's
  first value; it now starts at Kiro's default. The adapter still sends `--effort` on every turn.
- **Keep raw IDs as labels.** The V3 config carries a display name per row
  (`Claude Opus 5.5`); it is kept in evidence, not in `label`, until the V3 picker is captured.
- **Keep thinking as notes.** `thinkingToggleable` and `defaultThinkingEnabled` are recorded
  in the scope notes; `kiro-cli chat` has no thinking argument.

## Evidence

Where the data comes from, in order of what was tried:

1. `kiro-cli chat --list-models --format json-pretty`: 21 rows, order, descriptions, context
   windows and credit rates. No effort.
2. Headless `--output-format stream-json` turns send a `config_option_update` whose `model`
   option lists every row with `_meta.kiro.{hasEffort,effortLevels,defaultEffortLevel,
   thinkingToggleable,defaultThinkingEnabled,rateMultiplier,rateUnit}`
   ([fixture](./fixtures/kiro-2.30.0/headless-stream.text-turn.redacted.jsonl)). A turn costs
   credits, so it is not the probe's source.
3. `kiro-cli acp --agent-engine v3 --auth-method cli`: `initialize`, then `_kiro/config/template`
   without a session returns the mode, memory, autopilot, content-collection and output-style
   options but **no model option** on 2.30.0. `session/new` in a temporary directory sends the
   same `config_option_update` as the headless turn before answering, with no prompt and no
   credits; `session/delete` (advertised under `sessionCapabilities`) removes the session and
   its index entry. This is the probe's source.

The 2.30.0 data agrees with the 2.27.1 picker capture row for row: the same 21 IDs in the same
order, the same eleven effort rows, the same rings (`none` first on the three GPT rows, no
`xhigh` on claude-opus-4.6 and claude-sonnet-4.6). Defaults are new information:
claude-opus-5.5 `medium`, claude-opus-4.7 `xhigh`, every other effort row `high`.

Committed evidence:

- [`fixtures/kiro-2.30.0/model-list.probe.redacted.json`](./fixtures/kiro-2.30.0/model-list.probe.redacted.json):
  the probe's 21 rows with efforts, defaults and the ACP evidence fields, written by
  `catalog:evidence` from the 2026-10-13 snapshot.
- The headless stream fixtures listed in the V3 contract note carry the same
  `config_option_update`.

## Skill changes

- `scripts/catalog-probe/kiro-acp.mjs`: the ACP reader. JSON-RPC over stdio, one session created
  and deleted, timeouts and a sign-in classification; `parseKiroModelOptions` projects the rows.
  `tests/support/fake-kiro-acp.mjs` stands in for the CLI in tests.
- `scripts/catalog-probe/sources.mjs`: the Kiro source keeps `--list-models` for membership and
  adds the ACP rows; its coverage is now `efforts: kiro.reasoning_effort, effortDefault: true`.
  It is the one source that creates a session, which
  [catalog-probe.md](../../skills/maintain-provider-model-catalogs/references/catalog-probe.md)
  records.
- `scripts/measure-agent-usage.mjs`: the Kiro reader now reads the V3 session directory
  (`session.json` and `messages.jsonl`); credits are per turn from `usage_summary`, with no token
  counts.
- Removed: `Capture-KiroPicker.ps1`, `Restore-KiroPickerConfig.ps1` and `Test-KiroPicker.ps1`,
  with the Windows Kiro helper section of `interactive-capture.md`.

## Probe run

`node skills/maintain-provider-model-catalogs/scripts/catalog-probe.mjs probe --providers kiro`
on 2026-10-13: `kiro/cli 2.30.0 21/21 confirmed`, no findings, 8.0 s, `acpProbeSessionDeleted:
true`. The Kiro session store held only the operator's own session before and after the run.

## Validation

- `npm run catalog:generate` and `npm run catalog:check`.
- `tests/catalog-runtime.test.ts`, `src/http/ui/shared.playground.test.ts`,
  `tests/ui-shared.test.ts`, `src/core/models`, and the Kiro tests in
  `tests/runtime-server.test.ts` updated for the defaults.
- `node --test` on `catalog-probe.node-test.mjs` and `measure-agent-usage.node-test.mjs`.

## Open

- Capturing the V3 terminal picker would show whether Kiro now displays the display names; if
  so, labels could follow them under the usual label policy.
- A real turn's `config_option_update` is equal evidence to the ACP one; a future refresh that
  already has a headless capture can cite it instead of running the probe.
