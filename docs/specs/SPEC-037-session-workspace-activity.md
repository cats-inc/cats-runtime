# SPEC-037: Session Workspace Activity

## Metadata

| Field | Value |
| --- | --- |
| **Status** | Approved; sliced implementation in progress, acceptance pending |
| **Owner** | Runtime execution/workspace workstream |
| **Reviewer** | Owner and Runtime/Platform integration owners; pending |
| **Decision** | [ADR-046](../decisions/046-expose-evidence-backed-session-workspace-activity.md) |
| **Related Plan** | [PLAN-047](../plans/PLAN-047-session-workspace-activity.md) |
| **First consumer** | cats-platform SPEC-127 / PLAN-120 |

## Summary

Expose evidence-backed observations of directories, repositories and worktrees
used by a Runtime session. Several agents may retain the same non-Git parent cwd
while operating different child checkouts. A provider-neutral bounded snapshot
and stream update give Platform the facts needed for Code participant work areas.
This does not change execution roots, provider permissions or worktree lifecycle.

## Goals

- Distinguish session workspace binding from admitted operations on actual paths.
- Identify several repos and worktrees per session without restricting repo depth.
- Capture operation lifecycle, provenance, freshness and partial coverage honestly.
- Provide one contract across Runtime-owned tools and supported native adapters.
- Recover safely across reconnect, reset, session replacement and restart.

## Non-Goals

- Multiple selected roots, multiple Codespaces or extra writable-root settings.
- Product participant/Cat identity, UI composition or bubble/message attribution.
- Changing a session cwd as an observational side effect.
- Worktree creation, placement, adoption, merge, deletion or cleanup redesign.
- Whole-machine observation, recursive repo discovery or arbitrary shell parsing.
- Blocking otherwise supported provider execution because telemetry is unavailable.

## User Stories

- As a host, I can display work on `cats-runtime` and `cats-platform` while the
  session cwd remains `~/Source/cats-inc/`.
- As a host, I can distinguish linked worktrees of one repository and know
  whether Runtime owns their lifecycle.
- As an operator, I can identify an ongoing operation, a failed attempt and
  recent work without confusing missing telemetry with inactivity.

## Requirements

### WA-01: Proposed typed snapshot and transport

Add an optional typed `workspaceActivity` field to the existing session
inspection response and emit `type: 'workspace_activity'` updates through the
existing Runtime session streaming paths. Both carry the same bounded full
snapshot, avoiding a second product-specific delta protocol. Preserve the field
through supported NDJSON/SSE and normalized output adapters.

The types below are exported by the S1 slice. Session inspection and streaming
integration follow in S3; a type export alone does not enable observation:

```ts
interface RuntimeWorkspaceActivitySnapshot {
  schemaVersion: 1;
  sessionId: string;
  observationEpoch: string;
  revision: number;
  observedAt: string;
  startupCwd: string;
  runtimeCwd: string;
  coverage: {
    status: 'available' | 'partial' | 'unsupported' | 'unavailable';
    reason?: string;
  };
  workspaces: RuntimeObservedWorkspace[];
  truncated: boolean;
}

interface RuntimeObservedWorkspace {
  checkoutId: string;
  executionLocationId: string;
  path: string;
  repository: {
    id: string;
    label: string;
    sourceRoot?: string;
  } | null;
  kind: 'original' | 'worktree' | 'non_git' | 'unknown';
  branch: string | null;
  detachedCommit: string | null;
  management: 'runtime_managed' | 'unmanaged' | 'unknown';
  association: 'session_binding' | 'observed_operation';
  verification: 'verified' | 'unverified' | 'unavailable';
  firstObservedAt: string;
  lastObservedAt: string;
  runningOperations: RuntimeWorkspaceOperation[];
  recentOperations: RuntimeWorkspaceOperation[];
}

interface RuntimeWorkspaceOperation {
  id: string;
  toolId?: string;
  executionId: string;
  kind: 'read' | 'write' | 'test' | 'git' | 'shell' | 'other';
  state: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  evidence: 'runtime_tool' | 'provider_structured';
  startedAt: string;
  endedAt?: string;
}
```

`executionId` is Runtime-owned turn/run provenance; implementation must map it
to the existing execution lifecycle rather than creating a second run engine.
Raw provider input cannot assign `sessionId`, epoch or execution identity.
Stable operation IDs are independent of optional provider tool IDs.

Existing create/resume cwd and workspace fields stay scalar. An older/recognized
session with no activity has no invented observation; hosts can treat absence
as not reported. New implementations report current coverage explicitly.

### WA-02: Evidence admission and correlation

Runtime-owned filesystem tools provide their validated resolved targets and
correlated outcomes to one observer. Multi-file reads, batch inspect, patches,
renames and deletes contribute every verifiable checkout involved. Preserve
pre-operation identity when a target is deleted; do not need the file to survive
in order to attribute a completed operation.

A started write is an attempt. A failure never increments a successful-change
count. Exact changed-file counts or test results are optional derived facts only
when the tool contract supports them. A directory listing establishes access to
that directory, not activity in every child repo it happens to contain.

Managed-worktree preparation may establish `session_binding` context with empty
operation lists. It does not establish that the agent read, changed or tested
the checkout. A subsequent verified operation can promote the association.
Product-assigned intent is outside Runtime's observed-operation records.

### WA-03: Provider and shell coverage

Native adapters contribute only fixture-backed structured paths and operation
boundaries. Validate paths in the actual execution environment. Tool parameters
reported by a provider establish an observed attempt; completion requires the
matching result/lifecycle event. Unmappable or incomplete reports are partial.

Generic `run_shell`, `cd ...`, `git -C ...` strings, pipelines, scripts, assistant
claims and successful process exit alone do not establish actual target paths
or operation class. A verified structured per-command cwd can establish a shell
operation at that directory; it does not prove every subprocess stayed there.
Recognize tests only through a supported structured test/execution contract.

Coverage describes visibility, not execution capability. `available` means
supported observation inputs in the admitted tool profile are observable; a
profile allowing opaque shell or unsupported tools must be `partial` even if
some file operations are visible. Adapters default to unsupported/unavailable
until validated. Do not claim complete filesystem tracing for native providers.

Select the first native adapter slice from real fixture inventory in PLAN-047.
Claude/Codex are candidate consumers, not a promised all-provider support matrix.

### WA-04: Repository and checkout identity

Resolve identity on observed/admitted paths, not by scanning the root. Use
bounded read-only Git metadata inspection on the correct execution location.
Recognize Git worktree `.git` files, common Git metadata, nested repositories,
branch changes and detached HEAD. The nearest containing repo owns an ordinary
file operation; explicitly observed Git metadata targets must not be misattributed
to an ancestor repo simply because their physical path lies there.

Repository identity must group linked worktrees of one repository and distinguish
independent clones. Checkout identity must distinguish physical worktrees and
execution locations even when basenames match. Use canonical physical identity
under each filesystem's case rules; do not lowercase all paths globally. Missing
paths can be resolved against the nearest admitted existing parent, with existing
alias/containment protections intact.

`sourceRoot` and a human-readable source repository label are optional verified
facts. Do not derive them by trimming `.git` strings or treating a worktree's
arbitrary basename as its source repository. A bare/unresolvable repository or
unsupported metadata layout yields explicit unknown identity instead of a fake
root. The initial resolver reads bounded metadata files directly and needs no
Git executable; it does not load Git configuration, hooks or external helpers.

Cache identity by execution location and verified checkout, with bounded lifetime
and invalidation after relevant observed Git actions, filesystem replacement,
branch changes and lifecycle boundaries. Reverify before presenting a reused path
as current. Branch data carries its observation time, not a permanent assertion.

### WA-05: Authority and management ownership

Keep all existing tool, path, sandbox, network and shell policies. Observations
are not grants. Read-only metadata resolution does not grant the agent shell
execution. Resolve symlinks/junctions only as already allowed by path policy;
do not bypass a rejected alias to improve telemetry.

Worktree Git metadata may be outside the checkout root. Inspect it only with
existing metadata authority or verified Runtime-managed provenance; otherwise
return partial/unavailable Git identity. Observation must not read arbitrary
foreign files through a `.git` pointer. Bound Git subprocess execution/output
and disable optional locks/interactive behavior as appropriate to read-only probes.

Report `runtime_managed` only from existing managed-worktree ownership records.
Other verified worktrees are unmanaged or ownership-unknown. Creating a worktree
through agent shell, observing it or reading it never enrolls it in cleanup.
Existing worktree paths outside a product Codespace may be observed under their
existing session authority; this feature creates no extra root grant.

Guest/peer/remote paths require a verified execution-location mapping or a
supported remote observation source. Never feed a foreign path into host Git
or local filesystem resolution. Runtime has no Code participant identity.

### WA-06: Lifecycle, revisions and reconciliation

Use serialized reducer updates with strictly increasing revisions per
`(sessionId, observationEpoch)`. Observation epochs are Runtime-owned and change
when observation continuity is rebuilt after restart/reset/rebind. Duplicate
operations/results and late prior-execution results do not revive activity.

On tool completion, move the operation from running to recent with its outcome.
On cancel, close, reset, failure or lost observation continuity, terminate or
mark outstanding operations unknown. Do not synthesize success. Closing retains
bounded recent data according to existing session retention; deleting removes it.

Fork/branch receives a new session observation identity and no inherited active
operations. Resume rechecks workspace identity and coverage. Rehydrated persisted
facts are last-known, with no restored running operations. A new epoch starts
only after the current execution attachment has been validated.

Inspection exposes the authoritative current epoch/revision. Hosts subscribe,
buffer/reconcile the snapshot and apply only newer updates in that epoch. An
unknown epoch requires re-observation of the current attachment before replacing
state. No ordering is inferred from wall-clock timestamps across sessions.

### WA-07: Bounded retention and privacy

The initial proposed budget is 32 checkout rows per session, up to 8 running and
8 recent operations per row, plus a 64 KiB serialized snapshot cap. Coalesce
duplicate operations and retain active rows before least-recent completed rows.
Overflow or pruning sets `truncated`; do not invent an exact total that was not
tracked. If running work exceeds a cap, report partial/truncated coverage rather
than falsely claiming dropped operations completed. Final constants require
Phase 1 review and boundary tests.

Persist only identifiers, sanitized paths, operation classes/outcomes,
coverage and timestamps. Do not store raw commands, file contents, tool output,
tokens or credential-bearing remote URLs in workspace activity. Existing
authenticated session-read permissions govern the response and streaming data.

### WA-08: Storage and compatibility

Use existing session storage for a bounded last-known checkpoint if persistence
is required; avoid a new unbounded event log. Absent legacy fields mean unknown
coverage, never historical work inferred from cwd. Pure reads must not rewrite
old profiles merely to populate observations.

Document the persisted format boundary before implementation. Any schema upgrade
must validate recognized input, create a backup, atomically replace, and preserve
recoverability on validation/write/restart failure. Add interruption/restart tests.
Runtime must not replace corrupt existing state with an empty fabricated history.

Additive contracts should preserve the current minor's public behavior. A breaking
HTTP/stream/config/persisted contract requires the next 0.x minor or stable major.
No version bump or release is authorized by this planning task.

## Non-Functional Requirements

- Observation is bounded and off the token-critical path where possible. It does
  not trigger a model turn or periodic root scan.
- Observer/Git probe failure degrades coverage, not a valid operation's outcome.
- Providers remain executable when observation is unsupported. Do not introduce
  exact provider-version execution gates.
- Native Windows, macOS/Linux and supported guest mappings need path fixtures;
  only actual validated modes may claim verified local identity.

## Acceptance Criteria

| ID | Scenario and expected result |
| --- | --- |
| RA-01 | Two sessions share one non-Git root cwd and operate different child repos; snapshots attribute separately without changing cwd. |
| RA-02 | A repo four levels down, an existing subdirectory and a missing nested file path resolve from admitted operations without crawling the root. |
| RA-03 | Batch reads/patches/renames across two repos produce distinct checkout facts; failed writes and parent listings do not invent changes/child activity. |
| RA-04 | Two worktrees of one repo share repo identity and keep distinct checkout identity; independent clones with the same basename do not collapse. |
| RA-05 | `.git` files, detached HEAD, branch changes, missing Git and deleted/reused paths produce verified or explicitly unknown facts. |
| RA-06 | Agent-created worktrees remain unmanaged; outside-root metadata, forbidden aliases and unmapped remote paths never broaden authority. |
| RA-07 | Unsupported tools, provider gaps and opaque shell actions show partial/not-reported coverage with no fabricated target or test success. |
| RA-08 | Start/result correlation, duplicate/late events, reset/resume/fork, close/cancel and restart cannot retain false running state. |
| RA-09 | Inspection and each supported streaming path agree on snapshot schema, epoch/revision and truncation; reconnect recovery preserves ordering. |
| RA-10 | Caps, slow/failing Git, privacy, authentication, old data and migration interruption/restart are covered by isolated tests. |
| RA-11 | At least one fixture-backed native adapter and Runtime-owned local tools produce facts consumed by Platform's Code panel acceptance; provider/OS limits are recorded. |

## Dependencies and Open Questions

- [SPEC-002](SPEC-002-local-tool-runtime.md) path/tool policy and
  [SPEC-014](SPEC-014-session-maintenance-worktree-isolation-and-compaction-hooks.md)
  workspace lifecycle remain authoritative.
- [Platform SPEC-127](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-127-code-participant-workspace-visibility.md)
  supplies the Code consumer and participant attribution requirements.
- [ ] Select exact observation hooks, checkpoint location and native provider slice
  after inventorying existing Runtime execution/transport contracts.
- [ ] Confirm snapshot limits and Git-probe budget against representative fixtures.
- [ ] Approve public field placement and storage compatibility before implementation.

## References

- [ADR-046](../decisions/046-expose-evidence-backed-session-workspace-activity.md)
- [PLAN-047](../plans/PLAN-047-session-workspace-activity.md)

---

*Created: 2026-10-20*
