# Runtime npm Release Guide

## Release boundaries

Follow the [shared release preparation/completion policy](https://github.com/cats-inc/cats-one/blob/main/docs/release-guide.md#release-preparation-and-completion):
prepare all release documentation and pins in the original version change.
Verify publication using existing hosted Release/Actions/registry evidence, then
report and finish. Do not add tracked publication reports, status-only commits
or follow-up PRs, or chase unrelated main updates after verification.

Runtime npm is independently released as `@cats-inc/cats-runtime`. Ordinary
commits, merges and branch pushes do not bump its version or publish it. Accumulate
changes until the owner selects a Runtime npm release; use existing authorization
without asking again for already authorized steps.

A Runtime release does not require a new Platform, cats-one, Desktop or App
release. Coordinate a consumer only when the delivered compatibility contract or
chosen minimum version requires it. See the
[cross-repository release guide](https://github.com/cats-inc/cats-one/blob/main/docs/release-guide.md)
for all targets and the distinction between package versions, Git tags and npm
dist-tags.

| Item | Current source or behavior |
| --- | --- |
| npm identity | `@cats-inc/cats-runtime`; the unscoped name is not this repo's release target |
| Version | Root `package.json`, `package-lock.json.version` and `package-lock.json.packages[""].version` |
| Branch push / merge | Configured CI only; no npm publication |
| Release preflight | [release-preflight.yml](../.github/workflows/release-preflight.yml); runs the gate without publishing |
| npm publication | Manually dispatch [npm-publish.yml](../.github/workflows/npm-publish.yml) |
| npm channel | Explicit `dist_tag=latest` or `next`; the workflow defaults to `next` |
| Git release tag | Not required for npm publication |

## Version selection and migration gate

Follow the [cross-repository compatibility policy](https://github.com/cats-inc/cats-one/blob/main/docs/release-guide.md#compatibility-and-data-upgrades).
Breaking HTTP/CLI, user-authored configuration or persisted-data contracts move
`0.x` to its next minor; stable `1.x+` public contracts use a major bump. Compatible
fixes use patch; compatible features may use minor. Schema numbers do not directly
determine package versions. A tested transparent internal migration can preserve
compatibility; simply rejecting an old user file cannot.

The catalog schema-2 cutover sets the next authorized Runtime release boundary at
`0.2.0`. Do not continue `0.1.x` as if existing schema-1 profiles were compatible.
Shipping requires the owning Runtime to handle recognized data upgrades with
complete validation, backup, atomic replacement, idempotent restart and explicit
failure diagnostics. Test clean and existing profiles; a version bump or a note
asking users to repair their files is insufficient. Do not add legacy execution
fallbacks or overwrite unrecognized data to make startup appear successful.

## Prepare and publish

### Release notes — 0.7.0 on npm (2026-11-17)

- npm `@cats-inc/cats-runtime` moves from 0.6.2 to 0.7.0. It carries everything
  merged since npm 0.6.2 (2026-10-30), #204 to #243. The lost provider session
  change below alters HTTP behavior for existing calls, so this is the next 0.x
  minor.
- **Lost provider sessions are reported, not retried** ([ADR-006 rule 8](decisions/006-agent-backend-and-shared-runtime-contracts.md#2026-11-11-amendment-report-a-lost-provider-session-instead-of-replacing-it)).
  When Grok (streaming JSON or hosted ACP), Claude Code or Codex answers that the
  session's native session cannot be resumed, the session is marked
  `provider_session_unavailable` and closes for good; a turn that saw the answer
  streams an `error` event with that `code` and records `errorCode` (#214). A
  Codex thread the user archived (#218), a Kimi session that is missing or was
  created under another directory (#224), and hosted Kimi's `Unknown sessionId`
  (#225) are reported the same way. The marker persists across restarts, the
  worker pool refuses to spawn the session, and messages, resume and explicit
  native fork answer HTTP 410 with the code. The default fork falls back to a
  context transplant, `sessionKey` reuse skips the session, and reset clears the
  marker with the stale id. Callers continue in a new session with their own
  handoff. See [Provider session unavailable](api.md#provider-session-unavailable).
- **Compatibility boundary.** A send that used to leave the session `ready` after
  this in-stream error now closes it, and the next send or resume answers 410
  instead of 200 or 400. A caller that treated 410 as "resume and retry" would
  now get a second 410. The additive fields (`code`, `errorCode`,
  `providerSessionUnavailable`) need no data migration; existing sessions load
  unchanged. This HTTP behavior change requires the next 0.x **minor**, 0.7.0.
  Cats Desktop (cats-platform#398) and Cats Bot (cats-bot#139) continue such a
  conversation in a new session.
- **Kimi Code CLI** ([ADR-054](decisions/054-drive-kimi-code-through-print-mode-stream-json.md)).
  - A new `kimi` CLI provider, ordered after Pi and before Kiro, runs
    `kimi --output-format stream-json --prompt` for each turn and resumes with
    `--session` (#224). Print mode runs in Kimi's `auto` permission mode and has no
    effort control. A turn is limited to 30 minutes by default
    (`CATS_KIMI_TURN_TIMEOUT_MS`), usage and served models come from the session's
    `wire.jsonl`, and processes Cats starts get `KIMI_CODE_NO_AUTO_UPDATE=1`. The
    catalog lists the six managed `kimi-code` aliases with no default row. Runtime
    lists Kimi's native sessions (`/kimi/sessions`), reads their transcripts and
    deletes them through Kimi's own ACP `session/delete`.
  - A `kimi` instance with `protocol: hosted` runs `kimi acp`, so each tool call,
    including the `kimi-cu-win` computer-use plugin, Bash and Write, asks the host
    first (#225, #226). Runtime admits a prompt only after Kimi confirms the
    `default` approval mode and the requested model, and stops a session that
    moves to any mode other than `default` or `plan`. Kimi's session start-up may
    take 45 s, and its own plan errors are kept. Provider selection offers this
    target as the `kimi/cli/hosted` template; print mode stays Kimi's default
    instance (#232).
  - Real-plan turns ran on Windows with Kimi Code 2.6.0. macOS, Linux, WSL and
    Docker runs are not verified; the WSL and Docker session store is tested with
    a fake shell runner.
- **One-time approvals** ([ADR-055](decisions/055-let-the-owner-grant-computer-use-shell-and-file-approvals-once.md), #230, #232).
  An `accept` answer may carry `standingGrant` (`{until:'session'}` or
  `{until:'time', durationMs}`, 1 minute to 24 hours) for computer use, shell
  commands or file writes. Only a send with `standingGrants: true` on
  `POST /sessions/:id/messages` uses a grant; Runtime then answers a matching
  prompt with its one-action choice, and hosts see it `resolved` with reason
  `standing_grant`. Hosted ACP tags `execute`, `edit` and Kimi's computer-use
  tools, and targets advertise their categories in `interactions.standingGrants`.
  Codex, Claude Code and Muse prompts stay per call. Grants live in memory and end
  on revoke, expiry, session removal or Runtime restart.
  `DELETE /sessions/:id/interactions/grants` revokes them, and
  `GET /interactions/grants` lists every session that holds one.
- **Hosted native tools for Muse, Grok and Antigravity** ([ADR-049](decisions/049-use-native-control-protocols-for-hosted-provider-tools.md), #208).
  An explicit `protocol: hosted` CLI target runs Muse MSP, Grok ACP or
  Antigravity's separate ACP executable with native file and command tools and
  live approvals, under an explicitly admitted full machine and network ceiling.
  Session MCP stays disabled for Antigravity, and its native acceptance is not
  claimed. Existing targets and bounded media execution keep their contracts.
- **Catalog bases** ([SPEC-045](specs/SPEC-045-catalog-bases-per-channel-region-and-plan.md),
  [ADR-056](decisions/056-offer-one-basis-selector-over-captured-catalog-bases.md), #234, #235, #243).
  A CLI can carry several captured model lists, one per channel, region or plan,
  inside catalog schema 2 (`basis.id`, `basis.region`, `plan.id`).
  `GET /providers/:provider/models/advanced?basis=<id>` returns `basisId`,
  `bases[]` and `capture`; the MCP `providerAdvancedModels` tool takes `basis`;
  `catalogCapabilities.catalogBases` is `true`; and `modelSelection` and
  `modelResolution` carry `basisId`. An unknown basis answers 400
  `catalog_basis_unknown` on the advanced read, `POST /sessions` and fork, and is
  never switched. For a Kimi target with several bases, Runtime marks the one its
  non-secret region marker matches as `detected` without applying it to a
  request. Playground gains a "List basis" select for targets with two or more
  bases, and shows the basis information icon it used to drop. Kimi's scope
  records the `global (kimi.ai)` region as its only basis, so saved selections are
  unchanged.
- **Media from immutable references** ([ADR-053](decisions/053-extend-media-receipts-with-immutable-references.md),
  [SPEC-044](specs/SPEC-044-reference-media-generation.md), #221, #222). Media
  contract 3 uploads immutable sources and generates images and short videos from
  them through Grok `image_edit` and `image_to_video`; a video source supplies its
  middle frame. Contract 2 requests and receipts are unchanged. FFmpeg and FFprobe
  are optional and loaded on first use. Without them Runtime still starts and
  serves images and image references; video generation profiles are left out of
  capabilities, and a video source answers 503 `media_decoder_unavailable`.
- **Session close and Windows processes** (#211, #237, #239 to #242).
  - Close, reset and delete wait, bounded at 6 s, for the provider process to
    stop, including Kimi Code and Junie per-turn processes and a worker that is no
    longer active. Meanwhile the session reads `closing` and a concurrent delete
    answers 409. Sandbox removal retries transient Windows errors; a removal that
    still fails answers `deleted` with `workspaceCleaned: false`.
  - On Windows, every CLI Runtime starts, including a `.cmd` shell proxy and the
    per-turn Kimi Code and Junie processes, is ended with its process tree
    (`taskkill /T /F`). Image runs, Kimi turns and the quota readers share one
    process-tree helper.
  - Legacy ephemeral CLI workers separate the first-event budget (30 s) from
    provider silence after initialization (120 s, reset on progress), set with
    the new `CATS_RUNTIME_MESSAGE_IDLE_TIMEOUT_MS`. Explicit timeout overrides keep
    their behavior.
- **Codex** (#215, #220). `POST /sessions` accepts
  `providerSessionPersistence: ephemeral` on targets that advertise it, so
  internal jobs leave no saved Codex thread; an ephemeral session cannot be
  resumed, forked or respawned. Unnamed persistent threads get a recognizable name
  from `sessionLabel`, and native user names are kept. Turn instructions reach
  Codex as acknowledged native developer items instead of a prefix on the user
  message.
- **Managed plugins** (#219). The `desktop-preview` host policy lets Desktop
  preview install Agency Agents into an ordinary profile, and a still-enabled
  generation is restored after a clean restart. Shutdown drains native
  process-close callbacks within a bounded timeout, so normal exits no longer
  leave false orphan receipts. Managed-plugin schema 1 is unchanged.
- **Setup and discovery** (#212, #213, #223). OpenClaw selection targets accept a
  write-only `authToken`, saved as `auth_token` in the private provider
  configuration; reads report only `tokenConfigured` and `tokenEditable`. A save
  over an unreadable `providers.yaml` first keeps an owner-only
  `providers.yaml.invalid-<timestamp>-<id>.bak` (the newest five are kept) and
  answers 409 if it cannot. Grok discovery waits for the worker's exact native id,
  so a fresh Grok session's next message no longer fails with 409
  `skill_content_profile_conflict`.
- **Catalogs** (#207, #209, #228). Codex adds GPT-6.1 Terra. Copilot adds GPT-6.1
  Terra and Gemini 4 Hydrogen, and shows Auto as Copilot Fusion with the `balance`
  tier. Claude adds Fable 5.2 as `claude-fable-5-2` and flattens the picker's
  "More models" group in picker order. Antigravity adds Gemini 4 Hydrogen and
  Orchestrator (Argon). Muse adds `muse-ember-1.0`. Cursor adds DeepSeek V4.1
  Flash 1017, Gemini 4 Carbon, Gemini 4 Hydrogen and Claude Fable 5.2, and removes
  Gemini 3.7 Flash and Gemini 3.6 Flash. Kimi's six aliases arrive with #224.
- **Repository tooling, not in the package** (#228, #229, #231, #235, #236). The
  maintenance skill's catalog probe compares one named basis, falls back to Muse's
  account cache when MSP serves another list, and checks CLI sign-ins without
  opening credential files.
- **CI and documentation only** (#204 to #206, #210, #216, #217, #227, #233,
  #238, and direct documentation commits). `release-preflight` reuses a merged
  pull request's run or an earlier green run of the same tree, and
  `npm-publish.yml` skips its test gate when that preflight passed on the commit
  on main. SPEC-042 (turn-scoped context) and SPEC-043 (text-only sessions,
  including its R10 credential rule) are specifications; nothing in them is
  implemented in this release.
- **Other compatibility.** Everything else is additive or a fix. Callers that do
  not send the new fields (`basis`, `basisId`, `standingGrant`, `standingGrants`,
  `providerSessionPersistence`, `authToken`) or contract 3 requests keep their
  behavior. Changes existing calls can see: close, reset and delete take up to
  6 s while a process stops, with a `closing`/409 window for a concurrent delete;
  silence within a legacy ephemeral CLI turn defaults to 120 s instead of the
  30 s startup budget; and a provider selection save answers 409 when it cannot
  back up an unreadable `providers.yaml`. Catalog schema 2, existing catalogs,
  overrides, saved selections, configuration files and stored sessions load
  unchanged. No new migration is required, and the existing validated upgrades,
  backups and recovery remain in force. Before a downgrade, drain active contract
  3 media work; an older Runtime also rejects an override that uses `basis.id`,
  `region` or `plan.id`.
- **Optional FFmpeg packages.** npm installs the optional `ffmpeg-static` 5.3.0
  (license GPL-3.0-or-later; its install script downloads FFmpeg) and
  `ffprobe-static` 3.1.0 (package license field MIT; about 350 MB of prebuilt
  FFprobe binaries for darwin arm64/x64, linux ia32/x64 and win32 ia32/x64). The
  Runtime tarball contains no FFmpeg or FFprobe file (1,553 files, 10.6 MB
  unpacked, in #243's `npm pack --dry-run`), and Desktop ships neither package
  (ADR-053). Decoding is verified only in repository installs, whose own
  `allowScripts` permits `ffmpeg-static`'s script: Linux x64 in CI, where the MP4
  decode test passes, and Windows in #221's native evidence. In a consumer-style
  install on 2026-11-17 with npm 12.2.1 (`engines` requires npm 12 or newer), npm
  blocked that script because the installing project had not allowed it, so
  FFmpeg stays absent until the installer allows it. That install ran on Linux
  arm64, for which `ffprobe-static` 3.1.0 has no FFprobe binary. Either case
  leaves video unavailable, as above, while images and image references keep
  working. macOS and other consumer installs are not checked.
- **cats-one.** cats-one's `^0.6.2` range excludes 0.7.0, so the launcher keeps
  resolving 0.6.2 until a cats-one release raises it. No cats-one, Platform,
  Desktop or Bot release is selected here.
- **Exact source.** The workflow publishes from `main` at the merged commit of
  this change, which adds only the version fields and this section to main at
  selection, `42fcb9c43426b9b4a7334117056efd8c9be43862`. Its last code change is
  `f5bc6bfb2da2df2209afcd5a0f63162ff407a5ad` (#243).
- **Checks.** Each code PR passed its focused suites and the required
  `release-preflight` check before merge; the PR descriptions record their
  review, native evidence and limits. `npm-publish.yml` reuses a passing
  `release-preflight` run on the exact main commit or runs `npm run release:check`
  itself, then builds fresh artifacts through `prepack` and publishes through the
  npm trusted publisher with provenance. An installed npm consumer upgrade from
  0.6.2 is not exercised beyond those gates.
- **Selected distribution.** npm `@cats-inc/cats-runtime@0.7.0` with explicit
  `latest`. There is no Runtime GitHub Release or Git tag. Publication results:
  the npm registry entry and the `npm-publish.yml` run.

### Release notes — 0.6.2 on npm (2026-10-30)

- npm `@cats-inc/cats-runtime` moves from 0.6.1 to 0.6.2. The version was
  prepared on 2026-10-24 for source bundling only (below) and never published to
  npm, so this npm release reuses it. It carries everything merged since 0.6.1,
  #188 to #202.
- **Provider interactions and session capabilities** ([ADR-048](decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md),
  [SPEC-039](specs/SPEC-039-provider-session-capabilities-and-interactions.md)).
  - A host that negotiates interaction hosting before it creates a session
    receives Codex (#194) and Claude Code (#197) approvals, questions and MCP
    elicitation. Its typed reply returns to the same live request while the
    model turn stays occupied. Replies are bound to the live worker's
    generation, revision and idempotency key. Cancellation, deadlines and worker
    loss invalidate them and leave redacted receipts.
  - Explicit and provider execution policies are admitted only with a verified
    effective policy (#194, #198). `sessionCapabilities` reports admissible
    ceilings, the session's tools and browser integration. Claude Code on native
    Windows admits only `full-access` with network; narrower requests return 400
    `interaction_unsupported` before a worker starts.
  - Codex's native MCP consent arrives as `tool_approval`, and explicitly
    interactive policies make injected session MCP servers ask before each call
    (#202).
  - `POST /sessions`, `/resume` and `/fork` accept `browserIntegration` for
    Claude in Chrome: `true` launches `--chrome`, `false` launches `--no-chrome`,
    and omitting it keeps the user's own default (#200).
- **Media.** Native Cursor image generation with GLM 5.3 / max (#190). Muse
  JPEG output is accepted, and existing source failures are recovered from
  matching native evidence without calling the provider again (#189). The
  bundled image codecs load in the shipped entry (#188).
- **Catalogs.** The sixteen CLI/channel catalogs and the
  `auggie.reasoning_effort` binding of the 2026-10-24 notes below (#191).
- **Codex discovery.** A fresh Codex session no longer adopts an older thread
  from the same folder, and a failed fresh session keeps the provider's
  transcript (#195).
- **Compatibility.** This is a compatible 0.6.x patch. Callers that do not
  negotiate interactions or send the new fields keep their existing behavior
  (SPEC-039 R7). The new routes and fields are additive, and consumers
  capability-gate them before relying on them. Existing request meanings,
  configuration files, catalog schema 2, binding version 1 and stored-data
  formats are unchanged. No new migration is required, and the existing
  validated upgrades, backups and recovery remain in force.
- **Exact source.** The workflow publishes from `main` at the merged commit of
  this change, which adds only this section. Its package contents are those of
  `399e63571be8188fc685ba3925ff47f80a256f27` (#202). Desktop 0.12.2 bundles that
  commit, and Cats Bot 0.3.0 vendors a 0.6.2 tarball built from a source tree
  identical to it.
- **Checks.** Each PR passed its focused suites, independent review and full CI.
  Desktop 0.12.2's release gates started this exact Runtime code in packaged
  hosts. `npm-publish.yml` repeats the full test gate and a fresh build before
  trusted publication with provenance. An installed npm consumer upgrade from
  0.6.1 is not exercised beyond those gates.
- **Selected distribution.** npm `@cats-inc/cats-runtime@0.6.2` with explicit
  `latest`. Platform/Desktop 0.12.3 bundles this source, and cats-one 0.6.0
  raises its Runtime range to `^0.6.2`. There is no Runtime GitHub Release.
  Publication results: the npm registry entry and the `npm-publish.yml` run.

### Release notes — 0.6.2 (2026-10-24)

- Refresh all sixteen configured CLI/channel catalogs from this installation's
  observed lists and pickers: 615 model/family choices, 30 additions, 29 withdrawn
  entries, and seven Junie picker-spelling corrections. Other channels and custom
  model strings retain their existing behavior. Runtime's Playground and Platform
  consume the same schema-2 factory, including per-model options and exact labels.
- Add the `auggie.reasoning_effort` binding and pass `--reasoning-effort` only for
  models whose observed JSON lists effort levels. Preserve literal values, with no
  inferred default or control for unsupported/custom models. Existing sessions
  retain their resolved bindings. Junie Eco remains evidence-only by owner choice.
- This compatible 0.6.x patch keeps catalog schema 2, binding version 1, HTTP/config
  contracts and stored-data formats. No new migration or data reset is required;
  existing validated upgrades, backups and recovery remain in force. Older Runtime
  binaries cannot execute the new binding, so Desktop selects this source revision.
- Focused catalog, adapter, HTTP, Playground and TypeScript checks passed, as did
  all sixteen actual API projections through Platform and all 615 Playground
  choices. An isolated source Desktop candidate built and stopped cleanly. Native
  picker evidence covers Windows only; Junie's unchanged traversal hash does not
  establish an unchanged prelaunch-to-exit settings file. Detailed evidence and
  limitations are in [the refresh record](research/2026-10-24-sixteen-cli-catalog-refresh.md).
  PR/main release preflight enforces the full gate.
- Selected distribution: source bundling in Desktop **0.9.7 standard-profile
  preview**. Platform's original bump PR pins this change's immutable merge SHA;
  the release workflow records identical Runtime identities in each OS/source
  receipt. Expected trust: macOS **signed + notarized**, Windows **unsigned: no
  certificate**, Linux **n/a**. Existing same-profile self-update paths remain
  supported. Usage 0.5.4 keeps its exact artifact pin in Platform. This selects no
  npm, App or cats-one publication. Publication results: Desktop's `v0.9.7`
  GitHub prerelease and its Actions run.

### Prepared release notes — 0.6.1 (2026-10-23)

- Fix the concrete native Cat MCP setup failure found during isolated acceptance:
  a changed descriptor set killed the old worker and immediately spawned its
  replacement, while the old child/Code Mode helper still owned its lifetime.
  The pool correctly refused that overlap. Replacement now waits for complete
  process-stopped confirmation, bounded to ten seconds, before applying descriptors
  and writing input. Pi resume/skill replacement uses the same protocol.
- Cancellation, close, deletion, another spawn and shutdown invalidate pending
  replacements. Unconfirmed stop returns retryable `worker_stop_unconfirmed`
  (503); cancellation returns 409. Capacity/singleton claims remain held until
  the old process lifetime actually ends; the pool guard is not weakened.
- This is a compatible 0.6.x lifecycle fix, with no HTTP request, configuration
  or stored-data format change. All receipt upgrade validation/backups/recovery
  from 0.6.0 remain. Published 0.6.0 package and evidence stay immutable.
- Targeted coverage includes the real WorkerProcess child/helper lifetime,
  captured old handle, cancellation/close/deletion, timeout/abort capacity, and
  MCP HTTP setup before input, plus unchanged-descriptor no-restart. Full hosted
  preflight and native rerun remain required; the failed native probe admitted
  no image. These tests do not claim live Telegram delivery.
- Selected distribution: npm `@cats-inc/cats-runtime@0.6.1`, explicit `latest`,
  and the coordinated Desktop 0.9.3 standard preview. Desktop pins this fix's
  immutable merge SHA in its original release preparation and source receipt.
  Existing trusted npm publisher/provenance and standard Desktop signing remain;
  no Runtime GitHub Release or cats-one release is selected. Verify publication
  in hosted Actions/registry without a later status-only edit.

### Prepared release notes — 0.6.0 (2026-10-23)

- Image contract 2 exposes provider profiles, configuration/revision checks and
  measured JPEG/PNG output. Enabled generation profiles include Grok, Muse, Codex
  and Antigravity, with the runner bounds and limitations in SPEC-038/PLAN-048.
  The changed HTTP request/capabilities contract is the next 0.x minor boundary.
- Controlled Cat generation can identify its original source session through
  optional host-owned `sourceSessionId`. `sourceSessionYield` advertises bounded
  handoff: only that idle source may give up its singleton or last pool slot.
  Other conversations are never evicted. A busy source is refused before image
  execution; unknown stop outcomes keep the capacity claim until process-stopped.
  Captured old handles cannot restart or write after retirement. Observe now
  reports `turnInFlight` separately from registry readiness.
- Existing schema 2 receipts need no conversion. Recognized schema 1 image receipts
  use the existing validated, backed-up, atomic upgrade with repeat-start and
  failure recovery; unknown or damaged data is preserved and refused. Catalogs,
  credentials and user workspaces retain their current upgrade paths.
- Focused worker/request regression: 32 passed, including delayed helper closure,
  abort claims and unrelated singleton protection. The observe route integration
  test also passed. Independent review found no remaining handoff blocker.
  PR release-preflight and npm publication repeat the full release gate; publication
  and live Cat/Telegram acceptance are not claimed by these fixture results.
- Selected distribution: npm `@cats-inc/cats-runtime@0.6.0`, explicit `latest`, and
  source bundling in the coordinated Desktop 0.9.3 **standard** preview. The
  immutable merge commit is the Runtime source pin selected by Desktop; its hosted
  source receipt records the same SHA. npm uses its existing trusted publisher and
  provenance; Desktop retains standard per-platform signing. No Runtime GitHub
  Release or cats-one version is selected. Hosted Actions/registry/source receipts
  supply publication evidence without a later status-only documentation commit.

### Release notes — 0.5.4 (2026-10-23)

- **Studio images report a full worker pool and the default pool grows to 50** (#181).
  - Idle chat workers count against `maxSessions` and are not reclaimed. Before, ten
    idle conversations made every image fail with `image_service_busy`.
  - A full pool now fails the attempt as `runtime_capacity_full` before any CLI starts.
  - The `CATS_RUNTIME_MAX_SESSIONS` default rises from 10 to 50 (owner request). An
    explicitly configured value is kept.
  - Reclaiming idle workers for bounded operations remains a separate design item.
- **`DELETE /media/images/jobs/:id` removes a receipt directory with its image** (#182).
  Platform uses it for owner deletion.
  - An attempt still live in this process gets 409 `image_not_deletable`.
  - A missing receipt counts as already deleted.
  - Deletion never starts, retries or recovers an attempt.
- **Studio image generation uses `grok-4.7` with `xhigh` effort** instead of
  `grok-4.7-build-fast` at `low` (7850471a). Execution stays one round,
  `image_gen`-only, with unchanged collection bounds.
- **New provider selections get the documented per-instance timeouts** (#180, #183).
  - Antigravity native instances get 120 seconds, Copilot 60 seconds and Muse 60 seconds.
  - Retained and explicitly configured targets keep their values.
  - The underlying Muse/Antigravity idle-event investigation (#178) is still open.
- **Compatibility.** HTTP routes are added and none are changed. Configuration files,
  receipts and catalogs keep their formats, so this is a compatible 0.5.x patch with
  no data migration.
- **Distribution.** Source bundling is selected for the Desktop 0.9.2 standard-profile
  preview. Its preparation pins this bump's immutable merge commit across OS builds
  and the complete source archive. No Runtime npm or cats-one release is selected.
- **Validation.** Each change passed its focused suites and required PR
  release-preflight. This preparation changes only version fields and notes. Its PR
  release-preflight and the Desktop packaging workflow enforce the release checks.
  Publication results: Desktop
  [`v0.9.2`](https://github.com/cats-inc/cats-platform/releases/tag/v0.9.2) and its
  workflow run.

### Release notes — 0.5.3 (2026-10-20)

- Refresh five factory model catalogs (#172). Antigravity 1.4.2 adds Gemini 4
  Argon with a low/medium/high effort control as its first entry, in picker
  order, so a fresh agy selection starts at Gemini 4 Argon low; Argon execution
  was not exercised. Codex 0.163.0 raises gpt-6.1-sol's context limit from 272000
  to 500000. Grok 1.0.62 starts sessions at a 256000 window, so its four limits
  move from 500000 to 256000; its 500K window can be chosen only in the Grok TUI,
  and Cats has no window control (#173). Claude 2.1.303 and Muse 1.4.10 keep
  their rows, efforts and defaults.
- Saved selections and existing sessions keep their resolved models. Profiles
  without a catalog override adopt the new factory; an operator override keeps
  its own scopes. Catalog schema 2 and `CATALOG_BINDING_VERSION` 1 are
  unchanged, so this is a compatible 0.5.x patch with no data migration.
- The repository-only catalog skill gains a read-only CLI sign-in checker,
  `npm run catalog:logins` (#171). It is not in the npm package or Desktop.
- Source bundling is selected for Desktop 0.8.3 standard-profile preview. Its
  preparation pins this bump's immutable merge commit across OS builds and the
  complete source archive. No Runtime npm or cats-one release is selected.
- The catalog refresh passed catalog generation/check, probe validation of all
  five scopes, the catalog data/runtime, model, Playground, runtime-server and
  skill-sync suites, the skill script tests, typecheck and its PR
  release-preflight. This preparation changes version fields and notes; its PR
  release-preflight and the Desktop packaging workflow enforce the release
  checks. Publication results: Desktop
  [`v0.8.3`](https://github.com/cats-inc/cats-platform/releases/tag/v0.8.3) and its
  workflow run.

### Release notes — 0.5.2 (2026-10-15)

- Fresh Dashboard session and Playground Add Agent pickers use the first
  configured/selectable provider in canonical order, Codex first, instead of
  preselecting Claude. Explicit current/saved selections and starter team roles
  remain intact; Playground retains its availability ordering.
- Include the Grok/Muse CLI-only quota collectors: Grok billing is connected but
  the current authenticated response lacks subscription allowance numbers and
  stays unavailable. Muse native Windows plus existing Git winpty supplies
  Current/Weekly percentages from an unlogged Turns 0 TUI. Optional resetLabel
  preserves native text without an invented reset instant or window duration.
- Compatible 0.5.x patch; configuration and persisted formats are unchanged,
  with no data migration. Existing sessions and HTTP/ACP execution defaults are
  preserved. Quota reads do not create model turns or execution history.
- Source bundling is selected for Desktop 0.8.2 standard-profile preview. Its
  preparation must pin this bump's immutable merge commit across OS builds and
  the complete source archive. No Runtime npm or cats-one release is selected.
- The default-picker regression tests and existing provider/Playground tests
  passed (32 focused cases). Grok/Muse live CLI → HTTP → host and quota tests
  passed in their implementation slice. Required PR release-preflight and
  Desktop packaged-source/App/startup gates enforce the release checks.
  Expected Desktop tag: `v0.8.2`. Use its Actions run and Release assets to verify
  completion after dispatch. Muse macOS/Linux/WSL/Docker quota queries remain unsupported.

### Release notes — 0.5.1 (2026-10-14)

- Add native Kiro V3 account quota reads through CLI-owned ACP authentication,
  without a session or model turn. Preserve fractional credits, unknown limits
  and calendar-only reset dates; bonus/add-on billing remains unmapped.
- This is a compatible patch within 0.5.x: configuration and persisted formats
  stay compatible, so no data migration is required. Snapshot schemaVersion 1
  gains optional `resetsOn` rather than an invented reset instant.
- The owner selected source bundling in Desktop 0.8.1 standard preview. No Runtime
  npm publication or cats-one release is selected. Desktop preparation pins the
  immutable merge commit of this bump across every OS and the source archive.
- The Kiro implementation passed 66 focused tests, native Windows live validation
  and its full PR release-preflight. This preparation changes version fields and
  notes; its existing PR gate and Desktop packaging workflow enforce validation.
  Publication results: Desktop
  [`v0.8.1`](https://github.com/cats-inc/cats-platform/releases/tag/v0.8.1) and its
  workflow run. Native macOS/Linux quota login remains unverified locally.

### Release notes — 0.5.0 (prepared 2026-10-14)

- **Kiro runs on its V3 headless engine (minor boundary).** Each turn runs
  `kiro-cli chat --no-interactive --agent-engine v3 --output-format stream-json`
  and resumes by session id from any directory, with tool, reasoning, model,
  effort and credit events ([ADR-045](decisions/045-drive-kiro-through-the-v3-headless-engine.md)).
  Sessions are read from Kiro's V3 store: `sessions_dir` in `providers.yaml` and
  `KIRO_SESSIONS_DIR` replace `db_path` and `KIRO_DB_PATH`. The old keys are
  ignored, not migrated, because they named a file Runtime no longer reads;
  Kiro sessions kept only in the older SQLite store are no longer listed. Kiro
  CLI 2.30.0 is the first verified release; older releases fail with Kiro's own
  error. Headless Kiro denies tool calls that need approval, so `default` mode
  means deny rather than ask. Replacing user configuration keys is why this is
  0.5.0 rather than a 0.4.x patch.
- **Every CLI has a full model catalog.** Cursor, OpenCode (`opencode-go`), Kilo
  (its gateway list), Cline (`cline-pass`) and Devin moved from six-model
  shortlists to complete lists, with per-model Variant, thinking-level, effort,
  speed or parameter controls where the CLI offers them. The eleven existing
  full catalogs were refreshed to this machine's CLI versions, Goose moved to
  its full `chatgpt_codex` channel with its thinking-effort menu, and Kiro's
  per-model effort defaults come from its V3 engine. New bindings keep
  `CATALOG_BINDING_VERSION` at 1; catalog schema 2 is unchanged. Repeated
  catalog loads in one process now reuse the parsed factory.
- **Setup and Playground.** Providers appear in one display order everywhere,
  and the Playground presets start with four agents (Codex, Claude,
  Antigravity, Grok) or twelve in that order.
- **Compatibility and release scope.** Apart from the Kiro configuration keys,
  public APIs, configuration contracts, catalog schema 2 and persisted formats
  are unchanged; no data migration is required. Runtime 0.4.1 was never
  published to npm but was bundled by Desktop 0.7.10 to 0.7.14 from
  `f64f347d2820a08fc24b4e82448c69542fc88771`, so this source takes a new version.
  The owner selected npm `latest` and the Desktop 0.8.0 standard preview, which
  bundles the merged commit of this preparation, together with Platform npm 0.8.0
  and cats-one 0.5.0, whose Runtime range moves to `^0.5.0`.
- **Validation.** The merged changes passed their pull-request release
  preflight; this preparation changes only version fields and these notes. The
  publication workflow runs `npm run release:check` before trusted publication.
  Publication results: the npm registry entry and the `npm-publish.yml` run.

### Release notes — 0.4.1 (prepared 2026-10-04)

- **Current provider catalogs.** Antigravity 1.2.16 now offers Claude Opus 5.5
  and Sonnet 5.5 with low, medium and high effort. The owner approved removing
  the two withdrawn Claude 4.6 Thinking families. The complete picker and model
  list confirm seven families and eighteen executable IDs. Intervening catalog
  updates also cover Junie, Copilot, Auggie, Kiro and Pi.
- **Less repeated catalog maintenance.** Probe and offline validation write a
  compact agent handoff containing actionable scopes, retained evidence and
  exact next commands. Permission failures remain operator actions; degraded
  sources cannot falsely confirm rows or invalidate acknowledgements. A guarded
  Antigravity picker helper captures visible controls without running inference.
- **Compatibility and release scope.** This is a compatible patch within 0.4.x:
  public APIs, configuration contracts, catalog schema 2 and persisted formats
  are unchanged, so no data migration is required. The owner selected source
  bundling in Desktop 0.7.10 standard preview, not npm publication. Desktop's
  release preparation records the exact merged Runtime commit and retains its
  existing App pins and standard signing profile.
- **Validation.** Catalog generation and boundary checks, 76 focused catalog/
  Antigravity tests, one HTTP consumer test, 21 Playground tests, 39 probe tests through their CI
  hook, three picker-helper guards and type checking passed. Independent review
  has no remaining findings. The signed-in Cursor follow-up confirms all six
  curated families and leaves no agent or operator actions. Full release
  preflight remains the PR gate; publication verification belongs to the
  Desktop workflow and its public assets.

### Release notes — 0.4.0 (prepared 2026-09-30)

- **Explicit remote listening required.** An API key no longer changes the default
  listener from `127.0.0.1` to every interface. Existing remote deployments that only
  set `CATS_RUNTIME_API_KEY` must also set `CATS_RUNTIME_HOST=0.0.0.0`, `::`, or their
  chosen interface address. A non-loopback bind logs a startup warning. Loopback
  Desktop/Platform clients and persisted data are unchanged. This breaks an implicit
  configuration contract, so do not ship it as a 0.3.x patch. See the
  [deployment instructions](deployment.md#listener-exposure-next-minor-040).

### Published versions

Runtime **0.4.0** was published on 2026-09-30 (Taipei) to npm `latest` from
`2f167ad5f8d2e787de804bbd1c4bf069b9f9c433`, and is selected for bundling in the Desktop
**0.7.0** standard-profile preview; the owner authorized both together with Platform npm
0.7.0, Usage 0.5.1, Studio 0.2.1 and cats-one 0.4.0.
It is a **minor** because the listener default changed: an API key no longer implies
binding every interface (see the 0.4.0 release notes above and
[deployment](deployment.md#listener-exposure-040)). Everything else since npm 0.3.2 is
compatible: session MCP servers on create, resume and send, configured for Claude Code
and Codex; managed Agency skills with durable revocation; served-model reporting for
Claude, Copilot, Grok, Codex, Pi, Kiro and Junie; bounded native Grok image jobs;
the Junie stdin/UTF-8/failure fixes; Kiro v1 engine selection; the catalog basis field;
the 0.3.3 and 0.3.4 Desktop-only fixes; privacy and deletion hardening (access logs
without query strings, staged deletion with retry fences, atomic registry snapshots
written `0o600`, bundle third-party notices); dashboard dependencies vendored with
integrity checks; and the `author` field. Catalog schema 2 and persisted formats are
unchanged; no data migration is involved. cats-one's `^0.3.1` range excludes this
version, so the launcher moves to `^0.4.0` in its own release. The
[publication workflow](https://github.com/cats-inc/cats-runtime/actions/runs/36608425703)
passed its release gate, fresh build and trusted publication, and recorded a Sigstore
provenance statement ([transparency log 3003568317](https://search.sigstore.dev/?logIndex=3003568317)).
Verified after propagation: npm `latest` = 0.4.0, `gitHead` equals the source commit,
`author` is the individual maintainer, the downloaded tarball's SHA-1
`4269b67da29a38ff2ee15e06cbf28e09f78f99d2` matches the registry, and the tarball ships
`LICENSE`, the new favicon and the pinned vendored dashboard scripts. A fresh private
prefix installed it and the `cats-runtime --help` entry point ran. The registry
document lagged the successful publish by a few minutes; no repeat publication was made.

Runtime **0.3.4** shipped on 2026-09-28 (Taipei) in the
[Desktop **0.5.10** standard-profile preview](https://github.com/cats-inc/cats-platform/releases/tag/v0.5.10),
which bundles `0804e238e1c9b6a29c3357301336400ea4e3ac64` on every OS. It is not
published to npm; npm `latest` stays `0.3.2`. This compatible patch fixes turns whose
result arrives after the provider's process exits: the session stream now delivers Auggie's
and Kiro's result before closing, and a turn that ends without a result or error is completed
instead of leaving its run running. Kiro sessions are read from Kiro 2.24's
`~/.kiro/sessions/cli` store as well as its database. Junie rows execute as the setting IDs
its `--model` accepts instead of picker names. A request Pi ends with an error, such as a
model the account's plan does not include, is reported as a failure with Pi's message, and
failed launches keep the first stderr lines. No configuration, persisted-data or catalog
schema contract changes; no migration or cats-one minimum is required.

Runtime **0.3.3** shipped on 2026-09-28 (Taipei) in the
[Desktop **0.5.9** standard-profile preview](https://github.com/cats-inc/cats-platform/releases/tag/v0.5.9),
which bundles `d061e9b35bb527633d8448274b8fa6c13ffb8851` on every OS. It is not
published to npm; npm `latest` stays `0.3.2`. This compatible patch fixes Windows
provider launches whose multi-line or quoted prompts were cut short by `cmd.exe` or
Windows PowerShell 5.1: npm shims with an extensionless node script (Cline, Kilo),
Cursor's `cursor-agent.cmd` and Junie's `junie.bat` now resolve to the program they
would have run. It also stops Cursor segments before a tool call from appearing twice,
removes OpenCode's withdrawn Union Alpha Free from the shortlist, and logs each run's
provider, model, outcome and error. No configuration, persisted-data or catalog
schema contract changes; no migration or cats-one minimum is required.

Runtime **0.3.2** was published on 2026-09-28 (Taipei) to npm `latest` from
`9fefd8e41512f200de6b7d4f1ed93fb7aa5e4dcb`; the Desktop **0.5.8** standard
preview bundles that exact commit on every OS. This compatible patch adds the
intervening Junie, Kiro, Auggie, Copilot
and Pi catalog updates, verified read-only/managed-worktree skill delivery, and
truthful Codex native sandbox/bootstrap diagnostics. Codex development can now
stop with an actionable diagnostic when the actual provider permission mode
cannot satisfy the admitted worktree grant; it does not silently claim that
requested sandbox permissions were applied. Catalog schema 2, existing model
identities and public configuration/data contracts remain compatible; no new
migration or cats-one minimum is required. Independent compatibility review and
the paired preview/release skill-distribution check passed. The
[publication workflow](https://github.com/cats-inc/cats-runtime/actions/runs/36350009873)
passed its full gate (2,510 tests passed, five skipped, none failed), fresh build
and trusted publication. Public npm `latest`, version, source commit and downloaded
tarball SHA-512/SHA-1 are verified. The source
[release preflight](https://github.com/cats-inc/cats-runtime/actions/runs/36349953652)
also passed. npm's initial processing delay resolved without a repeat publication.
The downloaded public tarball passed installation into a fresh private prefix,
the shipped CLI help entry point, and its actual release-profile catalog: 33
skills with no physical preview supplement. The paired Platform package's English
and Traditional Chinese knowledge consumers also passed without provider calls.

Runtime `0.3.1` is prepared for the Desktop `0.5.1` standard-profile preview and for
npm publication on `latest`. It is a compatible patch. Writable startup now retires
factory copies that earlier Desktop builds seeded (PR #91): an unmodified copy, or an
untouched conversion of one, is backed up and removed so the current factory applies.
Edited files keep the existing upgrade behavior. This fixes upgraded installations
that kept old model menus or reported that catalog settings need attention. It also
includes the Claude and Muse catalog refreshes (PRs #87 to #90), Claude session
grouping by recorded cwd, and hidden native Windows Codex launches (PR #92). There is
no new schema or execution binding. `0.3.0` was never published to npm, but Desktop
`0.5.0` bundled it from different source, so this release takes a new version instead
of reusing it. Published on 2026-09-26 from `e202eaf4037c648c73caa52c9a9d441793b2df71`:
npm `latest` is `0.3.1` ([workflow](https://github.com/cats-inc/cats-runtime/actions/runs/36183579493)),
and Desktop 0.5.1 bundles the same commit on every OS. cats-one 0.2.0 requires `^0.3.1`.

Runtime `0.3.0` is prepared for the Desktop `0.5.0` standard-profile preview. It is
the minor boundary for the preview-content isolation and retained-context policy
(PR #85): release execution no longer resumes retained contexts whose release
compatibility cannot be established. Existing data is retained unchanged; affected
release execution requires a fresh verified context, so no data migration applies.
Desktop previews stage the `runtime-skills/preview` development supplement, which
npm excludes. The complete implementation passed release preflight at
`d2d12db3f6674e3e82a21d8fae7bd496cdf1e298`. This preparation does not publish
Runtime to npm.

Runtime `0.2.1` prepares the [Codex 0.156.1 catalog refresh](research/2026-09-24-codex-picker-pilot.md)
and reusable picker-capture workflow. This compatible patch retains schema 2 and the existing
upgrade contract; no data migration or new execution binding is required. The version bump and
PR do not publish npm or a Desktop preview.

Runtime `0.2.0` is prepared for the Desktop `0.4.0` preview's catalog upgrade
validation. The complete pre-bump implementation passed release preflight at
`231abff3231ab8a0e3fb4df5c77de13ff33cff02`. Pin the prepared Runtime commit in the
Desktop workflow. This preparation does not publish Runtime to npm.

1. Select the intended source and npm channel, and integrate remote changes without
   discarding other work. Check the registry before choosing an unused version.
   An already prepared, unpublished version can be reused; published versions
   cannot be overwritten with new bytes.
2. Synchronize the root manifest and both root lockfile version fields. Update
   them directly or use `npm version <version> --no-git-tag-version`; an npm-only
   release must not create a Git tag as an incidental bump side effect.
3. Follow [local validation scope](../AGENTS.md#local-validation-scope) for changed
   behavior. The publication workflow runs `npm run release:check`; do not duplicate
   the full suite locally solely because a version is being bumped or published.
   The optional preflight is useful when release readiness needs to be established
   before publication, not an additional mandatory duplicate run.
4. Commit/push using the user's authorized Git workflow. Pushing the version files
   is preparation, not publication. Dispatch the selected source separately:

   ```sh
   gh workflow run npm-publish.yml --repo cats-inc/cats-runtime --ref main -f dist_tag=latest
   ```

   `--ref main` publishes the commit selected from main at dispatch time. Use the
   intended release branch when main contains work outside the selected release.
   Use `next` only for the chosen prerelease channel.
5. Confirm the workflow succeeded, then verify the registry and tarball:

   ```sh
   npm view @cats-inc/cats-runtime@latest version dist.tarball --json
   ```

   Substitute the chosen dist-tag. Registry propagation can lag a successful
   publish; verify availability rather than dispatching another attempt to
   overwrite the same version. A pending workflow is not a completed release.

The workflow installs dependencies, runs the full release gate and uses the
configured npm trusted publisher. The package's `prepack` builds the published
artifacts. Trusted publication is the established release path, not future setup;
do not introduce a separate local-login/token flow for routine releases.

## Package and consumer boundary

The package supplies the `cats-runtime` executable at `build/runtime/index.js`.
Its manifest controls the published files, including built Runtime code, web
assets, runtime skills and configuration examples. Hosts use the process/HTTP
boundary; the root JavaScript export is not a supported product source-import
contract.

Install or launch the scoped package:

```sh
npm install -g @cats-inc/cats-runtime
cats-runtime
# Or launch without a global installation:
npx @cats-inc/cats-runtime@latest
```

The package ships its necessary examples. Missing user provider configuration
enters bootstrap; saving the provider selection writes the active configuration.
Management and curated catalogs can use bundled defaults without copying every
example into the user's configuration directory.

Use the existing pack/install helpers under `scripts/windows/`, `scripts/macos/`
or `scripts/linux/` when packaging, install behavior or entrypoints changed.
Choose verification that covers the changed contract; do not repeat full startup
exercises for documentation or a version-only edit. See
[deployment](deployment.md) and [testing](testing.md).

When changing the catalog schema or loader, include an isolated **existing-profile
upgrade** using the previous shipped catalog format. Verify rejection diagnostics,
the backed-up conversion/apply/reload path, and basic/advanced model reads with one
revision. A clean-profile package smoke is insufficient. For a known operator
installation, inspect its selected package/profile read-only and prepare any needed
conversion before reporting upgrade readiness. Obtain any required personal-file
authorization before applying it; release notes alone do not complete migration.

## Coordination with other release targets

- If an authorized cats-one release requires a new Runtime minimum, publish that
  Runtime version and confirm it is downloadable before changing the launcher's
  dependency range and resolving its lockfile from npm. Already published
  dependencies need no repeat release.
- A newer Runtime patch within cats-one's existing range does not require a
  cats-one bump. Fresh consumers may resolve it; existing installations/caches
  are not an automatic update mechanism.
- Desktop bundles an identified Runtime source checkout. Publishing Runtime to
  npm is not a prerequisite for a Desktop preview or official release. Platform
  owns Desktop source selection, packaging, versioning and publication.
- Apps are independently versioned artifacts owned by cats-apps. A Runtime change
  does not bump App versions or change Desktop's selected App artifacts.

*Last updated: 2026-10-14*
