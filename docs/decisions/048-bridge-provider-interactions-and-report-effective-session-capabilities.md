# ADR-048: Bridge Provider Interactions and Report Effective Session Capabilities

## Status

Accepted for sliced implementation — 2026-10-28. The owner authorized documentation
PRs with auto-merge, then latest-source implementation with incremental commits.
Implementation has not started; publication and changing legacy permission defaults
remain outside this authorization.

## Context

Terminal Codex and Runtime both use the Codex CLI engine. Runtime launches
`codex app-server`, but a protocol host must handle the requests a terminal UI
would normally present. The current adapter answers user-input requests with an
empty answer and declines MCP elicitations. Both `default` and `skip` request
`approvalPolicy: never`; writable workspaces still use `workspace-write`.

Global provider MCP configuration can survive this launch. The missing pieces
therefore include interaction delivery, effective policy and session-specific
visibility, rather than simply replacing `spawn` or adding another MCP registry.
See the [dated investigation](../research/2026-10-28-codex-host-capability-gaps.md)
for source baselines, observed discovery and the limits of that evidence.

Platform already has task/supervision approvals and managed Cats plugins. Bots
already has an owner inbox and `ask_owner`. These are useful product foundations,
but none is a substitute for replying to the original provider request.

## Decision

Use one Runtime contract for live provider interactions, execution policy and
observed session capabilities; let each host own its presentation and product policy.

| Owner | Responsibility |
| --- | --- |
| Runtime | Provider protocol, request correlation, validated replies, lifecycle, effective permissions, live capability observations and provider process ownership |
| Platform | Authenticated product routing, conversation/participant attribution, approvals and input UI, Desktop settings and dependency diagnostics |
| Bots | Headless owner-response API, bot journal and serialized queue, note/tray notification and standalone settings |
| Provider / upstream helper | Native tools, provider configuration and account access, browser/computer connection and OS permissions |

1. Keep app-server as the Codex execution mode. Resolve capabilities from the
   actual executable, account, configuration, workspace and live worker. Do not
   impersonate an OpenAI desktop client or equate a process launch with tool readiness.
2. Make interaction hosting an explicitly negotiated capability. Requests remain
   pending until a valid reply, provider resolution, cancellation, expiry or worker
   loss. Replies use a control path independent of the occupied turn queue.
3. Separate provider requests from Cats task approvals. The product may display
   them together, but task approval never implicitly answers a provider request.
4. Separate approval policy from filesystem/network isolation. Add an explicit
   provider-policy mode and an explicit Cats-policy mode with effective results;
   preserve existing callers' behavior within the current minor line.
5. Keep user MCP/plugin configuration under provider ownership. Session MCP
   injection remains the bounded [SPEC-035](../specs/SPEC-035-session-mcp-servers.md)
   overlay. Do not copy credentials, replace `CODEX_HOME`, or overwrite user config
   to manufacture parity. Detect naming collisions instead of silently shadowing
   a user server.
6. Report what a live session advertises, what policy permits, and what has actually
   been verified separately. A catalog entry is not proof of a working desktop
   helper, permission grant, nested tool inventory or successful invocation.
7. Preserve [ADR-041](041-bridge-explicit-codex-read-tools-through-runtime.md)'s
   bounded dynamic read tools and [ADR-035](035-never-block-provider-execution-on-exact-cli-version.md)'s
   version-drift policy. `allowedTools` must not become a claim that every native
   or external MCP tool is universally filtered.

The governing specification is [SPEC-039](../specs/SPEC-039-provider-session-capabilities-and-interactions.md);
sequencing is [PLAN-049](../plans/PLAN-049-provider-session-capabilities-and-interactions.md).
Consumer specifications are `cats-platform SPEC-132 / PLAN-124` and
`cats-bots SPEC-004 / PLAN-004`, on each repository's
`docs/provider-session-capabilities` branch. They consume this contract rather than
copying provider wire schemas. Bots continues to have no Platform dependency.

## Consequences

### Positive

- Both products can expose native capabilities through the same execution boundary.
- Unsupported interactions and missing desktop dependencies become explainable.
- Reconnection, stale replies and permission changes have one execution authority.

### Negative

- Human waiting requires lifecycle handling beyond an ordinary streaming turn.
- Product UIs, Runtime transport and packaging must be validated together.
- Existing ambiguous permission labels require a coordinated consumer change.

### Neutral

- Native Windows Codex is the first implementation target; other providers and
  remote execution report their measured support without inheriting its claims.
- OpenAI Desktop-only capabilities can remain dependent on an installed, running
  upstream host. This decision does not license or promise their redistribution.
- Documentation introduces no new listener, version bump or data migration.

## Alternatives Considered

| Alternative | Reason not selected |
| --- | --- |
| Switch to terminal scraping / PTY | Does not solve host identity, policy, helper or lifecycle contracts; abandons structured requests |
| Set every session to `skip` | Still loses questions and elicitations; approval bypass does not establish full filesystem or browser access |
| Implement Codex separately in Platform and Bots | Duplicates adapters and lifecycle rules, bypassing the Runtime boundary |
| Route every Bot interaction through Platform | Breaks the standalone bot requirement |
| Manage all user plugins in Cats | Expands package/credential ownership beyond the requested capability integration |

## References

- [Session MCP overlay](044-configure-session-mcp-servers-for-provider-clis.md)
- [Platform MCP ownership](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/020-own-mcp-intent-in-product-and-tool-delivery-in-runtime.md)
- [Standalone Bot boundary](https://github.com/cats-inc/cats-bots/blob/main/docs/decisions/001-build-a-resident-bot-core-on-cats-runtime-with-disposable-presentation.md)

*Created / last updated: 2026-10-28*
