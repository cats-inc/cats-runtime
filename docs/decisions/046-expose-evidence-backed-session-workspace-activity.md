# ADR-046: Expose Evidence-Backed Session Workspace Activity

## Status

Proposed, 2026-10-20. Planning only; no implementation or provider acceptance
is claimed. See [SPEC-037](../specs/SPEC-037-session-workspace-activity.md) and
[PLAN-047](../plans/PLAN-047-session-workspace-activity.md).

## Context

The owner wants a Team Code conversation rooted at `~/Source/cats-inc/`, with
several coding agents sharing that cwd while working across child repositories
and worktrees. Platform needs to show which concrete checkouts each participant
operated. Repositories may be several directory levels below the selected root.

Runtime already distinguishes `source`, `sandbox` and `worktree` workspaces,
with one cwd and optional managed-worktree state per session. Those fields
describe execution topology, not all directories or repos used by an agent.
The local tool runtime knows admitted filesystem targets; native providers emit
varying structured tool details. General shell execution may provide too little
evidence to establish actual operation targets.

Platform should not decode provider-specific events or scrape assistant prose
to manufacture workspace facts. Runtime owns provider normalization, path
mapping and managed workspace identity. Platform owns mapping Runtime sessions
to product conversations, lanes, runs and participants.

## Decision

### 1. Add a generic observational session contract

Expose bounded `workspaceActivity` snapshots through session inspection and
typed `workspace_activity` stream updates. A snapshot identifies its Runtime
session, observation epoch and revision, coverage/freshness, concrete workspaces
and their correlated running/recent operations.

Preserve the existing single cwd/workspace execution contract. An observed
workspace collection is not a collection of selected roots or permissions.
Do not add multi-root create/resume settings in this slice.

### 2. Admit evidence at the execution boundary

Capture validated targets and outcomes from Runtime-owned tools. Normalize
native provider tool facts only when the adapter has fixture-backed semantics
for paths, execution location and start/completion correlation. Prefer shared
observer/reducer logic over separate provider-owned activity stores.

A tool invocation establishes an attempt; a matching successful result may
establish completion. A write attempt is not automatically a verified change,
and a shell exit code alone is not proof of a classified test result.

Do not infer actual repository activity from model prose, directory names,
generic command strings or a recursive disk scan. Binding a managed worktree
establishes workspace context, not a read/write operation. Expose partial or
unavailable coverage when actual targets or outcomes cannot be verified.

### 3. Resolve Git identity without changing execution policy

Resolve repository and physical checkout identity for an admitted path on the
correct execution location. Recognize linked-worktree `.git` files, branches,
detached HEAD and ordinary non-Git folders. Distinguish independent clones and
multiple worktrees of the same repository.

Resolution is bounded, read-only and subject to existing path/metadata authority.
Never execute host Git against an unmapped guest/peer path, crawl the selected
root, grant agent shell access or follow an otherwise forbidden alias merely to
provide a label. Report unavailable facts explicitly.

An observed agent-created/external worktree remains unmanaged. Existing
managed-worktree state remains the only authority for Runtime lifecycle ownership;
this feature never adopts, merges, deletes or relocates a worktree.

### 4. Preserve truthful lifecycle, ordering and recovery

Scope revisions by `(sessionId, observationEpoch)`. Revisions increase within
an epoch; a new Runtime observation incarnation/reset gets a new epoch.
Serialize reducer updates and suppress duplicate or late operation results.
Inspection is authoritative when reconciling a stream epoch after reconnect.

Close/cancel/error terminates or invalidates running operations. Rehydrated
snapshots are last-known, with no operation treated as still running until
reconciled. Session fork/branch does not copy active operations into the child.
Deleting a session removes its retained activity under the existing retention rules.

Persist only a bounded sanitized checkpoint when the existing session store is
used. Any schema change needs validated, backed-up, atomic migration and explicit
failure/restart recovery tests. Do not retain obsolete execution interfaces.

### 5. Keep product identity and coverage policy in their owning layers

Runtime reports session/operation provenance and verified workspace facts.
It does not introduce Cat, participant, Code or Work record types. Platform
maps these facts through server-owned attachments; model-supplied identity
claims cannot reassign them.

Validate coverage per actual provider/instance execution mode. A provider with
unsupported observation remains executable under its existing contract. Missing
observation capability does not broaden authority or block an otherwise valid turn.

## Consequences

### Positive

- Products can show actual multi-repo work while retaining a common parent cwd.
- Provider/tool evidence, Git identity, retention and completeness have one owner.
- The observational contract supports future products without coupling Runtime
  to Code UI or requiring multi-root execution settings.

### Negative

- Native provider coverage needs fixture and bounded live validation; opaque shell
  behavior remains partial.
- Git identity caches, operation lifecycle and persisted checkpoints require
  cross-platform and recovery tests.
- Consumers must reconcile epochs/revisions and must expose unavailable data honestly.

### Neutral

- Bubble attribution, multiple Codespaces and multi-root permissions are outside
  this work. Existing worktree preparation and cleanup policies remain in force.
- No version bump, provider upgrade or publication follows from creating this proposal.

## Alternatives Considered

### Let Platform inspect provider payloads and run Git probes

Duplicates backend knowledge, weakens execution-location boundaries and makes
product output depend on provider formatting. Runtime owns normalization instead.

### Treat cwd or a discovered repository list as actual activity

Neither proves which checkout was used. Keep context, intent and admitted
operation evidence distinct.

### Require a separate session for every repository

Useful for explicitly isolated jobs, but does not satisfy the requested agents
sharing one parent cwd and operating several repositories during a run.

### General shell auditing or periodic filesystem scanning

Adds broad surveillance and substantial ambiguity. Start with observable tools,
verified provider contracts and explicit coverage limits.

## References

- [SPEC-037](../specs/SPEC-037-session-workspace-activity.md)
- [PLAN-047](../plans/PLAN-047-session-workspace-activity.md)
- [SPEC-014: Session maintenance and worktree isolation](../specs/SPEC-014-session-maintenance-worktree-isolation-and-compaction-hooks.md)
- [SPEC-002: Local tool runtime](../specs/SPEC-002-local-tool-runtime.md)
- [Platform SPEC-127](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-127-code-participant-workspace-visibility.md)

---

*Proposed: 2026-10-20*
*Decision authority: Owner; cross-repository review pending*
