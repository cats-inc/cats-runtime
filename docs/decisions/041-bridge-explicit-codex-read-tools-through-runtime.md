# ADR-041: Bridge Explicit Codex Read Tools Through Runtime

## Status

Accepted; native local read bridge implemented and verified.

## Context

The Platform PLAN-110 K4 Windows collaboration trial reached a writable
implementation worktree, but its Codex worker could not inspect files. The
owner-approved file-tool whitelist does not grant shell execution. Codex's
native file reads used PowerShell command execution, so Runtime correctly
declined them. Approving a command by a friendly display classification or
`Get-Content` substring would also authorize shell profiles and other parsing
effects that Runtime cannot rewrite at the approval boundary.

## Decision

Use the existing shared local tool runtime for a narrow Codex adapter bridge:

1. Advertise only `read_file` and `list_files`, and only when each exact
   canonical name is present in the session's existing `allowedTools` grant.
   This is opt-in even for `default` and `skip` permission modes. Ordinary
   sessions and coordinators without that explicit grant are unchanged.
2. Register native dynamic tools through the app-server experimental protocol.
   The adapter owns native schemas and responses; the shared tool runtime owns
   filesystem policy. Do not add a public HTTP contract or persisted schema.
3. Bind execution to the admitted local workspace, original child process and
   current thread/turn. Never accept a tool-supplied working directory. Initial
   support is native local execution; unverified remote path mappings fail
   closed. Cancellation or process replacement suppresses stale replies.
4. Recheck the granted subset and existing workspace/permission policy for
   every call. Reject malformed arguments, foreign thread/turn/namespace,
   unknown tools, path escapes, symbolic links/junctions and special files.
   Bound file inspection size and returned text. No write, shell or network
   handler is exposed through this bridge.
5. Preserve native command/file-change approval decisions. Dynamic tools add
   capabilities; they do not establish a firewall for every native tool.
6. Attempt the known protocol without an exact-version gate. A rejected
   required registration is an explicit bootstrap failure, never a fallback
   to broader permissions. Resume/fork support requires evidence of preserved
   tool registration and revalidation against the new session grant.

## Consequences

File-only collaboration can inspect its authorized workspace without granting
shell execution. The same path and tool policy remains reusable across API and
CLI backends. The adapter needs an asynchronous server-request response seam
with lifecycle protection, and compatibility evidence must cover experimental
registration. Bounded output alone is not proof of bounded filesystem I/O or
protection against arbitrary concurrent filesystem replacement.

## Validation Evidence

A zero-turn native probe on Windows with Codex 0.156.1 accepted initialization
with `experimentalApi: true` and `thread/start` with the two function tool
definitions. It returned a read-only, network-disabled sandbox and exited
normally. The probe used a new private profile without authentication. This
establishes registration compatibility only; it does not prove model dispatch,
resume/fork preservation or the complete adapter lifecycle.

A subsequent private Platform K4 trial used this bridge for real native file
inspection in both implementation and independent review. The implementation
created a captured local revision; review approved the observed contents and
the fixed host-run fixture tests passed. Native/Runtime/Work usage reconciled
exactly at 95,312 tokens. The overall Platform trial failed its 80,000-token
continuation threshold at final reporting; it is not bounded-workflow acceptance.
All copied authentication was removed and the owned Runtime stopped normally.

The focused adapter/transport suite passes 125 unique cases, including named
native environments, rejected WSL/Docker mapping, path aliases and limits,
foreign/stale calls, required bootstrap acknowledgement, real child-process
request/response delivery, cancellation/replacement and stdin EPIPE. One existing
one-second process-start timeout passed unchanged on isolated rerun. Runtime
compilation passes. Resume/fork with explicit read grants remains unsupported;
the bridge stops before launch rather than silently dropping the tools.

## Alternatives Considered

- Approve recognized shell read commands: rejected because the approval
  payload is not an execution parser or a way to disable shell profiles.
- Grant all commands or skip approval: rejected because it exceeds the
  collaboration's admitted capabilities.
- Implement a second provider-specific filesystem runtime: rejected because
  it duplicates the existing shared policy and path boundary.

## References

- [Shared local tools](../specs/SPEC-002-local-tool-runtime.md)
- [Backend-neutral runtime](./005-backend-neutral-runtime-and-api-backend.md)
- [Provider version drift](./035-never-block-provider-execution-on-exact-cli-version.md)
- [Platform collaboration rollout](https://github.com/cats-inc/cats-platform/blob/main/docs/plans/PLAN-110-orchestrator-knowledge-and-collaboration-rollout.md)

*Decision made: 2026-09-25*
