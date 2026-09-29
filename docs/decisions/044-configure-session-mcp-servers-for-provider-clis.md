# ADR-044: Configure session MCP servers for provider CLIs

Status: Proposed (2026-09-29). Requirements: [SPEC-035](../specs/SPEC-035-session-mcp-servers.md).
Delivery: [PLAN-046](../plans/PLAN-046-session-mcp-servers.md).

## Context

Hosts need the provider CLIs that Runtime spawns to call tools the host defines.
Cats Code is the first case (Platform ADR-126, SPEC-123): a Cat must be able to
open a preview through Platform-hosted MCP tools and receive the result in the
same turn. Runtime has no way to do this today:

- Session create accepts `instructions`, `skills`, `context` and `allowedTools`.
- No CLI adapter passes MCP configuration.
- A tool named only in prompt text or in `context` metadata is never callable.

Platform SPEC-121 FR-02 already assigns MCP/tool delivery for managed plugins to
Runtime. The MCP servers themselves stay independently hosted by their owners:
Platform, Apps (Platform ADR-125), plugins or remote services. Runtime is not a
proxy.

## Decision

1. **Accepted on create, resume and send.** Session create, `POST /sessions/:id/resume`
   and message send accept an optional `mcpServers` list. Claude and Codex
   workers are persistent: send never starts a new worker, and a closed session
   (for example after a Runtime restart) gets a new worker only through resume.
   Each entry names a server, its transport and URL, and an auth descriptor.
   Runtime only configures the provider CLI; the CLI connects directly, and
   Runtime never carries MCP traffic.
2. **Narrow first contract.**
   - `transport: 'http'` (Streamable HTTP) only, with a loopback URL.
   - `auth.kind` is `bearer_env` or `none`.
   - `stdio` transport, `oauth_ref` auth and unknown keys are rejected.
   - Server names are lowercase slugs, unique within a session and valid both
     as a TOML bare key and inside `mcp__<name>__<tool>`.
   - Owners use namespaces: `cats` for the Platform host, `app-<slug>` for Apps
     and a slug derived from the plugin ID for plugins (plugin IDs contain `/`).
     Runtime validates format and uniqueness, not ownership.
3. **Descriptors are secrets.** Runtime keeps them only in memory, keyed by
   session. It never persists them, never includes them in session reads, never
   logs them and never places them in argv. A bearer token reaches the child only
   through an environment variable. An omitted field keeps the current set; an
   empty list clears it. Descriptors survive a worker kill, so a respawn can use
   them, and are removed only with the session. Forks never inherit them: a fork
   has a new session identity, which a host grant must not follow.
4. **Native runtime only.** Docker and WSL execution pass the child environment
   through a launch payload that can reach argv. Session MCP servers are
   therefore `unsupported` unless the CLI instance runs in `native` mode, as for
   managed plugins. The same applies to non-CLI backends and peer-routed turns.
5. **Adapter opt-in.** An adapter declares support through an optional
   `ProviderCapabilities.sessionMcpServers` flag; unsupported adapters keep
   working without MCP. The planned first mappings are Claude Code
   (`--mcp-config` plus pre-authorized `mcp__<name>` tools) and Codex
   (`-c mcp_servers.<name>.*` with `bearer_token_env_var`, plus approval scoped to
   that server). Mappings follow the version-drift policy (ADR-035).
6. **Delivery report.** Delivery status is `delivered` (the worker running this
   session was launched with the current set), `unsupported` or `failed`. Each
   server carries a `connection` value of `connected`, `failed` or `unknown`,
   based on the provider's own evidence where it emits any. The report appears
   in create and resume JSON responses. For send, it is the first stream event:
   a `progress` event of kind `mcp_servers`, in the same position as the
   guardrail warning. Hosts use it to decide whether to advertise the tools;
   provider-level support alone is not proof.
7. **Changing the set.** A changed set applies to the next worker launch. For a
   supporting adapter, a send that changes the set of a live worker recycles
   that worker at the turn boundary through the existing resume path, before the
   turn is written.
8. **Surfaces.** The Runtime `/mcp` facade does not expose the field in v1: its
   `create_session` and `send_message` schemas stay closed. ACP `session/new`
   has its own client `mcpServers` field with a different meaning, and the two
   are not unified.

## Consequences

- One provider-neutral mechanism serves host, plugin, App and remote servers
  without a new field per consumer. OAuth and stdio can extend the same
  descriptor later.
- Remote Runtime deployments and Docker/WSL instances cannot reach loopback host
  tools. That limitation is explicit until a separate policy is designed.
- The optional request field is additive within the current 0.x line. This ADR
  implies no version bump.
