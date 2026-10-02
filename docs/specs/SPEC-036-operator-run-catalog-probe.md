# SPEC-036: Operator-run catalog probe

Status: Implemented, pending review (2026-10-02). Extends
[SPEC-028](./SPEC-028-provider-model-catalog-maintenance-skill.md); usage and the agent workflow
are in the skill's [catalog probe reference](../../skills/maintain-provider-model-catalogs/references/catalog-probe.md).

## Problem

Catalog refreshes are reliable but agent-operated: an agent drives each CLI's picker through
desktop UI automation, which costs a session per provider even when nothing changed. Most CLIs
also have a read-only model enumeration that needs no picker. The operator wants to run one local
command, get metadata, and see which models are still offered, which are new and which need an
agent.

## Decisions (operator, 2026-10-02)

- "Still usable" means "still listed by the CLI's read-only enumeration". A per-model execution
  check is a later, separately authorized tier because it spends quota on every account.
- Claude has no read-only enumeration. The probe only detects picker-related release notes and
  asks for an agent capture; it does not drive the picker itself. (Grok, first assumed to be in
  the same position, turned out to have `grok models` and is probed like the others.)
- Probe results become catalog evidence only through a committed fixture that an agent writes
  with the evidence command once an edit is authorized; `tmp/` outputs stay private.
- The operator needs a visible page to compare and confirm results. The JSON files stay the
  record; `report.html` is a view of `report.json` and needs no server.
- The tool runs from a cats-runtime development checkout. It is not part of the npm package or
  the Desktop sidecar.

## Requirements

| ID | Requirement |
| --- | --- |
| CP-01 | `npm run catalog:probe` runs one source per curated CLI scope: the read-only enumeration recorded in that provider's reference, or a static read of the installed package. It never logs in, opens a session, sends a prompt or edits the catalog. |
| CP-02 | Each source runs from an empty temporary directory with stdin closed, without terminal and host-agent variables plus its provider's recorded variables, under a timeout that stops the process tree. Recorded self-update guards apply (OpenCode, Copilot, Goose, Muse, Pi, Cline, Junie). |
| CP-03 | Versions come from installation metadata where it exists, otherwise `--version`. A version difference is a note; ADR-035 applies, so a newer CLI is never a failure by itself. |
| CP-04 | The snapshot keeps projected public fields only: the compared IDs, labels, efforts and defaults, versions and source status, plus per-row `evidence` the source stated but the probe never compares (context limits, descriptions, list markers and similar). Prices, endpoints, raw output, session and account fields are never kept. Snapshot and reports are written under the Git-ignored `tmp/catalog-probe/`. Messages from a failed command are redacted and cut to one line. |
| CP-05 | Validation reads the factory's generated JSON and refuses it when its digest does not match the YAML. Each source declares its membership coverage (complete, partial, superset, family, none) and the fields it is authoritative for; only those fields are compared. |
| CP-06 | Every finding names its audience: none, info, operator or agent. Absence from a source is never removal evidence. In a shortlist scope, or from a superset source, extra upstream rows are notes. A degraded source (not signed in, fallback catalog) turns its model findings into inconclusive notes and asks the operator. |
| CP-07 | `config/catalog-probe-acknowledgements.json` lists investigated differences by scope, kind, subject and optional field/observed value, each with a reason and an evidence path. A matched finding needs nobody; an unmatched entry for a probed provider is reported stale. Agents write entries; the operator does not. |
| CP-08 | Output is a terminal summary, `report.md`, `report.json` and a self-contained `report.html` that shows every catalog entry beside the CLI's row for it, with differences marked; the npm scripts open it in the default browser. `report.json` names the agent scopes, every finding's next action and a hand-off prompt. Exit code 0 means nothing to do, 2 means the operator or an agent has something to do, 1 means the tool failed. |
| CP-09 | `npm run catalog:validate -- --snapshot <file>` re-validates a saved snapshot without running any CLI, so an agent can confirm its catalog edits or acknowledgements. |
| CP-10 | Parsers, comparison, acknowledgements, rendering and the command line are covered by an offline Node suite with synthetic input, run in CI through `tests/agent-skill-sync.test.ts`. |
| CP-11 | `npm run catalog:evidence -- --snapshot <file> --scope <provider> [--ids …]` writes `docs/research/fixtures/<cli>-<version>/model-list.probe.redacted.json`: the selected rows with command, source class, version, time, platform, account scope, completeness, authoritative fields and what still needs the picker. String values pass the skill's redaction helper; an existing file is not replaced without `--force`; a scope without a read-only list gets no fixture. |

## Non-goals

- Scheduling. ADR-034/PLAN-036's CI release-feed watcher is a separate, unimplemented plan; this
  probe is the local catalog dimension on a maintainer machine with installed, signed-in CLIs.
- Editing the catalog, advancing `last_updated` or writing evidence fixtures. Agents do that
  through the skill's ordinary refresh workflow.
- Driving pickers (Claude, or option menus no enumeration covers) and per-model execution checks.
- Running on an installed Runtime or Desktop.

## Verification (2026-10-02, native Windows 11)

All sixteen sources ran in about a minute. Muse answered from its bundled catalog because the
CLI was not signed in on this machine, which the report gave to the operator. The agent scopes
were real catalog changes:

- Copilot 1.0.91 and Auggie (`claude-sonnet-5-5`) list Claude Sonnet 5.5;
- Pi 1.0.0 and Auggie list GPT-6.1-Sol;
- Kiro 2.27.0 listed `claude-sonnet-5.5` at 04:52 UTC and not at 05:05 UTC, with the same build:
  account lists can flap during a rollout, so an agent re-reads before adding a row;
- Copilot's four Gemini rows and Pi's Spark row are acknowledged with their earlier evidence.

Muse's signed-in `providerCatalog` branch and Grok's signed-out branch are covered by synthetic
tests only; neither state occurred on the verification machine.

A later run of all sixteen sources with the per-row evidence fields gave the same results. Its
snapshot held no URL, e-mail address, price, profile ID or login text. The evidence command was
exercised on that day's Auggie, Copilot, Pi, Kiro and Codex rows into a scratch directory and the
output reviewed; no fixture was committed, because no catalog edit was authorized.

Cursor first reported five false absences because its legacy slugs carry a `cursor-` prefix and
effort suffixes; family matching now respects version boundaries. Claude Code 2.1.286 started
embedding its release notes as a template literal, which `claude-changelog.mjs` now reads.
