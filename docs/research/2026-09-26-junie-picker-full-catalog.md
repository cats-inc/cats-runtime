# Junie 26.9.22 full catalog from an agent-operated picker capture

Date: 2026-09-26. Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `junie` / `cli` catalog scope, changed from a five-row shortlist to
`selection_mode: full`. Only the default JetBrains AI channel is in scope; BYOK channels
selected with `--provider` are excluded.

## Request and decisions

The operator asked for Junie's catalog to be expanded like the full-catalog providers,
using maintain-provider-model-catalogs with desktop-ui-automation. The operator also asked
for a report of screenshot count, resolution and token usage, and for a PR with auto squash
merge and branch cleanup after validation.

The capture ran in a Junie-hosted agent session, which then ran low on context. A Claude Code
session took over from its handoff: it reused the completed capture and did not traverse the
picker again. Questions asked and answers:

1. **Effort values.** Include every value the picker offers. Wire tokens are the JAR's
   `EffortLevel` names lowercased: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
   Only `low` and `medium` have been executed through Cats (by the earlier shortlist). Junie's
   `--help` lists only low, medium and high.
2. **Default row.** The picker row `Default (Gemini 3.7 Flash)` (badge `70% off`) becomes the
   model `Gemini 3.7 Flash` with `default: true`. The raw row text and badge are kept in its notes.
3. **Effort defaults.** None are declared, because the picker shows no effort default marker.
   The Effort cell shows each row's saved `effortPerModel` setting.
   - Consequence: Desktop, Playground and runtime resolution start at each model's first value,
     and the runtime sends that value as `--effort`.
   - First values: None for GPT-5.6-LUNA, GPT-5.6-SOL, GPT-5.6-TERRA, GPT-6-LUNA and GPT-6-SOL;
     Minimal for Gemini 3.6 Flash; Low for the other nine.
   - The operator chose this ("option 1") on 2026-09-26, including the behavior change for the
     former shortlist rows (see Catalog delta).
4. **Desktop "Default" option.** Desktop added its own "Default" (預設) enum option for any control
   without a declared default, unless the key was on a hard-coded allowlist. The operator judged
   this a bug: `/model` offers no such choice, and the runtime sent the first value anyway.
   cats-platform removed the fabricated option for all providers in a separate PR (#150). No
   current catalog changes behavior, because the only no-default controls were the allowlisted
   Antigravity, Grok and Muse keys.

Policy: [SPEC-028](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md) now lists Junie in
the full-catalog group (2026-09-26 amendment). The
[2026-09-23 shortlist note](./2026-09-23-junie-shortlist.md) is superseded.

## Capture

- **Environment:**
  - Junie 26.9.22, build 3419.7, on native Windows 11 with Windows Terminal. The operator
    launched it in a dedicated window with
    `<user-home>\.local\share\junie\versions\3419.7\junie\junie.exe --skip-update-check`, not
    through the auto-updating `junie.bat` shim.
  - The agent typed `/model` and sent only Up, Down and Right, then one Escape. Enter was never
    sent.
- **Method:**
  - Windows UI Automation visible text, through the desktop-ui-automation helper. The first list
    screen was checked against a window screenshot.
  - Right cycles the highlighted row's effort. Each row was cycled back to its starting value.
- **Completeness:**
  - The footer counter read `i/15`, and all 15 rows were highlighted in turn.
  - Every Provider cell read `JetBrains AI`, so there were no BYOK rows.
  - All five former shortlist rows are present. No row was removed.
- **Settings:**
  - `~/.junie/settings.json` hashed
    `35960eff399200406f4eb19e905c83e1698aa30ef08dc751af9df151e1411c51` before and after the
    traversal.
  - Junie itself rewrote the file once when the operator launched it (same 358 bytes). The
    changed field was not verified.
- **Identity:** no account identifier, email or organization appeared on the captured screens.
- **Evidence:**
  [model-picker.agent-capture.redacted.txt](./fixtures/junie-26.9.22/model-picker.agent-capture.redacted.txt).
  Raw captures and scripts stay private, outside Git.

| # | Picker name | Efforts, linear order | Start (saved setting) |
| --- | --- | --- | --- |
| 1 | Default (Gemini 3.7 Flash) | Low, Medium, High | Medium |
| 2 | Claude Fable 5.1 | Low, Medium, High, XHigh, Max | Low |
| 3 | Claude Opus 5 | Low, Medium, High, XHigh, Max | Low |
| 4 | Claude Opus 5.5 | Low, Medium, High, XHigh, Max | XHigh |
| 5 | Claude Sonnet 5 | Low, Medium, High, XHigh, Max | Low |
| 6 | Gemini 3.6 Flash | Minimal, Low, Medium, High | High |
| 7 | Gemini 3.8 Flash | Low, Medium, High | Medium |
| 8 | GPT-5.6-LUNA | None, Low, Medium, High, XHigh, Max | Low |
| 9 | GPT-5.6-SOL | None, Low, Medium, High, XHigh, Max | Low |
| 10 | GPT-5.6-TERRA | None, Low, Medium, High, XHigh, Max | Low |
| 11 | GPT-6-ASTRA | Low, Medium, High, XHigh, Max | Low |
| 12 | GPT-6-LUNA | None, Low, Medium, High, XHigh, Max | Low |
| 13 | GPT-6-SOL | None, Low, Medium, High, XHigh, Max | Low |
| 14 | Grok 4.6 | Low, Medium, High, XHigh | Low |
| 15 | Grok 4.7 | Low, Medium, High, XHigh | Low |

Descriptions and per-Mtok prices are in the fixture and in each model's catalog notes. En dashes
(–) and hyphens are kept exactly as displayed.

## Static corroboration

These checks read the installed `junie-release-3419.7.jar`. They are a possible superset, not
entitlement or default evidence.

- **Model names:** all 15 literal names occur exactly in `ModelOption$Specific`.
- **Effort order:**
  - `EffortLevel.$values()` returns `None, Minimal, Low, Medium, High, XHigh, Max`, and
    `getWireId()` is the name lowercased with `Locale.ROOT`.
  - `EffortLevel$Companion.availableForModel` builds each model's list in that order, with None
    first. The Right-key ring shows only `Max > None > Low`, so the ring alone cannot place None;
    the bytecode fixes the linear order.
  - A read-only bytecode reader was used, because no `javap` was installed.
- **Unused defaults:** `EffortLevel$Companion.defaultForModel` exists. It is not used, because
  the picker shows no effort default.
- **`--effort` parsing:** `ModelOptionsGroup` declares `--effort` as a free string option, with
  the help text "Possible values: low, medium, high." No choice validation was found in that
  class. Whether Junie accepts `none`, `minimal`, `xhigh` and `max` at run time was not verified
  by a turn.

## Catalog delta

- The scope changes from `shortlist` to `full`, `cli_version` from 26.9.21 to 26.9.22, and
  `last_updated` to 2026-09-26. The last change is justified because the model list was
  complete (15/15).
- **The five retained rows change as follows:**
  - Labels drop the fixed `— <effort>` suffix and become the literal picker names.
  - `execution.fixed_controls` is replaced by a per-model `junie.reasoning_effort` enum control.
  - Existing capability tags and the former label spellings in `source_names` are kept.
- **Ten rows are new:** Claude Opus 5, Claude Opus 5.5, Claude Sonnet 5, Gemini 3.6 Flash,
  GPT-5.6-LUNA, GPT-5.6-TERRA, GPT-6-ASTRA, GPT-6-LUNA, GPT-6-SOL and Grok 4.7.
- **Starting effort changes for former rows** when a selection carries no effort (fixed value →
  first value):
  - Gemini 3.7 Flash: medium → low
  - Claude Fable 5.1: low → low
  - Gemini 3.8 Flash: medium → low
  - GPT-5.6-SOL: low → none
  - Grok 4.6: low → low
  Existing sessions keep their recorded bindings.
- **No code change.** The adapter already sends `junie.reasoning_effort` as `--effort`, and the
  string binding already existed.

## Launch incident: Microsoft Defender

The capture agent first tried to launch Junie itself. There were two failure causes:

- **Inherited agent environment.** `TERM=dumb` and similar variables made Junie exit with
  `JLine returned dumb`.
- **Defender.** At startup, Junie decrypts `~/.junie/dpapi_credentials` through
  `powershell -NoProfile -NonInteractive -EncodedCommand …`.
  - Defender blocked that child process three times. Protection history lists
    `Trojan:Win32/Commando.A!ml` at 16:27:49, 16:40:56 and 16:46:01 (UTC+8), each remediated.
  - Junie then logged `Cannot run program "powershell": CreateProcess error=5` and exited.
  - The operator temporarily allowed the command, then launched Junie from their own terminal,
    where it was not blocked. Why only agent-launched starts were blocked is not established.
  - Several diagnostic steps were spent on `error=5` before anyone checked Defender.

These lessons are now in the catalog skill: the
[Junie reference](../../skills/maintain-provider-model-catalogs/references/providers/junie.md) and
the launch-hygiene step in
[interactive capture](../../skills/maintain-provider-model-catalogs/references/interactive-capture.md).
The general Windows lesson is in platform's desktop-ui-automation skill (cats-platform #151):

- clean the inherited environment before launching;
- check security history first when a CLI exits before its UI;
- never change antivirus settings, and fall back to an operator-launched window.

**Operator follow-up:** restore the temporary Defender allowance, and close the capture windows.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed, including the code/data
  boundary check.
- **Focused Vitest run: 114 passed:**
  - `tests/catalog-data.test.ts` and `tests/catalog-runtime.test.ts`;
  - `src/core/models/providerModelCatalog.test.ts` and `src/backends/cli/providers/junie.test.ts`;
  - `src/http/ui/shared.playground.test.ts` and `tests/ui-shared.test.ts`.
- **New tests:**
  - first-value resolution: GPT-5.6-SOL → none, Gemini 3.6 Flash → minimal, Gemini 3.7 Flash → low;
  - an explicit `xhigh` is accepted where offered and rejected where not;
  - the emitted `--model` / `--effort` arguments;
  - Playground rendering, picker order and the absence of "(default)" labels.
- `tests/runtime-server.test.ts -t junie`: 2 passed (the basic and advanced model routes).
  Junie was removed from the Playground shortlist test group.
- `tests/agent-skill-sync.test.ts`: 8 passed. `npm run typecheck` passed, and `build:ui` output
  was unchanged.
- **Old-label consumers.** Remaining uses are all historical and were left as they are:
  - `config/catalog-schema1-migration.json`, `tests/fixtures/catalog-schema1/*` and earlier
    research notes;
  - cats-platform `tests/fixtures/catalogs-v2.json`, which its helper describes as a "Frozen HTTP
    projection … Never production data".
- **Not verified:** a Junie turn with any effort other than low or medium.

## Cost

- **Images:** 6 window captures were saved, all 1129×635 on a 2560×1306 desktop. Four came from
  failed startup attempts, one is the first list screen and one is row 13. Only the first list
  screen was sent to a model, about 960 input tokens at width × height / 750.
- **Junie host session** (per-call usage from its `events.jsonl`). The main model was Claude
  Opus 5.5; smaller models handled Junie's own summarization and routing calls. Cost is as
  reported by Junie.

| Phase | Calls | Uncached input | Cache write | Cache read | Output | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| Preparation, failed launches, Defender diagnosis (15:46–16:50) | 203 | 122,890 | 305,614 | 6,575,964 | 78,663 | 4.14 |
| Capture (16:50–17:17) | 72 | 52,993 | 192,430 | 3,547,373 | 48,532 | 2.56 |
| Decisions and handoff (17:19–17:36) | 40 | 42,894 | 517,324 | 816,039 | 26,712 | 2.98 |
| Total | 315 | 218,777 | 1,015,368 | 10,939,376 | 153,907 | 9.68 |

- **Catalog update:**
  - The work ran in a Claude Code session (Claude Opus 5.5) whose history already held a long
    earlier survey. Every call re-read that context.
  - Measured from the takeover message through this commit: 103 calls, 206 uncached input,
    484,799 cache write, 44,709,231 cache read and 86,859 output tokens.
  - That window also covers the handoff assessment and coordinating the two cats-platform PRs
    (#150, #151). The subagent that implemented #150 is not included.
  - This repeats the skill's advice to run each provider refresh in a fresh session.
