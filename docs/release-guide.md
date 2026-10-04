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
  Antigravity tests, one HTTP consumer test, 39 probe tests through their CI
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

*Last updated: 2026-09-28*
