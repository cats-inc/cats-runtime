# Release Guide

> How to publish `cats-runtime` to npm and evolve from a manual beta release to
> trusted CI publishing.

## Purpose

`cats-runtime` is an executable-first npm package:

- consumers should be able to `npm install cats-runtime`
- technical evaluators should be able to `npx @cats-inc/cats-runtime`
- upper-layer hosts such as `cats` should continue to treat it as a
  separate process and HTTP runtime boundary

This guide documents the release path that matches that packaging direction.

## Current Package Posture

The first public npm release shipped as `@cats-inc/cats-runtime@0.1.0`
(2026-07-22) with OIDC trusted publishing and provenance. The package has:

- a package entry at `build/runtime/index.js`
- an executable `bin` entry for `cats-runtime`
- bundled repo-local helper scripts under `build/runtime/bin/`
- curated publish contents via `files`
- a `prepack` build step
- a local release gate via `npm run release:check`
- local pack/install smoke helpers under `scripts/linux/`, `scripts/macos/`,
  and `scripts/windows/`
- package-contract coverage that now goes beyond tarball contents and also
  smokes the installed runtime entrypoint plus bundled helper scripts from the
  locally packed artifact

That means repo-local package verification is ready now, while registry
publication and trusted publishing activation are still future follow-through.

## Published Package Name

The first public package name is frozen to the unscoped package:

- `cats-runtime`

If a future migration ever moves to a scoped package, treat that as a separate
follow-through and update:

- `package.json` `name`
- README install examples
- any automation or release docs that mention install commands

Before the first manual release, verify current registry state and owner access:

```powershell
npm view cats-runtime name version
```

If npm returns `404 Not Found`, the name is still unpublished.

## Release Channels

- prerelease channel: `next`
- stable channel: `latest`

That keeps the first external validation off the default install path while the
registry artifact is still being proven.

## Release Modes

### Manual beta release

Use this for the first external trial release once the package name, npm owner,
and release operator are actually ready.

1. Ensure you can log in to npm with the account that will own the package.
2. Run the local release gate:

```powershell
npm run release:check
```

3. Publish a prerelease under a non-`latest` tag:

```powershell
npm version 0.1.0-beta.1
npm publish --tag next
```

If the package name is scoped, publish it publicly:

```powershell
npm publish --tag next --access public
```

Consumers can then install or run the beta with:

```powershell
npm install cats-runtime@next
npx @cats-inc/cats-runtime@next
```

## Repo-Owned Preflight Automation

The repository now includes a non-publishing GitHub Actions preflight at:

- `.github/workflows/cats-runtime-release-preflight.yml`

That workflow currently does only two repo-owned things:

1. `npm ci`
2. `npm run release:check`

It intentionally does **not**:

- call `npm publish`
- request `id-token: write`
- claim npm trusted publishing is already configured

Use it to keep the release gate reproducible in GitHub before the first real
manual prerelease is attempted.

## Repo-Owned Trusted Publishing Skeleton

The repository also now includes a dedicated manual publish workflow at:

- `.github/workflows/cats-runtime-npm-publish.yml`

That workflow exists so npm trusted publishing can later bind to a stable
GitHub Actions workflow filename without forcing a publish in this repo slice.

Current repo-owned facts:

- it is `workflow_dispatch` only
- it requests `id-token: write`
- it uses `cats-runtime/.nvmrc`, which is now aligned to the Node 22 runtime
  baseline
- it runs `npm ci`
- it runs `npm run release:check`
- it then runs `npm publish --tag <next|latest>`

This still does **not** mean npm trusted publishing is already configured for
`cats-runtime`. A successful publish depends on external npm-side trusted
publisher setup matching the same GitHub repository and workflow filename.

### Manual stable release

After the beta is validated:

```powershell
npm version patch
npm publish
```

For scoped public packages:

```powershell
npm publish --access public
```

## Recommended Release Checklist

Run this sequence from `cats-runtime/`:

```powershell
npm install
npm run release:check
```

Then manually verify:

```powershell
node build/runtime/index.js --help
node build/runtime/index.js --startup-mode app-managed --managed-by release-check --ready-output json
```

The second command should emit a single-line JSON `runtime.ready` event after
the HTTP server is ready.

## Post-Publish Validation

After the first publish, validate the actual registry artifact:

```powershell
npx cats-runtime@latest --help
```

For a beta tag:

```powershell
npx @cats-inc/cats-runtime@next --help
```

Also validate installation:

```powershell
npm install cats-runtime
```

## Future State: Trusted Publishing Activation

After the first manual prerelease is proven, keep the dedicated publish
workflow and finish the external npm trusted-publisher activation around it.

The current preflight workflow is intentionally separate from the publish
workflow. The publish workflow file now exists, but the npm-side trust
relationship still has to be configured and proven outside the repo.

Recommended activation checklist:

1. Keep the repository public if public provenance support is desired.
2. Configure npm trusted publishing for the exact GitHub org/user, repository,
   and workflow filename `cats-runtime-npm-publish.yml`.
3. If GitHub environment protection is later added, register the same
   environment name in npm trusted publisher settings.
4. Keep the publish workflow on GitHub-hosted runners; npm does not currently
   support self-hosted runners for trusted publishing.
5. Keep `package.json` `repository.url` exactly aligned with the GitHub repo.
6. Use protected manual dispatch first, then decide later whether to move the
   same workflow to tag- or release-driven publishing.
7. Once trusted publishing works, restrict or remove long-lived publish tokens.

Important notes from npm's current guidance:

- trusted publishing is preferred over long-lived tokens
- trusted publishing currently requires npm CLI `11.5.1+` and Node
  `22.14.0+`
- GitHub-hosted runners are supported; self-hosted runners are not currently
  supported
- npm trusted publisher matching is exact for the GitHub repository and
  workflow filename
- provenance is generated automatically for public packages published from
  public repositories through trusted publishing, so that path does not need
  a separate `--provenance` flag

## Package Metadata Expectations

Keep these fields accurate before publish:

- `repository`
- `homepage`
- `bugs`
- `engines.node`
- `publishConfig.access`

When the package name or repo path changes, update those fields before the next
release.

## Notes on Public Surface

`cats-runtime` is published as an executable-first package. Even though the
package still exposes some programmatic exports for internal/dev use, product
hosts should integrate through:

- child-process startup
- JSON readiness output
- `GET /health`
- the public HTTP API

That keeps the package aligned with the process-boundary ADRs.

## References

- npm publish: https://docs.npmjs.com/cli/v8/commands/npm-publish
- Trusted publishing: https://docs.npmjs.com/trusted-publishers/
- Provenance: https://docs.npmjs.com/generating-provenance-statements
- GitHub Actions npm publish guide: https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages
- Scoped public packages: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- Unscoped public packages: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages

---

*Last updated: 2026-04-07*
