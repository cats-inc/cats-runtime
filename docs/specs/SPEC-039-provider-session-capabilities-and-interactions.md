# SPEC-039: Provider Session Capabilities and Interactions

## Metadata

| Field | Value |
| --- | --- |
| Status | Codex implemented (PLAN-049); Claude Code mapping approved for sliced implementation (PLAN-050) |
| Owner | Runtime execution boundary |
| Reviewer | Product owner and Runtime/Platform/Bots maintainers |
| Decision | [ADR-048](../decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md) |
| Plan | [PLAN-049](../plans/PLAN-049-provider-session-capabilities-and-interactions.md) (Codex), [PLAN-050](../plans/PLAN-050-claude-provider-interactions.md) (Claude Code) |
| Baseline | Runtime `7e92601a` (0.6.2 source); Bots consumes Runtime 0.6.1 |

## Summary

Expose provider questions, approvals and MCP elicitations to a capable host, return
the host's answer to the original live request, and report the session's effective
policy and observed tools. Native Codex is the first vertical slice. The target is
capability parity with a matched terminal environment, not parity inferred from a
provider name, plugin installation or `skip` setting.

All fields, routes and events below are **proposed**, not current public APIs.

## Goals

- Complete a provider interaction through Platform or a standalone Bot without
  creating a replacement model turn.
- Explain differences in executable, configuration source, cwd, project trust,
  policy, account access, MCP connection and native helper readiness.
- Preserve existing restricted workflows and old callers while adding opt-in support.

## Non-Goals

- A general plugin marketplace, credential migration, or control of user-owned
  MCP processes outside the provider's supported lifecycle.
- Automatic access to every tool in an OpenAI-hosted session or another account.
- Full cross-provider / WSL / container / remote parity in the first slice.
- Approval of arbitrary unknown protocol requests or automatic replay of effects.

## Requirements

### R1. Capability negotiation and provider selection

The provider-target capability read reports supported interaction kinds, policy
selection and inventory coverage separately. Support is based on executable mode
and implemented mappings, not an exact CLI-version allowlist. A session opts in
with a versioned host descriptor, provisionally:

```ts
interface InteractionHostV1 {
  version: 1;
  kinds: ('command_approval' | 'file_approval' | 'tool_approval' | 'permission_grant'
    | 'user_input' | 'mcp_form' | 'mcp_url')[];
  timeoutMs: number;
}
```

For this proposal, a host requests a 30-minute deadline; Runtime accepts 1 minute
through 24 hours. A shorter provider deadline wins. These limits are configuration,
not evidence that an upstream service waits equally long. Missing negotiation
retains existing behavior. An unsupported requested mode fails explicitly before
execution; never silently downgrade a requested interactive session to auto-denial.

### R2. Interaction identity and lifecycle

Every request has a Runtime `interactionId`, `sessionId`, current execution/turn
identity, worker generation, kind, creation/deadline timestamps, revision, status
and bounded display payload. Provider request IDs and wire shapes remain adapter
private. Associate a thread-only request only when the current execution is
unambiguous; otherwise return a safe unsupported result with a reason.

Lifecycle: `pending -> responding -> resolved`, or a terminal `expired`,
`cancelled`, `interrupted` or `unsupported`. Record the decision separately from
whether the provider confirmed resolution. A stdin write is not proof that the
requested external action happened. Provider resolution/turn completion can end
the request before the user replies and must disable the pending UI.

Do not change existing session status enums in this additive slice. The session
remains busy while its turn waits; a separate interaction/wait projection explains
why. UI disconnection alone does not cancel it. Worker replacement, session close,
turn cancellation and provider termination invalidate all outstanding requests.
Never restore an old callback by resuming a thread after process loss.

### R3. Reply control path

Proposed authenticated interfaces on the existing Runtime listener:

| Interface | Purpose |
| --- | --- |
| `GET /sessions/:id/interactions` | Bounded snapshot with revision and terminal receipts for reconnect reconciliation |
| `POST /sessions/:id/interactions/:interactionId/responses` | Validated typed response plus expected revision and idempotency key |
| Existing session stream and message stream | Negotiated `interaction_requested` / `interaction_updated` events using the same identity |
| `GET /sessions/:id/capabilities` | Observed policy, inventory and dependency snapshot; bounded refresh option |

These control requests must reach the worker while the normal turn gate is held.
Runtime authenticates the caller under its existing API boundary; the host applies
owner/conversation authorization before proxying. A session ID alone grants nothing.
Responses bind to the current worker, execution and revision. The first valid
decision wins. Same idempotency key/body returns the prior receipt; another body,
stale generation or conflicting decision returns a conflict without another write.
Unknown/foreign request errors reveal no payload. Expiry/cancellation wins against
a response that has not been committed; a committed response is never sent twice.

Store only bounded, redacted lifecycle receipts. Retain them for the current
worker lifetime with a bounded terminal history; a missing receipt is not permission
to replay. Reconnect uses snapshot then stream revision to avoid missed/duplicate
cards. Memory-only callbacks are not promised to survive a Runtime restart.

### R4. Typed payloads and Codex mapping

| Kind | Host data and response |
| --- | --- |
| Command / file approval | Provider-supplied command or file-change summary, cwd, offered choices and scope; return one supported choice |
| Tool approval | Any other tool call the provider asks to run, such as an MCP or browser tool: tool label, MCP server and a bounded input summary; return one supported choice |
| Permission grant | Requested filesystem/network/platform subset and supported scope; response may grant only an authorized subset |
| User input | Stable question IDs, text, options and free-text support; validate answers against the request |
| MCP form | Server identity, message and supported form schema; typed answer, decline or cancel |
| MCP URL | Server identity, destination and opaque correlation; user-controlled navigation and provider-specific completion semantics |

The initial Codex mapping covers `item/commandExecution/requestApproval`,
`item/fileChange/requestApproval`, `item/permissions/requestApproval`,
`item/tool/requestUserInput` and `mcpServer/elicitation/request`. Fixtures must
confirm actual method variants, notification order and supported capabilities.
Negotiate extended/experimental forms only when both adapter and host support them.

Never treat a generic task approval as a form answer. Render provider content as
untrusted text; bound schemas and payload sizes, reject unsupported schema features
explicitly, and never run schema-supplied code. URL handling must use the host's
safe external-navigation boundary, not execute arbitrary schemes. Private form
answers stay on the authenticated response path and out of logs/transcripts.

Unsupported forms, no capable host and expiry produce a typed non-grant outcome
with an observable reason. Do not submit a fabricated successful empty answer.
Automatic provider deadlines may close a request; they do not authorize guessed
answers or new permission grants. Approval policy can authorize an action without
human input, but it cannot invent required user data.

### R5. Execution policy and configuration provenance

The initial policy wire schema is additive and memory-only. Both modes use `version: 1`.
`provider` requires `constraints: { maxAccess, network }`, where `maxAccess` is
`read-only`, `workspace-write` or `full-access`, and `network` is a boolean ceiling.
`explicit` requires `access` from the same enum, `network` boolean and `approval`
of `never`, `untrusted` or `on-request`; its reviewer is explicitly the user.
The first native adapter rejects read-only with network enabled and full access
with network disabled because those combinations need a different native policy
representation. Workspace-write admits the provider's standard temporary-directory
access and only writable roots inside the session cwd. Enforcement coverage is
local processes; remote MCP side effects remain outside this sandbox boundary.
An interaction host is required, and new policy cannot override host read-only
constraints or a tool allowlist. New policy and request-level legacy permission
fields cannot be combined. This schema is being implemented in PLAN-049 P2.

Runtime persists only a versioned admission requirement marker for opted-in Runtime
and native thread identities. New sessions are recorded before execution; native
identities are bound before the first model turn. Markers contain `requiresHost`
and `requiresPolicy`, not settings, grants, prompts or callbacks. After restart a
marked session must re-negotiate before resuming/forking; absence of transient
settings cannot silently restore legacy execution. Existing unmarked sessions
retain their legacy behavior and data. A current validated backup is committed
before atomic primary replacement; recovery uses the stricter valid requirement,
unknown formats fail closed, and synchronous spawn failures restore prior state.
Markers remain when a session is unregistered so rediscovery cannot bypass them.
Consumers must capability-gate this opt-in contract before using an older Runtime.

Native auto-review cannot enforce a restricted host ceiling if it can approve
escapes without a Runtime callback, so provider mode rejects that combination.
Command/file approval replies can authorize a sandbox retry without bounded grant
parameters; this initial adapter offers them only under an admitted full-access /
network ceiling. Permission requests remain subject to subset and canonical-path
checks at registration and delivery. Later grants invalidate the completeness of
the bootstrap observation. These limits must be visible in host policy UI.

Add a versioned `executionPolicy` union with two modes:

- `provider`: preserve the selected provider's effective policy/configuration.
  Validate it against host admission constraints before execution; an incompatible
  inherited policy is rejected, not silently widened or narrowed.
- `explicit`: select approval behavior independently from a bounded filesystem /
  network policy. Include an explicitly selected full-access option only when the
  target supports it and the host admits it. Never infer this from legacy `skip`.

The final serialized policy schema and exact provider mapping are a P0 deliverable;
they must be reviewed before changing create/resume requests. Supplying both a new
policy and conflicting legacy controls is a validation error. Omitted new policy
preserves the existing contract. Read-only, whitelist and supervised execution
cannot opt into broader provider defaults by accident. Revocation/new policy takes
effect at a documented turn boundary; the old active turn retains its admitted
policy until cancellation or completion.

Return requested policy, observed effective approval/reviewer/sandbox/network settings,
enforcement coverage and discrepancy reasons. Verify the effective result on
create and resume before sending a model turn. If the adapter cannot establish
the required boundary, report unsupported/mismatch instead of advertising parity.
Show where configuration came from without returning config contents or secrets.
Do not expose sign-in tokens, raw environment values or authenticated MCP URLs.

For opted-in sessions, derive injected MCP tool approval settings from the admitted
policy. SPEC-035's existing unconditional `approve` overlay must not silently
override a new request for interactive approval. Keep its legacy behavior for old
callers; freeze the additive overlay-policy representation in P0. A local sandbox
does not establish enforcement over a remote MCP service's own side effects.

### R6. Tool inventory and readiness

Inventory belongs to the actual session/worker and includes observation time,
generation, source, pagination, completeness and errors. Separate built-in tools,
provider-configured MCP, session-injected MCP and Runtime dynamic tools. A target
catalog or the SPEC-035 delivery report alone is insufficient.

For each server/tool, distinguish advertised, connection/auth state, known policy
restriction and invocation evidence. Unknown is not disabled or ready. Preserve
auth-mechanism status separately: an `unsupported` auth method does not prove a
tool is unsupported. Names are qualified by source/server to avoid collisions.
Nested/lazy tool hosts can expose only partial discovery; report that coverage
without executing every tool or promising that the top-level list is exhaustive.

Read through the existing worker's supported discovery API. Never send a prompt,
start a new model turn, refresh credentials, launch another provider session or
invoke a mutating tool just to inspect. No worker yields `not_observed`; a bounded
cache is explicitly stale. Refresh may perform upstream MCP discovery and must
report failure/partial results without blocking the session indefinitely.

Record desktop/browser dependencies as `available`, `unavailable` or `unknown`,
with evidence source and a remediation hint. Discovery and successful invocation
are separate levels. Detect a stale upstream helper after it stops; do not infer
ownership of that helper or kill/restart a user-owned process. The Runtime code-mode
host is not evidence that OpenAI computer-use/browser helpers are running.

### R7. Compatibility, isolation and recovery

- Extend capability reads and opted-in sessions additively within Runtime 0.6.x.
  Changing the meaning of existing permission fields requires the next minor line.
  Record that boundary now; this document does not select a release version.
- Continue SPEC-035's HTTP/loopback injection constraints and credential handling.
  Native user configuration is a separate source, not restricted by that injection
  descriptor schema. Resolve overlay collisions before starting the turn.
- Keep pending handles in memory. Any durable policy/receipt schema introduced
  during implementation requires validation, backup, atomic replacement and tested
  failure recovery; do not sneak fields into old snapshots without an upgrade design.
- A disconnected host reconnects to a still-live request; a restarted worker yields
  interruption. No automatic replay, broadened grants or fabricated completion.
- Human waiting must not trigger idle eviction or be mistaken for a hung model.
  Keep a separate deadline and make cancellation/control requests responsive.
- Codex discovery must wait for the worker's exact native thread ID. A single
  pending worker in the same cwd is not identity evidence; startup scans can find
  older terminal threads before spawn completes. Failed fresh admission unregisters
  the Runtime row without deleting provider transcripts. Other providers' existing
  discovery-only identity strategies are outside this Codex change.

### R8. Claude Code mapping

Claude Code is the second native target, delivered by
[PLAN-050](../plans/PLAN-050-claude-provider-interactions.md). Evidence and
limits are in the [Claude protocol note](../research/2026-10-28-claude-host-control-protocol.md).
Its `stream-json` control frames (`control_request` / `control_response`,
correlated by `request_id`) stay private to the adapter.

- **Negotiation.** The Claude CLI target advertises `command_approval`,
  `file_approval`, `tool_approval`, `user_input`, `mcp_form` and `mcp_url`. It
  never advertises `permission_grant`, which has no Claude Code counterpart. A
  negotiated host adds `--permission-prompt-tool stdio`; without that flag the
  CLI denies approvals itself and omits `AskUserQuestion`.
- **Mapping.** `can_use_tool` for `AskUserQuestion` becomes `user_input` (one
  field per question; answers return keyed by question text). `Bash` and
  `PowerShell` become `command_approval`; `Write`, `Edit`, `MultiEdit` and
  `NotebookEdit` become `file_approval` with the path and size, never the file
  contents. Every other tool, including MCP and Claude in Chrome tools, becomes
  `tool_approval` with the tool label, MCP server and an input summary of at
  most 4 KiB. `elicitation` becomes `mcp_form` or `mcp_url`, reusing the bounded
  MCP form rules above.
- **Answers.** Accept returns `allow` with the original input; "allow for this
  session" is offered only for `addRules` suggestions and is forwarded with
  destination `session`. Persistent destinations and `setMode` suggestions are
  never forwarded. Decline returns `deny`; cancel returns `deny` with
  `interrupt`. A request whose kind was not negotiated, or an approval that
  would widen a read-only workspace, a tool allowlist or an admitted policy,
  is denied as unavailable.
- **Hostless requests.** The CLI asks for MCP elicitation even when no host was
  negotiated. The adapter declines it immediately instead of leaving the turn
  waiting. Unknown CLI control requests receive an error response;
  `control_cancel_request` resolves the matching interaction.
- **Legacy boundaries.** A read-only workspace and a tool allowlist launch with
  `--permission-mode manual`, so the user's own default mode (for example
  `auto`) cannot approve actions outside them. Unrestricted `default` keeps the
  user's configured mode; `skip` keeps `--dangerously-skip-permissions`.
- **Policy.** Claude Code has no sandbox on native Windows, so this adapter can
  enforce no filesystem or network ceiling. The target advertises
  `admissibleAccess: ['full-access']`; any narrower provider constraint or
  explicit access is rejected before execution with `interaction_unsupported`.
  Explicit `on-request` and `untrusted` launch `--permission-mode manual`;
  `never` launches `bypassPermissions`. Provider mode passes no mode flag. The
  adapter sends `initialize` before the first user message and verifies the
  reported `current_permission_mode` (`manual` reports `default`) before
  releasing the turn; a managed setting that changes the mode is a mismatch.
  The observed approval is the reported mode, and the reviewer is `user`,
  `auto_classifier` (for `auto`) or `none` (for `bypassPermissions` and
  `dontAsk`). Session MCP tools are pre-approved only without a policy or with
  explicit `never`.
- **Inventory.** `mcp_status` is read through the live worker without a model
  turn. Status maps to the connection enum (`pending` to `starting`,
  `needs-auth` to `authenticationRequired`); servers named like the session
  overlay are `session-injected`, all others `provider-configured`, including
  claude.ai connectors. Built-in tools are reported once `system/init` has
  listed them, after the first user message.
- **Dependencies.** Browser is `unknown` when `claude-in-chrome` is connected,
  because the extension may still have no browser; `unavailable` when the
  server is absent, with `--chrome` in the instance launch arguments as the
  remediation. Computer use is `unavailable`: Claude Code offers it only to
  interactive macOS sessions.

## Acceptance Criteria

| ID | Required evidence |
| --- | --- |
| A1 | Each supported interaction reaches a fixture host and returns the correctly typed response to the same live request |
| A2 | Duplicate, stale, foreign, expired and simultaneous conflicting responses never produce a second provider reply |
| A3 | UI reconnect preserves a live request; worker restart, cancellation and provider resolution close it truthfully |
| A4 | Legacy default/skip/whitelist and ADR-041 fixtures remain unchanged; new policy reports its verified effective boundary |
| A5 | Inventory distinguishes global MCP, injected MCP and dynamic tools, including partial discovery, no-worker and stale-helper states |
| A6 | Secrets/form answers stay out of logs, snapshots and transcript; overlay collision never silently replaces user configuration |
| A7 | Platform and standalone Bot independently complete an interaction; Bot works without Platform |
| A8 | Matched terminal/host comparison records CLI/config/cwd/policy/helper differences; controlled Chrome and desktop actions are verified separately |
| A9 | Claude: every advertised kind completes against a scripted CLI and a real CLI run; hostless elicitation is declined; narrower policies are rejected before execution; read-only and allowlist sessions cannot be widened by the user's default mode |

## Dependencies and Open Questions

- P0 freezes wire schema, payload/receipt limits, event compatibility and provider
  capability mapping with both consumers. The routes above are the design baseline.
- Native URL-flow completion and extended-form variants need current executable
  evidence. Unsupported variants remain explicit; no generic accept fallback.
- Upstream-only helper distribution is not settled by this design. Record the
  supported installed-host route and its constraints before any packaging proposal.
- Mobile/remote response ownership is deferred; local Desktop and headless Bot are
  the first acceptance hosts. Other providers retain existing behavior.

## References

- [Investigation and official sources](../research/2026-10-28-codex-host-capability-gaps.md)
- [Session MCP injection](SPEC-035-session-mcp-servers.md)
- Consumer contracts: `cats-platform SPEC-132`, `cats-bots SPEC-004`.

*Created / last updated: 2026-10-28*
