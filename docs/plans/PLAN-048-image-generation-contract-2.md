# PLAN-048: Image generation contract 2

- Spec: [SPEC-038](../specs/SPEC-038-image-generation-contract-2.md)
- Decision: [ADR-047](../decisions/047-generalize-bounded-image-generation-to-provider-profiles.md)
- Cross-repository plan: [cats-apps PLAN-006](../../../cats-apps/docs/plans/PLAN-006-studio-image-workspace.md),
  Runtime part of A0 and A1. The owner chose generation-only for Muse, Antigravity and Codex
  first (2026-10-23).

## Tasks

### Cursor extension — 2026-10-24

- [x] Native runner, isolated Cursor data root, matching completion source collection, pinned
  GLM 5.3 / max profile, shared metering/capacity dispatch; focused runner fixtures and TypeScript
  checks passed. The four image regression files passed 33 tests.
- [x] Platform projection/SDK/shared-ledger consumer and Studio five-provider order/default
  implemented in their own worktrees; isolated real package/host fixture acceptance passed.
- [x] Successful live acceptance through the new runner. The first authorized image call failed
  during native save because a blanket Write deny blocked it. Permissions and native framing
  are corrected; the owner explicitly allowed one further image, which passed in 25.0 seconds:
  JPEG 1024 x 1024, 90,500 original bytes, one image tool call and process stopped after collection.
  The profile is enabled. No automatic generation retry or Runtime npm release is selected.
- [ ] Independent review. Author-run mechanical checks are not independent review.

- [x] Profiles in `catalogs/media-profiles.json` (catalog schema 2) with a validated loader and
  an `enabled` gate. Grok keeps 4.7 / xhigh at native 1:1.
- [x] Contract 2 capabilities, request and receipt. Stale revisions and configurations are
  refused. The MIME type of the bytes is served.
- [x] Shared execution module: JPEG/PNG decode with size caps and measured alpha, containment,
  stable reads, process-tree stop and failure classification. The Grok runner moved onto it
  with unchanged behaviour.
- [x] Muse runner with CLI-enforced step and parallelism limits, a Runtime session ID, and
  collection from the attempt workspace.
- [x] Schema 1 receipt upgrade, with backup, atomic replace, crash rerun, and refusal of unknown
  or damaged receipts.
- [x] Muse live acceptance: one image through the runner, then the profile was enabled.
- [x] Codex: the CLI has no pre-execution bound; the owner accepted a runner-enforced bound
  (2026-10-23). Runner, fixtures and one live call are done.
- [x] Antigravity: one `invoke_subagent` and collection from this conversation's artifact
  folder, under a runner-enforced bound. Fixtures and one live call are done.
- [ ] Muse: find a muse 1.4 setting (for example an `--agents` overlay or a permission profile)
  that keeps only `image_generation`, so the memory and artifact tools are off.
- [ ] Release: next Runtime 0.x minor (HTTP contract change), bundled with the Platform
  contract 2 consumer in a Desktop preview.

## Validation

- `npx vitest run tests/image-generation.test.ts tests/muse-image.test.ts` and `tsc --noEmit`.
- Live calls only with the owner's authorization, one image per provider gate, through the
  runner. Report each live call's provider, instance, model and effort beforehand.

## Progress log

### Controlled Cat image consumer — in progress, 2026-10-23

- Platform's owner-authorized golden path shares the image executor with Studio (Usage is
  excluded). It requires source-turn handoff because an idle persistent Cat can own the same
  native singleton or the final worker slot needed by its image.
- Added optional `sourceSessionId` receipt/idempotency evidence, `sourceSessionYield` readiness,
  explicit observed `turnInFlight`, and bounded pool handoff of that source only. Existing
  schema 2 requests without the optional field are unchanged; schema 1 receipt upgrade keeps
  its existing backup/atomic recovery path.
- Focused worker/request suites passed 32 tests, including delayed helper closure, captured
  handles, aborted shutdown claims and unrelated singleton preservation. Independent read-only
  review found the initial exit-versus-helper-close and captured-handle races; both were fixed.
  Observation integration, final consumer regression, live golden-path acceptance and release
  gates remain pending. No version or release has been published for this work.

| Date | Note |
| --- | --- |
| 2026-10-23 | The owner asked to open all four providers for testing and accepted runner-enforced bounds for Codex and Antigravity. One live call each passed: Codex, a 1254 x 1254 PNG in 27.0 s; Antigravity, a 1024 x 1024 JPEG in 27.1 s with one delegation. Both stopped after the image, and both profiles are enabled. An independent review led to stricter Muse result binding, an atomic receipt-upgrade backup, and documentation of the Muse memory-write risk. |
| 2026-10-23 | Contract 2 and the Muse runner were implemented. The first live Muse call ended without an image: `--disable-write` had removed `image_generation`, and the model replied only that the tool was unavailable. Writes now stay enabled inside the attempt workspace. The second call saved a 1920 x 1280 PNG in 18.6 s and the profile was enabled. |
