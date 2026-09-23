# Runtime npm Release Guide

## Release boundaries

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

*Last updated: 2026-09-23*
