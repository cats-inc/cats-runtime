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
