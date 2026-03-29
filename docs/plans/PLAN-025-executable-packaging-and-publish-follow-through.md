# PLAN-025: Executable Packaging and Publish Follow-Through

> Consolidate the repo-local packaging, documentation, and release-automation
> follow-through that still sits partly in `ROADMAP.md` under `OPT-15`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Artifacts

- [ROADMAP OPT-15](../../ROADMAP.md)
- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md)
- [Release Guide](../release-guide.md)
- [Deployment Guide](../deployment.md)

## Overview

`cats-runtime` already has the core executable packaging contract in-repo:

- executable `bin` entries for `cats-runtime` and `cats-runtime-mcp`
- curated publish contents via `files`
- `prepack`
- `release:check`
- local pack/install helpers on Linux, macOS, and Windows
- package-contract coverage for the curated tarball shape

What remains is follow-through:

- some docs still describe the npm package path as only a planned publish path
- package/readme/operator guidance does not yet fully separate repo-local
  package readiness from not-yet-proven public registry publishing
- local smoke coverage can still go beyond static tarball contents
- trusted publishing automation is still only a documented future direction

This plan captures the repo-owned work that can be landed before a real npm
publish is attempted.

## Goals

1. Make packaging docs truthful about the current state: repo-local executable
   packaging is ready; public npm publication is still unproven.
2. Strengthen repo-local package verification beyond static `npm pack --dry-run`
   contents where it materially reduces release risk.
3. Prepare the repository for later publish automation without pretending the
   first real npm publish already happened.

## Non-Goals

- Performing the first real npm publish from this plan
- Claiming trusted publishing is configured before a workflow actually exists
- Reopening shared runtime UI architecture under the name of packaging
- Turning product hosts into source-import consumers of `cats-runtime`

## Implementation Phases

### Phase 1: Documentation and Governance Truth

- [x] Align deployment/release/package docs with the current repo reality:
      local package execution is ready, registry publication is still pending
- [x] Keep packaging follow-through clearly separated from unfinished shared UI
      work tracked under `PLAN-019`

**Deliverables**: operators and future contributors can tell what is already
repo-ready versus what still depends on a first public release.

### Phase 2: Local Package Smoke Coverage

- [ ] Add a bounded repo-local smoke slice that verifies packaged executable
      behavior beyond static tarball contents when that can run reliably in CI
- [ ] Keep the smoke slice focused on executable/package behavior rather than
      provider availability or long-lived runtime startup policy

**Deliverables**: local package regressions become easier to catch before a
registry publish is attempted.

### Phase 3: Publish Automation Preparation

- [ ] Decide what trusted-publishing artifacts can be added safely before the
      first real manual release
- [ ] Keep pre-publish automation truthful: document what is planned, what is
      repo-ready, and what still depends on external npm/GitHub configuration

**Deliverables**: the repo is structurally ready for later release automation
without claiming publish infrastructure that is not actually configured yet.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `docs/plans/PLAN-025-executable-packaging-and-publish-follow-through.md` | Create | Canonical implementation plan for `OPT-15` follow-through |
| `docs/plans/README.md` | Modify | Index PLAN-025 |
| `docs/release-guide.md` | Modify | Keep package/release truth aligned with current repo state |
| `docs/deployment.md` | Modify | Distinguish repo-local package readiness from public publish |
| `README.md` | Modify | Keep package/run guidance aligned with current executable posture |
| `tests/package-contract.test.ts` | Modify | Optional local smoke follow-through beyond static tarball checks |
| `.github/workflows/*` | Maybe | Only if a truthful pre-publish automation slice is ready |

## Testing Strategy

- `npm run build`
- targeted `vitest` coverage for any packaging smoke additions
- `npm pack --dry-run`-backed contract checks when modifying tarball contents
- `git diff --check`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Docs overstate publish readiness | High | Keep "repo-ready" and "published" explicitly separate |
| Packaging follow-through gets conflated with shared UI work | Medium | Treat `PLAN-019` as related but separate |
| Local smoke checks become flaky or environment-specific | Medium | Keep them bounded and executable-first |
| Automation docs drift ahead of real GitHub/npm setup | High | Only mark trusted publishing as landed when repo config actually exists |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-29 | Plan created to turn `OPT-15` from roadmap-only follow-through into a tracked packaging/release workstream |
| 2026-03-29 | Phase 1 slice landed: deployment/release/package docs now distinguish repo-local executable package readiness from not-yet-proven public npm publication, and `SPEC-017` now points shared UI follow-through to `PLAN-019` while keeping packaging follow-through under `PLAN-025` |

---

*Created: 2026-03-29*
*Author: Codex*
