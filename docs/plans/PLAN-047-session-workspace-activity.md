# PLAN-047: Session Workspace Activity

## Metadata

| Field | Value |
| --- | --- |
| **Status** | In Progress; owner-authorized sliced implementation, acceptance pending |
| **Owner** | Runtime execution/workspace workstream |
| **Reviewer** | Owner and Runtime/Platform integration owners; pending |
| **Spec** | [SPEC-037](../specs/SPEC-037-session-workspace-activity.md) |
| **Decision** | [ADR-046](../decisions/046-expose-evidence-backed-session-workspace-activity.md) |
| **Consumer** | cats-platform SPEC-127 / PLAN-120 |

## Overview

Add bounded session workspace observations for one parent cwd with several
repos/worktrees beneath it. Runtime owns evidence, identity and observation
lifecycle. Platform maps sessions to Code participants and renders work areas.
This plan adds no multi-root settings, bubble fields or worktree lifecycle actions.

The owner authorized implementation and incremental commits after Platform
PR #289 passed CI and merged. Both main checkouts were pulled before worktrees
were created. Each slice receives scoped validation and a separate commit;
version changes and publication remain separately authorized.

## Delivery Slices

| Slice | Repository and deliverable | State |
| --- | --- | --- |
| S1 | Runtime activity types and admitted repo/worktree identity | Complete; 15 focused tests and typecheck passed |
| S2 | Runtime bounded reducer, ordering, snapshot validation and inactive reattachment | Complete; 11 focused tests and typecheck passed |
| S3 | Runtime local-tool observation, session lifecycle, transport and memory-only restart checks | Pending |
| S4 | Native provider structured evidence, coverage and fixture/native checks | Pending |
| S5 | Platform participant attribution, work-area API and live projection | Pending |
| S6 | Code right panel, avatar entry, localization and renderer regressions | Pending |
| S7 | Cross-repository native acceptance, recovery/privacy and documentation reconciliation | Pending |

S1 uses bounded metadata reads without Git subprocesses/configuration or a root
scan. It reuses existing path policy and trusted managed-worktree source authority.
Generic shell strings, bubbles and multiple selected Codespaces remain excluded.
Unknown identity is retained at an authority or traversal boundary. Managed
source attachments that are themselves linked worktrees currently remain
unavailable until S3 can supply verified lifecycle metadata provenance. Windows
case-sensitive directory behavior, submodules and path reuse need later fixtures;
the current checks do not claim those modes are validated.

S2 keeps last-known facts in memory only. No existing session record is rewritten
and no disk format is introduced. Process restart has no restored activity;
reattachment within one process changes epoch and terminates pending operations.
Every asynchronous mutation carries an attachment/execution lease. Snapshot budgets
are 32 rows, 8 running/8 recent operations per row and 64 KiB, with up to 1024
correlation/tombstone IDs per execution. Out-of-order or dropped facts explicitly
degrade coverage. Identity probe time is separate from operation completion time.

## Implementation Phases

### Phase 1: Freeze the generic observation contract

- [ ] Review SPEC-037 with Platform SPEC-127 for shape, identity, coverage,
  observation epoch, ordering and reconciliation.
- [ ] Trace existing local tool, CLI, API/agent execution and normalized transport
  paths. Choose the shared observer/reducer injection points.
- [ ] Inventory actual structured tool paths/results per provider and instance
  mode. Choose one fixture-backed native slice plus Runtime-owned local tools;
  record unsupported/partial modes explicitly.
- [ ] Confirm no cwd/root settings change and no new observation-dependent
  execution refusal, tool grant or managed-worktree adoption.
- [ ] Choose bounded snapshot/checkpoint limits and the existing session-store
  extension. Define migration/backup/atomic-recovery tests if schema changes.

**Deliverable:** Reviewed typed contract and coverage/fixture matrix shared with
Platform PLAN-120. Do not claim raw shell target inference as verified evidence.

### Phase 2: Implement identity resolution and the observation reducer

- [ ] Add provider-neutral snapshot, workspace and operation types.
- [ ] Implement location-qualified repository/checkout identity with bounded
  read-only probes for `.git` files, nested repos, branches and detached HEAD.
- [ ] Reuse existing path policy and managed ownership records; handle non-Git,
  missing/forbidden metadata, aliases and unmapped foreign paths explicitly.
- [ ] Add a serialized bounded reducer for start/completion/cancel, multiple
  targets, deduplication, limits and freshness.
- [ ] Keep session binding context separate from observed operation association.
- [ ] Cover branch/path replacement and identity cache invalidation without
  filesystem-wide watchers or recursive repository scans.

**Deliverable:** Isolated pure/model and real-temp-Git tests for identity and
operation facts, with no product identity dependency.

### Phase 3: Capture Runtime tool and native provider evidence

- [ ] Emit validated operation targets/outcomes from local read/list/write/patch/
  rename/delete tool boundaries, including multi-target and pre-delete identity.
- [ ] Wire the selected native adapter's verified structured events into the
  same observer; distinguish reported attempts from successful completion.
- [ ] Resolve per-command paths on the correct execution location and mark
  opaque shell or uncorrelated results partial/unknown.
- [ ] Report truthful coverage for each selected tool profile and execution mode.
- [ ] Confirm observer/Git failures do not change a valid tool's result or grant
  more permissions, and unsupported providers continue existing execution.

**Deliverable:** Fixture-backed local/native observations with actual path
provenance and documented coverage boundaries.

### Phase 4: Expose inspection, streaming and lifecycle recovery

- [ ] Add optional `workspaceActivity` to session inspection and typed
  `workspace_activity` updates through supported session streaming paths.
- [ ] Keep normalized stream and inspection schema identical; preserve facts
  without scraping transcript text or leaking raw provider payloads.
- [ ] Implement observation epochs/revisions and an inspection reconciliation
  sequence covering subscription/snapshot races.
- [ ] Integrate close/cancel/error/reset/resume/fork/delete and reject late results.
- [ ] Persist only bounded last-known checkpoints, restore them inactive and
  revalidate current attachment/identity before live claims.
- [ ] Test recognized old data, backup/atomic upgrade if needed, corrupt state,
  failure recovery, and interrupted write/restart behavior.
- [ ] Exercise real HTTP/stream consumer fixtures with Platform's parser contract.

**Deliverable:** Authenticated recoverable session observations with bounded
retention and no false running state after a lifecycle boundary.

### Phase 5: Cross-repository acceptance and documentation

- [ ] Use synthetic temp repositories under a non-Git `cats-inc` parent; include
  a fourth-level repo, multiple linked worktrees and a plain directory.
- [ ] Verify two sessions retain the same cwd while reading/writing distinct
  child repos; exercise one session across several checkouts.
- [ ] Run a bounded native provider acceptance on one named OS/profile with real
  structured evidence and unchanged execution grants.
- [ ] Consume facts in Platform PLAN-120; verify participant attribution,
  coverage/freshness and worktree management labels in an isolated renderer.
- [ ] Run focused affected tests and required build/type checks; expand only for
  actual cross-layer dependencies or unresolved failures.
- [ ] Obtain independent review and update API/architecture docs, companion
  statuses and exact validation/remaining provider/OS coverage.
- [ ] Record the needed compatibility boundary before any separately authorized
  release. Do not bump versions or publish as a side effect.

**Deliverable:** SPEC-037 RA-01 through RA-11 evidence and synchronized Platform
acceptance, without presenting fixtures as all-provider native validation.

## Files to Create/Modify

Implementation candidates; none are changed by this documentation task:

| Surface | Intended change |
| --- | --- |
| `src/core/types.ts` | Provider-neutral observation types and typed output event |
| `src/core/workspace/` | Bounded identity resolution and activity reducer |
| `src/core/tools/LocalToolRuntime.ts` | Validated target/outcome observer hooks |
| `src/core/tools/pathSafety.ts` | Reuse current path boundary; change only if a reviewed shared need exists |
| `src/core/runtime/RuntimeSessionManager.ts` | Observation lifecycle and injected collaborators |
| `src/core/runtime/sessionInspection.ts` | Optional activity read snapshot |
| `src/backends/cli/providers/` | Selected adapter's verified structured events |
| `src/backends/agent/` and `src/backends/api/` | Shared observation integration where applicable |
| `src/backends/cli/pool/SessionRegistry.ts` | Reviewed bounded checkpoint/recovery seam if selected |
| `src/http/` | Inspection/stream transport, auth and schema preservation |
| Existing focused workspace/tool/provider/HTTP tests | Identity, lifecycle, transport and consumer fixtures |
| `docs/api.md`, `docs/architecture.md` | Describe the implemented public contract at delivery |

## Testing Strategy

Documentation preparation checks numbering, links, scope and diffs only. No new
application test/build or live provider acceptance is claimed in this task.

Implementation tests must use isolated temp roots and Runtime test environment
helpers. Never read or mutate the user's `~/.cats/runtime` or actual Cats repos
for write-based fixtures. Bound all Git subprocesses and clean owned temp roots.

- Identity: common parent cwd, fourth-level repos, independent clones, linked
  worktrees, detached HEAD, aliases, missing targets, case rules and foreign paths.
- Evidence: multi-target tools, failed writes, pre-delete identity, unknown shell,
  omitted provider paths/results, duplicate/late events and exact coverage states.
- Lifecycle/storage: cancel/close/reset/fork/resume/delete, epoch changes,
  restart inactivity, limits, privacy, migration and failure/restart recovery.
- Transport/consumer: inspection vs NDJSON/SSE parity, auth, ordering and Platform
  parser/projection fixtures.
- Native: one named provider/mode/OS with unchanged grants; clearly record partial
  support instead of extrapolating to all providers.

Existing focused baselines include `src/core/workspace/sessionWorkspace.test.ts`,
`src/core/tools/pathSafety.test.ts`, `src/core/tools/LocalToolRuntime.test.ts`
and `src/backends/cli/pool/sessionView.test.ts`. Add new tests where they prove
the new contract. A docs-only task does not rerun these baseline suites.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Shell/native payloads do not prove actual targets | Admit structured evidence only; explicit partial coverage |
| Git metadata escapes admitted workspace authority | Reuse verified metadata authority; unavailable otherwise |
| Identity probes add latency or I/O | Bounded lazy resolution/cache, no root scanning |
| Late results or restart revive running work | Execution-scoped correlation, epochs and inactive restore |
| Consumer confuses observations with grants or ownership | Typed context/operation distinction and explicit management responsibility |
| Stream/checkpoint size grows without bound | Row/operation/byte caps and truncation tests |

## Progress Log

| Date | Update |
| --- | --- |
| 2026-10-20 | Created ADR-046 / SPEC-037 / PLAN-047 for Platform ADR-134 / SPEC-127 / PLAN-120. Planning only; implementation and native acceptance not started. Multi-root settings, bubble changes and worktree ownership changes are excluded. |
| 2026-10-20 | Documentation validation passed: 34 references across the six new Platform/Runtime documents resolve against the local worktrees; numbering, index entries, LF/final newlines and code fences checked. Both repositories passed `git diff --check`. No application tests, builds or live acceptance were run for this docs-only task. |
| 2026-10-20 | Owner authorized sliced implementation and incremental commits. Platform PR #289 was verified merged at `8bb3fd2f` with changes/validate/nodejs CI successful; both main checkouts pulled cleanly. Runtime worktree `plan047-workspace-activity` starts at `b2d888aa`; S1 and independent contract review are in progress. |
| 2026-10-20 | S1 adds exported activity types and lazy admitted Git identity. Independent review fixes cover incomplete outer authority, managed-subdirectory attachments, foreign source/sibling pointers and bounded-walk exhaustion. Focused identity suite: 15 passed; Runtime TypeScript check passed; no live provider or Platform acceptance yet. |
| 2026-10-20 | S2 adds a bounded in-memory reducer and strict snapshot validator. Attachment/execution leases reject stale callbacks; duplicate/late and terminal-before-start evidence cannot invent active work. Review also verified envelope/retention limits, consumer failure isolation and identity/activity timestamps. Focused reducer suite: 11 passed; Runtime TypeScript check passed. Storage schema unchanged; S3 lifecycle/transport and native/UI acceptance remain pending. |

---

*Created: 2026-10-20*
