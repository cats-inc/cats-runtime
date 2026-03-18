# Release Guide

> How to publish `cats-runtime` to npm and evolve from a manual beta release to
> trusted CI publishing.

## Purpose

`cats-runtime` is an executable-first npm package:

- consumers should be able to `npm install cats-runtime`
- technical evaluators should be able to `npx cats-runtime`
- upper-layer hosts such as `cats-inc` should continue to treat it as a
  separate process and HTTP runtime boundary

This guide documents the release path that matches that packaging direction.

## Current Package Posture

Before publishing, `cats-runtime` already has:

- a package entry at `dist/index.js`
- an executable `bin` entry for `cats-runtime`
- curated publish contents via `files`
- a `prepack` build step
- a local release gate via `npm run release:check`

## Decide the Published Package Name

Choose one of these patterns before the first publish:

- unscoped: `cats-runtime`
- scoped public package: `@scope/cats-runtime`

If you change to a scoped package later, update:

- `package.json` `name`
- README install examples
- any automation or release docs that mention install commands

Before the first release, verify availability:

```powershell
npm view cats-runtime name version
```

If npm returns `404 Not Found`, the unscoped name is currently available.

## Release Modes

### Manual beta release

Use this for the first external trial release.

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
npx cats-runtime@next
```

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
node dist/index.js --help
node dist/index.js --startup-mode app-managed --managed-by release-check --ready-output json
```

The second command should emit a single-line JSON `runtime.ready` event after
the HTTP server is ready.

## Post-Publish Validation

After publish, validate the actual registry artifact:

```powershell
npx cats-runtime@latest --help
```

For a beta tag:

```powershell
npx cats-runtime@next --help
```

Also validate installation:

```powershell
npm install cats-runtime
```

## Future State: Trusted Publishing

After the first manual release is proven, move publish to GitHub Actions trusted
publishing.

Recommended direction:

1. Keep the repository public for public provenance support.
2. Create a GitHub Actions workflow dedicated to npm publishing.
3. Configure npm trusted publishing for that exact repository and workflow
   filename.
4. Give the workflow `id-token: write` permission.
5. Publish from Git tags or a protected manual release workflow.
6. Once trusted publishing works, restrict or remove long-lived publish tokens.

Important notes from npm's current guidance:

- trusted publishing is preferred over long-lived tokens
- GitHub-hosted runners are supported; self-hosted runners are not currently
  supported
- provenance is generated automatically for public packages published from
  public repositories through trusted publishing

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
- Scoped public packages: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- Unscoped public packages: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages

---

*Last updated: 2026-03-19*
