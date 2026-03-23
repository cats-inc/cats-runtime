# PLAN-013: Browser Preview Substrate v0

> Implementation plan for a lightweight runtime-owned browser session/page
> substrate that aligns browser-backed preview flows with existing preview
> surface contracts without turning `cats-runtime` into a full BrowserOS stack.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / Team 4 browser-preview workstream |

## Related Specs / Research

- [ADR-011: Add a Runtime-Owned Browser and Preview Subsystem with Pluggable Drivers](../decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md)
- [cats SPEC-020: Embedded Preview Surfaces for Runtime Artifacts and Services](../../../cats/docs/specs/SPEC-020-embedded-preview-surfaces-for-runtime-artifacts-and-services.md)
- [cats ADR-019: Normalize Runtime Previews as Surfaces, Not Provider Iframes](../../../cats/docs/decisions/019-normalize-runtime-previews-as-surfaces-not-provider-iframes.md)

## Overview

`cats-runtime` already had normalized preview surfaces for services and
artifacts, but it did not yet own a browser/session/page contract. That left a
gap between:

- existing delivery/session preview metadata
- the ADR direction for runtime-owned browser lifecycle
- future Cats Code preview and deploy-observe workflows

This slice adds the thinnest useful substrate:

- runtime-owned browser sessions and pages
- a pluggable browser-driver seam
- a first manual driver that validates the contract without pulling in an
  external browser runtime
- additive browser HTTP routes and inspection payloads

## Scope

### In Scope

- runtime-owned browser driver/session/page types
- a first in-memory `RuntimeBrowserService`
- a pluggable `RuntimeBrowserDriver` interface
- a `manual` driver that records runtime-owned page metadata without launching
  a real browser
- browser HTTP routes for listing drivers, creating/inspecting sessions,
  registering pages, and closing sessions
- normalized `browser_page` preview surfaces aligned with existing service /
  artifact preview contracts
- service/artifact binding helpers that reuse existing runtime session
  inspection data instead of source-importing sibling browser projects

### Out of Scope

- Playwright/CDP execution
- BrowserOS-style user takeover
- product-side preview UI
- monorepo sibling browser-service dependencies
- workspace/worktree lifecycle ownership
- MCP/browser tool facade work

## Implementation Phases

### Phase 1: Contracts and Driver Seam

- [x] Add runtime-owned browser driver/session/page contracts
- [x] Add a browser-page preview surface kind aligned with existing preview
      surface metadata
- [x] Define the pluggable `RuntimeBrowserDriver` interface

### Phase 2: Runtime Service and Driver

- [x] Add `src/core/browser/RuntimeBrowserService.ts`
- [x] Add a first `manual` browser driver under `src/backends/browser`
- [x] Keep the first slice dependency-free inside `cats-runtime`

### Phase 3: HTTP Routes

- [x] Add runtime-owned browser routes under `src/http/routes/browser.ts`
- [x] Wire the route into `src/http/app.ts` with minimal additive changes
- [x] Support runtime-session service/artifact binding without changing the
      existing preview-surface schema

### Phase 4: Verification and Documentation

- [x] Add browser service unit tests
- [x] Add browser route tests covering driver listing, manual pages, binding,
      and validation errors
- [x] Update `README.md`, `docs/api.md`, `docs/architecture.md`,
      `docs/AGENT-GUIDE.md`, and `PROGRESS.md`
- [x] Run `npm run build` and `npm test`

## Technical Decisions

- Keep browser state runtime-owned and lightweight. The first slice does not
  launch or supervise a real browser process.
- Preserve the existing preview-surface contract by extending it with
  `kind/source: "browser_page"` instead of inventing a second preview schema.
- Reuse existing runtime session inspection to resolve service/artifact binding
  targets, rather than reaching into product code or sibling browser projects.
- Keep the browser service in-memory for the first slice. Persistence and
  stronger cleanup can follow once a real driver lands.

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created and implemented in the same Team 4 browser-preview pass |

---

*Created: 2026-03-23*
*Author: Codex*
