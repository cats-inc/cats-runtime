# 2026-10-24 sixteen CLI catalog refresh

Date: 2026-10-24 (UTC+8). Mode: refresh; policy: confirm uncertainty. Scope: all sixteen
configured CLI/channel scopes, Runtime/Playground and Platform selectors, plus the expressly
authorized Auggie effort implementation. API/local scopes are unchanged. The collection used
no inference or login. After source validation, the owner authorized version bumps, auto-merged
PRs and Desktop 0.9.7 standard-profile preview publication; see the 0.6.2 release notes.

## Evidence

All sixteen sign-in checks passed on native Windows 11. Private snapshot:
`tmp/catalog-refresh-20261024/probe/snapshot.json`. Supporting projected rows are retained under
`fixtures/<provider>-<version>/model-list-2026-10-24.probe.redacted.json`. Devin's fixture excludes
fusion and legacy MODEL_* rows. Cursor has a separate full parameterized-model fixture.
Observations cover this installation/account; other accounts/OSes are unverified.

| Provider | Observed version | Entries | Method |
|---|---|---:|---|
| Codex | 0.164.0 | 7 | Complete account debug models; hidden rows excluded; context/efforts unchanged |
| Claude | 2.1.310 | 12 | Complete 13-row picker including Default sentinel; every effort line and session-only /status mapping |
| Antigravity | 1.4.7 | 5 | Complete 13 executable variants; earlier slider provenance retained |
| Grok | 1.0.70 | 4 | Complete list and projected CLI-owned cache efforts/context |
| Muse | 1.4.12-R6909.1 | 3 | Account MSP list/variants; isDefault not projected |
| Cursor | 2026.10.22-27dcf5f | 48 | Complete parameterized reply, 45 filtered families split losslessly |
| Copilot | 1.0.103 | 14 | Complete 32-row picker, 18 unavailable; every Reasoning/Tier range and Context figure |
| OpenCode | 1.19.4 | 29 | Complete opencode-go list; Default-first Variant controls |
| Kilo | 7.8.17 | 336 | Gateway list and 343 picker rows: Recommended 10 + gateway 326; Recent 7 duplicates |
| Goose | 1.56.0 | 6 | Official versioned compiled list and installed binary strings; configure never run |
| Pi | 1.4.0 | 7 | Installed openai-codex package, thinking levels/default; GPT-6.1 Sol context 500000 |
| Auggie | 0.36.0 | 37 | Complete bidirectional picker, exact JSON display-name/ID mapping and per-model effortLevels |
| Junie | 26.10.20 (build 3813.10) | 20 | Configured JetBrains AI tab, Up/Down only; supported efforts from JAR |
| Kiro | 2.34.0 | 22 | Complete list and V3 ACP efforts/defaults; new candidates confirmed by targeted reread |
| Cline | 3.0.73 | 14 | Accepted installed cline-pass block; Free excluded; earlier thinking provenance retained |
| Devin | 3000.11.205 | 51 | Complete family/variant enumeration; fusion and legacy UIDs excluded |

Captures used uniquely titled single-pane Windows Terminal windows and the platform UI helper.
Initial screenshots established visible-text correspondence; traversal was text only. Completed
captures were reused. Auggie, Claude, Copilot and Kilo retained prelaunch settings/state hashes.
Junie's traversal hash stayed unchanged, but prelaunch-to-exit differed. No restoration overwrote
possible concurrent/user changes. Automatic review rejected copying the entire Junie settings
file because it might duplicate sensitive data. The replacement workflow hashes in place and
never cycles effort. The JAR reader calls availableForModel/getWireId/getDisplayName, reads no
defaults/credentials/settings and starts no CLI. Raw screenshots/logs remain private.

Goose source: [channel list](https://github.com/block/goose/blob/v1.56.0/crates/goose/src/providers/chatgpt_codex.rs),
[configure menu](https://github.com/block/goose/blob/v1.56.0/crates/goose-cli/src/commands/configure.rs).
Installed binary SHA-256: `4da436a30ed6ca5b81a3a196e87a4596b862e06f0419a29a384cba1c9dad2977`.
Its six known names occur in the installed binary. Release-asset byte identity was not checked.

## Decisions and implementation

The operator answered one grouped question: **apply all proposed changes**. This authorizes
removing 29 unavailable/unlisted old entries and their variants, removing Copilot Auto Fast,
adopting Junie's seven literal GPT entry-ID spellings, removing Junie's unmarked Gemini default
while retaining first-row initialization, and retaining Eco only in evidence. The exact old IDs
are retained in the pre-refresh factory/history and the conversation. No unrelated scope changed.

The additive schema-2 `auggie.reasoning_effort` string binding sends --reasoning-effort. Each
nonempty per-model JSON effortLevels becomes its own enum, using literal tokens as labels with
no default claim. Missing levels and custom strings get no inferred effort. First-value
initialization is sent explicitly. The picker still has no effort step: an authorized session-only
Enter on GPT-6 Astra returned directly to the prompt. This requested control supersedes the former
notes-only policy. Existing resolved sessions keep their bindings.

Runtime is the single authored factory; Playground and Platform consume its basic/advanced
contract. No independent UI model table is added. Platform's regression uses synthetic unknown
IDs/levels to check rendering, selection transport and switching to a row without effort. Frozen
migration/UI fixtures retain historical labels. Devin Lightning is a separate form with exact
UIDs and its own effort order, not the Fast value. Junie executable setting IDs stay unchanged;
the new Junie Mixes channel is outside the configured JetBrains AI scope. Eco has no binding here.
An independent decoder confirmed that the picker cycles the same getLlm/availableForModel path
used by the JAR reader. Eco is a separate On/Off preference with model/effort-dependent
availability, not merely an indicator; its omission is explicitly authorized. See the retained
[method linkage](fixtures/junie-build-3813.10/picker-method-linkage-2026-10-24.redacted.txt).

## Validation

- `catalog:generate` and `catalog:check` passed; sourceDigest is
  `4f26605237482c1c911cb8b5a887ea4bf5288bf0f1050126c97ec5cbb1329c81`.
- The same saved probe snapshot validates all sixteen scopes as ok, notes only. Four stale
  acknowledgements were retired: withdrawn Copilot Gemini 3.7, no-longer-listed Pi Spark and
  Devin legacy UIDs, and Kilo's ended Gemini 4 Argon promotion. Exclusion policies remain intact.
- Focused Runtime suites passed: catalog-data 22, catalog-runtime 38, Auggie adapter 9,
  providerModelCatalog 20, shared Playground 22, and the bounded HTTP catalog selection 22
  (53 unrelated server cases skipped). Factory-backed assertions now consume shared membership;
  frozen discovery/migration fixtures are unchanged. No full-suite pass is claimed.
- The first hosted preflight passed 2,856 tests and found two additional stale factory-backed
  assertions (Kiro management models and bundled Pi refresh). Both now compare the projection
  with the shared factory, retaining exact order/labels and the no-spawn refresh assertion.
  Their focused rerun passed; dynamic/migration fixtures remain unchanged.
- Junie reader and scope-generator synthetic tests: 11 passed. Junie read-only/Eco helper tests
  passed without starting a CLI. Runtime TypeScript passed after installing existing lockfile
  dependencies in this worktree; the shared checkout lacked pngjs. Dependency/version files
  did not change. Initial sandbox subprocess failures (EPERM) passed through approved execution.
- Platform's 44 focused catalog/selection/UI tests, test TypeScript check and server build passed.
  The nested worktree initially lacked mobile dependencies; the existing main-checkout mobile
  dependency folder was linked only into the ignored worktree path.
- An isolated Runtime served every actual factory basic/advanced response to Platform's built
  normalizers: all sixteen scopes, 615 entry labels, per-entry controls and shared revisions
  matched. A fresh headless Chrome then verified all 615 Playground choices, Auggie effort
  selection, absence of effort on an unsupported model and custom input. Every non-GET browser
  request was blocked. The first harness attempts needed the normal Runtime lifecycle, time
  for initial metadata diagnostics, and expansion of the initially collapsed card; final passed.
- The isolated source Candidate compiled Runtime and Platform server/host/renderer, displayed
  its initial provider-selection screen, and carried the same catalog sourceDigest. It reported
  drained with exitCode 0; its host and both sidecar PIDs were independently absent afterwards.
  Source/build/screenshot/stop receipts remain private under `catalog-candidate-20261024` outside
  both repositories. This is a source build/startup check, not an installed-release upgrade.
- Runtime worktree skill mirrors were synchronized; parent main-checkout workspace sync/check
  remained unchanged and passed. That does not activate the unmerged worktree skill in the
  controlling parent session. Both main checkouts stayed clean on their default branches.
- Independent review found no remaining concrete defect. Text fixtures were checked for identity
  and credential leakage. No provider inference or Cats conversation/task was created. Interactive
  CLIs can write ordinary empty startup/session/cache files; their accounts were not used for turns.

## Scripts and cost

Kept with offline tests/reference updates: Capture-JuniePicker.ps1 (Up/Down-only mode, separate
Eco column), junie-model-ids.mjs --efforts (JAR values/labels and fixed-effort metadata), and
catalog-scope-entries.mjs (Devin Lightning form). Later versions can rerun them while the observed
picker layout, JAR signatures and UID grammar remain compatible.

Private one-offs, not kept: desktop-ready.ps1 (this host's initial window query), InspectJunie.java
(this JAR's method-signature reconnaissance), retain-evidence.mjs (this run's fixture names and
excerpts), prepare-candidate.mjs (this snapshot's projection/delta), apply-candidate.mjs (confirmed
scope edits and fixture names), update-consumer-tests.mjs (replacing specific old assertion text),
and verify-surfaces.mjs (this snapshot's two concrete Auggie model cases, installed browser and
Platform build path). These depend on this run's paths/versions and cannot rerun unchanged for
a later CLI refresh. The independent review used an inline, version-scoped Python class-file
decoder for the named Junie methods; no decoder file was retained. Native launch/key snippets
reuse the platform helper rather than duplicate it.

Thirteen images were saved privately: ten 1129x635 terminal images, one 2576x1274 maximized
terminal image, one 1664x1011 Candidate image and one 1440x1000 Playground image. Eight were
actually sent for inspection (five small terminal images plus the latter three). Their original
pixels imply about 13.3k image-input tokens before viewer resizing; billed image tokens are not
available. Text-only traversal saved no additional images.

The matched host session's checkpoint through 2026-10-24 13:56:04 UTC reports 156 calls,
317985 uncached input, 41004544 cache-read and 112002 output tokens (39152 reasoning tokens are
included in output); cache writes were zero. This excludes later wrap-up calls and the separate
review session, and supplies no USD price. Provider inference usage was zero.
