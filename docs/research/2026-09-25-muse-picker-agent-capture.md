# Muse picker agent capture, 2026-09-25

Mode: refresh. Provider scope: muse only (`config/curated-model-catalogs.yaml.example`,
muse section). Interaction policy: confirm uncertainty.

## What was re-observed

Muse Code 1.3.0 (`muse-bin-1.3.0-R3401.1`, `.muse-version` 1.3.0-R3401.1) against
the operator's signed-in account (profile `tbh`, identity redacted):

- Machine enumeration (evidence priority 1): MSP `model/list` over
  `muse serve --no-session-log` (initialize, `initialized` notification, then
  `model/list` with no sessionId; newline-delimited JSON-RPC). Reply:
  `providerId` meta, `profileId` tbh, `source` providerCatalog, four rows with
  the same ids, display labels, release dates, limits, contributor descriptions,
  and contributor-row `isDefault` flag as the 2026-09-05 capture. `isActive` is
  false everywhere because no sessionId was supplied. Complete for this account.
- Agent-operated picker (priority 2): dedicated uniquely-titled Windows Terminal
  window, empty temporary workspace, `--no-session-log`, Windows UI Automation
  visible text checked against private screenshots. `/model` picker shows the
  same four rows in the same order with the same contributor descriptions;
  `?` marks the session-current row (muse-spark-1.3), no default marker on any
  row. `/effort` with muse-spark-1.3 active shows minimal, low, medium, high,
  xhigh, max in order; `? xhigh current` is the session value, no default
  declared. Left both pickers without confirming (Escape); status still showed
  muse-spark-1.3 / xhigh afterwards. No prompt was submitted, no inference ran,
  today's session-log directory count unchanged (1, the operator's own agent
  session), owned windows closed afterwards.

## Capture accounting

- Saved screenshots: 5 PNG, each 1129x635 (window captures incl. terminal
  chrome): trust gate, `/model` list, post-Enter main screen, `/effort` menu,
  plus the first failed-launch error screen. Kept private outside Git.
- Images sent to the model: 0. Traversal used TextPattern text only.
- Token usage: this host exposes no per-message usage transcript, so no exact
  input/output/cache split is available. Proxy: ~25 shell calls across
  preparation (help/schema/MSP ~6.6k output tokens), capture (~20 UI reads,
  ~1k tokens each), and catalog update; screenshots added 0 model-input tokens
  because none were attached. Session-context re-reads dominate, per the skill.
- Helpers run: `Test-WindowsUiGuards.ps1` (13 PASS, offline), thread desktop
  `Default`, UIA top-level count 4 including the owned terminal.

## Decision (assess: 5 ready, 0 confirmation-required, 0 omitted, no hard gates)

- `cli_version` 1.0.3-R2198.1 -> 1.3.0-R3401.1; `last_updated` 2026-09-05 ->
  2026-09-25 (complete model-list re-read qualifies).
- No model added or removed; ids, labels, limits, contributor metadata, Cats
  `(contributor)` display projection, and the unset curated default all
  retained. MSP `isDefault` on the contributor row is still not projected
  (existing operator decision; picker shows no default marker either).
- muse-spark-1.3 effort menu re-confirmed identical; the other three rows'
  effort menus retain their 2026-09-18 operator-correction provenance and were
  not re-traversed (one level's evidence leaves other levels intact).
- No material uncertainty remained, so no operator questions were asked under
  confirm uncertainty. Frozen historical artifacts (schema-1 migration map,
  cutover fixture, 1.0.3 probe/decision notes, launcher/probe test constants)
  intentionally untouched.

Evidence fixtures: `docs/research/fixtures/muse-1.3.0/model-list.agent-capture.redacted.txt`
and `docs/research/fixtures/muse-1.3.0/picker-transcription.agent-capture.redacted.txt`.
Agent working files (raw/normalized/observation/decision/summary, screenshots,
schema export): private temp dir, not committed.
