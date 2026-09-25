# Muse picker agent capture, 2026-09-26

Mode: refresh. Provider scope: muse only (`config/curated-model-catalogs.yaml.example`,
muse section). Interaction policy: confirm uncertainty.

## What was re-observed

Muse Code 1.4.0 (`muse-bin-1.4.0-R4161.1`, `.muse-version` 1.4.0-R4161.1) against
the operator's signed-in account (profile `tbh`, identity redacted):

- Machine enumeration (evidence priority 1): MSP `model/list` over
  `muse serve --no-session-log` (initialize, `initialized` notification, then
  `model/list` with no sessionId; newline-delimited JSON-RPC). Reply:
  `providerId` meta, `profileId` tbh, `source` providerCatalog, four rows with
  the same ids, display labels, release dates, limits, contributor descriptions,
  and contributor-row `isDefault` flag as the 2026-09-25 capture. `isActive` is
  false everywhere because no sessionId was supplied. New in 1.4.0: each row
  carries an ordered `variants` array (both 1.3 rows minimal, low, medium, high,
  xhigh, max; both 1.2 rows minimal through xhigh), matching the curated
  per-model effort menus exactly. The `muse --help` parser vocabulary
  (none|minimal|low|medium|high|xhigh|max|ultra, default high) is broader and is
  not imported. Complete for this account.
- Agent-operated picker (priority 2): attempted but incomplete on this Linux
  labwc/Wayland host. Dedicated empty workspace, `--no-session-log`,
  MUSE_NO_AUTO_UPDATE=1. Desktop observation proven with one escalated `grim`
  screenshot (desktop context only; picker pixels not present because the probe
  TUI ran in a sandboxed pty without a window). Native control missing:
  `wlrctl`/`wtype` not installed (only `grim` + `wlr-randr` present);
  sandboxed `grim` fails with "failed to create display". A sandboxed pty probe
  with CPR auto-answer advanced past the first cursor query, then stalled
  before rendering the picker (kitty-keyboard / device-attributes queries
  unanswered). `/model` + Enter was sent once; no picker rows were captured, no
  prompt was submitted, no inference ran. Settings hash unchanged
  (60c21d8287e5de034dde8970ddc433073dcd9d70ba8b4ffab11a15b695aa1520, still
  model muse-spark-1.3 / xhigh from the operator's own config). CLI startup
  wrote ordinary local-tracing logs; no new persisted probe session was
  observed and owned pty processes were terminated.

## Capture accounting

- Saved screenshots: 1 PNG, 1920x1080 (~1.8 MB, fullscreen desktop context
  incl. the operator's terminal chrome; no picker content). Kept private
  outside Git (`/tmp/cats-ui.nWHuXb/before.png`). An earlier empty
  `/tmp/cats-ui.OPqbCd` dir from the failed sandboxed attempt holds no image.
- Images sent to the model: 1 (the desktop-context screenshot, inspected for
  environment proof only; 0 picker images because no picker pixels existed).
- Token usage: this host exposes no per-message usage transcript, so no exact
  input/output/cache split is available. Proxy: ~30 shell calls across
  preparation (help/schema/MSP), capture (grim readiness, pty probes with CPR
  handling, config/session checks), and catalog update; screenshots added
  model-input tokens for 1 image (1920x1080). Session-context re-reads
  dominate, per the skill.
- Helpers run: no Windows helpers on this host. `wlr-randr` reports a single
  enabled output HDMI-A-2 (Sony TV) at 1920x1080 @60Hz, scale 1.0. Linux recipe
  readiness: observation proven escalated-only; control missing as above.

## Decision (assess: 5 ready, 0 confirmation-required, 0 omitted, no hard gates)

- `cli_version` 1.3.0-R3401.1 -> 1.4.0-R4161.1; `last_updated` 2026-09-25 ->
  2026-09-26 (complete model-list re-read qualifies; option screens retain
  prior provenance per the evidence rule).
- No model added or removed; ids, labels, limits, contributor metadata, Cats
  `(contributor)` display projection, and the unset curated default all
  retained. MSP `isDefault` on the contributor row is still not projected
  (existing operator decision; no picker default was claimed either).
- Effort menus were not re-traversed via picker on 1.4.0, so all four rows
  retain their existing provenance (2026-09-18 operator correction; 1.3 row
  additionally re-confirmed 2026-09-25). The 1.4.0 MSP `variants` corroborate
  the same tokens and order; `none`/`ultra` remain excluded. No help-derived
  default is declared.
- No material uncertainty remained, so no operator questions were asked under
  confirm uncertainty. Frozen historical artifacts (schema-1 migration map,
  1.0.3 probe/decision notes, launcher/probe test constants) intentionally
  untouched.

Evidence fixtures: `docs/research/fixtures/muse-1.4.0/model-list.agent-capture.redacted.txt`
and `docs/research/fixtures/muse-1.4.0/picker-transcription.agent-capture.redacted.txt`
(limitation log, not picker rows).
Agent working files (raw MSP/pty logs, screenshots, schema export): private temp
dirs (`/tmp/muse-catalog-1.4.0-*`, `/tmp/cats-ui.*`, `/tmp/muse-picker-ws.*`,
`/tmp/muse-schema`), not committed.
