# Operator-run catalog probe

The probe lets the operator check every CLI catalog without an agent. It runs each installed
CLI's read-only model enumeration, validates the result against the factory and says, per scope,
whether nothing, the operator or an agent has to act. Agents take over only the scopes the report
names. The design is [SPEC-036](../../../docs/specs/SPEC-036-operator-run-catalog-probe.md) in
cats-runtime.

## Run it

From the cats-runtime root:

```text
npm run catalog:probe                              # all sources
npm run catalog:probe -- --providers codex,kiro    # only these
npm run catalog:probe -- --skip muse,cursor        # CLIs this machine does not use
npm run catalog:validate -- --snapshot tmp/catalog-probe/<time>/snapshot.json
```

`probe` writes `snapshot.json`, `report.json`, `report.md`, `report.html` and `agent-handoff.json` to
`tmp/catalog-probe/<time>/`, which Git ignores, and prints one line per scope plus a `View:`
link. `validate` re-checks a saved snapshot, for example after a catalog edit or a new
acknowledgement, and rewrites the three reports beside it. Exit codes: `0` nothing to do (notes
only), `2` the operator or an agent has something to do, `1` the tool failed. A stale
`curated-model-catalogs.generated.json` is refused; run `npm run catalog:generate` first.

The npm scripts pass `--open`, which shows `report.html` in the default browser; calling the
script with `node` opens nothing unless `--open` is given. The JSON files are the record and the
page is a view of `report.json`. It shows:

- **Headline and what to do:** how many scopes need an agent or you, the operator's actions,
  the agent scopes and a copyable hand-off prompt pointing to the compact `agent-handoff.json`.
- **Tally:** one row per scope with catalog and installed versions and one mark per catalog
  entry in catalog order, then, after a gap, the listed models no entry runs. A mark's shape and
  colour both give its status, and each mark links to its row in the scope's sheet.
- **Each scope:** a reconciliation sheet with the catalog on the left, what the CLI listed on
  the right and the result between them. The left heading names the CLI version the catalog was
  captured with and the right one the installed version that answered. Each row shows the
  label, options and the execution IDs the CLI listed (✓) or did not (✗), then new rows and,
  folded, the other listed models. A value only in the catalog is struck through in red, a value
  only the CLI lists is green, ★ marks a default, an outlined ★ a different default and a wavy
  underline a different label. Fields a CLI is not authoritative for are dimmed and not
  compared.
- **Filter and search:** filter the sheets by who acts; search finds a model by entry ID, label
  or execution ID across every scope.

Each terminal tag says who acts; the page writes `Agent` or `You` beside the scope and nothing
when it is `ok`:

- `ok`: every comparable entry is confirmed, or only notes remain.
- `you`: install, sign in or rerun. The line under the table says which.
- `agent`: hand `report.json` to an agent with the printed prompt.

## Sources

Every source runs from an empty temporary directory with stdin closed, without terminal or
host-agent variables (`TERM`, `CI`, `CLAUDECODE`, `CLAUDE_CODE_*` and others), and is stopped
with its process tree on timeout (default 60 s, `--timeout`). None logs in, opens a session,
sends a prompt or writes raw output. Versions come from installed package metadata where it
exists, otherwise from `--version`.

A degraded answer is tried once more before it is reported. A CLI can refresh an expired
sign-in on one call and answer for the account only on the next: `grok models` did on 2026-10-03.
The retry is noted on the scope; only a second degraded answer asks you to sign in.

| Scope | Read | Membership | Compared fields | Guards |
|---|---|---|---|---|
| claude | release notes embedded in the newest `~/.local/share/claude/versions` binary | none | picker-related notes since `cli_version` | never launched |
| codex | `codex debug models` | complete | label, efforts, effort default; `visibility=hide` rows are not picker rows | none needed so far |
| antigravity | `agy models` | complete | executable IDs, including every variant | none needed so far |
| grok | `grok models` | complete | IDs; "not authenticated" makes the source degraded | none needed so far |
| muse | `muse-bin-<version> serve --no-session-log`, MSP `model/list` | complete | IDs, efforts (`variants`); a non-`providerCatalog` reply is degraded | runs the versioned binary, never the self-updating launcher |
| cursor | `cursor-agent --list-models` | family | family slug only | none needed so far |
| copilot | `list-copilot-models.mjs` (`models.list`) | partial | label, efforts | `--headless --stdio --no-auto-update`, no `COPILOT_*` |
| opencode | `opencode models <basis channel> --verbose --pure` | complete | label | `OPENCODE_DISABLE_AUTOUPDATE=true` |
| kilo | `kilo models <basis channel> --verbose --pure` (gateway, not picker) | partial | IDs | `--pure` |
| goose | `goose --version` | none | version only | `GOOSE_PATH_ROOT` in a temporary directory |
| pi | `extract-pi-models.mjs` on the installed package | complete | thinking levels, default | never `pi --list-models` |
| auggie | `auggie model list --json` | complete | label; `registryAvailable: false` is degraded | no `AUGMENT_*`/`AUGGIE_*` |
| junie | `junie-model-ids.mjs` on the installed JAR | superset | label | never starts Junie; build number, not release version |
| kiro | `kiro-cli chat --list-models --format json-pretty` | complete | IDs | no `KIRO_*`, `JSC_*`, `AWS_EXECUTION_ENV` |
| cline | the `@cline/llms` `dist/models.js` provider block, read as text | superset | IDs | never executes Cline, whose informational flags once started npm updates |
| devin (agent/acp_stdio) | `devin models list --format json` | complete | variant UIDs | never `devin acp --help` |

Membership values:

- **complete:** the source lists what the picker offers. An extra row is a new candidate in a
  full scope; a missing entry is absent.
- **partial:** the source is known to differ from the picker and can omit its rows: Copilot omits
  every Gemini row, and Kilo's gateway list lacks the picker's routing rows.
- **superset:** static data that can list more than the picker. Extra rows are notes only.
- **family:** only model families, not the parameterized variant. Cursor's legacy slug
  `gpt-5.6-sol-high-fast` proves the `gpt-5.6-sol` family is listed, not that the catalog's
  exact parameter combination still exists.
- **none:** no read-only enumeration. Claude asks for a capture only when release notes since
  the catalog version mention the picker, a versioned model name, the default model, effort,
  Ultracode or `[1m]`. Its picker can still change without a version change.

Only a channel scope's `basis.channel` decides which channel OpenCode, Kilo, Pi and Cline are
probed on. A scope without it is a tool error, not a default.

## Findings

| Kind | Who | Meaning |
|---|---|---|
| `new-candidate` | agent | A full scope's complete or partial source lists a row no entry executes. |
| `absent-from-source` | agent | An entry's execution ID (or variant) is not listed. Never removal evidence by itself. |
| `hidden-in-source` | agent | An entry executes a row the source marks hidden. |
| `field-drift` | agent | `label`, `efforts` or `effortDefault` differs on a field the source is authoritative for. |
| `capture-needed` | agent | Claude release notes since `cli_version` mention picker changes. |
| `source-unavailable` | you or agent | Not installed, not signed in, timed out or permission denied needs host/operator action. Other parse, exit or launch failures need agent investigation. |
| `source-degraded` | you | The source answered without the account catalog twice in a row. Its model findings become inconclusive notes. |
| `upstream-only`, `hidden-upstream`, `version-changed`, `no-automatic-source` | note | Shortlist or superset extras, hidden rows, a newer CLI, an unverifiable scope. |

`report.json` holds every finding with `subject`, `catalog`/`observed` values and `nextAction`.
`listConfirmed: true` means a complete source listed exactly the catalog's membership on a
conclusive run.

## Acknowledgements

`config/catalog-probe-acknowledgements.json` records investigated differences so that routine
runs stay clean:

```json
{
  "schemaVersion": 1,
  "acknowledgements": [
    {
      "provider": "copilot",
      "kind": "absent-from-source",
      "subject": "gemini-3.8-flash",
      "reason": "models.list omits every Gemini picker row; ...",
      "evidence": "docs/research/2026-09-27-copilot-picker-full-catalog.md",
      "acknowledgedOn": "2026-10-02"
    }
  ]
}
```

- `backend` defaults to `cli` and `transport` to none; set them for other scopes.
- An entry matches one finding by scope, `kind` and `subject`, plus `field` and `observed` when
  given. Pin `observed` for a drift so a later different value reopens it. Acknowledgements do
  not expire with the CLI version: every CLI updates often, and a structural source gap stays.
- An acknowledged `absent-from-source` on a partial source can never show that row's real
  withdrawal. Only a picker capture can.
- An unused entry is reported stale only after its exact provider/backend/transport scope
  answers successfully. Failed or degraded reads cannot retire an acknowledgement.
- Only an agent writes entries, after investigating, with a `reason` and an `evidence` path to the
  research note or fixture. The operator does not author this file. A machine-specific state,
  such as a CLI that is not installed or signed in here, belongs in `--skip`, not in this file.

## Work through a report (agents)

1. Read the adjacent `agent-handoff.json` first. It contains only `needsAgent` scopes, open
   findings, affected entries with inherited controls resolved, relevant snapshot rows, source
   authority and exact evidence/validation command arguments. Operator actions are separate.
   Ordinary refresh rules and hard gates still apply. The full report remains the operator's
   comparison view; avoid loading healthy scopes, hidden rows or unrelated upstream lists into
   agent context. For an older run without this file, run `node
   skills/maintain-provider-model-catalogs/scripts/catalog-probe.mjs validate --snapshot <file>`
   once, without `--open`; it generates the handoff without querying any CLI.
2. The snapshot is evidence of its source class at its CLI version and time. Reuse it; do not
   rerun the enumeration to corroborate. It is private until an edit is authorized; then write
   the rows that support the edit as a fixture with the [evidence command](#evidence-fixtures)
   and cite it from the catalog notes.
3. Per finding:
   - **New candidate:** the fixture proves the ID and the fields under `authoritativeFor`.
     Labels, options and descriptions the source does not supply need picker evidence, captured
     as the provider reference describes. Codex `debug models` supplies label, efforts and the
     effort default; a model `(default)` marker, picker descriptions and picker order are
     picker-only. Then add the entry, or acknowledge why it stays out.
   - **Absent or hidden:** check the picker. Removal needs the operator's confirmation. A
     source gap gets an acknowledgement.
   - **Field drift:** reuse the already captured field when the source is authoritative for it.
     Acquire only missing display labels or conflicting evidence, then update it or acknowledge
     with the `observed` value pinned. Do not repeat a picker traversal just to corroborate it.
   - **Capture needed:** run the provider's agent-operated capture.
   - **Source failure (parse, exit, launch):** update the source in `scripts/catalog-probe/` and
     its synthetic test in `tests/catalog-probe.node-test.mjs`.
     `EPERM`/`EACCES` instead means `permission-denied`, including when a nested helper wraps the
     error. Use the host approval mechanism or an authorized terminal, then retry only affected
     providers. Never interpret host restrictions as model removals or parser drift.
4. Rerun `npm run catalog:validate -- --snapshot <the same snapshot>`. The scopes you worked on
   should be clean or carry only notes.
5. A clean run does not advance `last_updated`. When an agent edits a scope, a conclusive run with
   `listConfirmed: true` is complete model-list evidence for that scope at the snapshot's
   version; partial, superset, family and none never are.

The handoff is regenerated even when no agent action remains (its `scopes` is then empty), so a
previous actionable copy cannot survive validation. `validate --out` retains the original
snapshot's absolute path in the handoff. Commands are argv arrays, not shell-escaped strings;
quote arguments for the executing shell instead of joining arbitrary paths into shell code.
Measure context savings by comparing artifact bytes on the same pre-edit snapshot and factory;
byte reduction is not a measured token count or an inference-latency benchmark.

## Evidence fixtures

Once an edit is authorized, turn the snapshot rows that support it into a committable fixture:

```text
npm run catalog:evidence -- --snapshot tmp/catalog-probe/<time>/snapshot.json --scope auggie --ids claude-sonnet-5-5,gpt-6-1-sol
npm run catalog:evidence -- --snapshot <snapshot> --scope codex,kiro
```

It writes `docs/research/fixtures/<cli>-<version>/model-list.probe.redacted.json` (`--name` changes
the stem, `--fixtures-root` the directory) and prints the `Evidence:` line for the catalog notes.
An existing file is never replaced without `--force`. Junie's directory uses its build number,
`junie-build-<build>`, because the probe does not observe the release version. Use `--ids` for
shortlists and other large lists: the fixture should hold the rows the edit relies on.

Each fixture records the command, source class, CLI version and its source, observation time,
platform, account scope (no identity), completeness and its meaning, the fields the source is
authoritative for, what still needs the picker, and the rows. String values pass through the
skill's redaction helper, and `redaction.redactions` lists what it replaced. Still review the file
by hand before committing it. A scope with no read-only list (Claude, Goose) or a failed source
has no fixture; record its picker capture instead.

Rows keep `evidence`: public fields the source stated but the probe does not compare. They can
support a note or a limit, but they are the source's own claim, not picker evidence.

- **codex:** description, visibility, context window and maximum, effort descriptions.
- **copilot:** context and long-context maximum, discount.
- **kiro:** description, context window, credit rate and unit, the list's own default marker
  (not a catalog default).
- **auggie:** short name, description, cost tier, badges, `effortLevels`, the JSON `isDefault` as
  `jsonIsDefault` (only the picker `(default)` suffix is default evidence); the
  envelope's `defaultModelId` as source evidence.
- **devin:** family ID and label, description, new/beta flags.
- **opencode, kilo:** family, status, release date, context and output limits, reasoning flag,
  variant names.
- **pi:** name, input types, reasoning flag, thinking-level map, context window, maximum tokens;
  pi-ai version and default thinking level as source evidence.
- **muse:** description, release date, context and output limits, MSP `isDefault` (never a
  curated default).
- **junie:** enum name; the accepted aliases as source evidence.
- **cline:** family, release date, context window, maximum tokens, reasoning option types.
- **grok, cursor:** the list's own `(default)` marker.

Prices, endpoints, raw output, session and account fields are never kept.

## Limits

- Verified on native Windows 11 on 2026-10-02 with all sixteen CLIs installed. Other platforms
  locate the same commands on `PATH`; Muse needs `.muse-version` beside its launcher there.
- Two live branches are covered only by synthetic tests: Muse's signed-in `providerCatalog` reply
  (this machine answered from `bundledCatalog`; the parser follows the 2026-09-26 fixture shape)
  and Grok's "not authenticated" state (the probe run was signed in).
- The probe proves "still listed", not "still executes". A per-model execution check would spend
  quota and needs separate authorization.
- Account-scoped results describe this machine's sign-ins only, at the time of the run. Lists can
  flap during a rollout: on 2026-10-02 Kiro 2.27.0 listed a new row and dropped it 13 minutes
  later. Re-read a new candidate before adding it.
