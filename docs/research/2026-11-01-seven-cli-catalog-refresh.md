# 2026-11-01 seven CLI catalog refresh

Mode: refresh. Interaction policy: confirm uncertainty. The owner narrowed the original
sixteen-provider request to Codex, Claude, Antigravity, Grok, Muse, Cursor and Copilot before
catalog edits. All other CLI/channel, API and local scopes remain unchanged. Runtime owns
the factory consumed by Playground, Platform and Bot; Bot offers only Codex, Claude,
Antigravity, Grok and Muse, in that order. No model table or binding was added to code.

## Evidence and delta

Native Windows 11, existing machine sign-ins, 2026-11-01 UTC+8. Account identities, credentials
and endpoints are excluded from fixtures. Private acquisition/checkpoint files are under
`tmp/catalog-refresh-20261101/`. Observations describe this account/machine only.

| Provider | Observed CLI | Entries | Evidence and result |
| --- | --- | ---: | --- |
| Codex | 0.166.0 | 8 | Complete account `debug models` and eight-row picker. New GPT-6.1 Terra is third; six efforts, Low default, context 500000. Its More reasoning submenu contains Max/Ultra; the earlier operator-approved flat projection is retained. Other rows and context values agree. |
| Claude | 2.1.316 | 12 | Complete 13-row picker including Default sentinel, all effort ranges/defaults and all twelve session-only `/status` mappings. No data changes; banner says Claude Ultra. Existing Default-sentinel and pinned Fable choices are retained. |
| Antigravity | 1.4.12 | 5 | Complete `agy models` confirms thirteen executable variants. Existing picker families, sliders/order and descriptions keep their earlier provenance. |
| Grok | 1.0.70 | 4 | Complete model list and reread CLI-owned account cache confirm labels, per-model efforts/descriptions and context 256000. Existing first-value/no-default policy is retained; alternative windows remain evidence only. |
| Muse | 1.4.14-R7309.1 | 3 | Complete account MSP `providerCatalog` confirms labels, variants and limits. Prior picker effort provenance is retained. `isDefault` is not projected. |
| Cursor | 2026.10.22-27dcf5f | 49 | Complete parameterized account reply: 46 CLI-filtered families. New DeepSeek V4.1 Flash 1017. Every previous entry, executable variant and control/default remains equal. No combination is guessed. |
| Copilot | 1.0.105 in TUI | 14 retained | Initial and post-login `models.list` returned HTTP 403: `unauthorized: not authorized to use this Copilot feature`. The interactive TUI independently displays the same catalog failure. Existing 1.0.103 catalog/date is unchanged; no freshness claim. |

The owner answered the sign-in question with “I will handle Copilot sign-in locally”, then
confirmed “just logged in”. The targeted retry reused that answer. Both the machine and
interactive surfaces still refused feature access. This is an unresolved upstream account
authorization limitation, not removal evidence. No additional sign-in or inference was attempted.
The minimal refusal record is
`fixtures/copilot-1.0.105/catalog-feature-403.2026-11-01.redacted.txt`.

Supporting rows are in `fixtures/<provider>-<version>/model-list-2026-11-01.probe.redacted.json`,
the Codex Terra picker text, Claude picker/status JSON, Grok projected cache JSON and Cursor
parameterized-model JSON. Every affected scope cites its exact fixtures. Codex hidden rows stay
evidence-only. Existing unobserved metadata and all out-of-scope data are preserved.

Agent-owned observation and decision artifacts were assessed before applying the candidate:
eight changes ready, no confirmation-required/omitted/deferred change; observation gap checks
are empty. There are no removals, new bindings, inferred capabilities or model-default changes.

## Validation and delivery boundary

- `catalog:generate` and `catalog:check` passed. Factory sourceDigest:
  `b9f8c46b2b9add026804082b219a0d3350ab17f264b2c481beb00dc3cfacff64`.
- Same saved six-source probe snapshot revalidated clean (notes only). Claude picker and Cursor
  parameterized evidence cover fields the basic probe cannot verify. Copilot's failed snapshot
  remains separate and inconclusive.
- Focused Runtime: catalog-data 22, catalog-runtime 38, providerModelCatalog 20 passed.
  Playground shared selection/default/agent suites passed another 30 tests (110 total focused
  Runtime tests). No full-suite claim.
  Runtime TypeScript and generated UI build passed after installing existing lockfile dependencies
  in the isolated worktree. Initial sandbox `spawn EPERM` and the main checkout's absent pngjs
  were environment issues; no dependency manifest/lockfile or unrelated test changed.
- Platform server/test-UI builds and four focused consumer suites passed (13 tests). Its original
  shared dependency folder lacked the now-vendored platform-ui-web; isolated `npm ci` fixed it.
  The test bundle emitted a missing mobile Expo base-config warning; selected consumer tests pass.
- A real isolated Runtime served all seven requested basic/advanced catalogs to Platform's built
  normalizers, preserving every ID/label and one revision:
  `b6c938a44667a5a9dc64e3ac28719e583b6fbb4c269816aca416d9eb7430ce30`.
  Bot's model/controls projection also matched the same factory for its five providers.
- A fresh headless Chrome waited for Playground readiness, then checked all 95 choices
  (81 refreshed-provider entries plus Copilot's 14 retained entries), custom input in all seven
  menus, Terra's six efforts and Low default, and round-tripped a synthetic custom string.
  All non-GET browser requests were blocked. No page errors. The first harness sampled too early;
  its corrected run waits on actual readiness and expands the card before interaction.
- Built a local, unpublished Runtime tarball and installed it without saving dependency/lockfile
  changes into Bot's isolated worktree. Bot provider/settings tests and fixture process/HTTP
  interaction integration passed (18 tests). Its installed candidate digest equals the factory.
  This verifies the candidate, not the existing Bot dependency pin or installed applications.
  Bot candidate TypeScript checks and renderer/build passed as well.
- CLI settings hashes stayed equal from before launch through exit for Claude, Codex and Copilot.
  All dedicated CLIs received their normal exit command. Isolated Runtime shutdown drained via
  stdin; no real Cats conversation/task or provider inference was created.

The final old-ID/label consumer search found only retained test inputs and the separate image
media profiles, not an independent selector model table. Historical fixtures and media profiles
remain unchanged; adding a model does not establish image capability.

Publication, installed Desktop/Bot replacement and personal override writes are outside this
source/candidate validation. After the candidate and checks were ready, the owner authorized
`cnr`: commit, push and auto-merged PRs. Bot's tracked Runtime artifact is prepared from the
resulting exact Runtime source commit and pinned by checksum in its own PR. Version bumps,
installed application replacement and release/publication remain outside that authorization.

Independent review found no actionable issue after comparing the retained source/picker evidence,
all 484 Cursor variants and every changed scope. Its `catalog:check` and `git diff --check` passed.
It did not repeat CLI captures, consumer suites or installed-application acceptance.

## Scripts and cost

Existing maintained probe, evidence, Cursor capture, Claude picker/status capture, observation,
normalization and assessment helpers were reused unchanged. No new reusable script was needed.
Private scripts are deliberately excluded from Git because their paths, date, selected new model,
screen positions or fixture shape are specific to this capture:

| Script | Purpose | Reuse verdict |
| --- | --- | --- |
| ui.ps1 | This run's dedicated terminal launch/focus/text/key/snapshot wrapper | Host paths, titles and exact installed binaries; not reusable unchanged |
| codex-terra.ps1 | Navigate from this eight-row list to Terra effort | Row/version-specific; existing general Codex helper remains canonical |
| codex-terra-more.ps1 | Capture this new model's More reasoning branch | Exact menu shape/positions; not a replacement for general helper |
| finish-codex.ps1 | Cancel those menus and type the observed quit command | Specific starting screen and title |
| retain-evidence.mjs | Compare this Claude capture and project this Grok cache | Exact capture filenames/versions; only allowlisted metadata retained |
| prepare-update.mjs | Build this two-entry addition, observations and decision candidate | Exact new IDs, fixture names and confirmed unchanged snapshot |
| verify-surfaces.mjs | This snapshot's Runtime/Platform/Bot/browser acceptance | Worktree paths, installed Chrome and Terra case; not reusable unchanged |

Six PNG files remain private: five 1129×635 terminal images and one 1440×1000 Playground
image. Playground also had an earlier startup sample before the corrected run. Four images
were sent to the capture agent (Claude initial, Codex list, both Playground samples), approximately
5752 image-input tokens by the skill's pixel heuristic before viewer resizing. The independent
reviewer inspected both additional 1129×635 Terra option images, approximately 1912 more tokens.
Six inspected images across both agents total approximately 7664. Billed image tokens and the
controlling session's usage/cost are unavailable. Provider inference usage: zero.
