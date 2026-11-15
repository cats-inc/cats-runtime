# 2026-11-16 eight CLI catalog refresh

Mode: refresh. Interaction policy: confirm uncertainty. Scope requested by the owner: Codex,
Claude, Antigravity, Grok, Muse, Cursor, Kimi Code and Copilot, with desktop UI automation
allowed. Every other provider, channel, API and local scope is unchanged. No model table,
binding or adapter code changed.

Native Windows 11 in an RDP session, Windows Terminal, the machine's existing sign-ins. Account
identities, credentials, costs and endpoints are excluded from fixtures. Private screenshots,
step text and scripts stay outside Git. Observations describe this account and machine only.

## Evidence and delta

The read-only probe (`catalog-probe.mjs probe`, snapshot `20261116-054048`) asked an agent for
Claude, Antigravity, Cursor and Copilot, the operator for Muse, and nothing for Codex, Grok and
Kimi.

| CLI | Version | Entries | Evidence and result |
| --- | --- | ---: | --- |
| Codex | 0.167.2 | 8 | Complete `codex debug models`: same eight visible rows, labels, efforts, effort defaults and context windows (also compared by hand; the probe skips context). Version and date only. |
| Claude | 2.1.325 | 13 | Agent-operated `/model` capture plus session-only `/status` for rows 2-14. New Fable 5.2 (Low-Max, `(default)` Medium) sets `fable` (claude-fable-5-2). From 2.1.319 nine older models sit under an unnumbered `More models` group row; the expanded list numbers them 6-14. All other rows keep labels, efforts, defaults and `/status` values; Fable 5.1's description changed. |
| Antigravity | 1.5.9 | 7 | `agy models` (read twice) and the `/model` picker. New Gemini 4 Hydrogen (low/medium/high/xhigh slider, four ids) and Orchestrator (Argon) (`gemini-pro-orchestrator-g1-pro`, no slider). Gemini 4 Carbon is Unavailable (Ultra plan) with no id and stays out. |
| Grok | 1.0.77 | 4 | Complete `grok models` and the CLI-owned account cache: labels, per-model efforts and descriptions, 256000 default context unchanged. Version and date only. |
| Muse | 1.4.20-R8619.1 | 4 | MSP `model/list` answered `bundledCatalog` with no rows on this machine, also after the owner signed in again (`account/read`: `accountLogin`, `credentialRequired: true`). The CLI-owned account cache (`provider_catalog`) and the `/model` picker list muse-wonder-1.0, new muse-ember-1.0, muse-spark-1.3 and muse-spark-1.2; `/effort` with ember active shows minimal-max, no default. |
| Cursor | 2026.11.13-eacade1 | 50 | Complete parameterized reply, 47 CLI-filtered families. New Gemini 4 Carbon, Gemini 4 Hydrogen and Claude Fable 5.2; Gemini 3.7 Flash and Gemini 3.6 Flash are absent from the reply. Every other entry, variant and default is unchanged. |
| Kimi Code | 2.5.3 | 6 | `kimi provider list --json` matches the catalog added earlier today. No change. |
| Copilot | 1.0.110 (Copilot Pro) | 16 | 30-row picker walked both ways with every range cycled: 16 selectable, 14 plan-unavailable. New Gemini 4 Hydrogen (Low/Medium/High, one Context figure 983K, also in `models.list`). The other 15 rows, the GPT-5.6 Terra default and the Copilot Fusion label are unchanged. |

Fixtures: `fixtures/<cli>-<version>/model-list-2026-11-16.probe.redacted.json` (Codex, Grok,
Antigravity, Copilot), the Antigravity, Muse, Claude and Copilot picker captures, the Grok and Muse
cache projections and the Cursor parameterized reply. Each changed scope cites its own.

## Questions and answers

The owner answered on 2026-11-16:

1. Remove the Cursor Gemini 3.7 Flash and Gemini 3.6 Flash entries, absent from the complete
   reply: **remove both** (the variant strings stay reachable as custom input).
2. Project Claude's `More models` group: **flatten in picker order**, recording the group in
   notes and evidence.
3. Fable 5.2 execution: **pin `claude-fable-5-2`**, as the 2026-10-03 decision did for Fable 5.1,
   rather than the moving `fable` alias. The existing `fable` entry keeps running
   `claude-fable-5-1` with label Fable 5.1, so saved selections keep their model.
4. Muse: the owner signed in again. A new probe was still degraded. MSP diagnostics returned
   `account/read` `state: accountLogin` with `credentialRequired: true` while `model/list` stayed
   empty; why `serve` did not load the account catalog is unknown. The account list came from the
   CLI's own cache (written at the sign-in) and the picker instead.

Copilot's `auto` row: `models.list` says Auto, the picker still says Copilot Fusion, so the label
stays and the drift is acknowledged with `observed: "Auto"` pinned in
`config/catalog-probe-acknowledgements.json`.

## Capture notes

- Every CLI ran in a uniquely titled window after clearing `CLAUDECODE`, `CLAUDE_CODE_*`,
  `CLAUDE_PID`, `TERM`, `CI`, `NO_COLOR`, `GIT_EDITOR` and `MSYSTEM`; PowerShell 5.1 needed an
  empty `PSModulePath`, and Git Bash needed `MSYS_NO_PATHCONV=1`, or `/model` was typed as a path.
- Settings: Claude `settings.json`, Copilot `config.json` and `settings.json`, and Muse
  `settings.json` and `trust.json` kept their prelaunch SHA-256 through exit. agy's
  `settings.json` changed once at the trust prompt (one `trustedWorkspaces` entry for the new
  empty folder, left for the operator) and then stayed fixed.
- Claude's `More models` row needed helper changes; see Scripts. Expanding it (its footer names
  Enter) saved nothing.
- Copilot 1.0.110 puts the detail pane above the list; the window was maximized so every group
  showed. The helper still cannot match the Copilot Fusion pane, recorded by hand as before.
- The RDP client lost the foreground once during the Claude capture; no key was sent until the
  window was foreground again with the operator idle.
- No prompt, login, model selection or quota-using call was made. Antigravity listing and picker
  selection are not an execution check.

## Validation

- The agent-owned decision artifact (nine changes: six additions, the Claude flatten, the
  confirmed Cursor removal and the `last_updated` advances) was assessed before the final
  validation: all nine `ready`, none requiring confirmation, omitted or deferred.
- `catalog:generate` and `catalog:check` (including the code/data boundary guard) passed.
  Factory sourceDigest: `2d5bc5d6b736ad7572a4533d0523d17da2d0d50a4d78fad5c4700adaa1e53439`.
- No personal `curated-model-catalogs.yaml` exists in the default Runtime profile, so no local
  scope hides this factory there.
- The same probe snapshot revalidated: Codex 8/8, Antigravity 7/7, Grok 4/4, Kimi 6/6, Cursor
  41/50 with the rest acknowledged legacy-slug gaps, Copilot 14/16 plus two acknowledgements,
  Claude without enumeration. Muse stays `you` because of the MSP behavior above.
- Focused Vitest: `src/core/models`, `src/http/ui`, catalog data/runtime, runtime server and the
  Copilot, Antigravity, Claude, Muse and Cursor provider suites, 326 tests passed; skill sync 21
  passed. Three full-list pins were updated (Copilot 16 entries in two files, Muse effort
  lengths, Antigravity Playground efforts). New argv assertions: Copilot Gemini 4 Hydrogen
  (`--effort` without `--context`), agy Hydrogen low and xhigh ids and Orchestrator (Argon),
  Claude `--model claude-fable-5-2 --effort medium` while `fable` still runs claude-fable-5-1, and
  Muse `--model muse-ember-1.0 --reasoning-effort max`. `catalog-runtime`, `catalog-upgrade` and
  `package-contract` then passed 69 tests; `tsc --noEmit` and `git diff --check` passed. No
  full-suite claim.
- Offline helper tests: `Test-ClaudePicker.ps1` (14 cases, two new) and
  `Test-ClaudePickerRowStatus.ps1` (5 cases, one new) passed, plus the two new Node suites.
- Consumer search for the removed Cursor ids and labels found only a Junie-scoped Platform test
  fixture and historical notes.

## Scripts and cost

Kept, with offline tests registered in `tests/agent-skill-sync.test.ts` where they are Node suites:

- `scripts/project-grok-models-cache.mjs`: projects `~/.grok/models_cache.json` to public fields;
  replaces the private cache projection written in each earlier refresh. Reusable unchanged.
- `scripts/project-muse-model-cache.mjs`: projects Muse's account model cache while MSP serves no
  account list. Reusable unchanged while the cache format holds.
- `Capture-ClaudePicker.ps1` and `Read-ClaudePickerRowStatus.ps1`: handle the 2.1.319 `More
  models` group row.

Private, not kept:

- `drive.ps1` and `clean-launch.cmd`: a command-line front for the platform `WindowsUi.ps1`
  (launch, focus, read, type, key, maximize, close) and an environment-clearing launcher. Reusable
  in principle, but they belong to the platform desktop-ui-automation skill, so they are
  recommended there rather than added here.
- `agy-capture.ps1`, `copilot-capture.ps1`, `claude-capture.ps1`, `claude-rowstatus.ps1`: pass this
  run's titles, labels and paths to the kept helpers.
- `build-agy-fixture.mjs`, `build-copilot-fixture.mjs`, `fix-claude-capture.mjs`,
  `claude-yaml.mjs`: this run's fixture headers, a one-off rebuild of console-garbled strings from
  the helper's UTF-8 step files (the reference now says to read the JSON from a UTF-8 console), and
  the Claude scope reorder.
- `fg.ps1`, `dumpline.ps1`, `msp-probe.mjs`, `msp-init*.mjs`: diagnostics whose findings are in
  the Claude and Muse references. `edit-yaml.mjs` was written and not used.

Images: 18 saved (three manual 1129×635 window captures and 15 helper key screens), 3 sent to the
agent, about 2,900 image-input tokens by the pixel heuristic. `measure-agent-usage.mjs` on this
Claude Code session through 07:00 UTC+8: 247 calls, 502 uncached input, 448,811 cache-write,
74,301,543 cache-read and 166,800 output tokens; Preparation 49 calls, Capture (including the
helper fixes and Muse diagnostics) 145, Catalog update 53. Provider inference usage: zero.

## Not done

- No commit, push, PR, release, personal override or installed Desktop/Bot update.
- The probe and `catalog:logins` still report Muse 1.4.20 as needing a sign-in. Teaching their
  Muse source to read the CLI cache is a separate probe change.
- Workspace skill mirrors are refreshed after the change merges.
- Left on the machine for the operator: the agy `trustedWorkspaces` entry and the Claude
  `~/.claude.json` project entry for the two empty capture folders, and the empty CLI sessions
  that starting agy, Copilot, Claude and Muse created (no prompt was sent in any of them).
